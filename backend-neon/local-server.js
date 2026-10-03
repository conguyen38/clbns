require('dotenv').config();
const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');
const { setPool } = require('../api/db.js');
const { createDemoPool } = require('./demo-db.js');
const apiHandler = require('../api/index.js');
const photoHandler = require('../api/photo.js');

const PORT = process.env.PORT || 8787;
// Chế độ demo (mặc định khi chưa có DATABASE_URL): dùng database trong bộ nhớ
// với data mẫu thay vì Neon. Ép bật bằng DEMO=1.
const DEMO = process.env.DEMO === '1' || !process.env.DATABASE_URL;
const INDEX_HTML = path.join(__dirname, '..', 'index.html');

function wrapRes(res) {
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (obj) => {
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(obj));
  };
  res.send = (data) => { res.end(data); };
  return res;
}

const server = http.createServer(async (req, res) => {
  wrapRes(res);
  const parsed = new URL(req.url, `http://localhost:${PORT}`);
  req.query = Object.fromEntries(parsed.searchParams);

  if (req.method === 'GET' && (parsed.pathname === '/' || parsed.pathname === '/index.html')) {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.end(fs.readFileSync(INDEX_HTML));
    return;
  }

  if (parsed.pathname === '/api/photo') {
    try { await photoHandler(req, res); }
    catch (err) { res.status(500).send('Error: ' + err.message); }
    return;
  }

  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  req.body = Buffer.concat(chunks).toString('utf8');
  try {
    await apiHandler(req, res);
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

(async () => {
  if (DEMO) setPool(await createDemoPool());
  server.listen(PORT, () => {
    console.log(`ProAgent local running at http://localhost:${PORT} (${DEMO ? 'DEMO data' : 'Neon DATABASE_URL'})`);
  });
})();
