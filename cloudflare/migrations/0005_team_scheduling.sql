PRAGMA foreign_keys = ON;

CREATE TABLE team_shift_types (
  team_id TEXT NOT NULL REFERENCES teams(id),
  code TEXT NOT NULL,
  label TEXT NOT NULL,
  color TEXT NOT NULL,
  icon TEXT NOT NULL,
  start_time TEXT NOT NULL,
  end_time TEXT NOT NULL,
  position INTEGER NOT NULL CHECK (position BETWEEN 0 AND 99),
  archived INTEGER NOT NULL DEFAULT 0 CHECK (archived IN (0, 1)),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  updated_at TEXT NOT NULL,
  updated_by TEXT NOT NULL REFERENCES users(sub),
  PRIMARY KEY (team_id, code)
);
CREATE INDEX team_shift_types_list
  ON team_shift_types(team_id, archived, position, code);

CREATE TABLE team_rotation_templates (
  id TEXT PRIMARY KEY,
  team_id TEXT NOT NULL REFERENCES teams(id),
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  pattern_json TEXT NOT NULL,
  archived INTEGER NOT NULL DEFAULT 0 CHECK (archived IN (0, 1)),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  updated_at TEXT NOT NULL,
  updated_by TEXT NOT NULL REFERENCES users(sub)
);
CREATE INDEX team_rotation_templates_list
  ON team_rotation_templates(team_id, archived, name, id);

CREATE TABLE schedule_runs (
  actor_sub TEXT NOT NULL REFERENCES users(sub),
  mutation_id TEXT NOT NULL,
  team_id TEXT NOT NULL REFERENCES teams(id),
  fingerprint TEXT NOT NULL,
  result TEXT,
  created_at TEXT NOT NULL,
  completed_at TEXT,
  PRIMARY KEY (actor_sub, mutation_id)
);
CREATE INDEX schedule_runs_team ON schedule_runs(team_id, created_at);
