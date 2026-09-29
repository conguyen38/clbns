require('dotenv').config();
const { neon } = require('@neondatabase/serverless');
const sql = neon(process.env.DATABASE_URL);

async function main() {
  console.log('accounts:', await sql`select username, full_name, role, manager_username, region_codes, active from accounts order by username`);
  console.log('branches:', await sql`select branch_code, branch_name, region_code from branches order by branch_code`);
  console.log('checkpoints:', await sql`select checkpoint_id, checkpoint_name from checkpoints`);
  console.log('meetings:', await sql`select meeting_id, meeting_code, status, creator_username from meetings`);
  console.log('checkins:', await sql`select checkin_id, username, valid from checkins`);
}
main().catch(e => { console.error(e); process.exit(1); });
