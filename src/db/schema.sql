-- DevNet Toolbox — D1 schema
-- Design notes:
--  * Only non-sensitive identity data is stored (Telegram id, display name, username, language).
--  * Tool INPUT and OUTPUT are never persisted.
--  * Counters are denormalised on `users` so the profile page is a single indexed read.

PRAGMA foreign_keys = ON;

-- ─── Users ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
  user_id       INTEGER PRIMARY KEY,          -- Telegram user id
  first_name    TEXT    NOT NULL DEFAULT '',
  last_name     TEXT,
  username      TEXT,
  lang          TEXT    NOT NULL DEFAULT 'fa' CHECK (lang IN ('fa', 'en')),
  first_seen    INTEGER NOT NULL,             -- unix seconds
  last_seen     INTEGER NOT NULL,
  requests      INTEGER NOT NULL DEFAULT 0,   -- every update handled for this user
  tool_runs     INTEGER NOT NULL DEFAULT 0    -- successful tool executions
);

CREATE INDEX IF NOT EXISTS idx_users_last_seen ON users (last_seen DESC);

-- ─── Per-user per-tool usage ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tool_usage (
  user_id   INTEGER NOT NULL,
  tool_id   TEXT    NOT NULL,
  uses      INTEGER NOT NULL DEFAULT 0,
  last_used INTEGER NOT NULL,
  PRIMARY KEY (user_id, tool_id),
  FOREIGN KEY (user_id) REFERENCES users (user_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_tool_usage_tool ON tool_usage (tool_id);
CREATE INDEX IF NOT EXISTS idx_tool_usage_user_uses ON tool_usage (user_id, uses DESC);

-- ─── Daily aggregate (kept small, one row per day per tool) ─────────────
CREATE TABLE IF NOT EXISTS daily_stats (
  day     TEXT    NOT NULL,       -- YYYY-MM-DD (UTC)
  tool_id TEXT    NOT NULL,
  uses    INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, tool_id)
);

CREATE INDEX IF NOT EXISTS idx_daily_day ON daily_stats (day DESC);

-- ─── Global counters (single row) ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS counters (
  key   TEXT PRIMARY KEY,
  value INTEGER NOT NULL DEFAULT 0
);

INSERT OR IGNORE INTO counters (key, value) VALUES ('requests', 0);
INSERT OR IGNORE INTO counters (key, value) VALUES ('tool_runs', 0);
INSERT OR IGNORE INTO counters (key, value) VALUES ('errors', 0);

-- ─── Security scan history (Phase 2, requirement 13) ────────────────────
-- Privacy by design: no raw file, no file name, no URL, no secret value.
-- `target_hash` is a SHA-256 of the target (file bytes or normalised URL), so
-- a repeat scan can be recognised without ever storing what was scanned.
CREATE TABLE IF NOT EXISTS security_scans (
  scan_id     TEXT    PRIMARY KEY,           -- short random id shown to the user
  user_id     INTEGER NOT NULL,
  scan_type   TEXT    NOT NULL CHECK (scan_type IN ('apk','url','file','secret','dependency','ioc')),
  target_hash TEXT    NOT NULL,              -- SHA-256, never the target itself
  target_label TEXT   NOT NULL DEFAULT '',   -- short, redacted display label
  severity    TEXT    NOT NULL CHECK (severity IN ('safe','low','medium','high','critical')),
  score       INTEGER NOT NULL DEFAULT 0,
  findings    INTEGER NOT NULL DEFAULT 0,
  high_count  INTEGER NOT NULL DEFAULT 0,    -- high + critical, for the dashboard
  created_at  INTEGER NOT NULL,              -- unix seconds
  FOREIGN KEY (user_id) REFERENCES users (user_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_scans_user_date ON security_scans (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_scans_hash ON security_scans (target_hash, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_scans_type ON security_scans (scan_type, created_at DESC);

-- ─── Phase 4: personal favourites (requirement 50) ──────────────────────
-- Stores only the tool id a user starred and when. No tool input, no output,
-- and nothing that reveals what the user actually ran through the tool.
CREATE TABLE IF NOT EXISTS favorites (
  user_id  INTEGER NOT NULL,
  tool_id  TEXT    NOT NULL,
  added_at INTEGER NOT NULL,               -- unix seconds
  PRIMARY KEY (user_id, tool_id),
  FOREIGN KEY (user_id) REFERENCES users (user_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_favorites_user ON favorites (user_id, added_at DESC);
