/**
 * ProAgent Tracking — Backend riêng để test (Google Apps Script + Google Sheet).
 * Sheet này KHÔNG liên quan gì tới hệ thống gốc của repo lemaitranmedia/proagent-tracking.
 * Cách dùng: xem hướng dẫn deploy đi kèm (DEPLOY.md).
 */

const SHEET_HEADERS = {
  Accounts:    ['username','password','full_name','role','manager_username','region_codes','active'],
  Regions:     ['region_code','region_name','sm_username'],
  Branches:    ['branch_code','branch_name','region_code','lat','long','radius_m'],
  Checkpoints: ['checkpoint_id','checkpoint_name','lat','long','radius_m'],
  Checkins:    ['checkin_id','username','sa_name','checkpoint_id','checkpoint_name','lat','long','distance_m','radius_m','valid','photo_url','timestamp'],
  Meetings:    ['meeting_id','meeting_code','creator_username','creator_name','creator_role','branch_codes','meeting_date','start_time','end_time','purpose_type','purpose_other','attendees','gps_lat','gps_long','gps_branch_code','gps_distance_m','gps_valid','status','sm_note','ssm_note','resubmitted_from','created_at']
};

/* =========================================================
   SETUP — chạy hàm này 1 lần từ trình soạn thảo Apps Script
   (chọn "setup" ở dropdown function rồi bấm Run) để tạo sheet
   + seed tài khoản Admin đầu tiên.
   ========================================================= */
function setup() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  Object.keys(SHEET_HEADERS).forEach(name => {
    let sh = ss.getSheetByName(name);
    if (!sh) sh = ss.insertSheet(name);
    if (sh.getLastRow() === 0) sh.appendRow(SHEET_HEADERS[name]);
  });
  const def = ss.getSheetByName('Sheet1');
  if (def && ss.getSheets().length > 1 && def.getLastRow() === 0) ss.deleteSheet(def);

  const sh = sheet_('Accounts');
  const exists = getRows_(sh).some(r => r.username === 'admin');
  if (!exists) {
    // Đổi mật khẩu này ngay sau khi đăng nhập lần đầu.
    sh.appendRow(['admin', 'Admin@123', 'Quản trị viên', 'Admin', '', '', 'TRUE']);
  }
  Logger.log('Setup xong. Đăng nhập với username=admin, password=Admin@123');
}

/* =========================================================
   ENTRY POINTS
   ========================================================= */
function doGet(e) {
  return ContentService.createTextOutput(JSON.stringify({ ok: true, message: 'ProAgent backend is running. Use POST.' }))
    .setMimeType(ContentService.MimeType.JSON);
}

function doPost(e) {
  let result;
  try {
    const req = JSON.parse(e.postData.contents);
    const fn = ACTIONS[req.action];
    if (!fn) throw new Error('Unknown action: ' + req.action);
    result = { ok: true, data: fn(req.data || {}) };
  } catch (err) {
    result = { ok: false, error: err.message };
  }
  return ContentService.createTextOutput(JSON.stringify(result)).setMimeType(ContentService.MimeType.JSON);
}

/* =========================================================
   SHEET HELPERS
   ========================================================= */
function sheet_(name) {
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(name);
  if (!sh) throw new Error('Sheet "' + name + '" chưa tồn tại — hãy chạy hàm setup() trước.');
  return sh;
}

function getRows_(sh) {
  const values = sh.getDataRange().getValues();
  const headers = values[0];
  const rows = [];
  for (let i = 1; i < values.length; i++) {
    const obj = {};
    headers.forEach((h, idx) => obj[h] = values[i][idx]);
    obj.__row = i + 1;
    rows.push(obj);
  }
  return rows;
}

function stripRow_(r) {
  const o = Object.assign({}, r);
  delete o.__row;
  return o;
}

function appendObj_(sh, obj) {
  const headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  sh.appendRow(headers.map(h => obj[h] !== undefined ? obj[h] : ''));
}

function findRowIndex_(sh, keyField, keyValue) {
  const found = getRows_(sh).find(r => String(r[keyField]) === String(keyValue));
  return found ? found.__row : -1;
}

function updateCell_(sh, rowIndex, field, value) {
  const headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  const col = headers.indexOf(field) + 1;
  if (col > 0) sh.getRange(rowIndex, col).setValue(value);
}

function haversine_(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const toRad = d => d * Math.PI / 180;
  const dLat = toRad(lat2 - lat1), dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function savePhoto_(dataUrl, name) {
  const match = /^data:(image\/\w+);base64,(.*)$/.exec(dataUrl);
  if (!match) return '';
  const blob = Utilities.newBlob(Utilities.base64Decode(match[2]), match[1], name);
  const it = DriveApp.getFoldersByName('ProAgent Photos');
  const folder = it.hasNext() ? it.next() : DriveApp.createFolder('ProAgent Photos');
  const file = folder.createFile(blob);
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  return file.getUrl();
}

function orgSubtreeUsernames_(username) {
  const accounts = getRows_(sheet_('Accounts'));
  const set = new Set([username]);
  let changed = true;
  while (changed) {
    changed = false;
    accounts.forEach(a => {
      if (set.has(a.manager_username) && !set.has(a.username)) { set.add(a.username); changed = true; }
    });
  }
  return set;
}

/* =========================================================
   ACTIONS
   ========================================================= */
const ACTIONS = {};

ACTIONS.login = function (data) {
  const acc = getRows_(sheet_('Accounts')).find(r => r.username === data.username);
  if (!acc) throw new Error('Tài khoản không tồn tại.');
  if (String(acc.active).toUpperCase() !== 'TRUE') throw new Error('Tài khoản đã bị khóa.');
  if (String(acc.password) !== String(data.password)) throw new Error('Sai mật khẩu.');
  return { username: acc.username, full_name: acc.full_name, role: acc.role, manager_username: acc.manager_username, region_codes: acc.region_codes };
};

ACTIONS.adminListAccounts = function () {
  return getRows_(sheet_('Accounts')).map(stripRow_);
};

ACTIONS.adminCreateAccount = function (data) {
  const { username, password, full_name, role } = data;
  if (!username || !password || !full_name || !role) throw new Error('Thiếu thông tin bắt buộc.');
  const sh = sheet_('Accounts');
  if (getRows_(sh).some(r => r.username === username)) throw new Error('Username đã tồn tại.');
  appendObj_(sh, {
    username, password, full_name, role,
    manager_username: data.manager_username || '',
    region_codes: data.region_codes || '',
    active: 'TRUE'
  });
  return { ok: true };
};

ACTIONS.adminSetAccountActive = function (data) {
  const sh = sheet_('Accounts');
  const rowIdx = findRowIndex_(sh, 'username', data.username);
  if (rowIdx < 0) throw new Error('Không tìm thấy tài khoản.');
  updateCell_(sh, rowIdx, 'active', data.active ? 'TRUE' : 'FALSE');
  return { ok: true };
};

ACTIONS.adminUpdateAccount = function (data) {
  const sh = sheet_('Accounts');
  const rowIdx = findRowIndex_(sh, 'username', data.username);
  if (rowIdx < 0) throw new Error('Không tìm thấy tài khoản.');
  ['full_name', 'role', 'manager_username', 'region_codes'].forEach(f => {
    if (data[f] !== undefined) updateCell_(sh, rowIdx, f, data[f]);
  });
  return { ok: true };
};

ACTIONS.adminUpdateBranch = function (data) {
  const sh = sheet_('Branches');
  const rowIdx = findRowIndex_(sh, 'branch_code', data.branch_code);
  if (rowIdx < 0) throw new Error('Không tìm thấy chi nhánh.');
  ['branch_name', 'region_code', 'lat', 'long', 'radius_m'].forEach(f => {
    if (data[f] !== undefined) updateCell_(sh, rowIdx, f, data[f]);
  });
  return { ok: true };
};

ACTIONS.adminUpdateCheckpoint = function (data) {
  const sh = sheet_('Checkpoints');
  const rowIdx = findRowIndex_(sh, 'checkpoint_id', data.checkpoint_id);
  if (rowIdx < 0) throw new Error('Không tìm thấy điểm checkin.');
  ['checkpoint_name', 'lat', 'long', 'radius_m'].forEach(f => {
    if (data[f] !== undefined) updateCell_(sh, rowIdx, f, data[f]);
  });
  return { ok: true };
};

ACTIONS.adminDeleteCheckpoint = function (data) {
  const sh = sheet_('Checkpoints');
  const rowIdx = findRowIndex_(sh, 'checkpoint_id', data.checkpoint_id);
  if (rowIdx < 0) throw new Error('Không tìm thấy điểm checkin.');
  sh.deleteRow(rowIdx);
  return { ok: true };
};

ACTIONS.adminListRegions = function () {
  return getRows_(sheet_('Regions')).map(stripRow_);
};

ACTIONS.adminCreateRegion = function (data) {
  const { region_code, region_name } = data;
  if (!region_code || !region_name) throw new Error('Thiếu Mã vùng/Tên vùng.');
  const sh = sheet_('Regions');
  if (getRows_(sh).some(r => r.region_code === region_code)) throw new Error('Mã vùng đã tồn tại.');
  appendObj_(sh, { region_code, region_name, sm_username: data.sm_username || '' });
  return { ok: true };
};

ACTIONS.adminListBranches = function () {
  return getRows_(sheet_('Branches')).map(stripRow_);
};

ACTIONS.adminCreateBranch = function (data) {
  let { branch_code, branch_name, region_code, lat, long, radius_m } = data;
  if (!branch_name || !region_code || !lat || !long) throw new Error('Thiếu thông tin chi nhánh.');
  const sh = sheet_('Branches');
  if (!branch_code) branch_code = 'CN' + Utilities.getUuid().slice(0, 6).toUpperCase();
  if (getRows_(sh).some(r => r.branch_code === branch_code)) throw new Error('Mã chi nhánh đã tồn tại.');
  appendObj_(sh, { branch_code, branch_name, region_code, lat: Number(lat), long: Number(long), radius_m: Number(radius_m) || 150 });
  return { ok: true };
};

ACTIONS.adminListCheckpoints = function () {
  return getRows_(sheet_('Checkpoints')).map(stripRow_);
};

ACTIONS.adminCreateCheckpoint = function (data) {
  const { checkpoint_name, lat, long, radius_m } = data;
  if (!checkpoint_name || !lat || !long) throw new Error('Thiếu thông tin điểm checkin.');
  appendObj_(sheet_('Checkpoints'), {
    checkpoint_id: Utilities.getUuid(), checkpoint_name,
    lat: Number(lat), long: Number(long), radius_m: Number(radius_m) || 100
  });
  return { ok: true };
};

ACTIONS.getCheckpointsForUser = function () {
  return getRows_(sheet_('Checkpoints')).map(stripRow_);
};

ACTIONS.submitCheckin = function (data) {
  const { username, full_name, checkpoint_id, lat, long, photo_base64, checkin_id } = data;
  const cp = getRows_(sheet_('Checkpoints')).find(c => c.checkpoint_id === checkpoint_id);
  if (!cp) throw new Error('Không tìm thấy điểm checkin.');
  const dist = Math.round(haversine_(lat, long, Number(cp.lat), Number(cp.long)));
  const valid = dist <= Number(cp.radius_m);
  const cid = checkin_id || Utilities.getUuid();
  const sh = sheet_('Checkins');
  if (!getRows_(sh).some(r => r.checkin_id === cid)) {
    let photoUrl = '';
    if (photo_base64) { try { photoUrl = savePhoto_(photo_base64, cid); } catch (e) { photoUrl = ''; } }
    appendObj_(sh, {
      checkin_id: cid, username, sa_name: full_name, checkpoint_id, checkpoint_name: cp.checkpoint_name,
      lat, long, distance_m: dist, radius_m: cp.radius_m, valid: valid ? 'TRUE' : 'FALSE',
      photo_url: photoUrl, timestamp: new Date().toISOString()
    });
  }
  return { valid, distance_m: dist, radius_m: Number(cp.radius_m) };
};

ACTIONS.listCheckins = function (data) {
  const rows = getRows_(sheet_('Checkins')).map(stripRow_);
  if (data.role === 'Admin') return rows;
  if (data.role === 'SM' || data.role === 'SSM') {
    const subtree = orgSubtreeUsernames_(data.username);
    return rows.filter(r => subtree.has(r.username));
  }
  return rows.filter(r => r.username === data.username);
};

ACTIONS.getMeetingScopeForUser = function (data) {
  const acc = getRows_(sheet_('Accounts')).find(a => a.username === data.username);
  if (!acc) throw new Error('Không tìm thấy tài khoản.');
  let regionCodes = String(acc.region_codes || '').split(',').map(s => s.trim()).filter(Boolean);
  if (acc.role === 'SA' && !regionCodes.length) {
    const manager = getRows_(sheet_('Accounts')).find(a => a.username === acc.manager_username);
    if (manager) regionCodes = String(manager.region_codes || '').split(',').map(s => s.trim()).filter(Boolean);
  }
  const branches = getRows_(sheet_('Branches')).map(stripRow_);
  const scoped = acc.role === 'Admin' ? branches : branches.filter(b => regionCodes.includes(b.region_code));
  return { branches: scoped };
};

ACTIONS.createMeeting = function (data) {
  const acc = getRows_(sheet_('Accounts')).find(a => a.username === data.creator_username);
  if (!acc) throw new Error('Không tìm thấy tài khoản.');
  const branches = getRows_(sheet_('Branches'));
  const branchCodes = String(data.branch_codes || '').split(',').map(s => s.trim()).filter(Boolean);
  let bestDist = null, bestBranch = '', allValid = branchCodes.length > 0;
  branchCodes.forEach(code => {
    const br = branches.find(b => b.branch_code === code);
    if (br && br.lat && br.long) {
      const d = Math.round(haversine_(data.gps_lat, data.gps_long, Number(br.lat), Number(br.long)));
      if (bestDist === null || d < bestDist) { bestDist = d; bestBranch = br.branch_code; }
      if (d > Number(br.radius_m || 150)) allValid = false;
    } else {
      allValid = false;
    }
  });
  const status = acc.role === 'SM' ? 'PendingSSM' : 'PendingSM';
  const meetingId = Utilities.getUuid();
  appendObj_(sheet_('Meetings'), {
    meeting_id: meetingId, meeting_code: data.meeting_code, creator_username: acc.username,
    creator_name: acc.full_name, creator_role: acc.role, branch_codes: data.branch_codes,
    meeting_date: data.meeting_date, start_time: data.start_time, end_time: data.end_time,
    purpose_type: data.purpose_type, purpose_other: data.purpose_other || '', attendees: data.attendees || '',
    gps_lat: data.gps_lat, gps_long: data.gps_long, gps_branch_code: bestBranch,
    gps_distance_m: bestDist === null ? '' : bestDist, gps_valid: allValid ? 'TRUE' : 'FALSE',
    status, sm_note: '', ssm_note: '', resubmitted_from: data.resubmitted_from || '',
    created_at: new Date().toISOString()
  });
  return { meeting_id: meetingId, gps_valid: allValid, gps_distance_m: bestDist === null ? 0 : bestDist };
};

ACTIONS.listMeetingsForApproval = function (data) {
  const accounts = getRows_(sheet_('Accounts'));
  const meetings = getRows_(sheet_('Meetings')).map(stripRow_);
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

ACTIONS.listMeetings = function (data) {
  const meetings = getRows_(sheet_('Meetings')).map(stripRow_);
  if (data.role === 'Admin') return meetings;
  const subtree = orgSubtreeUsernames_(data.username);
  return meetings.filter(m => subtree.has(m.creator_username));
};

ACTIONS.getMeetingById = function (data) {
  const m = getRows_(sheet_('Meetings')).find(r => r.meeting_id === data.meeting_id);
  if (!m) throw new Error('Không tìm thấy meeting.');
  return stripRow_(m);
};

ACTIONS.approveMeeting = function (data) {
  const sh = sheet_('Meetings');
  const rowIdx = findRowIndex_(sh, 'meeting_id', data.meeting_id);
  if (rowIdx < 0) throw new Error('Không tìm thấy meeting.');
  const m = getRows_(sh).find(r => r.meeting_id === data.meeting_id);
  if (data.role === 'SM') {
    if (m.status !== 'PendingSM') throw new Error('Meeting không ở trạng thái chờ SM duyệt.');
    updateCell_(sh, rowIdx, 'status', data.decision === 'approve' ? 'PendingSSM' : 'RejectedSM');
    updateCell_(sh, rowIdx, 'sm_note', data.note || '');
  } else if (data.role === 'SSM') {
    if (m.status !== 'PendingSSM') throw new Error('Meeting không ở trạng thái chờ SSM duyệt.');
    updateCell_(sh, rowIdx, 'status', data.decision === 'approve' ? 'Approved' : 'RejectedSSM');
    updateCell_(sh, rowIdx, 'ssm_note', data.note || '');
  } else {
    throw new Error('Vai trò không có quyền duyệt.');
  }
  return { ok: true };
};
