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

-- ─── Admin panel (separate Worker, same database) ───────────────────────
-- The panel is a second Worker bound to this database. These tables are the
-- only state it owns; everything else it shows is read from the bot's tables.

-- Blocked users. The bot mirrors this into KV so the hot path stays a single
-- cheap read instead of a D1 round-trip on every update.
CREATE TABLE IF NOT EXISTS banned_users (
  user_id   INTEGER PRIMARY KEY,
  reason    TEXT    NOT NULL DEFAULT '',
  banned_at INTEGER NOT NULL,
  banned_by TEXT    NOT NULL DEFAULT 'admin'
);

-- Append-only trail of every state-changing action performed in the panel.
-- `detail` is a short human-readable summary; it must never contain a secret.
CREATE TABLE IF NOT EXISTS admin_audit (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  action     TEXT    NOT NULL,
  target     TEXT    NOT NULL DEFAULT '',
  detail     TEXT    NOT NULL DEFAULT '',
  ip         TEXT    NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_audit_date ON admin_audit (created_at DESC);

-- Broadcast history. Message text is kept so a send can be audited, but the
-- per-recipient result is only ever aggregated into counters.
CREATE TABLE IF NOT EXISTS broadcasts (
  id         TEXT    PRIMARY KEY,
  body       TEXT    NOT NULL,
  audience   TEXT    NOT NULL DEFAULT 'all',
  total      INTEGER NOT NULL DEFAULT 0,
  sent       INTEGER NOT NULL DEFAULT 0,
  failed     INTEGER NOT NULL DEFAULT 0,
  status     TEXT    NOT NULL DEFAULT 'running' CHECK (status IN ('running','done','failed')),
  created_at INTEGER NOT NULL,
  finished_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_broadcasts_date ON broadcasts (created_at DESC);

-- ─── Live activity feed (admin monitor) ─────────────────────────────────
-- Metadata only, by explicit decision: who did what, when, and whether it
-- worked. The message TEXT is never written here — only a command name, a
-- tool id, or a coarse kind such as 'photo'. `detail` is a short, bounded
-- label (e.g. a tool id or callback route), never user-supplied free text.
--
-- Rows are pruned to ACTIVITY_RETENTION_DAYS by the panel so the table stays
-- small and personal data is not kept indefinitely.
CREATE TABLE IF NOT EXISTS activity (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL,
  kind       TEXT    NOT NULL,          -- command | tool | callback | input | media
  detail     TEXT    NOT NULL DEFAULT '',
  ok         INTEGER NOT NULL DEFAULT 1,
  ms         INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_activity_date ON activity (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_activity_user ON activity (user_id, created_at DESC);

-- ─── Per-recipient broadcast delivery ───────────────────────────────────
-- Telegram's Bot API has no read receipts, so the honest signal is delivery:
-- whether sendMessage was accepted for each recipient, and if not, why.
-- `error` holds Telegram's short description (e.g. "bot was blocked by the
-- user"), which is a diagnostic string, not user content.
CREATE TABLE IF NOT EXISTS broadcast_delivery (
  broadcast_id TEXT    NOT NULL,
  user_id      INTEGER NOT NULL,
  status       TEXT    NOT NULL CHECK (status IN ('sent','failed')),
  error        TEXT    NOT NULL DEFAULT '',
  sent_at      INTEGER NOT NULL,
  PRIMARY KEY (broadcast_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_delivery_bc ON broadcast_delivery (broadcast_id, status);
