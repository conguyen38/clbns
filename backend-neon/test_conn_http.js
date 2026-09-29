require('dotenv').config();
const { neon } = require('@neondatabase/serverless');
const sql = neon(process.env.DATABASE_URL);
sql`SELECT 1 as ok`
  .then(r => { console.log('CONNECT OK', r); process.exit(0); })
  .catch(e => { console.error('CONNECT FAIL', e.message); process.exit(1); });
