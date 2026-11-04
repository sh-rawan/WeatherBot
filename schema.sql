CREATE TABLE IF NOT EXISTS users (
  user_id TEXT PRIMARY KEY,
  lat REAL NOT NULL,
  lon REAL NOT NULL,
  timezone TEXT NOT NULL,
  last_checked_date TEXT
);

-- One row for every forecast card sent. Reaction stays 'none' unless the user taps a button.
CREATE TABLE IF NOT EXISTS suggestions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  telegram_message_id INTEGER NOT NULL,
  source TEXT NOT NULL,            -- evening, today, tomorrow or test.
  sent_at TEXT NOT NULL,           -- UTC.
  forecast_date TEXT NOT NULL,     -- The local date the card describes.
  timezone TEXT NOT NULL,
  icons TEXT NOT NULL,
  reasons TEXT NOT NULL,           -- JSON list: umbrella, temperature, clothes, requested or test.
  snapshot TEXT NOT NULL,          -- JSON weather numbers behind the icons.
  reaction TEXT NOT NULL DEFAULT 'none', -- none, like or dislike. The latest tap wins.
  reacted_at TEXT,                 -- UTC.
  UNIQUE (user_id, telegram_message_id)
);

CREATE INDEX IF NOT EXISTS suggestions_by_date ON suggestions (forecast_date);
