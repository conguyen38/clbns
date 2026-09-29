require('dotenv').config();
const { neon } = require('@neondatabase/serverless');
const sql = neon(process.env.DATABASE_URL);

async function main() {
  const rows = await sql`select meeting_id, creator_username, creator_name from meetings`;
  console.log('before:', rows);
  await sql`update meetings set creator_name = 'Lê Văn SA1' where creator_username = 'sa1'`;
  const after = await sql`select meeting_id, creator_username, creator_name from meetings`;
  console.log('after:', after);
}
main().catch(e => { console.error(e); process.exit(1); });
