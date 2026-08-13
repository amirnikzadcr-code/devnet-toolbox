/**
 * Every database read and write the panel performs.
 *
 * All user input reaches D1 through bound parameters — never string
 * interpolation — so a crafted search term cannot alter a query. The one place
 * that builds SQL dynamically (the `IN (...)` list when unbanning in bulk)
 * generates only placeholders and binds the values separately.
 */
import type {
  ActivityRow,
  AdminEnv,
  AuditRow,
  BroadcastRow,
  DailyPoint,
  DeliveryRow,
  OverviewStats,
  ToolRow,
  UserRow,
} from './types.js';

const nowSec = (): number => Math.floor(Date.now() / 1000);
const utcDay = (offsetDays = 0): string => {
  const date = new Date(Date.now() - offsetDays * 86_400_000);
  return date.toISOString().slice(0, 10);
};

const num = (value: unknown): number => (typeof value === 'number' ? value : Number(value ?? 0) || 0);

/** One batched round-trip for the whole overview card row. */
export async function overview(db: D1Database): Promise<OverviewStats> {
  const today = utcDay();
  const dayAgo = nowSec() - 86_400;
  const weekAgo = nowSec() - 7 * 86_400;
  const midnight = Math.floor(new Date(`${today}T00:00:00Z`).getTime() / 1000);

  const batch = await db.batch<Record<string, unknown>>([
    db.prepare('SELECT key, value FROM counters'),
    db.prepare('SELECT COUNT(*) AS c FROM users'),
    db.prepare('SELECT COUNT(*) AS c FROM users WHERE first_seen >= ?1').bind(midnight),
    db.prepare('SELECT COUNT(*) AS c FROM users WHERE last_seen >= ?1').bind(dayAgo),
    db.prepare('SELECT COUNT(*) AS c FROM users WHERE last_seen >= ?1').bind(weekAgo),
    db.prepare('SELECT COALESCE(SUM(uses), 0) AS c FROM daily_stats WHERE day = ?1').bind(today),
    db.prepare('SELECT COUNT(DISTINCT tool_id) AS c FROM tool_usage'),
    db.prepare('SELECT COUNT(*) AS c FROM banned_users'),
    db.prepare('SELECT COUNT(*) AS c FROM favorites'),
    db.prepare('SELECT COUNT(*) AS c FROM security_scans'),
    db.prepare("SELECT COUNT(*) AS c FROM security_scans WHERE severity IN ('high','critical')"),
  ]);

  const rows = (index: number): Record<string, unknown>[] => batch[index]?.results ?? [];
  const count = (index: number): number => num(rows(index)[0]?.['c']);

  const counters = new Map<string, number>();
  for (const row of rows(0)) {
    const key = row['key'];
    if (typeof key === 'string') counters.set(key, num(row['value']));
  }

  return {
    users: count(1),
    newUsersToday: count(2),
    activeToday: count(3),
    activeWeek: count(4),
    requests: counters.get('requests') ?? 0,
    toolRuns: counters.get('tool_runs') ?? 0,
    runsToday: count(5),
    distinctTools: count(6),
    banned: count(7),
    favorites: count(8),
    scans: count(9),
    highRiskScans: count(10),
  };
}

/** Daily totals for the activity chart, oldest first, with gaps filled in. */
export async function dailySeries(db: D1Database, days = 14): Promise<DailyPoint[]> {
  const since = utcDay(days - 1);
  const res = await db
    .prepare('SELECT day, SUM(uses) AS uses FROM daily_stats WHERE day >= ?1 GROUP BY day ORDER BY day ASC')
    .bind(since)
    .all<{ day: string; uses: number }>();

  const found = new Map((res.results ?? []).map((row) => [row.day, num(row.uses)]));
  const series: DailyPoint[] = [];
  for (let i = days - 1; i >= 0; i -= 1) {
    const day = utcDay(i);
    series.push({ day, uses: found.get(day) ?? 0 });
  }
  return series;
}

export async function topTools(db: D1Database, limit = 20): Promise<ToolRow[]> {
  const res = await db
    .prepare(
      `SELECT tool_id, SUM(uses) AS uses, COUNT(DISTINCT user_id) AS users, MAX(last_used) AS last_used
       FROM tool_usage GROUP BY tool_id ORDER BY uses DESC LIMIT ?1`,
    )
    .bind(limit)
    .all<ToolRow>();
  return (res.results ?? []).map((row) => ({
    tool_id: String(row.tool_id),
    uses: num(row.uses),
    users: num(row.users),
    last_used: num(row.last_used),
  }));
}

export interface UserQuery {
  search?: string;
  sort?: 'last_seen' | 'tool_runs' | 'first_seen';
  page?: number;
  perPage?: number;
  bannedOnly?: boolean;
}

export async function listUsers(
  db: D1Database,
  query: UserQuery = {},
): Promise<{ rows: UserRow[]; total: number; page: number; pages: number }> {
  const perPage = Math.min(Math.max(query.perPage ?? 25, 1), 100);
  const page = Math.max(query.page ?? 1, 1);
  const search = (query.search ?? '').trim().slice(0, 64);

  // The sort column is chosen from a fixed allow-list, never taken from input.
  const sortColumn =
    query.sort === 'tool_runs' ? 'tool_runs' : query.sort === 'first_seen' ? 'first_seen' : 'last_seen';

  const filters: string[] = [];
  const params: unknown[] = [];
  if (search) {
    params.push(`%${search.toLowerCase()}%`, `%${search.toLowerCase()}%`, search);
    filters.push(
      `(LOWER(u.first_name) LIKE ?${params.length - 2} OR LOWER(COALESCE(u.username,'')) LIKE ?${params.length - 1} OR CAST(u.user_id AS TEXT) = ?${params.length})`,
    );
  }
  if (query.bannedOnly === true) filters.push('b.user_id IS NOT NULL');
  const where = filters.length > 0 ? `WHERE ${filters.join(' AND ')}` : '';

  const countRow = await db
    .prepare(`SELECT COUNT(*) AS c FROM users u LEFT JOIN banned_users b ON b.user_id = u.user_id ${where}`)
    .bind(...params)
    .first<{ c: number }>();
  const total = num(countRow?.c);

  const res = await db
    .prepare(
      `SELECT u.user_id, u.first_name, u.last_name, u.username, u.lang, u.first_seen, u.last_seen,
              u.requests, u.tool_runs, CASE WHEN b.user_id IS NULL THEN 0 ELSE 1 END AS banned
       FROM users u LEFT JOIN banned_users b ON b.user_id = u.user_id
       ${where}
       ORDER BY u.${sortColumn} DESC
       LIMIT ?${params.length + 1} OFFSET ?${params.length + 2}`,
    )
    .bind(...params, perPage, (page - 1) * perPage)
    .all<UserRow>();

  return {
    rows: (res.results ?? []).map((row) => ({ ...row, banned: num(row.banned) })),
    total,
    page,
    pages: Math.max(Math.ceil(total / perPage), 1),
  };
}

export async function userDetail(
  db: D1Database,
  userId: number,
): Promise<{ user: UserRow; tools: ToolRow[]; favorites: string[]; scans: number } | null> {
  const user = await db
    .prepare(
      `SELECT u.user_id, u.first_name, u.last_name, u.username, u.lang, u.first_seen, u.last_seen,
              u.requests, u.tool_runs, CASE WHEN b.user_id IS NULL THEN 0 ELSE 1 END AS banned
       FROM users u LEFT JOIN banned_users b ON b.user_id = u.user_id WHERE u.user_id = ?1`,
    )
    .bind(userId)
    .first<UserRow>();
  if (!user) return null;

  const [tools, favorites, scans] = await Promise.all([
    db
      .prepare(
        'SELECT tool_id, uses, 1 AS users, last_used FROM tool_usage WHERE user_id = ?1 ORDER BY uses DESC LIMIT 15',
      )
      .bind(userId)
      .all<ToolRow>(),
    db
      .prepare('SELECT tool_id FROM favorites WHERE user_id = ?1 ORDER BY added_at DESC')
      .bind(userId)
      .all<{ tool_id: string }>(),
    db
      .prepare('SELECT COUNT(*) AS c FROM security_scans WHERE user_id = ?1')
      .bind(userId)
      .first<{ c: number }>(),
  ]);

  return {
    user: { ...user, banned: num(user.banned) },
    tools: (tools.results ?? []).map((row) => ({ ...row, uses: num(row.uses), last_used: num(row.last_used) })),
    favorites: (favorites.results ?? []).map((row) => row.tool_id),
    scans: num(scans?.c),
  };
}

// ─── Moderation ──────────────────────────────────────────────────────────

/**
 * Bans are written to D1 *and* mirrored into KV. The bot checks KV on its hot
 * path, so a ban takes effect on the next update without adding a D1 read to
 * every message.
 */
export async function banUser(env: AdminEnv, userId: number, reason: string): Promise<void> {
  await env.DB.prepare(
    'INSERT INTO banned_users (user_id, reason, banned_at, banned_by) VALUES (?1, ?2, ?3, ?4) ' +
      'ON CONFLICT(user_id) DO UPDATE SET reason = excluded.reason, banned_at = excluded.banned_at',
  )
    .bind(userId, reason.slice(0, 200), nowSec(), 'panel')
    .run();
  await env.STATE.put(`ban:${userId}`, '1');
}

export async function unbanUser(env: AdminEnv, userId: number): Promise<void> {
  await env.DB.prepare('DELETE FROM banned_users WHERE user_id = ?1').bind(userId).run();
  await env.STATE.delete(`ban:${userId}`);
}

/**
 * Erases everything the bot holds about one user (GDPR-style request).
 * Foreign keys cascade from `users`, but the deletes are explicit so the
 * behaviour does not silently depend on `PRAGMA foreign_keys` being on.
 */
export async function purgeUser(env: AdminEnv, userId: number): Promise<void> {
  await env.DB.batch([
    env.DB.prepare('DELETE FROM tool_usage WHERE user_id = ?1').bind(userId),
    env.DB.prepare('DELETE FROM favorites WHERE user_id = ?1').bind(userId),
    env.DB.prepare('DELETE FROM security_scans WHERE user_id = ?1').bind(userId),
    env.DB.prepare('DELETE FROM users WHERE user_id = ?1').bind(userId),
  ]);
  await env.STATE.delete(`lang:${userId}`);
  await env.STATE.delete(`pending:${userId}`);
}

// ─── Audit trail ─────────────────────────────────────────────────────────

export async function audit(
  db: D1Database,
  entry: { action: string; target?: string; detail?: string; ip?: string },
): Promise<void> {
  await db
    .prepare('INSERT INTO admin_audit (action, target, detail, ip, created_at) VALUES (?1, ?2, ?3, ?4, ?5)')
    .bind(entry.action, entry.target ?? '', (entry.detail ?? '').slice(0, 300), entry.ip ?? '', nowSec())
    .run();
}

export async function recentAudit(db: D1Database, limit = 50): Promise<AuditRow[]> {
  const res = await db
    .prepare('SELECT id, action, target, detail, ip, created_at FROM admin_audit ORDER BY id DESC LIMIT ?1')
    .bind(limit)
    .all<AuditRow>();
  return res.results ?? [];
}

// ─── Broadcasts ──────────────────────────────────────────────────────────

export async function createBroadcast(
  db: D1Database,
  id: string,
  body: string,
  audience: string,
  total: number,
): Promise<void> {
  await db
    .prepare(
      'INSERT INTO broadcasts (id, body, audience, total, sent, failed, status, created_at) VALUES (?1, ?2, ?3, ?4, 0, 0, ?5, ?6)',
    )
    .bind(id, body.slice(0, 4000), audience, total, 'running', nowSec())
    .run();
}

export async function finishBroadcast(
  db: D1Database,
  id: string,
  sent: number,
  failed: number,
  status: 'done' | 'failed',
): Promise<void> {
  await db
    .prepare('UPDATE broadcasts SET sent = ?2, failed = ?3, status = ?4, finished_at = ?5 WHERE id = ?1')
    .bind(id, sent, failed, status, nowSec())
    .run();
}

export async function recentBroadcasts(db: D1Database, limit = 20): Promise<BroadcastRow[]> {
  const res = await db
    .prepare(
      'SELECT id, body, audience, total, sent, failed, status, created_at, finished_at FROM broadcasts ORDER BY created_at DESC LIMIT ?1',
    )
    .bind(limit)
    .all<BroadcastRow>();
  return res.results ?? [];
}

/** Recipients for a broadcast. Banned users are always excluded. */
export async function broadcastAudience(db: D1Database, audience: string): Promise<number[]> {
  const clauses: Record<string, string> = {
    all: '1 = 1',
    active7: 'u.last_seen >= :cutoff7',
    active30: 'u.last_seen >= :cutoff30',
    fa: "u.lang = 'fa'",
    en: "u.lang = 'en'",
  };
  const clause = clauses[audience] ?? clauses['all'] ?? '1 = 1';
  const cutoff7 = nowSec() - 7 * 86_400;
  const cutoff30 = nowSec() - 30 * 86_400;
  const sql =
    `SELECT u.user_id FROM users u LEFT JOIN banned_users b ON b.user_id = u.user_id ` +
    `WHERE b.user_id IS NULL AND ${clause.replace(':cutoff7', String(cutoff7)).replace(':cutoff30', String(cutoff30))} ` +
    `ORDER BY u.last_seen DESC LIMIT 5000`;
  const res = await db.prepare(sql).all<{ user_id: number }>();
  return (res.results ?? []).map((row) => num(row.user_id));
}

// ─── Live activity feed ─────────────────────────────────────────────────

/**
 * How long activity rows are kept.
 *
 * The feed is an operational tool, not an archive. A short window keeps the
 * table small and limits how much behavioural history exists about any user.
 */
export const ACTIVITY_RETENTION_DAYS = 7;

/** Most recent events, newest first, joined to the user for display. */
export async function recentActivity(
  db: D1Database,
  options: { limit?: number; userId?: number; kind?: string; sinceId?: number } = {},
): Promise<ActivityRow[]> {
  const limit = Math.min(Math.max(options.limit ?? 60, 1), 200);
  const where: string[] = [];
  const binds: unknown[] = [];

  if (options.userId !== undefined) {
    binds.push(options.userId);
    where.push(`a.user_id = ?${binds.length}`);
  }
  if (options.kind) {
    binds.push(options.kind);
    where.push(`a.kind = ?${binds.length}`);
  }
  if (options.sinceId !== undefined) {
    binds.push(options.sinceId);
    where.push(`a.id > ?${binds.length}`);
  }

  binds.push(limit);
  const sql =
    `SELECT a.id, a.user_id, a.kind, a.detail, a.ok, a.ms, a.created_at, u.first_name, u.username ` +
    `FROM activity a LEFT JOIN users u ON u.user_id = a.user_id ` +
    `${where.length ? `WHERE ${where.join(' AND ')} ` : ''}` +
    `ORDER BY a.id DESC LIMIT ?${binds.length}`;

  const res = await db.prepare(sql).bind(...binds).all<ActivityRow>();
  return res.results ?? [];
}

/** Rolling counters for the monitor header. */
export async function activityPulse(
  db: D1Database,
): Promise<{ lastMin: number; last5Min: number; lastHour: number; errorsHour: number; activeNow: number }> {
  const now = nowSec();
  const batch = await db.batch<Record<string, unknown>>([
    db.prepare('SELECT COUNT(*) AS c FROM activity WHERE created_at >= ?1').bind(now - 60),
    db.prepare('SELECT COUNT(*) AS c FROM activity WHERE created_at >= ?1').bind(now - 300),
    db.prepare('SELECT COUNT(*) AS c FROM activity WHERE created_at >= ?1').bind(now - 3600),
    db.prepare('SELECT COUNT(*) AS c FROM activity WHERE ok = 0 AND created_at >= ?1').bind(now - 3600),
    db.prepare('SELECT COUNT(DISTINCT user_id) AS c FROM activity WHERE created_at >= ?1').bind(now - 300),
  ]);
  const at = (index: number): number => num((batch[index]?.results?.[0] as { c?: unknown })?.c);
  return {
    lastMin: at(0),
    last5Min: at(1),
    lastHour: at(2),
    errorsHour: at(3),
    activeNow: at(4),
  };
}

/** Deletes rows past the retention window. Returns how many were removed. */
export async function pruneActivity(db: D1Database, days = ACTIVITY_RETENTION_DAYS): Promise<number> {
  const cutoff = nowSec() - days * 86_400;
  const res = await db.prepare('DELETE FROM activity WHERE created_at < ?1').bind(cutoff).run();
  return num((res.meta as { changes?: unknown } | undefined)?.changes);
}

// ─── Broadcast delivery ─────────────────────────────────────────────────

/**
 * Records the per-recipient result of a broadcast.
 *
 * Written in chunks because D1 caps the number of bound parameters per
 * statement; 4 columns × 50 rows stays well inside the limit.
 */
export async function recordDeliveries(
  db: D1Database,
  broadcastId: string,
  rows: { userId: number; status: 'sent' | 'failed'; error?: string }[],
): Promise<void> {
  const ts = nowSec();
  const CHUNK = 50;
  for (let index = 0; index < rows.length; index += CHUNK) {
    const slice = rows.slice(index, index + CHUNK);
    await db.batch(
      slice.map((row) =>
        db
          .prepare(
            `INSERT INTO broadcast_delivery (broadcast_id, user_id, status, error, sent_at)
             VALUES (?1, ?2, ?3, ?4, ?5)
             ON CONFLICT(broadcast_id, user_id) DO UPDATE SET
               status = excluded.status, error = excluded.error, sent_at = excluded.sent_at`,
          )
          .bind(broadcastId, row.userId, row.status, (row.error ?? '').slice(0, 120), ts),
      ),
    );
  }
}

/** Who a given broadcast reached, and who it failed for. */
export async function broadcastDeliveries(
  db: D1Database,
  broadcastId: string,
  status?: 'sent' | 'failed',
): Promise<DeliveryRow[]> {
  const binds: unknown[] = [broadcastId];
  let sql =
    `SELECT d.user_id, d.status, d.error, d.sent_at, u.first_name, u.username ` +
    `FROM broadcast_delivery d LEFT JOIN users u ON u.user_id = d.user_id ` +
    `WHERE d.broadcast_id = ?1`;
  if (status) {
    binds.push(status);
    sql += ` AND d.status = ?${binds.length}`;
  }
  sql += ' ORDER BY d.status ASC, d.sent_at ASC LIMIT 2000';
  const res = await db.prepare(sql).bind(...binds).all<DeliveryRow>();
  return res.results ?? [];
}

/**
 * "Engaged" count for a broadcast: recipients who interacted with the bot
 * after it was sent.
 *
 * This is NOT a read receipt — the Bot API cannot report those. It is a
 * strictly weaker signal, and the UI labels it as such.
 */
export async function broadcastEngagement(
  db: D1Database,
  broadcastId: string,
  sentAt: number,
): Promise<number> {
  const res = await db
    .prepare(
      `SELECT COUNT(DISTINCT a.user_id) AS c FROM activity a
       JOIN broadcast_delivery d ON d.user_id = a.user_id AND d.broadcast_id = ?1
       WHERE d.status = 'sent' AND a.created_at >= ?2`,
    )
    .bind(broadcastId, sentAt)
    .all<{ c: number }>();
  return num(res.results?.[0]?.c);
}

/** A single broadcast with its delivery breakdown. */
export async function broadcastById(db: D1Database, id: string): Promise<BroadcastRow | null> {
  const res = await db
    .prepare(
      'SELECT id, body, audience, total, sent, failed, status, created_at, finished_at FROM broadcasts WHERE id = ?1',
    )
    .bind(id)
    .all<BroadcastRow>();
  return res.results?.[0] ?? null;
}
