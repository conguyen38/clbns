require('dotenv').config();
const http = require('http');
const handler = require('../api/index.js');

const PORT = process.env.PORT || 8787;

function wrapRes(res) {
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (obj) => {
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(obj));
  };
  return res;
}

const server = http.createServer(async (req, res) => {
  wrapRes(res);
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString('utf8');
  req.body = raw;
  try {
    await handler(req, res);
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

server.listen(PORT, () => {
  console.log(`ProAgent Neon backend (local) running at http://localhost:${PORT}`);
});
