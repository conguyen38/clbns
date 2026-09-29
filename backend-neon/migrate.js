require('dotenv').config();
const { neon } = require('@neondatabase/serverless');

const OLD_API_URL = 'https://script.google.com/macros/s/AKfycbw8_IceA8qhj5MEX0ePsIiy8PdrRtiu7olRPGIKs9z5YY2nRSiUNhfYbV3OJdPtqHdM8g/exec';

async function callOldApi(action, data = {}) {
  const res = await fetch(OLD_API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ action, data }),
    redirect: 'manual',
  });
  let json;
  if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
    const follow = await fetch(res.headers.get('location'));
    json = await follow.json();
  } else {
    json = await res.json();
  }
  if (!json.ok) throw new Error(`${action} failed: ${json.error}`);
  return json.data;
}

async function main() {
  const sql = neon(process.env.DATABASE_URL);

  const [accounts, regions, branches, checkpoints, meetings, checkins] = await Promise.all([
    callOldApi('adminListAccounts'),
    callOldApi('adminListRegions'),
    callOldApi('adminListBranches'),
    callOldApi('adminListCheckpoints'),
    callOldApi('listMeetings', { role: 'Admin' }),
    callOldApi('listCheckins', { role: 'Admin' }),
  ]);

  console.log(`Fetched: ${accounts.length} accounts, ${regions.length} regions, ${branches.length} branches, ${checkpoints.length} checkpoints, ${meetings.length} meetings, ${checkins.length} checkins`);

  for (const a of accounts) {
    await sql`
      INSERT INTO accounts (username, password, full_name, role, manager_username, region_codes, active)
      VALUES (${a.username}, ${a.password}, ${a.full_name}, ${a.role}, ${a.manager_username || ''}, ${a.region_codes || ''}, ${String(a.active).toUpperCase() === 'TRUE' || a.active === true})
      ON CONFLICT (username) DO UPDATE SET
        password=EXCLUDED.password, full_name=EXCLUDED.full_name, role=EXCLUDED.role,
        manager_username=EXCLUDED.manager_username, region_codes=EXCLUDED.region_codes, active=EXCLUDED.active
    `;
  }

  for (const r of regions) {
    await sql`
      INSERT INTO regions (region_code, region_name, sm_username)
      VALUES (${r.region_code}, ${r.region_name}, ${r.sm_username || ''})
      ON CONFLICT (region_code) DO UPDATE SET region_name=EXCLUDED.region_name, sm_username=EXCLUDED.sm_username
    `;
  }

  for (const b of branches) {
    await sql`
      INSERT INTO branches (branch_code, branch_name, region_code, lat, long, radius_m)
      VALUES (${b.branch_code}, ${b.branch_name}, ${b.region_code}, ${Number(b.lat)}, ${Number(b.long)}, ${Number(b.radius_m) || 150})
      ON CONFLICT (branch_code) DO UPDATE SET
        branch_name=EXCLUDED.branch_name, region_code=EXCLUDED.region_code, lat=EXCLUDED.lat, long=EXCLUDED.long, radius_m=EXCLUDED.radius_m
    `;
  }

  for (const c of checkpoints) {
    await sql`
      INSERT INTO checkpoints (checkpoint_id, checkpoint_name, lat, long, radius_m)
      VALUES (${c.checkpoint_id}, ${c.checkpoint_name}, ${Number(c.lat)}, ${Number(c.long)}, ${Number(c.radius_m) || 100})
      ON CONFLICT (checkpoint_id) DO UPDATE SET
        checkpoint_name=EXCLUDED.checkpoint_name, lat=EXCLUDED.lat, long=EXCLUDED.long, radius_m=EXCLUDED.radius_m
    `;
  }

  for (const m of meetings) {
    await sql`
      INSERT INTO meetings (meeting_id, meeting_code, creator_username, creator_name, creator_role, branch_codes,
        meeting_date, start_time, end_time, purpose_type, purpose_other, attendees,
        gps_lat, gps_long, gps_branch_code, gps_distance_m, gps_valid, status, sm_note, ssm_note, resubmitted_from, created_at)
      VALUES (${m.meeting_id}, ${m.meeting_code || ''}, ${m.creator_username}, ${m.creator_name || ''}, ${m.creator_role || ''}, ${m.branch_codes || ''},
        ${String(m.meeting_date || '')}, ${String(m.start_time || '')}, ${String(m.end_time || '')}, ${m.purpose_type || ''}, ${m.purpose_other || ''}, ${m.attendees || ''},
        ${m.gps_lat ?? null}, ${m.gps_long ?? null}, ${m.gps_branch_code || ''}, ${m.gps_distance_m === '' ? null : m.gps_distance_m},
        ${String(m.gps_valid).toUpperCase() === 'TRUE' || m.gps_valid === true}, ${m.status}, ${m.sm_note || ''}, ${m.ssm_note || ''}, ${m.resubmitted_from || ''}, ${m.created_at})
      ON CONFLICT (meeting_id) DO NOTHING
    `;
  }

  for (const c of checkins) {
    await sql`
      INSERT INTO checkins (checkin_id, username, sa_name, checkpoint_id, checkpoint_name, lat, long, distance_m, radius_m, valid, photo_url, timestamp)
      VALUES (${c.checkin_id}, ${c.username}, ${c.sa_name || ''}, ${c.checkpoint_id}, ${c.checkpoint_name || ''},
        ${c.lat ?? null}, ${c.long ?? null}, ${c.distance_m ?? null}, ${c.radius_m ?? null},
        ${String(c.valid).toUpperCase() === 'TRUE' || c.valid === true}, ${c.photo_url || ''}, ${c.timestamp})
      ON CONFLICT (checkin_id) DO NOTHING
    `;
  }

  console.log('Migration done.');
}

main().catch(err => { console.error(err); process.exit(1); });
