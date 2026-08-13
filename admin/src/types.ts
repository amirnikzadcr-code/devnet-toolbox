/**
 * DevNet Toolbox — Admin Panel Worker
 *
 * A second, independent Worker that shares the bot's D1 database and KV
 * namespace. It is deployed under its own hostname so that a compromise of the
 * panel's surface never touches the bot's webhook, and so the bot Worker's
 * bundle stays free of dashboard HTML.
 *
 * Secrets are supplied by Cloudflare Secrets — never hardcoded, never logged,
 * never returned in a response body.
 */

export interface AdminEnv {
  /** Secret: password for the panel's first authentication factor. */
  ADMIN_PASSWORD: string;
  /** Secret: HMAC key used to sign session cookies. */
  SESSION_SECRET: string;
  /** Secret: Telegram bot token, used to deliver 2FA codes and broadcasts. */
  BOT_TOKEN: string;
  /** Var: Telegram user id allowed to log in and receive 2FA codes. */
  ADMIN_CHAT_ID: string;
  /** Var: public URL of the bot Worker, shown on the dashboard. */
  BOT_WORKER_URL?: string;
  /** Var: bot username without the @. */
  BOT_USERNAME?: string;
  /**
   * Secret (optional): Cloudflare API token with `Account Analytics: Read`,
   * used only to read usage figures. Absent it, the usage card explains what
   * is missing instead of showing misleading zeros.
   */
  CF_ANALYTICS_TOKEN?: string;
  /** Var (optional): Cloudflare account id for the usage query. */
  CF_ACCOUNT_ID?: string;

  /** KV: sessions, login throttling and 2FA challenges. */
  STATE: KVNamespace;
  /** D1: the bot's database, shared read/write. */
  DB: D1Database;
}

export interface Session {
  /** Telegram id of the authenticated administrator. */
  uid: number;
  /** Issued-at, unix seconds. */
  iat: number;
  /** Expiry, unix seconds. */
  exp: number;
}

export interface OverviewStats {
  users: number;
  newUsersToday: number;
  activeToday: number;
  activeWeek: number;
  requests: number;
  toolRuns: number;
  runsToday: number;
  distinctTools: number;
  banned: number;
  favorites: number;
  scans: number;
  highRiskScans: number;
}

export interface DailyPoint {
  day: string;
  uses: number;
}

export interface ToolRow {
  tool_id: string;
  uses: number;
  users: number;
  last_used: number;
}

export interface UserRow {
  user_id: number;
  first_name: string;
  last_name: string | null;
  username: string | null;
  lang: string;
  first_seen: number;
  last_seen: number;
  requests: number;
  tool_runs: number;
  banned: number;
}

export interface AuditRow {
  id: number;
  action: string;
  target: string;
  detail: string;
  ip: string;
  created_at: number;
}

export interface BroadcastRow {
  id: string;
  body: string;
  audience: string;
  total: number;
  sent: number;
  failed: number;
  status: string;
  created_at: number;
  finished_at: number | null;
}

/** One row of the live activity feed. Metadata only — never message text. */
export interface ActivityRow {
  id: number;
  user_id: number;
  kind: string;
  detail: string;
  ok: number;
  ms: number;
  created_at: number;
  first_name?: string | null;
  username?: string | null;
}

/** Per-recipient outcome of a broadcast send. */
export interface DeliveryRow {
  user_id: number;
  status: string;
  error: string;
  sent_at: number;
  first_name?: string | null;
  username?: string | null;
}

/** Cloudflare account-level usage, read from the GraphQL analytics API. */
export interface CloudflareUsage {
  /** True when the analytics API answered; false means we show why, not zeros. */
  available: boolean;
  /** Reason shown to the operator when `available` is false. */
  reason?: string;
  workers: { requests: number; errors: number; subrequests: number };
  /** Per-Worker split so the bot and the panel can be told apart. */
  scripts: { name: string; requests: number; errors: number }[];
  d1: { readQueries: number; writeQueries: number };
  /** Free-plan daily allowances, for the progress bars. */
  limits: { workerRequests: number; d1Reads: number; d1Writes: number };
}
