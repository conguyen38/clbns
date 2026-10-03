// Database demo cho chạy local: Postgres (PGlite) trong bộ nhớ, tạo bảng từ
// schema.sql rồi nạp data mẫu. Mỗi lần khởi động lại server là data reset.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function vnDate(offsetDays = 0) {
  return new Date(Date.now() + 7 * 3600 * 1000 + offsetDays * 86400000).toISOString().slice(0, 10);
}

function hoursAgo(h) {
  return new Date(Date.now() - h * 3600 * 1000).toISOString();
}

// Mốc thời gian trong HÔM NAY (backend tính "hôm nay" theo ngày của database),
// cách hiện tại vài phút nhưng không lùi qua 0h để tag trạng thái luôn hiện.
function todayMinutesAgo(m) {
  const now = new Date();
  const midnight = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return new Date(Math.max(midnight + 1000, now.getTime() - m * 60000)).toISOString();
}

async function seed(db) {
  const accounts = [
    ['admin', 'Admin@123', 'Quản trị viên', 'Admin', '', ''],
    ['sm01', '123456', 'Nguyễn Văn Minh', 'SM', '', 'HN'],
    ['sm02', '123456', 'Trần Thị Hoa', 'SM', '', 'HCM'],
    ['sa01', '123456', 'Lê Văn An', 'SA', 'sm01', 'HN'],
    ['sa02', '123456', 'Phạm Thị Bình', 'SA', 'sm01', 'HN'],
    ['sa03', '123456', 'Hoàng Văn Cường', 'SA', 'sm01', 'HN'],
    ['sa04', '123456', 'Vũ Thị Dung', 'SA', 'sm02', 'HCM'],
    ['sa05', '123456', 'Đặng Văn Em', 'SA', 'sm02', 'HCM'],
  ];
  for (const a of accounts) {
    await db.query(
      `INSERT INTO accounts (username, password, full_name, role, manager_username, region_codes, active)
       VALUES ($1,$2,$3,$4,$5,$6,true) ON CONFLICT (username) DO NOTHING`, a);
  }

  await db.query(`UPDATE accounts SET branch_code = CASE username
    WHEN 'sa01' THEN 'CN001' WHEN 'sa02' THEN 'CN002' WHEN 'sa03' THEN 'CN002'
    WHEN 'sa04' THEN 'CN003' WHEN 'sa05' THEN 'CN003' ELSE '' END`);

  await db.query(`INSERT INTO regions VALUES ('HN','Hà Nội','sm01'), ('HCM','TP. Hồ Chí Minh','sm02')`);
  await db.query(`INSERT INTO branches VALUES
    ('CN001','Chi nhánh Hoàn Kiếm','HN',21.0285,105.8542,150),
    ('CN002','Chi nhánh Cầu Giấy','HN',21.0362,105.7906,150),
    ('CN003','Chi nhánh Quận 1','HCM',10.7769,106.7009,150)`);

  const checkpoints = [
    ['cp-1', 'Hội thảo khách hàng Hoàn Kiếm', '15 Tràng Tiền, Hoàn Kiếm, Hà Nội', 'offline', 21.0245, 105.8572, 200, vnDate(-10), vnDate(20), '00:00', '23:59', '00:00', '23:59'],
    ['cp-2', 'Roadshow Quận 1', 'Phố đi bộ Nguyễn Huệ, Quận 1', 'offline', 10.7740, 106.7038, 300, vnDate(-5), vnDate(5), '07:00', '10:00', '16:00', '19:00'],
    ['cp-3', 'Đào tạo sản phẩm online', '', 'online', null, null, 0, vnDate(-15), vnDate(15), '00:00', '23:59', '00:00', '23:59'],
    ['cp-4', 'Webinar tháng trước', '', 'online', null, null, 0, vnDate(-45), vnDate(-31), '08:00', '09:00', '11:00', '12:00'],
    ['cp-5', 'Mở bán dự án Cầu Giấy', '120 Xuân Thủy, Cầu Giấy, Hà Nội', 'offline', 21.0368, 105.7826, 200, vnDate(-2), vnDate(12), '08:00', '10:00', '16:00', '18:00'],
    ['cp-6', 'Gặp mặt đối tác online', '', 'online', null, null, 0, vnDate(-1), vnDate(25), '09:00', '11:00', '15:00', '17:00'],
    ['cp-7', 'Tư vấn khách hàng tại Vincom Bà Triệu', '191 Bà Triệu, Hai Bà Trưng, Hà Nội', 'offline', 21.0113, 105.8492, 200, vnDate(-3), vnDate(4), '00:00', '23:59', '00:00', '23:59'],
    ['cp-8', 'Họp giao ban tuần', '', 'online', null, null, 0, vnDate(-6), vnDate(30), '00:00', '23:59', '00:00', '23:59'],
    ['cp-9', 'Sự kiện tri ân khách hàng Tây Hồ', '1 Thanh Niên, Tây Hồ, Hà Nội', 'offline', 21.0480, 105.8366, 250, vnDate(0), vnDate(2), '00:00', '23:59', '00:00', '23:59'],
    ['cp-10', 'Livestream giới thiệu sản phẩm', '', 'online', null, null, 0, vnDate(-8), vnDate(8), '00:00', '23:59', '00:00', '23:59'],
  ];
  // cp-5, cp-6 mới được tạo hôm qua -> hiện chấm đỏ "hoạt động mới" ở Check in.
  const newCheckpoints = new Set(['cp-5', 'cp-6']);
  for (const c of checkpoints) {
    await db.query(
      `INSERT INTO checkpoints (checkpoint_id, checkpoint_name, address, activity_type, lat, long, radius_m, event_start, event_end, checkin_start, checkin_end, checkout_start, checkout_end, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
      [...c, hoursAgo(newCheckpoints.has(c[0]) ? 20 : 24 * 20)]);
  }

  const checkins = [
    ['sa01', 'Lê Văn An', 'cp-1', 'Hội thảo khách hàng Hoàn Kiếm', 'checkin', 21.0246, 105.8570, 25, 200, true, true, 30],
    ['sa01', 'Lê Văn An', 'cp-1', 'Hội thảo khách hàng Hoàn Kiếm', 'checkout', 21.0247, 105.8571, 22, 200, true, true, 26],
    ['sa02', 'Phạm Thị Bình', 'cp-1', 'Hội thảo khách hàng Hoàn Kiếm', 'checkin', 21.0400, 105.8400, 2300, 200, true, false, 50],
    ['sa01', 'Lê Văn An', 'cp-3', 'Đào tạo sản phẩm online', 'checkin', null, null, null, null, true, true, 72],
    ['sa03', 'Hoàng Văn Cường', 'cp-3', 'Đào tạo sản phẩm online', 'checkin', null, null, null, null, false, false, 5],
    ['sa04', 'Vũ Thị Dung', 'cp-2', 'Roadshow Quận 1', 'checkin', 10.7741, 106.7036, 24, 300, true, true, 20],
  ];
  // Lượt check HÔM NAY của sa01 -> danh sách hiện đủ các loại tag:
  //   cp-3 check in + out hợp lệ        -> "✓ Đã check in/out"
  //   cp-1 mới check in hợp lệ          -> "Đã check in · chờ check out"
  //   cp-2 check in sai vị trí           -> "Check in không hợp lệ"
  //   cp-5 check out ngoài khung giờ     -> "Check in/out không hợp lệ"
  //   cp-6, cp-4 chưa làm gì             -> không có tag
  const todayCheckins = [
    ['sa01', 'Lê Văn An', 'cp-3', 'Đào tạo sản phẩm online', 'checkin', null, null, null, null, true, true, 40],
    ['sa01', 'Lê Văn An', 'cp-3', 'Đào tạo sản phẩm online', 'checkout', null, null, null, null, true, true, 30],
    ['sa01', 'Lê Văn An', 'cp-1', 'Hội thảo khách hàng Hoàn Kiếm', 'checkin', 21.0246, 105.8570, 25, 200, true, true, 25],
    ['sa01', 'Lê Văn An', 'cp-2', 'Roadshow Quận 1', 'checkin', 21.0285, 105.8542, 1143000, 300, true, false, 20],
    ['sa01', 'Lê Văn An', 'cp-5', 'Mở bán dự án Cầu Giấy', 'checkin', 21.0369, 105.7827, 15, 200, true, true, 15],
    ['sa01', 'Lê Văn An', 'cp-5', 'Mở bán dự án Cầu Giấy', 'checkout', 21.0369, 105.7827, 18, 200, false, false, 5],
    // Thêm các hoạt động đã check in của sa01:
    ['sa01', 'Lê Văn An', 'cp-7', 'Tư vấn khách hàng tại Vincom Bà Triệu', 'checkin', 21.0114, 105.8493, 14, 200, true, true, 55],
    ['sa01', 'Lê Văn An', 'cp-7', 'Tư vấn khách hàng tại Vincom Bà Triệu', 'checkout', 21.0112, 105.8491, 12, 200, true, true, 45],
    ['sa01', 'Lê Văn An', 'cp-8', 'Họp giao ban tuần', 'checkin', null, null, null, null, true, true, 50],
    ['sa01', 'Lê Văn An', 'cp-8', 'Họp giao ban tuần', 'checkout', null, null, null, null, true, true, 42],
    ['sa01', 'Lê Văn An', 'cp-9', 'Sự kiện tri ân khách hàng Tây Hồ', 'checkin', 21.0481, 105.8367, 16, 250, true, true, 12],
    ['sa01', 'Lê Văn An', 'cp-10', 'Livestream giới thiệu sản phẩm', 'checkin', null, null, null, null, true, true, 8],
    ['sa02', 'Phạm Thị Bình', 'cp-3', 'Đào tạo sản phẩm online', 'checkin', null, null, null, null, true, true, 35],
  ];
  const insertCheckin = (c, timestamp) => {
    const [username, saName, cpId, cpName, action, lat, long, dist, radius, timeValid, valid] = c;
    return db.query(
      `INSERT INTO checkins (checkin_id, username, sa_name, checkpoint_id, checkpoint_name, action_type, lat, long, distance_m, radius_m, time_valid, valid, timestamp)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
      [crypto.randomUUID(), username, saName, cpId, cpName, action, lat, long, dist, radius, timeValid, valid, timestamp]);
  };
  for (const c of checkins) await insertCheckin(c, hoursAgo(c[11]));
  for (const c of todayCheckins) await insertCheckin(c, todayMinutesAgo(c[11]));

  await db.query(
    `INSERT INTO acceptance_activities (acceptance_activity_id, activity_name, description, record_start, record_end, created_by, created_at) VALUES
     ('aa-1','Treo banner tại chi nhánh','Chụp ảnh banner đã treo tại quầy giao dịch',$1,$2,'admin',$5),
     ('aa-2','Phát tờ rơi khu dân cư','Ảnh chụp lúc phát tờ rơi, kèm vị trí',$1,$2,'admin',$5),
     ('aa-3','Đăng bài mạng xã hội','Screenshot bài đăng Facebook/Zalo',$3,$4,'admin',$5),
     ('aa-4','Khảo sát ý kiến khách hàng','Ảnh phiếu khảo sát đã điền (đã hết hạn ghi nhận)',$6,$7,'admin',$5),
     ('aa-5','Livestream bán hàng','Screenshot buổi livestream có số người xem',$1,$2,'admin',$5),
     ('aa-6','Check-in fanpage dự án','Screenshot bài check-in trên fanpage dự án (hoạt động mới)',$1,$2,'admin',$8)`,
    [hoursAgo(24 * 7), hoursAgo(-24 * 14), hoursAgo(24 * 3), hoursAgo(-24 * 3), hoursAgo(24 * 10), hoursAgo(24 * 9), hoursAgo(24 * 2), hoursAgo(6)]);

  const acceptances = [
    ['NT-001', 'sa01', 'Lê Văn An', 'SA', 'aa-1', 'Treo banner tại chi nhánh', 'Đã treo 2 banner tại CN Hoàn Kiếm', 'Approved', 'Tốt', 48],
    ['NT-002', 'sa02', 'Phạm Thị Bình', 'SA', 'aa-1', 'Treo banner tại chi nhánh', 'Banner tại CN Cầu Giấy', 'PendingSM', '', 6],
    ['NT-003', 'sa03', 'Hoàng Văn Cường', 'SA', 'aa-2', 'Phát tờ rơi khu dân cư', 'Phát 200 tờ khu Mỹ Đình', 'RejectedSM', 'Ảnh mờ, chụp lại giúp anh', 30],
    ['NT-004', 'sa01', 'Lê Văn An', 'SA', 'aa-3', 'Đăng bài mạng xã hội', 'Bài đăng trên Facebook cá nhân', 'PendingSM', '', 2],
    ['NT-005', 'sa04', 'Vũ Thị Dung', 'SA', 'aa-2', 'Phát tờ rơi khu dân cư', 'Phát tờ rơi Quận 3', 'PendingSM', '', 10],
    ['NT-006', 'sa01', 'Lê Văn An', 'SA', 'aa-4', 'Khảo sát ý kiến khách hàng', '15 phiếu khảo sát', 'Approved', 'OK', 60],
    ['NT-007', 'sa01', 'Lê Văn An', 'SA', 'aa-5', 'Livestream bán hàng', 'Livestream tối thứ 6', 'RejectedSM', 'Ảnh chưa thấy số người xem, chụp lại giúp em', 20],
  ];
  for (const a of acceptances) {
    const [code, user, name, role, activityId, activityName, desc, status, smNote, ago] = a;
    await db.query(
      `INSERT INTO acceptances (acceptance_id, acceptance_code, creator_username, creator_name, creator_role, activity_name, description, status, sm_note, created_at, acceptance_activity_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [crypto.randomUUID(), code, user, name, role, activityName, desc, status, smNote, hoursAgo(ago), activityId]);
  }
}

async function createDemoPool() {
  const { PGlite } = await import('@electric-sql/pglite');
  const db = new PGlite();
  await db.exec(fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8'));
  await seed(db);
  // Giả lập interface pool.query của Neon/pg (rows + rowCount).
  return {
    async query(text, params) {
      const r = await db.query(text, params);
      return { rows: r.rows, rowCount: r.affectedRows ?? r.rows.length };
    },
  };
}

module.exports = { createDemoPool };
