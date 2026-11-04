CREATE TABLE IF NOT EXISTS users (
  user_id TEXT PRIMARY KEY,
  lat REAL NOT NULL,
  lon REAL NOT NULL,
  timezone TEXT NOT NULL,
  last_checked_date TEXT
);
