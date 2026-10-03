CREATE TABLE IF NOT EXISTS accounts (
  username          text PRIMARY KEY,
  password          text NOT NULL,
  full_name         text NOT NULL,
  role              text NOT NULL,
  manager_username  text NOT NULL DEFAULT '',
  region_codes      text NOT NULL DEFAULT '',
  active            boolean NOT NULL DEFAULT true
);

CREATE TABLE IF NOT EXISTS regions (
  region_code   text PRIMARY KEY,
  region_name   text NOT NULL,
  sm_username   text NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS branches (
  branch_code   text PRIMARY KEY,
  branch_name   text NOT NULL,
  region_code   text NOT NULL,
  lat           double precision NOT NULL,
  long          double precision NOT NULL,
  radius_m      integer NOT NULL DEFAULT 150
);

-- "checkpoint" ở đây = Hoạt động (online hoặc offline) cho tính năng Check in.
-- Online: không cần lat/long/radius_m/address. Offline: bắt buộc đủ 4 trường đó.
CREATE TABLE IF NOT EXISTS checkpoints (
  checkpoint_id     text PRIMARY KEY,
  checkpoint_name   text NOT NULL,
  address           text NOT NULL DEFAULT '',
  activity_type     text NOT NULL DEFAULT 'offline', -- 'online' | 'offline'
  lat               double precision,
  long              double precision,
  radius_m          integer NOT NULL DEFAULT 100,
  event_start       date, -- ngày bắt đầu hoạt động diễn ra
  event_end         date, -- ngày kết thúc hoạt động diễn ra
  checkin_start     time, -- khung giờ check in trong ngày (không có date)
  checkin_end       time,
  checkout_start    time, -- khung giờ check out trong ngày
  checkout_end      time
);

-- Mỗi dòng là 1 lần check in HOẶC check out (action_type) của 1 user với 1 hoạt động.
CREATE TABLE IF NOT EXISTS checkins (
  checkin_id        text PRIMARY KEY,
  username          text NOT NULL,
  sa_name           text NOT NULL DEFAULT '',
  checkpoint_id     text NOT NULL,
  checkpoint_name   text NOT NULL DEFAULT '',
  action_type       text NOT NULL DEFAULT 'checkin', -- 'checkin' | 'checkout'
  lat               double precision,
  long              double precision,
  distance_m        integer,
  radius_m          integer,
  time_valid        boolean NOT NULL DEFAULT true,  -- có nằm trong khung giờ cho phép không
  valid             boolean NOT NULL DEFAULT false, -- hợp lệ tổng thể (time_valid AND gps_valid nếu offline)
  photo_url         text NOT NULL DEFAULT '',
  photo_thumb       text NOT NULL DEFAULT '',
  timestamp         timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS acceptances (
  acceptance_id       text PRIMARY KEY,
  acceptance_code     text NOT NULL DEFAULT '',
  creator_username    text NOT NULL,
  creator_name        text NOT NULL DEFAULT '',
  creator_role        text NOT NULL DEFAULT '',
  activity_name       text NOT NULL,
  description         text NOT NULL DEFAULT '',
  screenshot_url      text NOT NULL DEFAULT '',
  screenshot_thumb    text NOT NULL DEFAULT '',
  status              text NOT NULL DEFAULT 'PendingSM',
  sm_note             text NOT NULL DEFAULT '',
  ssm_note            text NOT NULL DEFAULT '',
  resubmitted_from    text NOT NULL DEFAULT '',
  created_at          timestamptz NOT NULL DEFAULT now()
);

-- Danh mục hoạt động cần nghiệm thu do Admin tạo. Nhân viên chọn hoạt động
-- trong danh sách rồi mới gửi ảnh/bằng chứng nghiệm thu.
CREATE TABLE IF NOT EXISTS acceptance_activities (
  acceptance_activity_id  text PRIMARY KEY,
  activity_name           text NOT NULL,
  description             text NOT NULL DEFAULT '',
  record_start            timestamptz NOT NULL,
  record_end              timestamptz NOT NULL,
  created_by              text NOT NULL DEFAULT '',
  active                  boolean NOT NULL DEFAULT true,
  created_at              timestamptz NOT NULL DEFAULT now()
);

-- Tương thích database đã có sẵn trước khi bổ sung khoảng thời gian nghiệm thu.
ALTER TABLE acceptance_activities ADD COLUMN IF NOT EXISTS record_start timestamptz;
ALTER TABLE acceptance_activities ADD COLUMN IF NOT EXISTS record_end timestamptz;
ALTER TABLE acceptances ADD COLUMN IF NOT EXISTS acceptance_activity_id text;

-- Thời điểm tạo hoạt động Check in, dùng để báo "hoạt động mới" trên giao
-- diện. Hoạt động đã có từ trước được gán mốc cũ để không bị báo là mới.
-- (api/index.js ensureSchema() cũng tự chạy migration này khi deploy.)
ALTER TABLE checkpoints ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT '2000-01-01T00:00:00Z';
ALTER TABLE checkpoints ALTER COLUMN created_at SET DEFAULT now();

CREATE INDEX IF NOT EXISTS idx_checkins_username ON checkins(username);
CREATE INDEX IF NOT EXISTS idx_acceptances_creator ON acceptances(creator_username);
CREATE INDEX IF NOT EXISTS idx_acceptances_status ON acceptances(status);
CREATE INDEX IF NOT EXISTS idx_acceptance_activities_active ON acceptance_activities(active);
CREATE INDEX IF NOT EXISTS idx_accounts_manager ON accounts(manager_username);

INSERT INTO accounts (username, password, full_name, role, manager_username, region_codes, active)
VALUES ('admin', 'Admin@123', 'Quản trị viên', 'Admin', '', '', true)
ON CONFLICT (username) DO NOTHING;
