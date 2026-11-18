// ryotei-transit (Vercel Edge版): Googleマップ経路データ取得（APIキー不要）
// GET /api/route?from=大阪駅&to=神戸駅&date=2026-11-19&time=09:00
// → { routes: [{ depEpoch, arrEpoch, dep, arr, durationMin, distanceKm, fareYen, lines }] }
export const config = { runtime: 'edge' };

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

function wallEpoch(date, time) {
  // Googleの !8j は「現地の壁時計時刻をUTCとみなしたepoch秒」
  const [Y, M, D] = date.split('-').map(Number);
  const [h, m] = time.split(':').map(Number);
  return Math.floor(Date.UTC(Y, M - 1, D, h, m) / 1000);
}

async function fetchRoute(from, to, date, time) {
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
  const root = JSON.parse(txt);
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
      lines
    };
  });
}

export default async function handler(req) {
  const u = new URL(req.url);
  const cors = { 'Access-Control-Allow-Origin': '*' };
  const from = u.searchParams.get('from'), to = u.searchParams.get('to');
  const date = u.searchParams.get('date'), time = u.searchParams.get('time');
  if (!from || !to || !date || !time) return Response.json({ error: 'missing params' }, { status: 400, headers: cors });
  try {
    const routes = await fetchRoute(from, to, date, time);
    return Response.json({ routes }, { headers: cors });
  } catch (e) {
    return Response.json({ error: String((e && e.message) || e) }, { status: 502, headers: cors });
  }
}
