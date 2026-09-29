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

CREATE TABLE IF NOT EXISTS checkpoints (
  checkpoint_id     text PRIMARY KEY,
  checkpoint_name   text NOT NULL,
  lat               double precision NOT NULL,
  long              double precision NOT NULL,
  radius_m          integer NOT NULL DEFAULT 100
);

CREATE TABLE IF NOT EXISTS checkins (
  checkin_id        text PRIMARY KEY,
  username          text NOT NULL,
  sa_name           text NOT NULL DEFAULT '',
  checkpoint_id     text NOT NULL,
  checkpoint_name   text NOT NULL DEFAULT '',
  lat               double precision,
  long              double precision,
  distance_m        integer,
  radius_m          integer,
  valid             boolean NOT NULL DEFAULT false,
  photo_url         text NOT NULL DEFAULT '',
  timestamp         timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS meetings (
  meeting_id          text PRIMARY KEY,
  meeting_code        text NOT NULL DEFAULT '',
  creator_username    text NOT NULL,
  creator_name        text NOT NULL DEFAULT '',
  creator_role        text NOT NULL DEFAULT '',
  branch_codes        text NOT NULL DEFAULT '',
  meeting_date        text NOT NULL DEFAULT '',
  start_time          text NOT NULL DEFAULT '',
  end_time            text NOT NULL DEFAULT '',
  purpose_type        text NOT NULL DEFAULT '',
  purpose_other       text NOT NULL DEFAULT '',
  attendees           text NOT NULL DEFAULT '',
  gps_lat             double precision,
  gps_long            double precision,
  gps_branch_code     text NOT NULL DEFAULT '',
  gps_distance_m      integer,
  gps_valid           boolean NOT NULL DEFAULT false,
  status              text NOT NULL DEFAULT 'PendingSM',
  sm_note             text NOT NULL DEFAULT '',
  ssm_note            text NOT NULL DEFAULT '',
  resubmitted_from    text NOT NULL DEFAULT '',
  created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_checkins_username ON checkins(username);
CREATE INDEX IF NOT EXISTS idx_meetings_creator ON meetings(creator_username);
CREATE INDEX IF NOT EXISTS idx_meetings_status ON meetings(status);
CREATE INDEX IF NOT EXISTS idx_accounts_manager ON accounts(manager_username);

INSERT INTO accounts (username, password, full_name, role, manager_username, region_codes, active)
VALUES ('admin', 'Admin@123', 'Quản trị viên', 'Admin', '', '', true)
ON CONFLICT (username) DO NOTHING;
