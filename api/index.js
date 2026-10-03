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
  checkin_start, checkin_end, checkout_start, checkout_end, created_at`;

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

// Kèm trạng thái check hôm nay của user cho từng hoạt động (cùng cách tính với
// getActivityCheckStatus) để danh sách lọc theo trạng thái và gắn tag.
ACTIONS.getCheckpointsForUser = async (pool, data) => {
  const [{ rows }, { rows: logs }] = await Promise.all([
    pool.query(`SELECT ${CHECKPOINT_COLUMNS} FROM checkpoints ORDER BY checkpoint_name`),
    pool.query(
      `SELECT checkpoint_id, action_type, valid FROM checkins
       WHERE username=$1 AND timestamp::date = CURRENT_DATE
       ORDER BY timestamp DESC`,
      [data.username || '']
    )
  ]);
  return rows.map(cp => {
    const cpLogs = logs.filter(l => l.checkpoint_id === cp.checkpoint_id);
    const last = cpLogs[0];
    const checkin = cpLogs.find(l => l.action_type === 'checkin');
    if (!last) return { ...cp, check_status: 'none', check_valid: null };
    if (last.action_type === 'checkout') {
      return { ...cp, check_status: 'completed', check_valid: !!last.valid && (!checkin || !!checkin.valid) };
    }
    return { ...cp, check_status: 'checked_in', check_valid: !!last.valid };
  });
};

// Xác định hành động tiếp theo của user với 1 hoạt động: nếu lần gần nhất
// HÔM NAY là checkin (chưa có checkout theo sau) -> tiếp theo là checkout;
// ngược lại (chưa làm gì hôm nay, hoặc lần gần nhất đã là checkout) -> checkin.
ACTIONS.getActivityCheckStatus = async (pool, data) => {
  const { rows } = await pool.query(
    `SELECT checkin_id, action_type, timestamp, valid, time_valid, distance_m, radius_m, photo_thumb, (photo_url <> '') AS has_photo
     FROM checkins
     WHERE username=$1 AND checkpoint_id=$2 AND timestamp::date = CURRENT_DATE
     ORDER BY timestamp DESC`,
    [data.username, data.activity_id]
  );
  const last = rows[0];
  const awaitingCheckout = last && last.action_type === 'checkin';
  // Kết quả của lượt gần nhất hôm nay: lần check out mới nhất (nếu lượt đã
  // xong) và lần check in đứng ngay trước nó -> giao diện hiển thị kết quả
  // thay vì các bước check cho thao tác đã làm.
  const checkout = last && last.action_type === 'checkout' ? last : null;
  const checkin = rows.find(r => r.action_type === 'checkin') || null;
  return {
    next_action: awaitingCheckout ? 'checkout' : 'checkin',
    // Trả lại giờ check in gần nhất để giao diện khóa ô Check in và hiển thị
    // chính xác thời điểm nhân viên đã thực hiện thao tác này.
    checkin_timestamp: awaitingCheckout ? last.timestamp : null,
    checkin,
    checkout
  };
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
    `SELECT aa.acceptance_activity_id, aa.activity_name, aa.description, aa.record_start, aa.record_end, aa.created_by, aa.created_at,
       (mine.acceptance_id IS NOT NULL) AS has_submission,
       mine.acceptance_id AS my_acceptance_id, mine.status AS my_status, mine.created_at AS my_submitted_at
     FROM acceptance_activities aa
     LEFT JOIN LATERAL (
       SELECT ac.acceptance_id, ac.status, ac.created_at FROM acceptances ac
       WHERE ac.acceptance_activity_id=aa.acceptance_activity_id AND ac.creator_username=$1
       ORDER BY ac.created_at DESC LIMIT 1
     ) mine ON true
     WHERE aa.active=true
     ORDER BY aa.created_at DESC, aa.activity_name`,
    [data.username]
  );
  return rows;
};

ACTIONS.createAcceptanceActivity = async (pool, data) => {
  const { rows: accounts } = await pool.query('SELECT username, role FROM accounts WHERE username=$1', [data.username]);
  const account = accounts[0];
  if (!account || account.role !== 'Admin') throw new Error('Chỉ Admin được tạo hoạt động nghiệm thu.');
  const activityName = String(data.activity_name || '').trim();
  if (!activityName) throw new Error('Thiếu tên hoạt động.');
  const recordStart = new Date(data.record_start);
  const recordEnd = new Date(data.record_end);
  if (Number.isNaN(recordStart.getTime()) || Number.isNaN(recordEnd.getTime())) throw new Error('Nhập đủ ngày và giờ ghi nhận nghiệm thu.');
  if (recordEnd <= recordStart) throw new Error('Thời gian kết thúc phải sau thời gian bắt đầu.');
  const acceptanceActivityId = require('crypto').randomUUID();
  await pool.query(
    `INSERT INTO acceptance_activities (acceptance_activity_id, activity_name, description, record_start, record_end, created_by)
     VALUES ($1,$2,$3,$4,$5,$6)`,
    [acceptanceActivityId, activityName, String(data.description || '').trim(), recordStart.toISOString(), recordEnd.toISOString(), account.username]
  );
  return { acceptance_activity_id: acceptanceActivityId };
};

ACTIONS.updateAcceptanceActivity = async (pool, data) => {
  const { rows: accounts } = await pool.query('SELECT username, role FROM accounts WHERE username=$1', [data.username]);
  if (!accounts[0] || accounts[0].role !== 'Admin') throw new Error('Chỉ Admin được sửa hoạt động nghiệm thu.');
  const activityName = String(data.activity_name || '').trim();
  const recordStart = new Date(data.record_start);
  const recordEnd = new Date(data.record_end);
  if (!activityName) throw new Error('Thiếu tên hoạt động.');
  if (Number.isNaN(recordStart.getTime()) || Number.isNaN(recordEnd.getTime())) throw new Error('Nhập đủ ngày và giờ ghi nhận nghiệm thu.');
  if (recordEnd <= recordStart) throw new Error('Thời gian kết thúc phải sau thời gian bắt đầu.');
  const result = await pool.query(
    `UPDATE acceptance_activities
     SET activity_name=$2, description=$3, record_start=$4, record_end=$5
     WHERE acceptance_activity_id=$1 AND active=true`,
    [data.acceptance_activity_id, activityName, String(data.description || '').trim(), recordStart.toISOString(), recordEnd.toISOString()]
  );
  if (!result.rowCount) throw new Error('Không tìm thấy hoạt động nghiệm thu.');
  return { ok: true };
};

ACTIONS.deleteAcceptanceActivity = async (pool, data) => {
  const { rows: accounts } = await pool.query('SELECT username, role FROM accounts WHERE username=$1', [data.username]);
  if (!accounts[0] || accounts[0].role !== 'Admin') throw new Error('Chỉ Admin được xóa hoạt động nghiệm thu.');
  const result = await pool.query('UPDATE acceptance_activities SET active=false WHERE acceptance_activity_id=$1 AND active=true', [data.acceptance_activity_id]);
  if (!result.rowCount) throw new Error('Không tìm thấy hoạt động nghiệm thu.');
  return { ok: true };
};

ACTIONS.createAcceptance = async (pool, data) => {
  const { rows: accRows } = await pool.query('SELECT * FROM accounts WHERE username=$1', [data.creator_username]);
  const acc = accRows[0];
  if (!acc) throw new Error('Không tìm thấy tài khoản.');
  if (!data.activity_name && !data.acceptance_activity_id) throw new Error('Thiếu hoạt động nghiệm thu.');
  let activityName = data.activity_name || '';
  if (data.acceptance_activity_id) {
    const { rows: activityRows } = await pool.query('SELECT * FROM acceptance_activities WHERE acceptance_activity_id=$1', [data.acceptance_activity_id]);
    const activity = activityRows[0];
    if (!activity || !activity.active) throw new Error('Hoạt động nghiệm thu không còn khả dụng.');
    if (!activity.record_start || !activity.record_end) throw new Error('Hoạt động chưa có khoảng thời gian ghi nhận.');
    const now = Date.now();
    if (now < new Date(activity.record_start).getTime() || now > new Date(activity.record_end).getTime()) {
      throw new Error('Hoạt động hiện không trong thời gian ghi nhận nghiệm thu.');
    }
    activityName = activity.activity_name;
  }
  // SM và Admin là các cấp cao nhất trong luồng hiện tại (không còn SSM),
  // nên nghiệm thu do họ tự tạo được coi là đã duyệt.
  const status = ['SM', 'Admin'].includes(acc.role) ? 'Approved' : 'PendingSM';

  // Gửi duyệt lại cho hoạt động đã hoàn thành: ghi đè lên bản đã gửi trước
  // đó (vẫn phải trong thời gian ghi nhận — đã kiểm tra ở trên) và quay lại
  // chờ duyệt, thay vì tạo thêm bản mới.
  if (data.overwrite_acceptance_id) {
    if (!data.acceptance_activity_id) throw new Error('Thiếu hoạt động nghiệm thu.');
    const result = await pool.query(
      `UPDATE acceptances
       SET acceptance_code=$3, description=$4, screenshot_url=$5, screenshot_thumb=$6, status=$7,
           sm_note='', ssm_note='', created_at=now()
       WHERE acceptance_id=$1 AND creator_username=$2 AND acceptance_activity_id=$8`,
      [data.overwrite_acceptance_id, acc.username, data.acceptance_code || '', data.description || '',
       data.screenshot_base64 || '', data.screenshot_thumb_base64 || '', status, data.acceptance_activity_id]
    );
    if (!result.rowCount) throw new Error('Không tìm thấy bản nghiệm thu đã gửi.');
    return { acceptance_id: data.overwrite_acceptance_id };
  }

  const acceptanceId = require('crypto').randomUUID();
  await pool.query(
    `INSERT INTO acceptances (acceptance_id, acceptance_code, creator_username, creator_name, creator_role,
       activity_name, description, screenshot_url, screenshot_thumb, status, sm_note, ssm_note, resubmitted_from, created_at, acceptance_activity_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'','', $11, now(), $12)`,
    [acceptanceId, data.acceptance_code || '', acc.username, acc.full_name, acc.role,
     activityName, data.description || '', data.screenshot_base64 || '', data.screenshot_thumb_base64 || '', status, data.resubmitted_from || '', data.acceptance_activity_id || null]
  );
  return { acceptance_id: acceptanceId };
};

ACTIONS.listAcceptancesForApproval = async (pool, data) => {
  const { rows: accounts } = await pool.query('SELECT * FROM accounts');
  const { rows: items } = await pool.query(`SELECT ${ACCEPTANCE_LIST_COLUMNS} FROM acceptances ORDER BY created_at DESC`);
  const requester = accounts.find(a => a.username === data.username);
  const pending = items.filter(m => m.status === 'PendingSM');
  // Admin là cấp cao nhất, có toàn quyền của SM -> thấy mọi bản chờ duyệt.
  if (requester && requester.role === 'Admin') return pending;
  const directReports = new Set(accounts.filter(a => a.manager_username === data.username).map(a => a.username));
  return pending.filter(m => directReports.has(m.creator_username));
};

ACTIONS.listAcceptances = async (pool, data) => {
  const { rows: items } = await pool.query(`SELECT ${ACCEPTANCE_LIST_COLUMNS} FROM acceptances ORDER BY created_at DESC`);
  if (data.role === 'Admin') return items;
  const subtree = await orgSubtreeUsernames(pool, data.username);
  return items.filter(m => subtree.has(m.creator_username));
};

function reportMonthBounds(month) {
  const normalizedMonth = /^\d{4}-\d{2}$/.test(month || '') ? month : nowVNParts().dateStr.slice(0, 7);
  const [year, monthNumber] = normalizedMonth.split('-').map(Number);
  const end = new Date(Date.UTC(year, monthNumber, 1)).toISOString().slice(0, 10);
  return { month: normalizedMonth, start: `${normalizedMonth}-01`, end };
}

async function getReportScope(pool, username) {
  const { rows: accountRows } = await pool.query('SELECT username, role FROM accounts WHERE username=$1', [username]);
  const requester = accountRows[0];
  if (!requester || !['SM', 'Admin'].includes(requester.role)) throw new Error('Vai trò không có quyền xem báo cáo.');

  const { rows: accounts } = await pool.query('SELECT username, full_name, role FROM accounts WHERE active=true ORDER BY full_name, username');
  if (requester.role === 'Admin') {
    return { requester, users: accounts.filter(a => a.role !== 'Admin') };
  }
  const subtree = await orgSubtreeUsernames(pool, requester.username);
  return { requester, users: accounts.filter(a => a.username !== requester.username && subtree.has(a.username)) };
}

async function getExpectedMonthlyActivities(pool, start, end) {
  const [checkpoints, acceptanceActivities] = await Promise.all([
    pool.query(
      `SELECT checkpoint_id, checkpoint_name
       FROM checkpoints
       WHERE (event_start IS NULL OR event_start < $2::date)
         AND (event_end IS NULL OR event_end >= $1::date)
       ORDER BY checkpoint_name`,
      [start, end]
    ),
    pool.query(
      `SELECT acceptance_activity_id, activity_name, description
       FROM acceptance_activities
       WHERE record_start < $2::timestamptz AND record_end >= $1::timestamptz
       ORDER BY activity_name`,
      [start, end]
    )
  ]);
  return { checkpoints: checkpoints.rows, acceptanceActivities: acceptanceActivities.rows };
}

// Báo cáo mức độ tham gia theo tháng: hoạt động hoàn thành được đặt cạnh tổng
// hoạt động cần làm trong tháng, để quản lý nhìn ra ngay nhân viên cần nhắc.
ACTIONS.getMonthlyActivityReport = async (pool, data) => {
  const { month, start, end } = reportMonthBounds(data.month);
  const { users: scopedUsers } = await getReportScope(pool, data.username);
  if (!scopedUsers.length) return { month, rows: [] };

  const usernames = scopedUsers.map(a => a.username);
  const { checkpoints, acceptanceActivities } = await getExpectedMonthlyActivities(pool, start, end);
  const checkpointIds = checkpoints.map(a => a.checkpoint_id);
  const acceptanceActivityIds = acceptanceActivities.map(a => a.acceptance_activity_id);
  const [checkins, acceptances] = await Promise.all([
    pool.query(
      `SELECT username, COUNT(DISTINCT checkpoint_id)::int AS total
       FROM checkins
       WHERE username = ANY($1) AND timestamp >= $2::date AND timestamp < $3::date
         AND checkpoint_id = ANY($4::text[])
       GROUP BY username`,
      [usernames, start, end, checkpointIds]
    ),
    pool.query(
      `SELECT creator_username AS username, COUNT(DISTINCT acceptance_activity_id)::int AS total
       FROM acceptances
       WHERE creator_username = ANY($1) AND created_at >= $2::date AND created_at < $3::date
         AND acceptance_activity_id = ANY($4::text[])
       GROUP BY creator_username`,
      [usernames, start, end, acceptanceActivityIds]
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
      checkin_total: checkpoints.length,
      acceptance_activities: acceptanceTotals.get(a.username) || 0,
      acceptance_total: acceptanceActivities.length
    }))
  };
};

ACTIONS.getMonthlyActivityReportDetails = async (pool, data) => {
  const { month, start, end } = reportMonthBounds(data.month);
  const { users } = await getReportScope(pool, data.username);
  const target = users.find(user => user.username === data.target_username);
  if (!target) throw new Error('Nhân viên không thuộc phạm vi báo cáo.');

  const { checkpoints, acceptanceActivities } = await getExpectedMonthlyActivities(pool, start, end);
  const [checkinRows, acceptanceRows] = await Promise.all([
    pool.query(
      `SELECT checkpoint_id, action_type, timestamp
       FROM checkins
       WHERE username=$1 AND timestamp >= $2::date AND timestamp < $3::date
       ORDER BY timestamp DESC`,
      [target.username, start, end]
    ),
    pool.query(
      `SELECT acceptance_activity_id, status, created_at
       FROM acceptances
       WHERE creator_username=$1 AND created_at >= $2::date AND created_at < $3::date
         AND acceptance_activity_id IS NOT NULL
       ORDER BY created_at DESC`,
      [target.username, start, end]
    )
  ]);
  const latestCheckin = new Map();
  checkinRows.rows.forEach(row => { if (!latestCheckin.has(row.checkpoint_id)) latestCheckin.set(row.checkpoint_id, row); });
  const latestAcceptance = new Map();
  acceptanceRows.rows.forEach(row => { if (!latestAcceptance.has(row.acceptance_activity_id)) latestAcceptance.set(row.acceptance_activity_id, row); });

  return {
    month,
    user: target,
    checkins: checkpoints.map(activity => {
      const record = latestCheckin.get(activity.checkpoint_id);
      return { ...activity, completed: !!record, recorded_at: record ? record.timestamp : null, action_type: record ? record.action_type : null };
    }),
    acceptances: acceptanceActivities.map(activity => {
      const record = latestAcceptance.get(activity.acceptance_activity_id);
      return { ...activity, completed: !!record, recorded_at: record ? record.created_at : null, status: record ? record.status : null };
    })
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
  if (['SM', 'Admin'].includes(data.role)) {
    if (m.status !== 'PendingSM') throw new Error('Hoạt động không ở trạng thái chờ duyệt.');
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
