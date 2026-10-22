CREATE TABLE IF NOT EXISTS bookings (
  id TEXT PRIMARY KEY,
  studio TEXT NOT NULL,
  booking_date TEXT NOT NULL,
  slots TEXT NOT NULL,
  applicant TEXT NOT NULL DEFAULT '',
  assistant INTEGER NOT NULL DEFAULT 0,
  reason TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'active',
  owner_token TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_bookings_date_studio
ON bookings(booking_date, studio, status);
