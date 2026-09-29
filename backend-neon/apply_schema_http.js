require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { neon } = require('@neondatabase/serverless');

async function main() {
  const sql = neon(process.env.DATABASE_URL);
  const full = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  const statements = full.split(/;\s*\n/).map(s => s.trim()).filter(Boolean);
  for (const stmt of statements) {
    await sql.query(stmt);
  }
  const tables = await sql`select table_name from information_schema.tables where table_schema='public' order by table_name`;
  console.log('Tables:', tables.map(r => r.table_name).join(', '));
}

main().catch(err => { console.error(err); process.exit(1); });
