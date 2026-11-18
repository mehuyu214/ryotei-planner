'use strict';
const $ = (s) => document.querySelector(s);
const placeList = $('#placeList');
const statusEl = $('#status');
const MAX_PLACES = 25;
const PROFILE = { driving: 'driving', foot: 'foot', bike: 'bike' };
const GMODE = { driving: 'driving', foot: 'walking', bike: 'bicycling', transit: 'transit' };
const TRANSIT_API = 'https://ryotei-transit.netlify.app/route';
const FALLBACK_SPEED = { driving: 40, foot: 4.8, bike: 14 }; // km/h

const map = L.map('map').setView([35.681, 139.767], 11);
L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors', maxZoom: 19
}).addTo(map);
let mapLayer = L.layerGroup().addTo(map);

function setStatus(msg, isError) {
  statusEl.textContent = msg || '';
  statusEl.className = 'status' + (isError ? ' error' : '');
}

function addPlaceRow(name, stay, winStart, winEnd) {
  const idx = placeList.children.length;
  if (idx >= MAX_PLACES) { setStatus('場所は最大' + MAX_PLACES + '件までです', true); return; }
  const row = document.createElement('div');
  row.className = 'place-row';
  const isStart = idx === 0;
  row.innerHTML =
    '<div class="row-head"><span class="place-num' + (isStart ? ' start' : '') + '">' + (idx + 1) + '</span>' +
    '<input class="place-name" type="text" placeholder="' + (isStart ? '出発地（例：自宅・駅・ホテル）' : '場所名（例：東京タワー）') + '" value="">' +
    (isStart ? '' : '<button class="btn btn-small btn-danger row-del" type="button">削除</button>') + '</div>' +
    (isStart ? '<div class="place-note">出発地です。出発時刻にここを出ます。</div>' :
    '<div class="place-fields">' +
    '<label>滞在時間（分）<input class="f-stay" type="number" min="0" step="5" value="60"></label>' +
    '<label>いたい時間から<input class="f-ws" type="time"></label>' +
    '<label>いたい時間まで<input class="f-we" type="time"></label></div>' +
    '<div class="place-note">希望時間帯は空欄でもOK。その時間帯に滞在が収まるよう旅程を組みます。</div>');
  if (name) row.querySelector('.place-name').value = name;
  if (!isStart) {
    if (stay != null) row.querySelector('.f-stay').value = stay;
    if (winStart) row.querySelector('.f-ws').value = winStart;
    if (winEnd) row.querySelector('.f-we').value = winEnd;
    row.querySelector('.row-del').addEventListener('click', () => { row.remove(); renumber(); });
  }
  placeList.appendChild(row);
}
function renumber() {
  [...placeList.children].forEach((row, i) => {
    const num = row.querySelector('.place-num');
    num.textContent = i + 1;
    num.classList.toggle('start', i === 0);
  });
}
$('#addPlaceBtn').addEventListener('click', () => addPlaceRow());
$('#mode').addEventListener('change', () => {
  $('#fuelRow').style.display = $('#mode').value === 'driving' ? '' : 'none';
  $('#transitNote').hidden = $('#mode').value !== 'transit';
});
(function initDate() {
  const d = new Date();
  $('#tripDate').value = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
})();
addPlaceRow(); addPlaceRow(); addPlaceRow();

function timeToMin(v) { if (!v) return null; const [h, m] = v.split(':').map(Number); return h * 60 + m; }
function fmtTime(mins) {
  mins = Math.round(mins);
  const h = Math.floor(mins / 60), m = mins % 60;
  return h + ':' + String(m).padStart(2, '0');
}
function fmtDur(mins) {
  mins = Math.round(mins);
  if (mins < 60) return mins + '分';
  return Math.floor(mins / 60) + '時間' + (mins % 60 ? (mins % 60) + '分' : '');
}
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function geocode(name) {
  const url = 'https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&accept-language=ja&q=' + encodeURIComponent(name);
  const res = await fetch(url);
  if (!res.ok) throw new Error('geocode');
  const js = await res.json();
  if (!js.length) return null;
  return { lat: parseFloat(js[0].lat), lng: parseFloat(js[0].lon), label: js[0].display_name };
}
function haversineKm(a, b) {
  const R = 6371, dLa = (b.lat - a.lat) * Math.PI / 180, dLo = (b.lng - a.lng) * Math.PI / 180;
  const s = Math.sin(dLa / 2) ** 2 + Math.cos(a.lat * Math.PI / 180) * Math.cos(b.lat * Math.PI / 180) * Math.sin(dLo / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}
async function osrmTable(profile, pts) {
  const coords = pts.map(p => p.lng + ',' + p.lat).join(';');
  const res = await fetch('https://router.project-osrm.org/table/v1/' + profile + '/' + coords + '?annotations=duration');
  if (!res.ok) throw new Error('table');
  const js = await res.json();
  if (js.code !== 'Ok' || !js.durations) throw new Error('table');
  return js.durations.map(row => row.map(v => v == null ? 1e9 : v / 60)); // minutes
}
async function osrmRoute(profile, pts) {
  const coords = pts.map(p => p.lng + ',' + p.lat).join(';');
  const res = await fetch('https://router.project-osrm.org/route/v1/' + profile + '/' + coords + '?overview=full&geometries=geojson');
  if (!res.ok) throw new Error('route');
  const js = await res.json();
  if (js.code !== 'Ok' || !js.routes || !js.routes.length) throw new Error('route');
  return js.routes[0];
}

// Simulate a visiting order. order = array of place indices, order[0] is the start (fixed).
// Returns schedule details and score components (all minutes).
function simulate(order, dur, places, startMin, roundTrip) {
  let t = startMin, travel = 0, wait = 0, violation = 0;
  const stops = [{ idx: order[0], arr: startMin, stayStart: startMin, dep: startMin, wait: 0, viol: 0 }];
  for (let k = 1; k < order.length; k++) {
    const prev = order[k - 1], cur = order[k];
    const tr = dur[prev][cur];
    travel += tr;
    const arr = t + tr;
    const pl = places[cur];
    let stayStart = arr, w = 0;
    if (pl.winStart != null && arr < pl.winStart) { w = pl.winStart - arr; stayStart = pl.winStart; }
    const dep = stayStart + pl.stay;
    let viol = 0;
    if (pl.winStart != null && pl.winEnd != null) {
      const overlap = Math.max(0, Math.min(dep, pl.winEnd) - Math.max(stayStart, pl.winStart));
      viol = pl.stay - overlap;
    } else if (pl.winEnd != null && dep > pl.winEnd) {
      viol = dep - pl.winEnd;
    }
    wait += w; violation += viol;
    stops.push({ idx: cur, arr, stayStart, dep, wait: w, viol });
    t = dep;
  }
  let backTravel = 0;
  if (roundTrip && order.length > 1) {
    backTravel = dur[order[order.length - 1]][order[0]];
    travel += backTravel;
  }
  const score = violation * 10000 + travel + wait;
  return { stops, travel, wait, violation, score, endTime: t + backTravel, backTravel };
}

function optimize(places, dur, startMin, roundTrip) {
  const n = places.length;
  // Nearest-neighbour initial order by travel time
  const rest = new Set(); for (let i = 1; i < n; i++) rest.add(i);
  const order = [0]; let cur = 0;
  while (rest.size) {
    let best = null, bd = Infinity;
    for (const j of rest) if (dur[cur][j] < bd) { bd = dur[cur][j]; best = j; }
    order.push(best); rest.delete(best); cur = best;
  }
  let bestSim = simulate(order, dur, places, startMin, roundTrip);
  const movable = () => order.slice(1);
  const apply = (m) => [0, ...m];
  let improved = true, guard = 0;
  while (improved && guard++ < 80) {
    improved = false;
    const m = movable();
    // relocation
    outer:
    for (let i = 0; i < m.length; i++) {
      for (let j = 0; j < m.length; j++) {
        if (i === j) continue;
        const nm = m.slice(); const [x] = nm.splice(i, 1); nm.splice(j, 0, x);
        const s = simulate(apply(nm), dur, places, startMin, roundTrip);
        if (s.score < bestSim.score - 1e-9) { order.splice(0, order.length, ...apply(nm)); bestSim = s; improved = true; break outer; }
      }
    }
    if (improved) continue;
    // 2-opt reversal
    for (let i = 0; i < m.length - 1; i++) {
      for (let j = i + 1; j < m.length; j++) {
        const nm = m.slice(0, i).concat(m.slice(i, j + 1).reverse(), m.slice(j + 1));
        const s = simulate(apply(nm), dur, places, startMin, roundTrip);
        if (s.score < bestSim.score - 1e-9) { order.splice(0, order.length, ...apply(nm)); bestSim = s; improved = true; break; }
      }
      if (improved) break;
    }
  }
  return { order, sim: bestSim };
}

function legCostYen(km, mode, leg) {
  if (mode === 'transit') return leg && leg.fare ? leg.fare : 0;
  if (mode !== 'driving') return 0;
  const nenpi = parseFloat($('#nenpi').value) || 12;
  const tanka = parseFloat($('#tanka').value) || 170;
  return Math.round(km / nenpi * tanka);
}
function gmapsLink(a, b, mode) {
  return 'https://www.google.com/maps/dir/?api=1&origin=' + a.lat + ',' + a.lng +
    '&destination=' + b.lat + ',' + b.lng + '&travelmode=' + GMODE[mode];
}

async function calculate() {
  const btn = $('#calcBtn');
  const rows = [...placeList.children];
  const places = [];
  for (let i = 0; i < rows.length; i++) {
    const name = rows[i].querySelector('.place-name').value.trim();
    if (!name) { setStatus((i + 1) + '番目の場所名が空です', true); return; }
    const preset = rows[i].dataset.lat ? { lat: parseFloat(rows[i].dataset.lat), lng: parseFloat(rows[i].dataset.lng) } : null;
    if (i === 0) { places.push({ name, stay: 0, winStart: null, winEnd: null, ...(preset || {}) }); continue; }
    const stay = Math.max(0, parseInt(rows[i].querySelector('.f-stay').value, 10) || 0);
    let ws = timeToMin(rows[i].querySelector('.f-ws').value);
    let we = timeToMin(rows[i].querySelector('.f-we').value);
    if (ws != null && we != null && we <= ws) we += 1440; // window past midnight
    places.push({ name, stay, winStart: ws, winEnd: we, ...(preset || {}) });
  }
  if (places.length < 2) { setStatus('場所を2件以上入れてください', true); return; }
  const mode = $('#mode').value;
  const profile = PROFILE[mode];
  const startMin = timeToMin($('#startTime').value) ?? 540;
  const roundTrip = $('#roundTrip').checked;
  btn.disabled = true;
  try {
    // 1) Geocode
    for (let i = 0; i < places.length; i++) {
      if (places[i].lat != null && places[i].lng != null) continue; // imported coords
      setStatus('場所を検索中… ' + (i + 1) + '/' + places.length + '：' + places[i].name);
      const g = await geocode(places[i].name);
      if (!g) { setStatus('場所が見つかりませんでした：' + places[i].name + '（市区町村名を足すなど、書き方を変えてみてください）', true); return; }
      places[i].lat = g.lat; places[i].lng = g.lng;
      if (i < places.length - 1) await sleep(350);
    }
    if (mode === 'transit') {
      await calculateTransit(places, startMin, roundTrip);
      setStatus('計算できました（Googleマップの実ダイヤ・運賃）');
      return;
    }
    // 2) Duration matrix
    setStatus('移動時間を調べています…');
    let dur, usedFallback = false;
    try { dur = await osrmTable(profile, places); }
    catch (e) {
      usedFallback = true;
      dur = places.map(a => places.map(b => haversineKm(a, b) * 1.3 / FALLBACK_SPEED[mode] * 60));
    }
    // 3) Optimize order + schedule
    setStatus('最高効率の旅程を組んでいます…');
    const { order } = optimize(places, dur, startMin, roundTrip);
    // 4) Real route geometry + leg data
    const orderedPts = order.map(i => places[i]);
    const routePts = roundTrip ? orderedPts.concat([places[0]]) : orderedPts;
    let legs = [], geometry = null;
    try {
      const route = await osrmRoute(profile, routePts);
      geometry = route.geometry.coordinates.map(c => [c[1], c[0]]);
      legs = route.legs.map(l => ({ km: l.distance / 1000, min: l.duration / 60 }));
    } catch (e) {
      usedFallback = true;
      geometry = routePts.map(p => [p.lat, p.lng]);
      for (let k = 1; k < routePts.length; k++) {
        const a = routePts[k - 1], b = routePts[k];
        legs.push({ km: haversineKm(a, b) * 1.3, min: dur[order[k - 1] ?? 0][order[k] ?? 0] || haversineKm(a, b) * 1.3 / FALLBACK_SPEED[mode] * 60 });
      }
    }
    // Final schedule using route leg durations
    const legDur = [0]; legs.forEach(l => legDur.push(l.min));
    const durFinal = places.map(() => places.map(() => 0));
    for (let k = 1; k < order.length; k++) durFinal[order[k - 1]][order[k]] = legs[k - 1].min;
    if (roundTrip) durFinal[order[order.length - 1]][0] = legs[legs.length - 1].min;
    const sim = simulate(order, durFinal, places, startMin, roundTrip);
    renderResult(places, order, sim, legs, geometry, mode, roundTrip, startMin);
    setStatus(usedFallback ? '経路サービスの一部が使えなかったため概算で計算しました' : '計算できました');
  } catch (err) {
    setStatus(err && err.message ? err.message : '計算に失敗しました。通信環境を確認してもう一度お試しください', true);
  } finally {
    btn.disabled = false;
  }
}

let lastResult = null;
function renderResult(places, order, sim, legs, geometry, mode, roundTrip, startMin) {
  lastResult = { places, order, sim, legs, mode, roundTrip, startMin };
  mapLayer.clearLayers();
  if (geometry && geometry.length > 1) {
    L.polyline(geometry, { color: '#6156c8', weight: 5, opacity: 0.85 }).addTo(mapLayer);
  }
  order.forEach((pi, k) => {
    const p = places[pi];
    const icon = L.divIcon({ className: '', html: '<div class="num-marker' + (k === 0 ? ' start' : '') + '">' + (k + 1) + '</div>', iconSize: [28, 28], iconAnchor: [14, 14] });
    L.marker([p.lat, p.lng], { icon }).addTo(mapLayer).bindPopup('<b>' + (k + 1) + '. ' + escapeHtml(p.name) + '</b>');
  });
  if (geometry) map.fitBounds(L.latLngBounds(geometry), { padding: [30, 30] });

  const list = $('#resultList');
  list.innerHTML = '';
  let totalKm = 0, totalCost = 0;
  legs.forEach(l => { totalKm += l.km; totalCost += legCostYen(l.km, mode, l); });

  sim.stops.forEach((s, k) => {
    const p = places[s.idx];
    const card = document.createElement('div');
    card.className = 'stop-card';
    let html = '<h3><span class="badge">' + (k + 1) + '</span>' + escapeHtml(p.name) + '</h3>';
    if (k === 0) {
      html += '<div class="stop-times">' + fmtTime(s.dep) + ' 出発</div>';
    } else {
      html += '<div class="stop-times">' + fmtTime(s.arr) + ' 着 → ' + fmtTime(s.dep) + ' 発</div>';
      let meta = '滞在 ' + fmtDur(p.stay);
      if (s.wait > 0.5) meta += '（到着が早いため ' + fmtDur(s.wait) + ' 待ち）';
      if (p.winStart != null || p.winEnd != null) {
        const wtxt = '希望 ' + (p.winStart != null ? fmtTime(p.winStart) : '…') + '〜' + (p.winEnd != null ? fmtTime(p.winEnd) : '…');
        if (s.viol < 0.5) meta += '<br>' + wtxt + ' → <span class="win-ok">希望どおり</span>';
        else meta += '<br>' + wtxt + ' → <span class="win-ng">約' + Math.round(s.viol) + '分ズレ</span>';
      }
      html += '<div class="stop-meta">' + meta + '</div>';
    }
    card.innerHTML = html;
    list.appendChild(card);
    if (k < legs.length) {
      const leg = legs[k];
      const from = places[order[k]], to = k + 1 < order.length ? places[order[k + 1]] : places[0];
      const row = document.createElement('div');
      row.className = 'leg-row';
      row.innerHTML = '<span>移動 ' + leg.km.toFixed(1) + 'km ・ ' + fmtDur(leg.min) + ' ・ ' +
        (mode === 'driving' ? '燃料代 約' + legCostYen(leg.km, mode, leg) + '円' : '¥0') + '</span>' +
        '<a target="_blank" rel="noopener" href="' + gmapsLink(from, to, mode) + '">Googleマップで開く</a>';
      list.appendChild(row);
    }
  });
  if (roundTrip) {
    const card = document.createElement('div');
    card.className = 'stop-card';
    card.innerHTML = '<h3><span class="badge">1</span>' + escapeHtml(places[0].name) + '（帰着）</h3><div class="stop-times">' + fmtTime(sim.endTime) + ' 着</div>';
    list.appendChild(card);
  }
  const totalTravel = legs.reduce((a, l) => a + l.min, 0);
  $('#resultSummary').textContent = '移動 ' + fmtDur(totalTravel) + ' / 待ち ' + fmtDur(sim.wait) +
    (sim.violation >= 0.5 ? ' / 希望ズレ合計 約' + Math.round(sim.violation) + '分' : ' / 希望は全て達成');
  $('#pointCount').textContent = places.length;
  $('#totalDist').textContent = totalKm.toFixed(1) + 'km';
  $('#totalCost').textContent = mode === 'driving' ? '¥' + totalCost : '¥0';
}
function escapeHtml(s) { return s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
$('#calcBtn').addEventListener('click', calculate);

/* ===== 元サイト「Route Notebook」とのJSON互換（読込／書出） =====
   対応形式: ChatGPT旅程JSON（kind: "route-notebook-itinerary", version 1）と
   kind無しの全旅行JSON（trips/points/events を持つオブジェクト）。 */
let pendingImport = null;

function fmtHHMM(mins) {
  mins = ((Math.round(mins) % 1440) + 1440) % 1440;
  return String(Math.floor(mins / 60)).padStart(2, '0') + ':' + String(mins % 60).padStart(2, '0');
}
function loadPlacesIntoForm(list, firstTime) {
  placeList.innerHTML = '';
  list.forEach((it, i) => {
    addPlaceRow();
    const row = placeList.children[i];
    row.querySelector('.place-name').value = it.name;
    if (it.lat != null && it.lng != null) { row.dataset.lat = it.lat; row.dataset.lng = it.lng; }
    if (i > 0) {
      row.querySelector('.f-stay').value = it.stay != null ? it.stay : 60;
      if (it.winStart) row.querySelector('.f-ws').value = it.winStart;
      if (it.winEnd) row.querySelector('.f-we').value = it.winEnd;
    }
  });
  renumber();
  if (firstTime) $('#startTime').value = firstTime;
  lastResult = null;
}
function buildGroups(data) {
  const pointMap = new Map();
  (data.points || []).forEach(p => { if (p && p.id != null) pointMap.set(String(p.id), p); });
  const groups = new Map();
  (data.events || []).forEach(ev => {
    if (!ev || ev.pointId == null || !pointMap.has(String(ev.pointId))) return;
    const key = (ev.plan || '（旅程名なし）') + '|' + (ev.day || '（日付なし）');
    if (!groups.has(key)) groups.set(key, { label: (ev.plan || '（旅程名なし）') + ' / ' + (ev.day || '（日付なし）'), events: [] });
    groups.get(key).events.push(ev);
  });
  return { pointMap, groups };
}
function applyGroup(pointMap, group) {
  const evs = group.events.slice().sort((a, b) =>
    (String(a.time || '')).localeCompare(String(b.time || '')) || ((a.order || 0) - (b.order || 0)));
  const seen = new Set(); const list = [];
  evs.forEach(ev => {
    const p = pointMap.get(String(ev.pointId));
    if (!p || seen.has(String(p.id))) return;
    seen.add(String(p.id));
    const t = ev.time && /^\d{1,2}:\d{2}$/.test(ev.time) ? ev.time : null;
    let stay = 60, ws = t, we = null;
    if (typeof ev.stayMinutes === 'number' && ev.stayMinutes >= 0) {
      stay = ev.stayMinutes;
      if (t) { const end = timeToMin(t) + stay; if (end < 1440) we = fmtHHMM(end); }
    }
    list.push({ name: p.name, lat: (typeof p.lat === 'number' ? p.lat : null), lng: (typeof p.lon === 'number' ? p.lon : null), stay, winStart: ws, winEnd: we });
  });
  if (list.length < 2) { setStatus('読み込める地点が2件未満でした', true); return; }
  if (list.length > MAX_PLACES) list.length = MAX_PLACES;
  loadPlacesIntoForm(list, evs.length && evs[0].time ? evs[0].time : null);
  setStatus('「' + group.label + '」から ' + list.length + ' 件の場所を読み込みました。条件を直して計算できます');
}
$('#importBtn').addEventListener('click', () => $('#importFile').click());
$('#importFile').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  if (file.size > 10 * 1024 * 1024) { setStatus('ファイルが10MBを超えています', true); return; }
  let data;
  try { data = JSON.parse(await file.text()); }
  catch (err) { setStatus('JSONとして読み込めませんでした', true); return; }
  if (Array.isArray(data)) data = { points: data, events: [] };
  if (!data || (!Array.isArray(data.points) && !Array.isArray(data.events))) {
    setStatus('Route Notebook形式のJSONではありません（points / events が必要です）', true); return;
  }
  const { pointMap, groups } = buildGroups(data);
  if (!pointMap.size) { setStatus('地点（points）が見つかりませんでした', true); return; }
  if (!groups.size) {
    const list = [...pointMap.values()].map(p => ({ name: p.name, lat: (typeof p.lat === 'number' ? p.lat : null), lng: (typeof p.lon === 'number' ? p.lon : null), stay: 60, winStart: null, winEnd: null }));
    if (list.length > MAX_PLACES) list.length = MAX_PLACES;
    loadPlacesIntoForm(list, null);
    setStatus('地点 ' + list.length + ' 件を読み込みました（予定なし）');
    return;
  }
  if (groups.size === 1) { applyGroup(pointMap, [...groups.values()][0]); return; }
  pendingImport = { pointMap, groups };
  const sel = $('#importGroup');
  sel.innerHTML = '';
  groups.forEach((g, key) => {
    const opt = document.createElement('option');
    opt.value = key; opt.textContent = g.label + '（' + g.events.length + '件）';
    sel.appendChild(opt);
  });
  $('#importBar').hidden = false;
  setStatus('日程が ' + groups.size + ' 件あります。読み込む日程を選んでください');
});
$('#importApply').addEventListener('click', () => {
  if (!pendingImport) return;
  const g = pendingImport.groups.get($('#importGroup').value);
  $('#importBar').hidden = true;
  if (g) applyGroup(pendingImport.pointMap, g);
  pendingImport = null;
});

$('#exportBtn').addEventListener('click', async () => {
  if (!lastResult) {
    setStatus('書き出し用に、まず旅程を計算します…');
    await calculate();
    if (!lastResult) { setStatus('計算できなかったため書き出せませんでした', true); return; }
  }
  const { places, order, sim, legs, mode } = lastResult;
  const now = new Date();
  const startDate = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0') + '-' + String(now.getDate()).padStart(2, '0');
  const tripId = 'route-planner';
  const totalCost = legs.reduce((a, l) => a + legCostYen(l.km, mode, l), 0);
  const modeMap = { driving: 'driving', foot: 'walking', bike: 'bicycling', transit: 'transit' };
  const srcText = mode === 'transit' ? 'Route Planner（Googleマップ実ダイヤによる提案）' : 'Route Planner（OSRM経路計算による提案）';
  const out = {
    kind: 'route-notebook-itinerary', version: 1,
    trips: [{ id: tripId, title: 'Route Planner 旅程', startDate, endDate: startDate, budget: totalCost, note: 'Route Plannerで最適化した旅程' }],
    points: order.map((pi, k) => ({ id: 'rp_p' + (k + 1), tripId, name: places[pi].name, lat: Math.round(places[pi].lat * 1e6) / 1e6, lon: Math.round(places[pi].lng * 1e6) / 1e6 })),
    events: sim.stops.map((s, k) => ({
      id: 'rp_ev_' + String(k + 1).padStart(4, '0'), tripId, plan: '最適化旅程', day: startDate,
      time: fmtHHMM(s.arr), action: places[s.idx].name + 'を訪問', pointId: 'rp_p' + (k + 1),
      order: k, category: '観光', stayMinutes: places[s.idx].stay,
      travelMode: k === 0 ? 'unspecified' : modeMap[mode],
      cost: k === 0 ? 0 : legCostYen(legs[k - 1].km, mode, legs[k - 1]),
      confidence: '計画', source: srcText
    }))
  };
  if (lastResult.roundTrip) {
    out.events.push({
      id: 'rp_ev_' + String(out.events.length + 1).padStart(4, '0'), tripId, plan: '最適化旅程', day: startDate,
      time: fmtHHMM(sim.endTime), action: places[0].name + 'へ帰着', pointId: 'rp_p1',
      order: out.events.length, category: '交通', stayMinutes: 0,
      travelMode: modeMap[mode], cost: legCostYen(legs[legs.length - 1].km, mode, legs[legs.length - 1]),
      confidence: '計画', source: srcText
    });
  }
  const blob = new Blob([JSON.stringify(out, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'route-notebook-itinerary.json';
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  setStatus('ChatGPT旅程JSONを書き出しました。元サイトの「JSON読込」から取り込めます');
});

/* ===== 電車モード（Googleマップ実ダイヤ、Netlify Function経由で取得） ===== */
function pad2(n) { return String(n).padStart(2, '0'); }
function jstDateTime(epoch) {
  const d = new Date((epoch + 32400) * 1000);
  return {
    date: d.getUTCFullYear() + '-' + pad2(d.getUTCMonth() + 1) + '-' + pad2(d.getUTCDate()),
    time: pad2(d.getUTCHours()) + ':' + pad2(d.getUTCMinutes()),
    hm: d.getUTCHours() + ':' + pad2(d.getUTCMinutes()),
    mins: d.getUTCHours() * 60 + d.getUTCMinutes()
  };
}
function epochOfJST(dateStr, minOfDay) {
  const [Y, M, D] = dateStr.split('-').map(Number);
  return Math.floor(Date.UTC(Y, M - 1, D, 0, 0) / 1000) - 32400 + minOfDay * 60;
}
async function fetchTransitLeg(fromName, toName, epoch) {
  const p = jstDateTime(epoch);
  const url = TRANSIT_API + '?from=' + encodeURIComponent(fromName) + '&to=' + encodeURIComponent(toName) +
    '&date=' + p.date + '&time=' + p.time;
  const res = await fetch(url);
  const js = await res.json().catch(() => null);
  if (!res.ok || !js || js.error || !js.routes || !js.routes.length || !js.routes[0].depEpoch) {
    throw new Error(fromName + ' → ' + toName + ' の電車時刻を取得できませんでした' + (js && js.error ? '（' + js.error + '）' : '') + '。推定では埋めていません');
  }
  return js.routes[0];
}
async function calculateTransit(places, startMin, roundTrip) {
  const dateStr = $('#tripDate').value || jstDateTime(Math.floor(Date.now() / 1000)).date;
  setStatus('回る順序を決めています…');
  let dur;
  try { dur = await osrmTable('driving', places); }
  catch (e) { dur = places.map(a => places.map(b => haversineKm(a, b) * 1.3 / FALLBACK_SPEED.driving * 60)); }
  const { order } = optimize(places, dur, startMin, roundTrip);
  const day0 = epochOfJST(dateStr, 0);
  let cursor = day0 + startMin * 60;
  const stops = [{ idx: order[0], arrEpoch: cursor, stayStartEpoch: cursor, depEpoch: cursor, waitMin: 0, violMin: 0, trainWaitMin: 0 }];
  const legs = [];
  const seq = order.slice(1);
  if (roundTrip) seq.push(0);
  let prevIdx = order[0];
  for (let k = 0; k < seq.length; k++) {
    const curIdx = seq[k];
    setStatus('電車の時刻を調べています… ' + (k + 1) + '/' + seq.length + ' 区間目（' + places[prevIdx].name + ' → ' + places[curIdx].name + '）');
    if (k > 0) await sleep(700);
    const r = await fetchTransitLeg(places[prevIdx].name, places[curIdx].name, cursor);
    const trainWait = Math.max(0, (r.depEpoch - cursor) / 60);
    legs.push({ km: r.distanceKm || 0, min: r.durationMin || 0, fare: r.fareYen, lines: r.lines || [], depEpoch: r.depEpoch, arrEpoch: r.arrEpoch });
    const isReturnLeg = roundTrip && k === seq.length - 1 && curIdx === 0;
    if (isReturnLeg) {
      stops.push({ idx: 0, arrEpoch: r.arrEpoch, stayStartEpoch: r.arrEpoch, depEpoch: r.arrEpoch, waitMin: 0, violMin: 0, trainWaitMin: trainWait, isReturn: true });
      cursor = r.arrEpoch;
    } else {
      const pl = places[curIdx];
      let stayStart = r.arrEpoch, w = 0;
      if (pl.winStart != null) {
        const wsE = day0 + pl.winStart * 60;
        if (stayStart < wsE) { w = (wsE - stayStart) / 60; stayStart = wsE; }
      }
      const dep = stayStart + pl.stay * 60;
      let viol = 0;
      if (pl.winEnd != null) viol = Math.max(0, (dep - (day0 + pl.winEnd * 60)) / 60);
      stops.push({ idx: curIdx, arrEpoch: r.arrEpoch, stayStartEpoch: stayStart, depEpoch: dep, waitMin: w, violMin: viol, trainWaitMin: trainWait });
      cursor = dep;
    }
    prevIdx = curIdx;
  }
  renderTransit(places, order, stops, legs, roundTrip, cursor);
}
function renderTransit(places, order, stops, legs, roundTrip, endEpoch) {
  const simLike = {
    stops: stops.filter(s => !s.isReturn).map(s => ({ idx: s.idx, arr: jstDateTime(s.arrEpoch).mins, stayStart: jstDateTime(s.stayStartEpoch).mins, dep: jstDateTime(s.depEpoch).mins, wait: s.waitMin, viol: s.violMin })),
    wait: stops.reduce((a, s) => a + s.waitMin + s.trainWaitMin, 0),
    violation: stops.reduce((a, s) => a + s.violMin, 0),
    endTime: jstDateTime(endEpoch).mins
  };
  lastResult = { places, order, sim: simLike, legs, mode: 'transit', roundTrip, startMin: jstDateTime(stops[0].depEpoch).mins };
  mapLayer.clearLayers();
  const pts = order.map(i => places[i]);
  const linePts = pts.map(p => [p.lat, p.lng]);
  if (roundTrip && pts.length) linePts.push([pts[0].lat, pts[0].lng]);
  if (linePts.length > 1) L.polyline(linePts, { color: '#6156c8', weight: 4, opacity: 0.7, dashArray: '8 8' }).addTo(mapLayer);
  order.forEach((pi, k) => {
    const p = places[pi];
    const icon = L.divIcon({ className: '', html: '<div class="num-marker' + (k === 0 ? ' start' : '') + '">' + (k + 1) + '</div>', iconSize: [28, 28], iconAnchor: [14, 14] });
    L.marker([p.lat, p.lng], { icon }).addTo(mapLayer).bindPopup('<b>' + (k + 1) + '. ' + escapeHtml(p.name) + '</b>');
  });
  if (linePts.length) map.fitBounds(L.latLngBounds(linePts), { padding: [30, 30] });
  const list = $('#resultList');
  list.innerHTML = '';
  let totalKm = 0, totalFare = 0, fareUnknown = false, rideMin = 0;
  legs.forEach(l => { totalKm += l.km; rideMin += l.min; if (l.fare == null) fareUnknown = true; else totalFare += l.fare; });
  stops.forEach((s, k) => {
    const p = places[s.idx];
    const card = document.createElement('div');
    card.className = 'stop-card';
    let html = '<h3><span class="badge">' + (s.isReturn ? 1 : k + 1) + '</span>' + escapeHtml(p.name) + (s.isReturn ? '（帰着）' : '') + '</h3>';
    if (k === 0) {
      html += '<div class="stop-times">' + jstDateTime(s.depEpoch).hm + ' 出発</div>';
    } else if (s.isReturn) {
      html += '<div class="stop-times">' + jstDateTime(s.arrEpoch).hm + ' 着</div>';
    } else {
      html += '<div class="stop-times">' + jstDateTime(s.arrEpoch).hm + ' 着 → ' + jstDateTime(s.depEpoch).hm + ' 発</div>';
      let meta = '滞在 ' + fmtDur(p.stay);
      if (s.trainWaitMin > 0.5) meta += '（電車待ち ' + fmtDur(s.trainWaitMin) + '）';
      if (s.waitMin > 0.5) meta += '（到着が早いため ' + fmtDur(s.waitMin) + ' 待ち）';
      if (p.winStart != null || p.winEnd != null) {
        const wtxt = '希望 ' + (p.winStart != null ? fmtTime(p.winStart) : '…') + '〜' + (p.winEnd != null ? fmtTime(p.winEnd) : '…');
        if (s.violMin < 0.5) meta += '<br>' + wtxt + ' → <span class="win-ok">希望どおり</span>';
        else meta += '<br>' + wtxt + ' → <span class="win-ng">約' + Math.round(s.violMin) + '分ズレ</span>';
      }
      html += '<div class="stop-meta">' + meta + '</div>';
    }
    card.innerHTML = html;
    list.appendChild(card);
    if (k < legs.length) {
      const leg = legs[k];
      const from = places[s.idx], to = places[stops[k + 1].idx];
      const row = document.createElement('div');
      row.className = 'leg-row';
      row.innerHTML = '<span>' + jstDateTime(leg.depEpoch).hm + '発 → ' + jstDateTime(leg.arrEpoch).hm + '着 ・ ' +
        (leg.lines.length ? escapeHtml(leg.lines.join('・')) + ' ・ ' : '') + fmtDur(leg.min) + ' ・ ' +
        (leg.fare != null ? '¥' + leg.fare : '運賃不明') + '</span>' +
        '<a target="_blank" rel="noopener" href="' + gmapsLink(from, to, 'transit') + '">Googleマップで開く</a>';
      list.appendChild(row);
    }
  });
  $('#resultSummary').textContent = '乗車 ' + fmtDur(rideMin) + ' / 待ち ' + fmtDur(simLike.wait) +
    (simLike.violation >= 0.5 ? ' / 希望ズレ合計 約' + Math.round(simLike.violation) + '分' : ' / 希望は全て達成');
  $('#pointCount').textContent = places.length;
  $('#totalDist').textContent = totalKm.toFixed(1) + 'km';
  $('#totalCost').textContent = '¥' + totalFare + (fareUnknown ? '＋不明分' : '');
}
