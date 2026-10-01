const { getPool } = require('./db');

function haversine(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const toRad = d => d * Math.PI / 180;
  const dLat = toRad(lat2 - lat1), dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

async function orgSubtreeUsernames(pool, username) {
  const { rows } = await pool.query('SELECT username, manager_username FROM accounts');
  const set = new Set([username]);
  let changed = true;
  while (changed) {
    changed = false;
    rows.forEach(a => {
      if (set.has(a.manager_username) && !set.has(a.username)) { set.add(a.username); changed = true; }
    });
  }
  return set;
}

const ACTIONS = {};

ACTIONS.login = async (pool, data) => {
  const { rows } = await pool.query('SELECT * FROM accounts WHERE username=$1', [data.username]);
  const acc = rows[0];
  if (!acc) throw new Error('Tài khoản không tồn tại.');
  if (!acc.active) throw new Error('Tài khoản đã bị khóa.');
  if (String(acc.password) !== String(data.password)) throw new Error('Sai mật khẩu.');
  return { username: acc.username, full_name: acc.full_name, role: acc.role, manager_username: acc.manager_username, region_codes: acc.region_codes };
};

ACTIONS.adminListAccounts = async (pool) => {
  const { rows } = await pool.query('SELECT * FROM accounts ORDER BY username');
  return rows;
};

ACTIONS.adminCreateAccount = async (pool, data) => {
  const { username, password, full_name, role } = data;
  if (!username || !password || !full_name || !role) throw new Error('Thiếu thông tin bắt buộc.');
  const exists = await pool.query('SELECT 1 FROM accounts WHERE username=$1', [username]);
  if (exists.rows.length) throw new Error('Username đã tồn tại.');
  await pool.query(
    'INSERT INTO accounts (username, password, full_name, role, manager_username, region_codes, active) VALUES ($1,$2,$3,$4,$5,$6,true)',
    [username, password, full_name, role, data.manager_username || '', data.region_codes || '']
  );
  return { ok: true };
};

ACTIONS.adminSetAccountActive = async (pool, data) => {
  const res = await pool.query('UPDATE accounts SET active=$2 WHERE username=$1', [data.username, !!data.active]);
  if (!res.rowCount) throw new Error('Không tìm thấy tài khoản.');
  return { ok: true };
};

ACTIONS.adminUpdateAccount = async (pool, data) => {
  const fields = ['full_name', 'role', 'manager_username', 'region_codes', 'password'].filter(f => data[f] !== undefined && data[f] !== '');
  if (!fields.length) return { ok: true };
  const setClause = fields.map((f, i) => `${f}=$${i + 2}`).join(', ');
  const values = fields.map(f => data[f]);
  const res = await pool.query(`UPDATE accounts SET ${setClause} WHERE username=$1`, [data.username, ...values]);
  if (!res.rowCount) throw new Error('Không tìm thấy tài khoản.');
  return { ok: true };
};

ACTIONS.changePassword = async (pool, data) => {
  const { username, current_password, new_password } = data;
  if (!username || !current_password || !new_password) throw new Error('Thiếu thông tin.');
  const { rows } = await pool.query('SELECT password FROM accounts WHERE username=$1', [username]);
  if (!rows[0]) throw new Error('Không tìm thấy tài khoản.');
  if (String(rows[0].password) !== String(current_password)) throw new Error('Mật khẩu hiện tại không đúng.');
  await pool.query('UPDATE accounts SET password=$2 WHERE username=$1', [username, new_password]);
  return { ok: true };
};

ACTIONS.adminDeleteAccount = async (pool, data) => {
  const res = await pool.query('DELETE FROM accounts WHERE username=$1', [data.username]);
  if (!res.rowCount) throw new Error('Không tìm thấy tài khoản.');
  return { ok: true };
};

ACTIONS.adminListRegions = async (pool) => {
  const { rows } = await pool.query('SELECT * FROM regions ORDER BY region_code');
  return rows;
};

ACTIONS.adminCreateRegion = async (pool, data) => {
  const { region_code, region_name } = data;
  if (!region_code || !region_name) throw new Error('Thiếu Mã vùng/Tên vùng.');
  const exists = await pool.query('SELECT 1 FROM regions WHERE region_code=$1', [region_code]);
  if (exists.rows.length) throw new Error('Mã vùng đã tồn tại.');
  await pool.query('INSERT INTO regions (region_code, region_name, sm_username) VALUES ($1,$2,$3)',
    [region_code, region_name, data.sm_username || '']);
  return { ok: true };
};

ACTIONS.adminUpdateRegion = async (pool, data) => {
  const fields = ['region_name', 'sm_username'].filter(f => data[f] !== undefined);
  if (!fields.length) return { ok: true };
  const setClause = fields.map((f, i) => `${f}=$${i + 2}`).join(', ');
  const values = fields.map(f => data[f]);
  const res = await pool.query(`UPDATE regions SET ${setClause} WHERE region_code=$1`, [data.region_code, ...values]);
  if (!res.rowCount) throw new Error('Không tìm thấy vùng.');
  return { ok: true };
};

ACTIONS.adminDeleteRegion = async (pool, data) => {
  const res = await pool.query('DELETE FROM regions WHERE region_code=$1', [data.region_code]);
  if (!res.rowCount) throw new Error('Không tìm thấy vùng.');
  return { ok: true };
};

ACTIONS.adminListBranches = async (pool) => {
  const { rows } = await pool.query('SELECT * FROM branches ORDER BY branch_code');
  return rows;
};

ACTIONS.adminCreateBranch = async (pool, data) => {
  let { branch_code, branch_name, region_code, lat, long, radius_m } = data;
  if (!branch_name || !region_code || !lat || !long) throw new Error('Thiếu thông tin chi nhánh.');
  if (!branch_code) branch_code = 'CN' + Math.random().toString(16).slice(2, 8).toUpperCase();
  const exists = await pool.query('SELECT 1 FROM branches WHERE branch_code=$1', [branch_code]);
  if (exists.rows.length) throw new Error('Mã chi nhánh đã tồn tại.');
  await pool.query(
    'INSERT INTO branches (branch_code, branch_name, region_code, lat, long, radius_m) VALUES ($1,$2,$3,$4,$5,$6)',
    [branch_code, branch_name, region_code, Number(lat), Number(long), Number(radius_m) || 150]
  );
  return { ok: true };
};

ACTIONS.adminUpdateBranch = async (pool, data) => {
  const fields = ['branch_name', 'region_code', 'lat', 'long', 'radius_m'].filter(f => data[f] !== undefined);
  if (!fields.length) return { ok: true };
  const setClause = fields.map((f, i) => `${f}=$${i + 2}`).join(', ');
  const values = fields.map(f => data[f]);
  const res = await pool.query(`UPDATE branches SET ${setClause} WHERE branch_code=$1`, [data.branch_code, ...values]);
  if (!res.rowCount) throw new Error('Không tìm thấy chi nhánh.');
  return { ok: true };
};

ACTIONS.adminDeleteBranch = async (pool, data) => {
  const res = await pool.query('DELETE FROM branches WHERE branch_code=$1', [data.branch_code]);
  if (!res.rowCount) throw new Error('Không tìm thấy chi nhánh.');
  return { ok: true };
};

ACTIONS.adminListCheckpoints = async (pool) => {
  const { rows } = await pool.query('SELECT * FROM checkpoints ORDER BY checkpoint_name');
  return rows;
};

ACTIONS.adminCreateCheckpoint = async (pool, data) => {
  const { checkpoint_name, lat, long, radius_m } = data;
  if (!checkpoint_name || !lat || !long) throw new Error('Thiếu thông tin điểm checkin.');
  const id = require('crypto').randomUUID();
  await pool.query(
    'INSERT INTO checkpoints (checkpoint_id, checkpoint_name, address, lat, long, radius_m) VALUES ($1,$2,$3,$4,$5,$6)',
    [id, checkpoint_name, data.address || '', Number(lat), Number(long), Number(radius_m) || 100]
  );
  return { ok: true };
};

ACTIONS.adminUpdateCheckpoint = async (pool, data) => {
  const fields = ['checkpoint_name', 'address', 'lat', 'long', 'radius_m'].filter(f => data[f] !== undefined);
  if (!fields.length) return { ok: true };
  const setClause = fields.map((f, i) => `${f}=$${i + 2}`).join(', ');
  const values = fields.map(f => data[f]);
  const res = await pool.query(`UPDATE checkpoints SET ${setClause} WHERE checkpoint_id=$1`, [data.checkpoint_id, ...values]);
  if (!res.rowCount) throw new Error('Không tìm thấy điểm checkin.');
  return { ok: true };
};

ACTIONS.adminDeleteCheckpoint = async (pool, data) => {
  const res = await pool.query('DELETE FROM checkpoints WHERE checkpoint_id=$1', [data.checkpoint_id]);
  if (!res.rowCount) throw new Error('Không tìm thấy điểm checkin.');
  return { ok: true };
};

ACTIONS.getCheckpointsForUser = async (pool) => {
  const { rows } = await pool.query('SELECT * FROM checkpoints ORDER BY checkpoint_name');
  return rows;
};

ACTIONS.submitCheckin = async (pool, data) => {
  const { username, full_name, checkpoint_id, lat, long, photo_base64, photo_thumb_base64, checkin_id } = data;
  const { rows } = await pool.query('SELECT * FROM checkpoints WHERE checkpoint_id=$1', [checkpoint_id]);
  const cp = rows[0];
  if (!cp) throw new Error('Không tìm thấy điểm checkin.');
  const dist = Math.round(haversine(lat, long, Number(cp.lat), Number(cp.long)));
  const valid = dist <= Number(cp.radius_m);
  const cid = checkin_id || require('crypto').randomUUID();
  const exists = await pool.query('SELECT 1 FROM checkins WHERE checkin_id=$1', [cid]);
  if (!exists.rows.length) {
    await pool.query(
      `INSERT INTO checkins (checkin_id, username, sa_name, checkpoint_id, checkpoint_name, lat, long, distance_m, radius_m, valid, photo_url, photo_thumb, timestamp)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12, now())`,
      [cid, username, full_name || '', checkpoint_id, cp.checkpoint_name, lat, long, dist, cp.radius_m, valid, photo_base64 || '', photo_thumb_base64 || '']
    );
  }
  return { valid, distance_m: dist, radius_m: Number(cp.radius_m) };
};

ACTIONS.getCheckinPhoto = async (pool, data) => {
  const { rows } = await pool.query('SELECT photo_url FROM checkins WHERE checkin_id=$1', [data.checkin_id]);
  if (!rows[0]) throw new Error('Không tìm thấy checkin.');
  return { photo_url: rows[0].photo_url || '' };
};

// Cột photo_url chứa cả ảnh base64 (vài MB/checkin) -> danh sách CHỈ trả về cờ
// has_photo, không kéo dữ liệu ảnh; ảnh thật chỉ tải riêng lúc bấm xem
// (xem ACTIONS.getCheckinPhoto) để tránh listCheckins nặng và chậm.
const CHECKIN_LIST_COLUMNS = `checkin_id, username, sa_name, checkpoint_id, checkpoint_name, lat, long, distance_m, radius_m, valid, timestamp, photo_thumb, (photo_url <> '') AS has_photo`;

ACTIONS.listCheckins = async (pool, data) => {
  if (data.role === 'Admin') {
    const { rows } = await pool.query(`SELECT ${CHECKIN_LIST_COLUMNS} FROM checkins ORDER BY timestamp DESC`);
    return rows;
  }
  if (data.role === 'SM' || data.role === 'SSM') {
    const subtree = await orgSubtreeUsernames(pool, data.username);
    const { rows } = await pool.query(`SELECT ${CHECKIN_LIST_COLUMNS} FROM checkins ORDER BY timestamp DESC`);
    return rows.filter(r => subtree.has(r.username));
  }
  const { rows } = await pool.query(`SELECT ${CHECKIN_LIST_COLUMNS} FROM checkins WHERE username=$1 ORDER BY timestamp DESC`, [data.username]);
  return rows;
};

ACTIONS.getMeetingScopeForUser = async (pool, data) => {
  const { rows: accRows } = await pool.query('SELECT * FROM accounts WHERE username=$1', [data.username]);
  const acc = accRows[0];
  if (!acc) throw new Error('Không tìm thấy tài khoản.');
  let regionCodes = String(acc.region_codes || '').split(',').map(s => s.trim()).filter(Boolean);
  if (acc.role === 'SA' && !regionCodes.length) {
    const { rows: mgrRows } = await pool.query('SELECT * FROM accounts WHERE username=$1', [acc.manager_username]);
    if (mgrRows[0]) regionCodes = String(mgrRows[0].region_codes || '').split(',').map(s => s.trim()).filter(Boolean);
  }
  const { rows: branches } = await pool.query('SELECT * FROM branches ORDER BY branch_code');
  const scoped = acc.role === 'Admin' ? branches : branches.filter(b => regionCodes.includes(b.region_code));
  return { branches: scoped };
};

ACTIONS.createMeeting = async (pool, data) => {
  const { rows: accRows } = await pool.query('SELECT * FROM accounts WHERE username=$1', [data.creator_username]);
  const acc = accRows[0];
  if (!acc) throw new Error('Không tìm thấy tài khoản.');
  const { rows: branches } = await pool.query('SELECT * FROM branches');
  const branchCodes = String(data.branch_codes || '').split(',').map(s => s.trim()).filter(Boolean);
  let bestDist = null, bestBranch = '', allValid = branchCodes.length > 0;
  branchCodes.forEach(code => {
    const br = branches.find(b => b.branch_code === code);
    if (br && br.lat && br.long) {
      const d = Math.round(haversine(data.gps_lat, data.gps_long, Number(br.lat), Number(br.long)));
      if (bestDist === null || d < bestDist) { bestDist = d; bestBranch = br.branch_code; }
      if (d > Number(br.radius_m || 150)) allValid = false;
    } else {
      allValid = false;
    }
  });
  const status = acc.role === 'SM' ? 'PendingSSM' : 'PendingSM';
  const meetingId = require('crypto').randomUUID();
  await pool.query(
    `INSERT INTO meetings (meeting_id, meeting_code, creator_username, creator_name, creator_role, branch_codes,
       meeting_date, start_time, end_time, purpose_type, purpose_other, attendees,
       gps_lat, gps_long, gps_branch_code, gps_distance_m, gps_valid, status, sm_note, ssm_note, resubmitted_from, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,'','', $19, now())`,
    [meetingId, data.meeting_code || '', acc.username, acc.full_name, acc.role, data.branch_codes || '',
     data.meeting_date || '', data.start_time || '', data.end_time || '', data.purpose_type || '', data.purpose_other || '', data.attendees || '',
     data.gps_lat, data.gps_long, bestBranch, bestDist, allValid, status, data.resubmitted_from || '']
  );
  return { meeting_id: meetingId, gps_valid: allValid, gps_distance_m: bestDist === null ? 0 : bestDist };
};

ACTIONS.listMeetingsForApproval = async (pool, data) => {
  const { rows: accounts } = await pool.query('SELECT * FROM accounts');
  const { rows: meetings } = await pool.query('SELECT * FROM meetings ORDER BY created_at DESC');
  const directReports = new Set(accounts.filter(a => a.manager_username === data.username).map(a => a.username));
  return meetings.filter(m => {
    if (m.status === 'PendingSM') return directReports.has(m.creator_username);
    if (m.status === 'PendingSSM') {
      const creator = accounts.find(a => a.username === m.creator_username);
      if (!creator) return false;
      if (creator.role === 'SM') return creator.manager_username === data.username;
      const smManager = accounts.find(a => a.username === creator.manager_username);
      return !!smManager && smManager.manager_username === data.username;
    }
    return false;
  });
};

ACTIONS.listMeetings = async (pool, data) => {
  const { rows: meetings } = await pool.query('SELECT * FROM meetings ORDER BY created_at DESC');
  if (data.role === 'Admin') return meetings;
  const subtree = await orgSubtreeUsernames(pool, data.username);
  return meetings.filter(m => subtree.has(m.creator_username));
};

ACTIONS.getMeetingById = async (pool, data) => {
  const { rows } = await pool.query('SELECT * FROM meetings WHERE meeting_id=$1', [data.meeting_id]);
  if (!rows[0]) throw new Error('Không tìm thấy meeting.');
  return rows[0];
};

ACTIONS.approveMeeting = async (pool, data) => {
  const { rows } = await pool.query('SELECT * FROM meetings WHERE meeting_id=$1', [data.meeting_id]);
  const m = rows[0];
  if (!m) throw new Error('Không tìm thấy meeting.');
  if (data.role === 'SM') {
    if (m.status !== 'PendingSM') throw new Error('Meeting không ở trạng thái chờ SM duyệt.');
    await pool.query('UPDATE meetings SET status=$2, sm_note=$3 WHERE meeting_id=$1',
      [data.meeting_id, data.decision === 'approve' ? 'PendingSSM' : 'RejectedSM', data.note || '']);
  } else if (data.role === 'SSM') {
    if (m.status !== 'PendingSSM') throw new Error('Meeting không ở trạng thái chờ SSM duyệt.');
    await pool.query('UPDATE meetings SET status=$2, ssm_note=$3 WHERE meeting_id=$1',
      [data.meeting_id, data.decision === 'approve' ? 'Approved' : 'RejectedSSM', data.note || '']);
  } else {
    throw new Error('Vai trò không có quyền duyệt.');
  }
  return { ok: true };
};

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }

  if (req.method === 'GET') {
    res.status(200).json({ ok: true, message: 'ProAgent backend (Neon) is running. Use POST.' });
    return;
  }

  if (req.method !== 'POST') {
    res.status(405).json({ ok: false, error: 'Method not allowed' });
    return;
  }

  let result;
  try {
    let body = req.body;
    if (typeof body === 'string') body = JSON.parse(body);
    if (!body || typeof body !== 'object') body = {};
    const fn = ACTIONS[body.action];
    if (!fn) throw new Error('Unknown action: ' + body.action);
    const pool = getPool();
    const data = await fn(pool, body.data || {});
    result = { ok: true, data };
  } catch (err) {
    result = { ok: false, error: err.message };
  }
  res.status(200).json(result);
};
