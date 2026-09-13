-- Global administration is separate from ownership of private calendars.
-- No API permission is granted by this table until team administration ships.
CREATE TABLE application_administrators (
  user_sub TEXT PRIMARY KEY REFERENCES users(sub),
  created_at TEXT NOT NULL
);
