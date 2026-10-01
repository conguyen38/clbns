const { getPool } = require('./db');

function haversine(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const toRad = d => d * Math.PI / 180;
  const dLat = toRad(lat2 - lat1), dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

const CHECKPOINT_COLUMNS = `checkpoint_id, checkpoint_name, address, activity_type, lat, long, radius_m,
  event_start::text AS event_start, event_end::text AS event_end,
  checkin_start, checkin_end, checkout_start, checkout_end`;

// Giờ Việt Nam (UTC+7, không có DST) dùng để so khung giờ check in/out trong ngày,
// tính độc lập với timezone máy chủ chạy Node.
function nowVNParts() {
  const vn = new Date(Date.now() + 7 * 3600 * 1000);
  return { dateStr: vn.toISOString().slice(0, 10), timeStr: vn.toISOString().slice(11, 16) };
}

function timeInWindow(timeStr, startStr, endStr) {
  if (!startStr || !endStr) return true;
  const s = startStr.slice(0, 5), e = endStr.slice(0, 5);
  if (s <= e) return timeStr >= s && timeStr <= e;
  return timeStr >= s || timeStr <= e; // khung giờ qua đêm (vd 22:00 -> 02:00)
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
  const { username, new_password } = data;
  if (!username || !new_password) throw new Error('Thiếu thông tin.');
  const res = await pool.query('UPDATE accounts SET password=$2 WHERE username=$1', [username, new_password]);
  if (!res.rowCount) throw new Error('Không tìm thấy tài khoản.');
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
  const { rows } = await pool.query(`SELECT ${CHECKPOINT_COLUMNS} FROM checkpoints ORDER BY checkpoint_name`);
  return rows;
};

ACTIONS.adminCreateCheckpoint = async (pool, data) => {
  const { checkpoint_name, activity_type } = data;
  if (!checkpoint_name) throw new Error('Thiếu tên hoạt động.');
  const isOffline = activity_type !== 'online';
  if (isOffline && (!data.lat || !data.long)) throw new Error('Hoạt động offline cần Latitude/Longitude.');
  if (!data.event_start || !data.event_end) throw new Error('Thiếu thời gian diễn ra hoạt động.');
  if (!data.checkin_start || !data.checkin_end) throw new Error('Thiếu khung giờ Check in.');
  if (!data.checkout_start || !data.checkout_end) throw new Error('Thiếu khung giờ Check out.');
  const id = require('crypto').randomUUID();
  await pool.query(
    `INSERT INTO checkpoints (checkpoint_id, checkpoint_name, address, activity_type, lat, long, radius_m, event_start, event_end, checkin_start, checkin_end, checkout_start, checkout_end)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
    [id, checkpoint_name, isOffline ? (data.address || '') : '', isOffline ? 'offline' : 'online',
     isOffline ? Number(data.lat) : null, isOffline ? Number(data.long) : null, isOffline ? (Number(data.radius_m) || 100) : 0,
     data.event_start, data.event_end, data.checkin_start, data.checkin_end, data.checkout_start, data.checkout_end]
  );
  return { ok: true };
};

ACTIONS.adminUpdateCheckpoint = async (pool, data) => {
  const fields = ['checkpoint_name', 'address', 'activity_type', 'lat', 'long', 'radius_m', 'event_start', 'event_end', 'checkin_start', 'checkin_end', 'checkout_start', 'checkout_end']
    .filter(f => data[f] !== undefined);
  if (!fields.length) return { ok: true };
  const setClause = fields.map((f, i) => `${f}=$${i + 2}`).join(', ');
  const values = fields.map(f => data[f]);
  const res = await pool.query(`UPDATE checkpoints SET ${setClause} WHERE checkpoint_id=$1`, [data.checkpoint_id, ...values]);
  if (!res.rowCount) throw new Error('Không tìm thấy hoạt động.');
  return { ok: true };
};

ACTIONS.adminDeleteCheckpoint = async (pool, data) => {
  const res = await pool.query('DELETE FROM checkpoints WHERE checkpoint_id=$1', [data.checkpoint_id]);
  if (!res.rowCount) throw new Error('Không tìm thấy hoạt động.');
  return { ok: true };
};

ACTIONS.getCheckpointsForUser = async (pool) => {
  const { rows } = await pool.query(`SELECT ${CHECKPOINT_COLUMNS} FROM checkpoints ORDER BY checkpoint_name`);
  return rows;
};

// Xác định hành động tiếp theo của user với 1 hoạt động: nếu lần gần nhất
// HÔM NAY là checkin (chưa có checkout theo sau) -> tiếp theo là checkout;
// ngược lại (chưa làm gì hôm nay, hoặc lần gần nhất đã là checkout) -> checkin.
ACTIONS.getActivityCheckStatus = async (pool, data) => {
  const { rows } = await pool.query(
    `SELECT action_type, timestamp FROM checkins
     WHERE username=$1 AND checkpoint_id=$2 AND timestamp::date = CURRENT_DATE
     ORDER BY timestamp DESC LIMIT 1`,
    [data.username, data.activity_id]
  );
  const last = rows[0];
  return { next_action: (last && last.action_type === 'checkin') ? 'checkout' : 'checkin' };
};

ACTIONS.submitActivityLog = async (pool, data) => {
  const { username, full_name, checkpoint_id, action_type, lat, long, photo_base64, photo_thumb_base64, checkin_id } = data;
  const { rows } = await pool.query(`SELECT ${CHECKPOINT_COLUMNS} FROM checkpoints WHERE checkpoint_id=$1`, [checkpoint_id]);
  const cp = rows[0];
  if (!cp) throw new Error('Không tìm thấy hoạt động.');
  const isOffline = cp.activity_type === 'offline';
  const windowStart = action_type === 'checkout' ? cp.checkout_start : cp.checkin_start;
  const windowEnd = action_type === 'checkout' ? cp.checkout_end : cp.checkin_end;
  const { dateStr, timeStr } = nowVNParts();
  const dateValid = (!cp.event_start || dateStr >= cp.event_start) && (!cp.event_end || dateStr <= cp.event_end);
  const timeValid = dateValid && timeInWindow(timeStr, windowStart, windowEnd);

  let dist = null, gpsValid = true;
  if (isOffline) {
    if (lat == null || long == null) throw new Error('Hoạt động offline cần vị trí GPS.');
    dist = Math.round(haversine(lat, long, Number(cp.lat), Number(cp.long)));
    gpsValid = dist <= Number(cp.radius_m);
  }
  const valid = timeValid && gpsValid;

  const cid = checkin_id || require('crypto').randomUUID();
  const exists = await pool.query('SELECT 1 FROM checkins WHERE checkin_id=$1', [cid]);
  if (!exists.rows.length) {
    await pool.query(
      `INSERT INTO checkins (checkin_id, username, sa_name, checkpoint_id, checkpoint_name, action_type, lat, long, distance_m, radius_m, time_valid, valid, photo_url, photo_thumb, timestamp)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14, now())`,
      [cid, username, full_name || '', checkpoint_id, cp.checkpoint_name, action_type || 'checkin',
       isOffline ? lat : null, isOffline ? long : null, dist, isOffline ? cp.radius_m : null,
       timeValid, valid, photo_base64 || '', photo_thumb_base64 || '']
    );
  }
  return { valid, time_valid: timeValid, gps_valid: isOffline ? gpsValid : null, distance_m: dist, radius_m: isOffline ? Number(cp.radius_m) : null };
};

ACTIONS.getCheckinPhoto = async (pool, data) => {
  const { rows } = await pool.query('SELECT photo_url FROM checkins WHERE checkin_id=$1', [data.checkin_id]);
  if (!rows[0]) throw new Error('Không tìm thấy checkin.');
  return { photo_url: rows[0].photo_url || '' };
};

// Cột photo_url chứa cả ảnh base64 (vài MB/checkin) -> danh sách CHỈ trả về cờ
// has_photo, không kéo dữ liệu ảnh; ảnh thật chỉ tải riêng lúc bấm xem
// (xem ACTIONS.getCheckinPhoto) để tránh listCheckins nặng và chậm.
const CHECKIN_LIST_COLUMNS = `checkin_id, username, sa_name, checkpoint_id, checkpoint_name, action_type, lat, long, distance_m, radius_m, time_valid, valid, timestamp, photo_thumb, (photo_url <> '') AS has_photo`;

ACTIONS.listCheckins = async (pool, data) => {
  if (data.role === 'Admin') {
    const { rows } = await pool.query(`SELECT ${CHECKIN_LIST_COLUMNS} FROM checkins ORDER BY timestamp DESC`);
    return rows;
  }
  if (data.role === 'SM') {
    const subtree = await orgSubtreeUsernames(pool, data.username);
    const { rows } = await pool.query(`SELECT ${CHECKIN_LIST_COLUMNS} FROM checkins ORDER BY timestamp DESC`);
    return rows.filter(r => subtree.has(r.username));
  }
  const { rows } = await pool.query(`SELECT ${CHECKIN_LIST_COLUMNS} FROM checkins WHERE username=$1 ORDER BY timestamp DESC`, [data.username]);
  return rows;
};

// Danh sách chỉ trả về thumbnail nhỏ (không kéo screenshot full, vài MB/bản
// ghi) -> getAcceptanceById mới trả ảnh đầy đủ cho trang chi tiết.
const ACCEPTANCE_LIST_COLUMNS = `acceptance_id, acceptance_code, creator_username, creator_name, creator_role, activity_name, description, screenshot_thumb, status, sm_note, ssm_note, resubmitted_from, created_at`;

ACTIONS.listAcceptanceActivities = async (pool, data) => {
  const { rows } = await pool.query(
    `SELECT acceptance_activity_id, activity_name, description, created_by, created_at
     FROM acceptance_activities WHERE active=true ORDER BY created_at DESC, activity_name`
  );
  return rows;
};

ACTIONS.createAcceptanceActivity = async (pool, data) => {
  const { rows: accounts } = await pool.query('SELECT username, role FROM accounts WHERE username=$1', [data.username]);
  const account = accounts[0];
  if (!account || account.role !== 'Admin') throw new Error('Chỉ Admin được tạo hoạt động nghiệm thu.');
  const activityName = String(data.activity_name || '').trim();
  if (!activityName) throw new Error('Thiếu tên hoạt động.');
  const acceptanceActivityId = require('crypto').randomUUID();
  await pool.query(
    `INSERT INTO acceptance_activities (acceptance_activity_id, activity_name, description, created_by)
     VALUES ($1,$2,$3,$4)`,
    [acceptanceActivityId, activityName, String(data.description || '').trim(), account.username]
  );
  return { acceptance_activity_id: acceptanceActivityId };
};

ACTIONS.createAcceptance = async (pool, data) => {
  const { rows: accRows } = await pool.query('SELECT * FROM accounts WHERE username=$1', [data.creator_username]);
  const acc = accRows[0];
  if (!acc) throw new Error('Không tìm thấy tài khoản.');
  if (!data.activity_name) throw new Error('Thiếu tên hoạt động.');
  // SM và Admin là các cấp cao nhất trong luồng hiện tại (không còn SSM),
  // nên nghiệm thu do họ tự tạo được coi là đã duyệt.
  const status = ['SM', 'Admin'].includes(acc.role) ? 'Approved' : 'PendingSM';
  const acceptanceId = require('crypto').randomUUID();
  await pool.query(
    `INSERT INTO acceptances (acceptance_id, acceptance_code, creator_username, creator_name, creator_role,
       activity_name, description, screenshot_url, screenshot_thumb, status, sm_note, ssm_note, resubmitted_from, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'','', $11, now())`,
    [acceptanceId, data.acceptance_code || '', acc.username, acc.full_name, acc.role,
     data.activity_name, data.description || '', data.screenshot_base64 || '', data.screenshot_thumb_base64 || '', status, data.resubmitted_from || '']
  );
  return { acceptance_id: acceptanceId };
};

ACTIONS.listAcceptancesForApproval = async (pool, data) => {
  const { rows: accounts } = await pool.query('SELECT * FROM accounts');
  const { rows: items } = await pool.query(`SELECT ${ACCEPTANCE_LIST_COLUMNS} FROM acceptances ORDER BY created_at DESC`);
  const directReports = new Set(accounts.filter(a => a.manager_username === data.username).map(a => a.username));
  return items.filter(m => m.status === 'PendingSM' && directReports.has(m.creator_username));
};

ACTIONS.listAcceptances = async (pool, data) => {
  const { rows: items } = await pool.query(`SELECT ${ACCEPTANCE_LIST_COLUMNS} FROM acceptances ORDER BY created_at DESC`);
  if (data.role === 'Admin') return items;
  const subtree = await orgSubtreeUsernames(pool, data.username);
  return items.filter(m => subtree.has(m.creator_username));
};

// Báo cáo mức độ tham gia theo tháng: mỗi hoạt động Check in chỉ tính một lần
// cho mỗi nhân viên (dù có cả check in và check out); nghiệm thu tính theo lần gửi.
ACTIONS.getMonthlyActivityReport = async (pool, data) => {
  const { rows: accountRows } = await pool.query('SELECT username, role FROM accounts WHERE username=$1', [data.username]);
  const requester = accountRows[0];
  if (!requester || !['SM', 'Admin'].includes(requester.role)) throw new Error('Vai trò không có quyền xem báo cáo.');

  const month = /^\d{4}-\d{2}$/.test(data.month || '') ? data.month : nowVNParts().dateStr.slice(0, 7);
  const start = `${month}-01`;
  const { rows: accounts } = await pool.query('SELECT username, full_name, role FROM accounts WHERE active=true ORDER BY full_name, username');
  let scopedUsers;
  if (requester.role === 'Admin') {
    scopedUsers = accounts.filter(a => a.role !== 'Admin');
  } else {
    const subtree = await orgSubtreeUsernames(pool, requester.username);
    scopedUsers = accounts.filter(a => a.username !== requester.username && subtree.has(a.username));
  }
  if (!scopedUsers.length) return { month, rows: [] };

  const usernames = scopedUsers.map(a => a.username);
  const [checkins, acceptances] = await Promise.all([
    pool.query(
      `SELECT username, COUNT(DISTINCT checkpoint_id)::int AS total
       FROM checkins
       WHERE username = ANY($1) AND timestamp >= $2::date AND timestamp < ($2::date + INTERVAL '1 month')
       GROUP BY username`,
      [usernames, start]
    ),
    pool.query(
      `SELECT creator_username AS username, COUNT(*)::int AS total
       FROM acceptances
       WHERE creator_username = ANY($1) AND created_at >= $2::date AND created_at < ($2::date + INTERVAL '1 month')
       GROUP BY creator_username`,
      [usernames, start]
    )
  ]);
  const checkinTotals = new Map(checkins.rows.map(r => [r.username, r.total]));
  const acceptanceTotals = new Map(acceptances.rows.map(r => [r.username, r.total]));
  return {
    month,
    rows: scopedUsers.map(a => ({
      username: a.username,
      full_name: a.full_name,
      checkin_activities: checkinTotals.get(a.username) || 0,
      acceptance_activities: acceptanceTotals.get(a.username) || 0
    }))
  };
};

ACTIONS.getAcceptanceById = async (pool, data) => {
  const { rows } = await pool.query('SELECT * FROM acceptances WHERE acceptance_id=$1', [data.acceptance_id]);
  if (!rows[0]) throw new Error('Không tìm thấy hoạt động nghiệm thu.');
  return rows[0];
};

ACTIONS.approveAcceptance = async (pool, data) => {
  const { rows } = await pool.query('SELECT * FROM acceptances WHERE acceptance_id=$1', [data.acceptance_id]);
  const m = rows[0];
  if (!m) throw new Error('Không tìm thấy hoạt động nghiệm thu.');
  if (data.role === 'SM') {
    if (m.status !== 'PendingSM') throw new Error('Hoạt động không ở trạng thái chờ SM duyệt.');
    await pool.query('UPDATE acceptances SET status=$2, sm_note=$3 WHERE acceptance_id=$1',
      [data.acceptance_id, data.decision === 'approve' ? 'Approved' : 'RejectedSM', data.note || '']);
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
