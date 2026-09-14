PRAGMA foreign_keys = ON;

CREATE TABLE team_change_requests (
  id TEXT PRIMARY KEY,
  team_id TEXT NOT NULL REFERENCES teams(id),
  kind TEXT NOT NULL CHECK (kind IN ('direct', 'swap')),
  requester_sub TEXT NOT NULL REFERENCES users(sub),
  requester_calendar_id TEXT NOT NULL REFERENCES calendars(id),
  requester_date TEXT NOT NULL,
  requester_observed_version INTEGER NOT NULL CHECK (requester_observed_version >= 0),
  requester_observed_shift_code TEXT,
  requested_shift_code TEXT,
  counterpart_sub TEXT REFERENCES users(sub),
  counterpart_calendar_id TEXT REFERENCES calendars(id),
  counterpart_date TEXT,
  counterpart_observed_version INTEGER,
  counterpart_observed_shift_code TEXT,
  status TEXT NOT NULL CHECK (status IN (
    'pending_counterpart', 'pending_manager', 'approved', 'rejected', 'declined', 'cancelled'
  )),
  reason TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  resolved_at TEXT,
  resolved_by TEXT REFERENCES users(sub)
);

CREATE INDEX team_change_requests_team_status
  ON team_change_requests(team_id, status, updated_at DESC, id);
CREATE INDEX team_change_requests_requester
  ON team_change_requests(requester_sub, updated_at DESC, id);
CREATE INDEX team_change_requests_counterpart
  ON team_change_requests(counterpart_sub, updated_at DESC, id);
