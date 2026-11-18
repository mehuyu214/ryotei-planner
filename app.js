'use strict';
const $ = (s) => document.querySelector(s);
const placeList = $('#placeList');
const statusEl = $('#status');

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

function addPlaceRow(name, stay, winStart, winEnd, legMode) {
  const idx = placeList.children.length;
  const row = document.createElement('div');
  row.className = 'place-row';
  const isStart = idx === 0;
  row.innerHTML =
    '<div class="row-head"><span class="place-num' + (isStart ? ' start' : '') + '">' + (idx + 1) + '</span>' +
    '<input class="place-name" type="text" placeholder="' + (isStart ? '出発地（例：自宅・駅・ホテル）' : '場所名（例：東京タワー）') + '" value="">' +
    '<button class="btn btn-small gsearch-btn" type="button">Googleで検索</button>' +
    (isStart ? '' : '<button class="btn btn-small btn-danger row-del" type="button">削除</button>') + '</div>' +
    (isStart ? '<div class="place-note">出発地です。出発時刻にここを出ます。</div>' :
    '<div class="place-fields">' +
    '<label>滞在時間（分）<input class="f-stay" type="number" min="0" step="5" value="60"></label>' +
    '<label>いたい日時から<input class="f-ws" type="datetime-local"></label>' +
    '<label>いたい日時まで<input class="f-we" type="datetime-local"></label>' +
    '<label>ここへの移動（電車・バス・徒歩モード時）<select class="f-legmode"><option value="auto">おまかせ（速い方）</option><option value="transit">電車・バス</option><option value="walk">徒歩</option></select></label></div>' +
    '<div class="place-note">希望日時は空欄でもOK。その日時に滞在が収まるよう旅程を組みます。</div>') +
    '<div class="place-extra">' +
    '<label>分類<input class="f-cat" type="text" list="catList" placeholder="観光・食事・宿泊など"></label>' +
    '<label>住所・補足（見つからない時）<input class="f-addr" type="text" placeholder="住所や正式名称"></label>' +
    '<label>座標（緯度,経度）<input class="f-coord" type="text" placeholder="例：34.6795,135.1783"></label></div>';
  if (name) row.querySelector('.place-name').value = name;
  if (!isStart) {
    if (stay != null) row.querySelector('.f-stay').value = stay;
    if (winStart) row.querySelector('.f-ws').value = winStart;
    if (winEnd) row.querySelector('.f-we').value = winEnd;
    if (legMode) row.querySelector('.f-legmode').value = legMode;
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
placeList.addEventListener('click', e => {
  const gs = e.target.closest('.gsearch-btn');
  if (!gs) return;
  const nm = gs.closest('.place-row').querySelector('.place-name').value.trim();
  if (nm) window.open('https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(nm), '_blank', 'noopener');
});
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
// datetime-local の値 → 旅行初日0:00からの絶対分。旧形式 HH:MM はその日の時刻として扱う。
function dtAbsMin(v) {
  if (!v) return null;
  const m = String(v).match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/);
  if (!m) return timeToMin(v);
  const trip = $('#tripDate').value;
  if (!trip) return null;
  const [Y, M, D] = trip.split('-').map(Number);
  const dayDiff = Math.round((Date.UTC(+m[1], +m[2] - 1, +m[3]) - Date.UTC(Y, M - 1, D)) / 86400000);
  return dayDiff * 1440 + (+m[4]) * 60 + (+m[5]);
}
// 絶対分 → 「M/D H:MM」（初日は時刻のみ）
function fmtDT(absMin) {
  const day = Math.floor(absMin / 1440);
  const t = fmtTime(absMin - day * 1440);
  const trip = $('#tripDate').value;
  if (!trip || day === 0) return t;
  const [Y, M, D] = trip.split('-').map(Number);
  const d = new Date(Date.UTC(Y, M - 1, D + day));
  return (d.getUTCMonth() + 1) + '/' + d.getUTCDate() + ' ' + t;
}
const CAT_COLORS = { '宿泊': '#367ca3', '交通・駅': '#367ca3', '展示・イベント': '#15927b', '食事': '#ba507d', '喫茶': '#ba507d', '買い物': '#b07734', '観光': '#6254ba' };
function catColor(cat) { return CAT_COLORS[(cat || '').trim()] || '#6254ba'; }
function markerHtml(num, cat, isStart) {
  return '<div class="num-marker' + (isStart ? ' start' : '') + '" style="background:' + catColor(cat) + '">' + num + '</div>';
}
const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'];
function dayLabel(dayOffset) {
  const trip = $('#tripDate').value;
  if (!trip) return (dayOffset + 1) + '日目';
  const [Y, M, D] = trip.split('-').map(Number);
  const d = new Date(Date.UTC(Y, M - 1, D + dayOffset));
  return (d.getUTCMonth() + 1) + '月' + d.getUTCDate() + '日（' + WEEKDAYS[d.getUTCDay()] + '）';
}
function dayLabelFromISO(iso) {
  const [Y, M, D] = iso.split('-').map(Number);
  const d = new Date(Date.UTC(Y, M - 1, D));
  return M + '月' + D + '日（' + WEEKDAYS[d.getUTCDay()] + '）';
}
function switchTab(which) {
  const plan = which === 'plan';
  $('#panePlan').hidden = !plan;
  $('#paneTrip').hidden = plan;
  $('#tabBtnPlan').classList.toggle('active', plan);
  $('#tabBtnTrip').classList.toggle('active', !plan);
}
$('#tabBtnPlan').addEventListener('click', () => switchTab('plan'));
$('#tabBtnTrip').addEventListener('click', () => switchTab('trip'));
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

const placeCache = new Map();
async function googlePlace(q) {
  if (placeCache.has(q)) return placeCache.get(q);
  let out = null;
  try {
    // /route の応答に含まれる地点情報（places）で解決する（to は固定の参照地点）
    const now = new Date(Date.now() + 32400 * 1000);
    const date = now.getUTCFullYear() + '-' + pad2(now.getUTCMonth() + 1) + '-' + pad2(now.getUTCDate());
    const time = pad2(now.getUTCHours()) + ':' + pad2(now.getUTCMinutes());
    const res = await fetch(TRANSIT_API + '?from=' + encodeURIComponent(q) + '&to=' + encodeURIComponent('東京駅') + '&date=' + date + '&time=' + time);
    if (res.ok) { const j = await res.json(); if (j && j.places && j.places[0] && j.places[0].lat != null) out = j.places[0]; }
  } catch (e) { /* Googleで取れなければ次の手段へ */ }
  placeCache.set(q, out);
  await sleep(300);
  return out;
}
// 場所の特定：座標欄 → 取込済み座標 → Google検索 → OSM検索 の順で解決する
async function resolvePlaces(places, rows) {
  for (let i = 0; i < places.length; i++) {
    const p = places[i], row = rows[i];
    const addr = row.querySelector('.f-addr').value.trim();
    const coordTxt = row.querySelector('.f-coord').value.trim();
    const cm = coordTxt.match(/(-?\d{1,3}\.\d+)\s*[,、]\s*(-?\d{1,3}\.\d+)/);
    if (cm) {
      p.lat = parseFloat(cm[1]); p.lng = parseFloat(cm[2]);
      p.query = p.lat + ',' + p.lng; p.address = addr || '';
      continue;
    }
    if (p.lat != null && p.lng != null) { // 取込済みの座標
      p.query = addr ? (p.name + ' ' + addr) : p.name;
      p.address = addr || '';
      continue;
    }
    setStatus('場所をGoogleで検索中… ' + (i + 1) + '/' + places.length + '：' + p.name);
    const q = addr ? (p.name + ' ' + addr) : p.name;
    const gp = await googlePlace(q);
    if (gp) { p.lat = gp.lat; p.lng = gp.lng; p.address = gp.address || addr || ''; p.query = gp.name || q; continue; }
    const g = await geocode(q);
    if (g) { p.lat = g.lat; p.lng = g.lng; p.query = q; p.address = addr || ''; continue; }
    throw new Error('場所が見つかりませんでした：「' + p.name + '」。行の「Googleで検索」ボタンで正式名称や住所を確認し、住所・補足欄に住所を書くか、座標欄に「緯度,経度」を入力してください。');
  }
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

// 全通り探索（回る場所が9件以下のとき）。それ以上は近似探索（optimize）に切り替える。
function bestOrder(places, dur, startMin, roundTrip) {
  const idx = [];
  for (let i = 1; i < places.length; i++) idx.push(i);
  if (idx.length > 9) return optimize(places, dur, startMin, roundTrip);
  let best = null;
  const perm = idx.slice();
  const evalPerm = () => {
    const order = [0, ...perm];
    const sim = simulate(order, dur, places, startMin, roundTrip);
    if (!best || sim.score < best.sim.score) best = { order, sim };
  };
  evalPerm();
  const c = new Array(perm.length).fill(0);
  let i = 0;
  while (i < perm.length) {
    if (c[i] < i) {
      const j = i % 2 === 0 ? 0 : c[i];
      const tmp = perm[j]; perm[j] = perm[i]; perm[i] = tmp;
      evalPerm(); c[i]++; i = 0;
    } else { c[i] = 0; i++; }
  }
  return best;
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

function buildPlaces(rows) {
  const places = [];
  for (let i = 0; i < rows.length; i++) {
    const name = rows[i].querySelector('.place-name').value.trim();
    if (!name) { setStatus((i + 1) + '番目の場所名が空です', true); return null; }
    const preset = rows[i].dataset.lat ? { lat: parseFloat(rows[i].dataset.lat), lng: parseFloat(rows[i].dataset.lng) } : null;
    const cat = rows[i].querySelector('.f-cat') ? rows[i].querySelector('.f-cat').value.trim() : '';
    if (i === 0) { places.push({ name, cat, stay: 0, winStart: null, winEnd: null, ...(preset || {}) }); continue; }
    const stay = Math.max(0, parseInt(rows[i].querySelector('.f-stay').value, 10) || 0);
    let ws = dtAbsMin(rows[i].querySelector('.f-ws').value);
    let we = dtAbsMin(rows[i].querySelector('.f-we').value);
    if (ws != null && we != null && we <= ws) we = null; // 終了が開始以前なら「開始のみ」の希望として扱う
    const legMode = rows[i].querySelector('.f-legmode') ? rows[i].querySelector('.f-legmode').value : 'auto';
    places.push({ name, cat, stay, winStart: ws, winEnd: we, legMode, ...(preset || {}) });
  }
  if (places.length < 2) { setStatus('場所を2件以上入れてください', true); return null; }
  return places;
}

async function runRoadMode(places, startMin, roundTrip, mode) {
  const profile = PROFILE[mode];
  setStatus('移動時間を調べています…');
  let dur, usedFallback = false;
  try { dur = await osrmTable(profile, places); }
  catch (e) {
    usedFallback = true;
    dur = places.map(a => places.map(b => haversineKm(a, b) * 1.3 / FALLBACK_SPEED[mode] * 60));
  }
  setStatus('最高効率の旅程を組んでいます…');
  const { order } = bestOrder(places, dur, startMin, roundTrip);
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
  const durFinal = places.map(() => places.map(() => 0));
  for (let k = 1; k < order.length; k++) durFinal[order[k - 1]][order[k]] = legs[k - 1].min;
  if (roundTrip) durFinal[order[order.length - 1]][0] = legs[legs.length - 1].min;
  const sim = simulate(order, durFinal, places, startMin, roundTrip);
  renderResult(places, order, sim, legs, geometry, mode, roundTrip, startMin);
  setStatus(usedFallback ? '経路サービスの一部が使えなかったため概算で計算しました' : '計算できました');
}

async function calculate() {
  const btn = $('#calcBtn');
  const rows = [...placeList.children];
  const places = buildPlaces(rows);
  if (!places) return;
  const mode = $('#mode').value;
  const startMin = timeToMin($('#startTime').value) ?? 540;
  const roundTrip = $('#roundTrip').checked;
  btn.disabled = true;
  try {
    // 場所の特定（座標欄 → 取込済み座標 → Google検索 → OSM検索）
    await resolvePlaces(places, rows);
    if (mode === 'transit') {
      const r = await calculateTransit(places, startMin, roundTrip);
      setStatus(r.failedPairs
        ? '計算できました（一部 ' + r.failedPairs + ' 区間はGoogleで経路が見つからず、順序決定で強く不利に扱いました）'
        : (r.proxy ? '計算できました（地点が多いため順序決定は概算時間、表示する時刻はGoogle実ダイヤ）' : '計算できました（全区間Google実データ・全通り探索）'), r.failedPairs > 0);
      return;
    }
    await runRoadMode(places, startMin, roundTrip, mode);
  } catch (err) {
    setStatus(err && err.message ? err.message : '計算に失敗しました。通信環境を確認してもう一度お試しください', true);
  } finally {
    btn.disabled = false;
  }
}

async function showPins() {
  const btn = $('#pinBtn');
  const rows = [...placeList.children];
  const places = buildPlaces(rows);
  if (!places) return;
  btn.disabled = true;
  try {
    await resolvePlaces(places, rows);
    places.forEach((p, i) => {
      rows[i].dataset.lat = p.lat; rows[i].dataset.lng = p.lng;
      const coordEl = rows[i].querySelector('.f-coord');
      if (coordEl && !coordEl.value) coordEl.value = p.lat.toFixed(6) + ',' + p.lng.toFixed(6);
      const addrEl = rows[i].querySelector('.f-addr');
      if (addrEl && !addrEl.value && p.address) addrEl.value = p.address;
    });
    mapLayer.clearLayers();
    const pts = [];
    places.forEach((p, i) => {
      pts.push([p.lat, p.lng]);
      const icon = L.divIcon({ className: '', html: markerHtml(i + 1, p.cat, i === 0), iconSize: [28, 28], iconAnchor: [14, 14] });
      let pop = '<b>' + (i + 1) + '. ' + escapeHtml(p.name) + '</b>';
      if (p.cat) pop += '<br>分類：' + escapeHtml(p.cat);
      if (p.address) pop += '<br>' + escapeHtml(p.address);
      if (i > 0) {
        pop += '<br>滞在 ' + fmtDur(p.stay);
        if (p.winStart != null || p.winEnd != null) pop += '<br>希望 ' + (p.winStart != null ? fmtDT(p.winStart) : '…') + '〜' + (p.winEnd != null ? fmtDT(p.winEnd) : '…');
      }
      L.marker([p.lat, p.lng], { icon }).addTo(mapLayer).bindPopup(pop);
    });
    if (pts.length) map.fitBounds(L.latLngBounds(pts), { padding: [30, 30] });
    setStatus('ピンを表示しました（' + places.length + '件）。このまま旅程を計算できます');
    saveDraft();
  } catch (err) {
    setStatus(err && err.message ? err.message : '場所の特定に失敗しました', true);
  } finally { btn.disabled = false; }
}
$('#pinBtn').addEventListener('click', showPins);

let lastResult = null;
function renderResult(places, order, sim, legs, geometry, mode, roundTrip, startMin) {
  lastResult = { places, order, sim, legs, mode, roundTrip, startMin, geometry };
  mapLayer.clearLayers();
  if (geometry && geometry.length > 1) {
    L.polyline(geometry, { color: '#6156c8', weight: 5, opacity: 0.85 }).addTo(mapLayer);
  }
  order.forEach((pi, k) => {
    const p = places[pi];
    const icon = L.divIcon({ className: '', html: markerHtml(k + 1, p.cat, k === 0), iconSize: [28, 28], iconAnchor: [14, 14] });
    L.marker([p.lat, p.lng], { icon }).addTo(mapLayer).bindPopup('<b>' + (k + 1) + '. ' + escapeHtml(p.name) + '</b>' + (p.cat ? '<br>' + escapeHtml(p.cat) : ''));
  });
  if (geometry) map.fitBounds(L.latLngBounds(geometry), { padding: [30, 30] });

  const list = $('#resultList');
  list.innerHTML = '';
  let totalKm = 0, totalCost = 0;
  legs.forEach(l => { totalKm += l.km; totalCost += legCostYen(l.km, mode, l); });

  let curDay = -1;
  sim.stops.forEach((s, k) => {
    const p = places[s.idx];
    const stopDay = Math.floor((k === 0 ? s.dep : s.arr) / 1440);
    if (stopDay !== curDay) {
      curDay = stopDay;
      const dh = document.createElement('div');
      dh.className = 'day-head';
      dh.textContent = dayLabel(stopDay);
      list.appendChild(dh);
    }
    const card = document.createElement('div');
    card.className = 'stop-card';
    let html = '<h3><span class="badge">' + (k + 1) + '</span>' + escapeHtml(p.name) + '</h3>';
    if (k === 0) {
      html += '<div class="stop-times">' + fmtDT(s.dep) + ' 出発</div>';
    } else {
      html += '<div class="stop-times">' + fmtDT(s.arr) + ' 着 → ' + fmtDT(s.dep) + ' 発</div>';
      let meta = (p.cat ? escapeHtml(p.cat) + ' ・ ' : '') + '滞在 ' + fmtDur(p.stay);
      if (s.wait > 0.5) meta += '（到着が早いため ' + fmtDur(s.wait) + ' 待ち）';
      if (p.winStart != null || p.winEnd != null) {
        const wtxt = '希望 ' + (p.winStart != null ? fmtDT(p.winStart) : '…') + '〜' + (p.winEnd != null ? fmtDT(p.winEnd) : '…');
        if (s.viol < 0.5) meta += '<br>' + wtxt + ' → <span class="win-ok">希望どおり</span>';
        else meta += '<br>' + wtxt + ' → <span class="win-ng">約' + Math.round(s.viol) + '分ズレ</span>';
      }
      html += '<div class="stop-meta">' + meta + '</div>';
    }
    if (p.address) html += '<div class="stop-meta">' + escapeHtml(p.address) + '</div>';
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
    const endDay = Math.floor(sim.endTime / 1440);
    if (endDay !== curDay) {
      const dh = document.createElement('div');
      dh.className = 'day-head';
      dh.textContent = dayLabel(endDay);
      list.appendChild(dh);
    }
    const card = document.createElement('div');
    card.className = 'stop-card';
    card.innerHTML = '<h3><span class="badge">1</span>' + escapeHtml(places[0].name) + '（帰着）</h3><div class="stop-times">' + fmtDT(sim.endTime) + ' 着</div>';
    list.appendChild(card);
  }
  const totalTravel = legs.reduce((a, l) => a + l.min, 0);
  $('#resultSummary').textContent = '移動 ' + fmtDur(totalTravel) + ' / 待ち ' + fmtDur(sim.wait) +
    (sim.violation >= 0.5 ? ' / 希望ズレ合計 約' + Math.round(sim.violation) + '分' : ' / 希望は全て達成');
  $('#pointCount').textContent = places.length;
  $('#totalDist').textContent = totalKm.toFixed(1) + 'km';
  $('#totalCost').textContent = mode === 'driving' ? '¥' + totalCost : '¥0';
  $('#tripEmpty').hidden = true;
  switchTab('trip');
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
    if (it.cat) row.querySelector('.f-cat').value = it.cat;
    if (it.address) row.querySelector('.f-addr').value = it.address;
    if (it.lat != null && it.lng != null) row.querySelector('.f-coord').value = it.lat + ',' + it.lng;
    if (i > 0) {
      row.querySelector('.f-stay').value = it.stay != null ? it.stay : 60;
      if (it.winStart) row.querySelector('.f-ws').value = it.winStart;
      if (it.winEnd) row.querySelector('.f-we').value = it.winEnd;
      if (it.legMode) row.querySelector('.f-legmode').value = it.legMode;
    }
  });
  renumber();
  if (firstTime) $('#startTime').value = firstTime;
  lastResult = null;
}
function dayToISODate(day) {
  if (!day) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(day)) return day;
  const m = String(day).match(/^(\d{1,2})\/(\d{1,2})/);
  if (m) {
    const yr = ($('#tripDate').value || '').slice(0, 4) || String(new Date().getFullYear());
    return yr + '-' + pad2(+m[1]) + '-' + pad2(+m[2]);
  }
  return null;
}
function addMinToDT(dtStr, mins) {
  const m = String(dtStr).match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/);
  if (!m) return null;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5] + mins));
  return d.getUTCFullYear() + '-' + pad2(d.getUTCMonth() + 1) + '-' + pad2(d.getUTCDate()) + 'T' + pad2(d.getUTCHours()) + ':' + pad2(d.getUTCMinutes());
}
function buildGroups(data) {
  const pointMap = new Map();
  (data.points || []).forEach(p => { if (p && p.id != null) pointMap.set(String(p.id), p); });
  const groups = new Map();
  (data.events || []).forEach(ev => {
    if (!ev || ev.pointId == null || !pointMap.has(String(ev.pointId))) return;
    const key = (ev.plan || '（旅程名なし）') + '|' + (ev.day || '（日付なし）');
    if (!groups.has(key)) groups.set(key, { label: (ev.plan || '（旅程名なし）') + ' / ' + (ev.day || '（日付なし）'), plan: ev.plan || '（旅程名なし）', events: [] });
    groups.get(key).events.push(ev);
  });
  // プランが複数日にまたがる場合は、まとめて読み込める「全日程」も用意する
  const byPlan = new Map();
  groups.forEach(g => { if (!byPlan.has(g.plan)) byPlan.set(g.plan, []); byPlan.get(g.plan).push(g); });
  const merged = [];
  byPlan.forEach((gs, plan) => {
    if (gs.length > 1) merged.push(['all|' + plan, { label: plan + ' / 全日程（' + gs.length + '日間）', plan, events: gs.flatMap(g => g.events) }]);
  });
  if (merged.length) {
    const rest = [...groups.entries()];
    groups.clear();
    merged.forEach(([k, v]) => groups.set(k, v));
    rest.forEach(([k, v]) => groups.set(k, v));
  }
  return { pointMap, groups };
}
function applyGroup(pointMap, group) {
  const evs = group.events.slice().sort((a, b) =>
    String(a.day || '').localeCompare(String(b.day || '')) ||
    (String(a.time || '')).localeCompare(String(b.time || '')) || ((a.order || 0) - (b.order || 0)));
  const seen = new Set(); const list = [];
  evs.forEach(ev => {
    const p = pointMap.get(String(ev.pointId));
    if (!p || seen.has(String(p.id))) return;
    seen.add(String(p.id));
    const t = ev.time && /^\d{1,2}:\d{2}$/.test(ev.time) ? ev.time : null;
    let stay = 60;
    if (typeof ev.stayMinutes === 'number' && ev.stayMinutes >= 0) stay = ev.stayMinutes;
    const isoDay = dayToISODate(ev.day);
    let ws = null, we = null;
    if (isoDay && t) { ws = isoDay + 'T' + t; we = addMinToDT(ws, stay); }
    list.push({ name: p.name, lat: (typeof p.lat === 'number' ? p.lat : null), lng: (typeof p.lon === 'number' ? p.lon : null), address: p.address || '', cat: p.category || '', stay, winStart: ws, winEnd: we, legMode: ev.travelMode === 'walking' ? 'walk' : (ev.travelMode === 'transit' ? 'transit' : 'auto') });
  });
  if (list.length < 2) { setStatus('読み込める地点が2件未満でした。複数日の旅程は「全日程」でも読み込めます', true); return; }
  const isoDays = evs.map(ev => dayToISODate(ev.day)).filter(Boolean).sort();
  if (isoDays.length) $('#tripDate').value = isoDays[0];
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
    opt.value = key; opt.textContent = g.label + '（予定' + g.events.length + '件）';
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
  const R = lastResult;
  const places = R.places, order = R.order, legs = R.legs;
  const mode = (R.kind === 'transit' || R.mode === 'transit') ? 'transit' : R.mode;
  const tripId = 'route-planner';
  const modeMap = { driving: 'driving', foot: 'walking', bike: 'bicycling', transit: 'transit' };
  const srcText = mode === 'transit' ? 'Route Planner（Googleマップ実ダイヤによる提案）' : 'Route Planner（OSRM経路計算による提案）';
  const legCost = (k) => {
    const leg = legs[k];
    if (!leg) return 0;
    return mode === 'transit' ? (leg.fare || 0) : legCostYen(leg.km, mode, leg);
  };
  const totalCost = legs.reduce((a, l, k) => a + legCost(k), 0);
  // 停車を「日付＋HH:MM」に正規化する（複数日にまたがる旅程も正しい日付で書き出す）
  const isoOfDayOff = (off) => {
    const trip = $('#tripDate').value;
    if (!trip) return '';
    const [Y, M, D] = trip.split('-').map(Number);
    const d = new Date(Date.UTC(Y, M - 1, D + off));
    return d.getUTCFullYear() + '-' + pad2(d.getUTCMonth() + 1) + '-' + pad2(d.getUTCDate());
  };
  let stopsN = [], returnStop = null;
  if (R.kind === 'transit' || R.mode === 'transit') {
    let seenFirst = false;
    R.stopsRaw.forEach(s => {
      if (s.isReturn) { const dt = jstDateTime(s.arrEpoch); returnStop = { idx: s.idx, date: dt.date, time: dt.time }; return; }
      // イベント時刻は「実際に滞在を始める時刻」（到着後の待ちを除く）
      const visitEpoch = !seenFirst ? (s.arrEpoch || s.depEpoch) : (s.depEpoch - places[s.idx].stay * 60);
      seenFirst = true;
      const dt = jstDateTime(visitEpoch);
      stopsN.push({ idx: s.idx, date: dt.date, time: dt.time });
    });
  } else {
    stopsN = R.sim.stops.map((s, k) => {
      const visit = k === 0 ? s.arr : s.dep - places[s.idx].stay; // 実際の滞在開始（待ちを除く）
      return { idx: s.idx, date: isoOfDayOff(Math.floor(visit / 1440)), time: fmtHHMM(visit) };
    });
    if (R.roundTrip) returnStop = { idx: 0, date: isoOfDayOff(Math.floor(R.sim.endTime / 1440)), time: fmtHHMM(R.sim.endTime) };
  }
  const startDate = stopsN.length ? stopsN[0].date : ($('#tripDate').value || '');
  const endDate = returnStop ? returnStop.date : (stopsN.length ? stopsN[stopsN.length - 1].date : startDate);
  const out = {
    kind: 'route-notebook-itinerary', version: 1,
    trips: [{ id: tripId, title: 'Route Planner 旅程', startDate, endDate, budget: totalCost, note: 'Route Plannerで最適化した旅程' }],
    points: order.map((pi, k) => {
      const pt = { id: 'rp_p' + (k + 1), tripId, name: places[pi].name, lat: Math.round(places[pi].lat * 1e6) / 1e6, lon: Math.round(places[pi].lng * 1e6) / 1e6 };
      if (places[pi].cat) pt.category = places[pi].cat;
      if (places[pi].address) pt.address = places[pi].address;
      return pt;
    }),
    events: stopsN.map((s, k) => ({
      id: 'rp_ev_' + String(k + 1).padStart(4, '0'), tripId, plan: '最適化旅程', day: s.date,
      time: s.time, action: places[s.idx].name + 'を訪問', pointId: 'rp_p' + (k + 1),
      order: k, category: places[s.idx].cat || '観光', stayMinutes: places[s.idx].stay,
      travelMode: k === 0 ? 'unspecified' : (mode === 'transit' ? ((legs[k - 1] && legs[k - 1].mode === 'walk') ? 'walking' : 'transit') : modeMap[mode]),
      cost: k === 0 ? 0 : legCost(k - 1),
      confidence: '計画', source: srcText
    }))
  };
  if (returnStop) {
    out.events.push({
      id: 'rp_ev_' + String(out.events.length + 1).padStart(4, '0'), tripId, plan: '最適化旅程', day: returnStop.date,
      time: returnStop.time, action: places[0].name + 'へ帰着', pointId: 'rp_p1',
      order: out.events.length, category: '交通', stayMinutes: 0,
      travelMode: mode === 'transit' ? ((legs[legs.length - 1] && legs[legs.length - 1].mode === 'walk') ? 'walking' : 'transit') : modeMap[mode], cost: legCost(legs.length - 1),
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
async function fetchTransitLeg(fromName, toName, epoch, legMode) {
  const p = jstDateTime(epoch);
  const url = TRANSIT_API + '?from=' + encodeURIComponent(fromName) + '&to=' + encodeURIComponent(toName) +
    '&date=' + p.date + '&time=' + p.time + '&mode=' + (legMode === 'walk' ? 'walk' : 'transit');
  const res = await fetch(url);
  const js = await res.json().catch(() => null);
  if (!res.ok || !js || js.error || !js.routes || !js.routes.length || !js.routes[0].depEpoch) {
    throw new Error(fromName + ' → ' + toName + ' の時刻を取得できませんでした' + (js && js.error ? '（' + js.error + '）' : '') + '。推定では埋めていません');
  }
  return js.routes[0];
}
const PAIR_CACHE_KEY = 'ryotei-pair-durations-v1';
function pairCacheGet(key) {
  try { const c = JSON.parse(localStorage.getItem(PAIR_CACHE_KEY) || '{}'); const e = c[key]; if (e && Date.now() - e.at < 86400000) return e.min; } catch (err) {}
  return null;
}
function pairCacheSet(key, min) {
  try {
    const c = JSON.parse(localStorage.getItem(PAIR_CACHE_KEY) || '{}');
    c[key] = { at: Date.now(), min };
    const keys = Object.keys(c);
    if (keys.length > 300) keys.slice(0, keys.length - 300).forEach(k => delete c[k]);
    localStorage.setItem(PAIR_CACHE_KEY, JSON.stringify(c));
  } catch (err) {}
}
async function calculateTransit(places, startMin, roundTrip) {
  const dateStr = $('#tripDate').value || jstDateTime(Math.floor(Date.now() / 1000)).date;
  const n = places.length;
  let failedPairs = 0, proxy = false;
  let dur;
  if (n > 12) {
    // 地点が多い場合は順序決定だけ概算行列を使う（表示する発着時刻は実ダイヤで取得する）
    proxy = true;
    setStatus('地点が多いため、順序決定用の概算の移動時間を取得中…');
    try { dur = await osrmTable('driving', places); }
    catch (e) { dur = places.map(a => places.map(b => haversineKm(a, b) * 1.3 / FALLBACK_SPEED.driving * 60)); }
  } else {
    // 1) 全区間の所要時間をGoogleマップで取得する（出発時刻基準）
    // 区間ごとの移動手段は「行き先の場所」の設定（おまかせ／電車・バス／徒歩）に従う。
    // おまかせは電車・バスと徒歩の両方を取得し、速い方を採用する。
    // 地点が多いときは順序決定用に限って往復を共通化し、取得回数を半分にする（表示する発着時刻は実際に乗る方向で毎回実取得する）
    const mirror = n > 8;
    const wantMode = (idx) => places[idx].legMode || 'auto';
    dur = Array.from({ length: n }, () => new Array(n).fill(0));
    let donePairs = 0;
    const totalPairs = n * (n - 1);
    const refEpoch = epochOfJST(dateStr, startMin);
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        if (i === j) continue;
        // 往復共通化は、両方向の希望手段が同じ（おまかせ以外）のときだけ
        if (mirror && j < i && wantMode(i) === wantMode(j) && wantMode(j) !== 'auto') { dur[i][j] = dur[j][i]; continue; }
        donePairs++;
        setStatus('Googleで全区間の所要時間を取得中… ' + donePairs + '/' + totalPairs + '（' + places[i].name + ' → ' + places[j].name + '）');
        const qi = places[i].query || places[i].name, qj = places[j].query || places[j].name;
        const wm = wantMode(j);
        const pairKey = qi + '|' + qj + '|' + dateStr + '|' + startMin + '|' + wm;
        const cachedMin = pairCacheGet(pairKey);
        if (cachedMin != null) { dur[i][j] = cachedMin; continue; }
        try {
          if (wm === 'auto') {
            let best = null;
            try { const rt = await fetchTransitLeg(qi, qj, refEpoch, 'transit'); best = rt.durationMin || 0; } catch (e) { /* 徒歩で再試行 */ }
            try { const rw = await fetchTransitLeg(qi, qj, refEpoch, 'walk'); const w = rw.durationMin || 0; if (best == null || w < best) best = w; } catch (e) { /* 電車のみ採用 */ }
            if (best == null) throw new Error('no route');
            dur[i][j] = best;
          } else {
            const r = await fetchTransitLeg(qi, qj, refEpoch, wm);
            dur[i][j] = r.durationMin || 0;
          }
          pairCacheSet(pairKey, dur[i][j]);
        } catch (e) { dur[i][j] = 100000; failedPairs++; }
        await sleep(350);
      }
    }
  }
  // 2) 全通り探索で回る順序を決める
  setStatus('全通りの並び順を探索しています…');
  const { order } = bestOrder(places, dur, startMin, roundTrip);
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
    const fromQ = places[prevIdx].query || places[prevIdx].name, toQ = places[curIdx].query || places[curIdx].name;
    const want = places[curIdx].legMode || 'auto';
    let r, legMode;
    if (want === 'walk') {
      r = await fetchTransitLeg(fromQ, toQ, cursor, 'walk'); legMode = 'walk';
    } else if (want === 'transit') {
      r = await fetchTransitLeg(fromQ, toQ, cursor, 'transit'); legMode = 'transit';
    } else {
      // おまかせ：電車・バスと徒歩を比べ、到着が早い方（同点なら電車・バス）
      let rt = null, rw = null;
      try { rt = await fetchTransitLeg(fromQ, toQ, cursor, 'transit'); } catch (e) { /* 徒歩で代替 */ }
      try { rw = await fetchTransitLeg(fromQ, toQ, cursor, 'walk'); } catch (e) { /* 電車のみ */ }
      if (!rt && !rw) throw new Error(fromQ + ' → ' + toQ + ' の時刻を取得できませんでした');
      if (rt && rw) { if (rw.arrEpoch < rt.arrEpoch) { r = rw; legMode = 'walk'; } else { r = rt; legMode = 'transit'; } }
      else if (rw) { r = rw; legMode = 'walk'; } else { r = rt; legMode = 'transit'; }
    }
    const trainWait = Math.max(0, (r.depEpoch - cursor) / 60);
    legs.push({ km: r.distanceKm || 0, min: r.durationMin || 0, fare: legMode === 'walk' ? 0 : r.fareYen, lines: legMode === 'walk' ? [] : (r.lines || []), depEpoch: r.depEpoch, arrEpoch: r.arrEpoch, path: r.path || [], mode: legMode });
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
  return { failedPairs, proxy };
}
function renderTransit(places, order, stops, legs, roundTrip, endEpoch) {
  const hmD = (epoch) => {
    const p = jstDateTime(epoch);
    return (p.date !== $('#tripDate').value ? (Number(p.date.slice(5, 7)) + '/' + Number(p.date.slice(8, 10)) + ' ') : '') + p.hm;
  };
  const simLike = {
    stops: stops.filter(s => !s.isReturn).map(s => ({ idx: s.idx, arr: jstDateTime(s.arrEpoch).mins, stayStart: jstDateTime(s.stayStartEpoch).mins, dep: jstDateTime(s.depEpoch).mins, wait: s.waitMin, viol: s.violMin })),
    wait: stops.reduce((a, s) => a + s.waitMin + s.trainWaitMin, 0),
    violation: stops.reduce((a, s) => a + s.violMin, 0),
    endTime: jstDateTime(endEpoch).mins
  };
  lastResult = { kind: 'transit', places, order, sim: simLike, legs, mode: 'transit', roundTrip, startMin: jstDateTime(stops[0].depEpoch).mins, stopsRaw: stops, endEpoch };
  mapLayer.clearLayers();
  const allPts = order.map(i => [places[i].lat, places[i].lng]);
  legs.forEach(leg => { if (leg.path) leg.path.forEach(pt => allPts.push(pt)); });
  legs.forEach((leg, k) => {
    if (leg.path && leg.path.length > 1) {
      L.polyline(leg.path, { color: leg.mode === 'walk' ? '#16a34a' : '#6d28d9', weight: 5, opacity: 0.85 }).addTo(mapLayer);
    } else {
      const a = places[stops[k].idx], b = places[stops[k + 1].idx];
      L.polyline([[a.lat, a.lng], [b.lat, b.lng]], { color: '#94a3b8', weight: 3, opacity: 0.6, dashArray: '3 7' }).addTo(mapLayer);
    }
  });
  order.forEach((pi, k) => {
    const p = places[pi];
    const icon = L.divIcon({ className: '', html: markerHtml(k + 1, p.cat, k === 0), iconSize: [28, 28], iconAnchor: [14, 14] });
    L.marker([p.lat, p.lng], { icon }).addTo(mapLayer).bindPopup('<b>' + (k + 1) + '. ' + escapeHtml(p.name) + '</b>' + (p.cat ? '<br>' + escapeHtml(p.cat) : ''));
  });
  if (allPts.length) map.fitBounds(L.latLngBounds(allPts), { padding: [30, 30] });
  const list = $('#resultList');
  list.innerHTML = '';
  let totalKm = 0, totalFare = 0, fareUnknown = false, rideMin = 0;
  legs.forEach(l => { totalKm += l.km; rideMin += l.min; if (l.fare == null) fareUnknown = true; else totalFare += l.fare; });
  let curDate = '';
  stops.forEach((s, k) => {
    const p = places[s.idx];
    const dateOf = jstDateTime(s.depEpoch || s.arrEpoch).date;
    if (dateOf !== curDate) {
      curDate = dateOf;
      const dh = document.createElement('div');
      dh.className = 'day-head';
      dh.textContent = dayLabelFromISO(dateOf);
      list.appendChild(dh);
    }
    const card = document.createElement('div');
    card.className = 'stop-card';
    let html = '<h3><span class="badge">' + (s.isReturn ? 1 : k + 1) + '</span>' + escapeHtml(p.name) + (s.isReturn ? '（帰着）' : '') + '</h3>';
    if (k === 0) {
      html += '<div class="stop-times">' + hmD(s.depEpoch) + ' 出発</div>';
    } else if (s.isReturn) {
      html += '<div class="stop-times">' + hmD(s.arrEpoch) + ' 着</div>';
    } else {
      html += '<div class="stop-times">' + hmD(s.arrEpoch) + ' 着 → ' + hmD(s.depEpoch) + ' 発</div>';
      let meta = (p.cat ? escapeHtml(p.cat) + ' ・ ' : '') + '滞在 ' + fmtDur(p.stay);
      if (s.trainWaitMin > 0.5) meta += '（電車待ち ' + fmtDur(s.trainWaitMin) + '）';
      if (s.waitMin > 0.5) meta += '（到着が早いため ' + fmtDur(s.waitMin) + ' 待ち）';
      if (p.winStart != null || p.winEnd != null) {
        const wtxt = '希望 ' + (p.winStart != null ? fmtDT(p.winStart) : '…') + '〜' + (p.winEnd != null ? fmtDT(p.winEnd) : '…');
        if (s.violMin < 0.5) meta += '<br>' + wtxt + ' → <span class="win-ok">希望どおり</span>';
        else meta += '<br>' + wtxt + ' → <span class="win-ng">約' + Math.round(s.violMin) + '分ズレ</span>';
      }
      html += '<div class="stop-meta">' + meta + '</div>';
    }
    if (p.address) html += '<div class="stop-meta">' + escapeHtml(p.address) + '</div>';
    card.innerHTML = html;
    list.appendChild(card);
    if (k < legs.length) {
      const leg = legs[k];
      const from = places[s.idx], to = places[stops[k + 1].idx];
      const row = document.createElement('div');
      row.className = 'leg-row';
      const isWalk = leg.mode === 'walk';
      row.innerHTML = '<span>' + hmD(leg.depEpoch) + '発 → ' + hmD(leg.arrEpoch) + '着 ・ ' +
        (isWalk ? '徒歩 ・ ' : (leg.lines.length ? escapeHtml(leg.lines.join('・')) + ' ・ ' : '')) + fmtDur(leg.min) + ' ・ ' +
        (leg.fare != null ? '¥' + leg.fare : '運賃不明') + '</span>' +
        '<a target="_blank" rel="noopener" href="' + gmapsLink(from, to, isWalk ? 'foot' : 'transit') + '">Googleマップで開く</a>';
      list.appendChild(row);
    }
  });
  $('#resultSummary').textContent = '移動 ' + fmtDur(rideMin) + ' / 待ち ' + fmtDur(simLike.wait) +
    (simLike.violation >= 0.5 ? ' / 希望ズレ合計 約' + Math.round(simLike.violation) + '分' : ' / 希望は全て達成');
  $('#pointCount').textContent = places.length;
  $('#totalDist').textContent = totalKm.toFixed(1) + 'km';
  $('#totalCost').textContent = '¥' + totalFare + (fareUnknown ? '＋不明分' : '');
  $('#tripEmpty').hidden = true;
  switchTab('trip');
}

/* ===== 旅程の保存（下書き自動保存＋名前付き保存、いずれもこのブラウザのlocalStorage） ===== */
const DRAFT_KEY = 'ryotei-draft-v1';
const SAVES_KEY = 'ryotei-saves-v1';
function lsGet(key) { try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : null; } catch (e) { return null; } }
function lsSet(key, val) { try { localStorage.setItem(key, JSON.stringify(val)); return true; } catch (e) { return false; } }
function serializeForm() {
  const rows = [...placeList.children];
  return {
    date: $('#tripDate').value, startTime: $('#startTime').value, mode: $('#mode').value,
    nenpi: $('#nenpi').value, tanka: $('#tanka').value, roundTrip: $('#roundTrip').checked,
    places: rows.map((row, i) => ({
      name: row.querySelector('.place-name').value,
      cat: row.querySelector('.f-cat') ? row.querySelector('.f-cat').value : '',
      lat: row.dataset.lat ? parseFloat(row.dataset.lat) : null,
      lng: row.dataset.lng ? parseFloat(row.dataset.lng) : null,
      stay: i === 0 ? null : row.querySelector('.f-stay').value,
      ws: i === 0 ? '' : row.querySelector('.f-ws').value,
      we: i === 0 ? '' : row.querySelector('.f-we').value,
      legmode: i === 0 ? 'auto' : (row.querySelector('.f-legmode') ? row.querySelector('.f-legmode').value : 'auto'),
      addr: row.querySelector('.f-addr') ? row.querySelector('.f-addr').value : '',
      coord: row.querySelector('.f-coord') ? row.querySelector('.f-coord').value : ''
    }))
  };
}
function applyFormState(state) {
  if (!state) return;
  if (state.date) $('#tripDate').value = state.date;
  if (state.startTime) $('#startTime').value = state.startTime;
  $('#mode').value = state.mode || 'driving';
  $('#fuelRow').style.display = $('#mode').value === 'driving' ? '' : 'none';
  $('#transitNote').hidden = $('#mode').value !== 'transit';
  if (state.nenpi) $('#nenpi').value = state.nenpi;
  if (state.tanka) $('#tanka').value = state.tanka;
  $('#roundTrip').checked = !!state.roundTrip;
  placeList.innerHTML = '';
  const fixDT = (v) => (v && /^\d{1,2}:\d{2}$/.test(v) && state.date) ? (state.date + 'T' + (v.length === 4 ? '0' + v : v)) : (v || null);
  (state.places || []).forEach(pl => {
    addPlaceRow(pl.name || '', pl.stay === '' || pl.stay == null ? null : Number(pl.stay), fixDT(pl.ws), fixDT(pl.we), pl.legmode || 'auto');
    const row = placeList.children[placeList.children.length - 1];
    if (pl.lat != null && pl.lng != null) { row.dataset.lat = pl.lat; row.dataset.lng = pl.lng; }
    if (pl.cat) row.querySelector('.f-cat').value = pl.cat;
    if (pl.addr) row.querySelector('.f-addr').value = pl.addr;
    if (pl.coord) row.querySelector('.f-coord').value = pl.coord;
  });
  if (!placeList.children.length) { addPlaceRow(); addPlaceRow(); }
  renumber();
  lastResult = null;
}
function saveDraft() { lsSet(DRAFT_KEY, serializeForm()); }
function getSaves() { const s = lsGet(SAVES_KEY); return Array.isArray(s) ? s : []; }
function refreshSavedList() {
  const sel = $('#savedList');
  const cur = sel.value;
  sel.innerHTML = '';
  const saves = getSaves();
  if (!saves.length) { sel.innerHTML = '<option value="">（保存なし）</option>'; return; }
  saves.forEach(sv => {
    const opt = document.createElement('option');
    opt.value = sv.name;
    const d = new Date(sv.savedAt);
    opt.textContent = sv.name + '（' + (d.getMonth() + 1) + '/' + d.getDate() + ' ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes()) + '）';
    sel.appendChild(opt);
  });
  if (cur && saves.some(sv => sv.name === cur)) sel.value = cur;
}
$('#saveBtn').addEventListener('click', () => {
  let name = $('#saveName').value.trim();
  if (!name) {
    const d = new Date();
    name = '旅程 ' + (d.getMonth() + 1) + '/' + d.getDate() + ' ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes());
  }
  const entry = {
    name, savedAt: new Date().toISOString(), form: serializeForm(),
    result: lastResult ? JSON.parse(JSON.stringify(lastResult)) : null
  };
  let saves = getSaves().filter(sv => sv.name !== name);
  saves.unshift(entry);
  if (!lsSet(SAVES_KEY, saves)) {
    // 容量不足時は地図の経路線を除いて再試行
    if (entry.result) entry.result.geometry = null;
    saves = getSaves().filter(sv => sv.name !== name);
    saves.unshift(entry);
    if (!lsSet(SAVES_KEY, saves)) { setStatus('保存できませんでした（ブラウザの保存容量不足）', true); return; }
  }
  refreshSavedList();
  $('#savedList').value = name;
  setStatus('「' + name + '」を保存しました' + (entry.result ? '（計算結果も含む）' : ''));
});
$('#loadSaveBtn').addEventListener('click', () => {
  const name = $('#savedList').value;
  const sv = getSaves().find(x => x.name === name);
  if (!sv) { setStatus('読み込む旅程を選んでください', true); return; }
  applyFormState(sv.form);
  if (sv.result) {
    const r = sv.result;
    if (r.mode === 'transit' && r.stopsRaw) renderTransit(r.places, r.order, r.stopsRaw, r.legs, r.roundTrip, r.endEpoch);
    else renderResult(r.places, r.order, r.sim, r.legs, r.geometry || null, r.mode, r.roundTrip, r.startMin);
    setStatus('「' + name + '」を読み込みました（計算結果も復元）');
  } else {
    setStatus('「' + name + '」を読み込みました');
  }
  saveDraft();
});
$('#delSaveBtn').addEventListener('click', () => {
  const name = $('#savedList').value;
  if (!name) { setStatus('削除する旅程を選んでください', true); return; }
  lsSet(SAVES_KEY, getSaves().filter(sv => sv.name !== name));
  refreshSavedList();
  setStatus('「' + name + '」を削除しました');
});
document.querySelector('.sidebar').addEventListener('input', saveDraft);
document.querySelector('.sidebar').addEventListener('change', saveDraft);
placeList.addEventListener('click', () => setTimeout(saveDraft, 0));
(function restoreDraft() {
  refreshSavedList();
  const draft = lsGet(DRAFT_KEY);
  if (draft && Array.isArray(draft.places) && draft.places.length) {
    applyFormState(draft);
    if (draft.places.some(p => p.name)) setStatus('前回の下書きを復元しました');
  }
})();

/* ===== 途中で再計算（アクシデント対応） ===== */
function refreshReplanLists() {
  const names = [...placeList.children].map(r => r.querySelector('.place-name').value.trim()).filter(Boolean);
  const hereSel = $('#replanHere');
  const prevHere = hereSel.value;
  hereSel.innerHTML = '<option value="">（場所を選ぶ）</option>' + names.map(n => '<option value="' + escapeHtml(n) + '">' + escapeHtml(n) + '</option>').join('');
  if (names.includes(prevHere)) hereSel.value = prevHere;
  const box = $('#replanVisited');
  const prevChecked = new Set([...box.querySelectorAll('input:checked')].map(x => x.value));
  box.innerHTML = '';
  names.forEach(n => {
    const lab = document.createElement('label');
    const cb = document.createElement('input');
    cb.type = 'checkbox'; cb.value = n;
    if (prevChecked.has(n)) cb.checked = true;
    lab.appendChild(cb);
    lab.appendChild(document.createTextNode(n));
    box.appendChild(lab);
  });
  const rt = $('#replanTime');
  if (!rt.value) {
    const d = new Date(Date.now() + 32400 * 1000);
    rt.value = d.getUTCFullYear() + '-' + pad2(d.getUTCMonth() + 1) + '-' + pad2(d.getUTCDate()) + 'T' + pad2(d.getUTCHours()) + ':' + pad2(d.getUTCMinutes());
  }
}
async function replan() {
  const btn = $('#replanBtn');
  const rows = [...placeList.children];
  const places = buildPlaces(rows);
  if (!places) return;
  const hereName = $('#replanHere').value;
  if (!hereName) { setStatus('今いる場所を選んでください', true); return; }
  const nowAbs = dtAbsMin($('#replanTime').value);
  if (nowAbs == null) { setStatus('現在日時を入れてください', true); return; }
  const visited = new Set([...document.querySelectorAll('#replanVisited input:checked')].map(x => x.value));
  btn.disabled = true;
  try {
    await resolvePlaces(places, rows);
    const here = places.find(p => p.name === hereName);
    if (!here) { setStatus('今いる場所が場所リストにありません', true); return; }
    const rest = places.filter(p => p.name !== hereName && !visited.has(p.name));
    if (!rest.length) { setStatus('残りの場所がありません', true); return; }
    const sub = [here, ...rest].map(p => ({ ...p }));
    // 過ぎてしまった希望時間は無効化する
    sub.forEach(p => { if (p.winEnd != null && p.winEnd < nowAbs) { p.winStart = null; p.winEnd = null; } });
    const mode = $('#mode').value;
    if (mode === 'transit') {
      const r = await calculateTransit(sub, nowAbs, false);
      setStatus('今からの最適経路を計算しました（' + hereName + ' から残り ' + rest.length + ' 件）' + (r.failedPairs ? '※一部 ' + r.failedPairs + ' 区間はGoogleで取得できず不利に扱いました' : ''), r.failedPairs > 0);
    } else {
      await runRoadMode(sub, nowAbs, false, mode);
      setStatus('今からの最適経路を計算しました（' + hereName + ' から残り ' + rest.length + ' 件）');
    }
  } catch (err) {
    setStatus(err && err.message ? err.message : '再計算に失敗しました', true);
  } finally { btn.disabled = false; }
}
$('#replanBtn').addEventListener('click', replan);
document.querySelector('.sidebar').addEventListener('input', refreshReplanLists);
refreshReplanLists();
