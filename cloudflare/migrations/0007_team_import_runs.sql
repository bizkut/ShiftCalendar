PRAGMA foreign_keys = ON;

CREATE TABLE team_import_runs (
  actor_sub TEXT NOT NULL REFERENCES users(sub),
  mutation_id TEXT NOT NULL,
  team_id TEXT NOT NULL REFERENCES teams(id),
  fingerprint TEXT NOT NULL,
  result TEXT NOT NULL,
  created_at TEXT NOT NULL,
  completed_at TEXT NOT NULL,
  PRIMARY KEY (actor_sub, mutation_id)
);

CREATE INDEX team_import_runs_team
  ON team_import_runs(team_id, completed_at DESC, mutation_id);
