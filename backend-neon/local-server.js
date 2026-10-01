require('dotenv').config();
const http = require('http');
const { URL } = require('url');
const apiHandler = require('../api/index.js');
const photoHandler = require('../api/photo.js');

const PORT = process.env.PORT || 8787;

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

server.listen(PORT, () => {
  console.log(`ProAgent Neon backend (local) running at http://localhost:${PORT}`);
});
