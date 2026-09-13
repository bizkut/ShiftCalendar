ALTER TABLE users ADD COLUMN username TEXT;
ALTER TABLE users ADD COLUMN display_name TEXT NOT NULL DEFAULT '';
ALTER TABLE users ADD COLUMN version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0);
ALTER TABLE users ADD COLUMN updated_at TEXT NOT NULL DEFAULT '';
CREATE UNIQUE INDEX users_username ON users(username) WHERE username IS NOT NULL;

ALTER TABLE teams ADD COLUMN name TEXT NOT NULL DEFAULT 'Team';
ALTER TABLE teams ADD COLUMN timezone TEXT NOT NULL DEFAULT 'Asia/Kuala_Lumpur';
ALTER TABLE teams ADD COLUMN version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0);
ALTER TABLE teams ADD COLUMN updated_at TEXT NOT NULL DEFAULT '';

ALTER TABLE memberships ADD COLUMN joined_at TEXT NOT NULL DEFAULT '';
ALTER TABLE memberships ADD COLUMN version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0);

CREATE TABLE team_invitations (
  id TEXT PRIMARY KEY,
  team_id TEXT NOT NULL REFERENCES teams(id),
  invitee_sub TEXT NOT NULL REFERENCES users(sub),
  role TEXT NOT NULL CHECK (role IN ('manager', 'member', 'viewer')),
  status TEXT NOT NULL CHECK (status IN ('pending', 'accepted', 'declined', 'revoked')),
  expires_at TEXT NOT NULL,
  created_by TEXT NOT NULL REFERENCES users(sub),
  created_at TEXT NOT NULL,
  responded_at TEXT,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0)
);
CREATE INDEX team_invitations_invitee ON team_invitations(invitee_sub, status, id);
CREATE INDEX team_invitations_team ON team_invitations(team_id, status, id);
CREATE UNIQUE INDEX team_invitations_pending
  ON team_invitations(team_id, invitee_sub) WHERE status = 'pending';

CREATE UNIQUE INDEX calendars_team_assignee
  ON calendars(team_id, assigned_sub) WHERE team_id IS NOT NULL AND deleted = 0;
