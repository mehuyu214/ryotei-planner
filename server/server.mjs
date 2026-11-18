// ryotei-transit を素のNode HTTPサーバとして動かすためのアダプタ（Render等向け）
// 本体ロジックは netlify/functions/route.mjs と共通。
import { createServer } from 'node:http';
import handler from '../netlify/functions/route.mjs';

const server = createServer(async (req, res) => {
  try {
    const request = new Request('http://localhost' + req.url, { method: req.method, headers: req.headers });
    const response = await handler(request);
    const headers = {};
    response.headers.forEach((v, k) => { headers[k] = v; });
    res.writeHead(response.status, headers);
    res.end(await response.text());
  } catch (e) {
    res.writeHead(500, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
    res.end(JSON.stringify({ error: String((e && e.message) || e) }));
  }
});
server.listen(process.env.PORT || 8080, () => console.log('ryotei-transit listening'));
