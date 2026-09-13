PRAGMA foreign_keys = ON;

CREATE TABLE users (
  sub TEXT PRIMARY KEY,
  disabled INTEGER NOT NULL DEFAULT 0 CHECK (disabled IN (0, 1))
);

CREATE TABLE teams (
  id TEXT PRIMARY KEY,
  owner_sub TEXT NOT NULL REFERENCES users(sub),
  deleted INTEGER NOT NULL DEFAULT 0 CHECK (deleted IN (0, 1))
);

CREATE TABLE memberships (
  team_id TEXT NOT NULL REFERENCES teams(id),
  user_sub TEXT NOT NULL REFERENCES users(sub),
  role TEXT NOT NULL CHECK (role IN ('owner', 'manager', 'member', 'viewer')),
  PRIMARY KEY (team_id, user_sub)
);
CREATE INDEX memberships_user ON memberships(user_sub, team_id);

CREATE TABLE calendars (
  id TEXT PRIMARY KEY,
  owner_sub TEXT NOT NULL REFERENCES users(sub),
  team_id TEXT REFERENCES teams(id),
  assigned_sub TEXT REFERENCES users(sub),
  name TEXT NOT NULL,
  color TEXT NOT NULL,
  timezone TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  updated_at TEXT NOT NULL,
  deleted INTEGER NOT NULL DEFAULT 0 CHECK (deleted IN (0, 1))
);
CREATE INDEX calendars_owner ON calendars(owner_sub, id);
CREATE INDEX calendars_team ON calendars(team_id, id);

CREATE TABLE calendar_days (
  calendar_id TEXT NOT NULL REFERENCES calendars(id),
  date TEXT NOT NULL,
  shift_code TEXT,
  version INTEGER NOT NULL CHECK (version > 0),
  deleted INTEGER NOT NULL CHECK (deleted IN (0, 1)),
  updated_at TEXT NOT NULL,
  updated_by TEXT NOT NULL REFERENCES users(sub),
  PRIMARY KEY (calendar_id, date)
);

CREATE TABLE mutations (
  user_sub TEXT NOT NULL REFERENCES users(sub),
  id TEXT NOT NULL,
  operation TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  result TEXT NOT NULL,
  PRIMARY KEY (user_sub, id)
);

CREATE TABLE audit (
  id INTEGER PRIMARY KEY,
  actor_sub TEXT NOT NULL REFERENCES users(sub),
  mutation_id TEXT NOT NULL,
  operation TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (actor_sub, mutation_id)
);

-- Insert a failed condition into this table to abort the entire D1 batch.
-- A zero-row conditional UPDATE does not raise an error on its own.
CREATE TABLE transaction_checks (
  valid INTEGER NOT NULL CHECK (valid = 1)
);
