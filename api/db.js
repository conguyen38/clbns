const { Pool, neonConfig } = require('@neondatabase/serverless');
const ws = require('ws');

neonConfig.webSocketConstructor = ws;

let pool;
function getPool() {
  if (!pool) {
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
  }
  return pool;
}

// Chỉ dùng cho server local (backend-neon/local-server.js) ở chế độ demo:
// thay Neon bằng database trong bộ nhớ. Production không gọi hàm này.
function setPool(customPool) {
  pool = customPool;
}

module.exports = { getPool, setPool };
