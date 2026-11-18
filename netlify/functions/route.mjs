// ryotei-transit (Netlify Functions版): Googleマップ経路・地点データ取得（APIキー不要）
// GET /route?from=大阪駅&to=神戸駅&date=2026-11-19&time=09:00
//   → { routes: [{ depEpoch, arrEpoch, dep, arr, durationMin, distanceKm, fareYen, lines, path }], places: [origin, dest] }
// GET /place?q=神戸駅
//   → { place: { name, address, lat, lng } }
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

function wallEpoch(date, time) {
  // Googleの !8j は「現地の壁時計時刻をUTCとみなしたepoch秒」
  const [Y, M, D] = date.split('-').map(Number);
  const [h, m] = time.split(':').map(Number);
  return Math.floor(Date.UTC(Y, M - 1, D, h, m) / 1000);
}

async function fetchPreviewRoot(from, to, date, time) {
  const ep = wallEpoch(date, time);
  const data = '!4m12!4m11!1m2!1m1!1s' + encodeURIComponent(from) +
    '!1m2!1m1!1s' + encodeURIComponent(to) +
    '!2m3!6e0!7e2!8j' + ep + '!3e3';
  const pageUrl = 'https://www.google.com/maps/dir/' + encodeURIComponent(from) + '/' + encodeURIComponent(to) + '/data=' + data;
  const page = await fetch(pageUrl, { headers: { 'User-Agent': UA, 'Accept-Language': 'ja' } });
  if (!page.ok) throw new Error('page ' + page.status);
  const html = await page.text();
  const m = html.match(/maps\/preview\/directions\?authuser=0&amp;hl=ja&amp;gl=us&amp;pb=([^"]+)/);
  if (!m) throw new Error('pb not found');
  const pb = m[1].replace(/%21/g, '!');
  const pv = await fetch('https://www.google.com/maps/preview/directions?authuser=0&hl=ja&gl=jp&pb=' + pb,
    { headers: { 'User-Agent': UA, 'Accept-Language': 'ja' } });
  if (!pv.ok) throw new Error('preview ' + pv.status);
  const txt = (await pv.text()).replace(/^\)\]\}'\n?/, '');
  return JSON.parse(txt);
}

function parsePlaces(root) {
  const out = [];
  const blocks = (root[0] && root[0][0]) || [];
  for (const b of blocks) {
    try {
      const head = b[0][0];
      const names = b[0][1];
      const coord = head[2];
      out.push({ name: names[1] || '', address: names[2] || '', lat: coord[2], lng: coord[3] });
    } catch (e) { out.push(null); }
  }
  return out;
}

function quad(q) {
  return Array.isArray(q) && typeof q[2] === 'number' && typeof q[3] === 'number' ? [q[2], q[3]] : null;
}

// 経路上の停車駅・地点の座標列（Googleの応答に含まれる実地点をつないだもの）
function extractPath(route) {
  const pts = [];
  try {
    const segs = route[1] && route[1][0] && route[1][0][1];
    if (Array.isArray(segs)) {
      for (const seg of segs) {
        const st = seg && seg[5];
        if (!Array.isArray(st)) continue;
        const cand = [];
        if (st[0]) cand.push(st[0][4]);
        if (Array.isArray(st[7])) for (const x of st[7]) cand.push(x && x[4]);
        if (st[1]) cand.push(st[1][4]);
        for (const c of cand) {
          const p = quad(c);
          if (!p) continue;
          const last = pts[pts.length - 1];
          if (!last || last[0] !== p[0] || last[1] !== p[1]) pts.push(p);
        }
      }
    }
  } catch (e) { /* pathなしで返す */ }
  return pts;
}

function parseRoutes(root) {
  const routes = root[0][1];
  return routes.slice(0, 3).map(r => {
    const s = r[0];
    const fareM = JSON.stringify(r).match(/\[(\d+),"\d[\d,]*円","JPY"\]/);
    const lines = [...new Set([...JSON.stringify(r).matchAll(/\[5,\["([^"]+)",1,"#[0-9a-f]{6}","#[0-9a-f]{6}"\]\]/g)].map(x => x[1]))];
    return {
      distanceKm: s[2] ? s[2][0] / 1000 : null,
      durationMin: s[3] ? Math.round(s[3][0] / 60) : null,
      depEpoch: s[5] && s[5][0] ? s[5][0][0] : null,
      arrEpoch: s[5] && s[5][1] ? s[5][1][0] : null,
      dep: s[5] && s[5][0] ? s[5][0][2] : null,
      arr: s[5] && s[5][1] ? s[5][1][2] : null,
      fareYen: fareM ? parseInt(fareM[1], 10) : null,
      lines,
      path: extractPath(r)
    };
  });
}

function nowJST() {
  const d = new Date(Date.now() + 32400 * 1000);
  const p = n => String(n).padStart(2, '0');
  return {
    date: d.getUTCFullYear() + '-' + p(d.getUTCMonth() + 1) + '-' + p(d.getUTCDate()),
    time: p(d.getUTCHours()) + ':' + p(d.getUTCMinutes())
  };
}

export default async (req) => {
  const u = new URL(req.url);
  const cors = { 'Access-Control-Allow-Origin': '*' };
  try {
    if (u.pathname === '/place') {
      const q = u.searchParams.get('q');
      if (!q) return Response.json({ error: 'missing q' }, { status: 400, headers: cors });
      const now = nowJST();
      const root = await fetchPreviewRoot(q, '東京駅', now.date, now.time);
      const places = parsePlaces(root);
      if (!places[0] || places[0].lat == null) return Response.json({ error: 'place not found' }, { status: 404, headers: cors });
      return Response.json({ place: places[0] }, { headers: cors });
    }
    if (u.pathname === '/route') {
      const from = u.searchParams.get('from'), to = u.searchParams.get('to');
      const date = u.searchParams.get('date'), time = u.searchParams.get('time');
      if (!from || !to || !date || !time) return Response.json({ error: 'missing params' }, { status: 400, headers: cors });
      const root = await fetchPreviewRoot(from, to, date, time);
      return Response.json({ routes: parseRoutes(root), places: parsePlaces(root) }, { headers: cors });
    }
    return new Response('not found', { status: 404, headers: cors });
  } catch (e) {
    return Response.json({ error: String((e && e.message) || e) }, { status: 502, headers: cors });
  }
};

export const config = { path: ['/route', '/place'] };
