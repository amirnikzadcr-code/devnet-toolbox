import type { Lang } from '../localization/index.js';
import type { TgUser } from '../types/telegram.js';
import { logError } from '../utils/errors.js';

export interface UserRow {
  user_id: number;
  first_name: string;
  last_name: string | null;
  username: string | null;
  lang: Lang;
  first_seen: number;
  last_seen: number;
  requests: number;
  tool_runs: number;
}

export interface ToolUsageRow {
  tool_id: string;
  uses: number;
  last_used: number;
}

export interface GlobalStats {
  requests: number;
  toolRuns: number;
  users: number;
  distinctTools: number;
  today: number;
  top: ToolUsageRow[];
}

const nowSec = (): number => Math.floor(Date.now() / 1000);
const utcDay = (): string => new Date().toISOString().slice(0, 10);

/** Upsert the user record and bump the request counter. Never stores message content. */
export async function touchUser(db: D1Database, user: TgUser, lang: Lang): Promise<void> {
  const ts = nowSec();
  await db
    .prepare(
      `INSERT INTO users (user_id, first_name, last_name, username, lang, first_seen, last_seen, requests, tool_runs)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6, 1, 0)
       ON CONFLICT(user_id) DO UPDATE SET
         first_name = excluded.first_name,
         last_name  = excluded.last_name,
         username   = excluded.username,
         last_seen  = excluded.last_seen,
         requests   = users.requests + 1`,
    )
    .bind(user.id, user.first_name ?? '', user.last_name ?? null, user.username ?? null, lang, ts)
    .run();
}

export async function getUser(db: D1Database, userId: number): Promise<UserRow | null> {
  return db.prepare('SELECT * FROM users WHERE user_id = ?1').bind(userId).first<UserRow>();
}

export async function setLang(db: D1Database, userId: number, lang: Lang): Promise<void> {
  await db.prepare('UPDATE users SET lang = ?2 WHERE user_id = ?1').bind(userId, lang).run();
}

export async function getLang(db: D1Database, userId: number): Promise<Lang | null> {
  const row = await db.prepare('SELECT lang FROM users WHERE user_id = ?1').bind(userId).first<{ lang: Lang }>();
  return row?.lang ?? null;
}

/** Record a successful tool run: user counter + per-tool + daily aggregate + global counter. */
export async function recordToolRun(db: D1Database, userId: number, toolId: string): Promise<void> {
  const ts = nowSec();
  const day = utcDay();
  await db.batch([
    db.prepare('UPDATE users SET tool_runs = tool_runs + 1, last_seen = ?2 WHERE user_id = ?1').bind(userId, ts),
    db
      .prepare(
        `INSERT INTO tool_usage (user_id, tool_id, uses, last_used) VALUES (?1, ?2, 1, ?3)
         ON CONFLICT(user_id, tool_id) DO UPDATE SET uses = tool_usage.uses + 1, last_used = excluded.last_used`,
      )
      .bind(userId, toolId, ts),
    db
      .prepare(
        `INSERT INTO daily_stats (day, tool_id, uses) VALUES (?1, ?2, 1)
         ON CONFLICT(day, tool_id) DO UPDATE SET uses = daily_stats.uses + 1`,
      )
      .bind(day, toolId),
    db.prepare("UPDATE counters SET value = value + 1 WHERE key = 'tool_runs'"),
  ]);
}

export async function bumpCounter(db: D1Database, key: 'requests' | 'tool_runs' | 'errors'): Promise<void> {
  try {
    await db.prepare('UPDATE counters SET value = value + 1 WHERE key = ?1').bind(key).run();
  } catch (error) {
    logError('db.bumpCounter', error, { key });
  }
}

export async function userTopTools(db: D1Database, userId: number, limit = 10): Promise<ToolUsageRow[]> {
  const res = await db
    .prepare('SELECT tool_id, uses, last_used FROM tool_usage WHERE user_id = ?1 ORDER BY uses DESC, last_used DESC LIMIT ?2')
    .bind(userId, limit)
    .all<ToolUsageRow>();
  return res.results ?? [];
}

export async function userDistinctTools(db: D1Database, userId: number): Promise<number> {
  const row = await db
    .prepare('SELECT COUNT(*) AS c FROM tool_usage WHERE user_id = ?1')
    .bind(userId)
    .first<{ c: number }>();
  return row?.c ?? 0;
}

/** One round-trip for the whole global stats page. */
export async function globalStats(db: D1Database): Promise<GlobalStats> {
  const day = utcDay();
  const batch = await db.batch<Record<string, unknown>>([
    db.prepare('SELECT key, value FROM counters'),
    db.prepare('SELECT COUNT(*) AS c FROM users'),
    db.prepare('SELECT COUNT(DISTINCT tool_id) AS c FROM tool_usage'),
    db.prepare('SELECT COALESCE(SUM(uses), 0) AS c FROM daily_stats WHERE day = ?1').bind(day),
    db.prepare('SELECT tool_id, SUM(uses) AS uses, 0 AS last_used FROM tool_usage GROUP BY tool_id ORDER BY uses DESC LIMIT 5'),
  ]);

  const rowsAt = (index: number): Record<string, unknown>[] => batch[index]?.results ?? [];
  const countAt = (index: number): number => {
    const value = rowsAt(index)[0]?.['c'];
    return typeof value === 'number' ? value : 0;
  };

  const counterMap = new Map<string, number>();
  for (const row of rowsAt(0)) {
    const key = row['key'];
    const value = row['value'];
    if (typeof key === 'string' && typeof value === 'number') counterMap.set(key, value);
  }

  const top: ToolUsageRow[] = rowsAt(4).map((row) => ({
    tool_id: String(row['tool_id'] ?? ''),
    uses: Number(row['uses'] ?? 0),
    last_used: Number(row['last_used'] ?? 0),
  }));

  return {
    requests: counterMap.get('requests') ?? 0,
    toolRuns: counterMap.get('tool_runs') ?? 0,
    users: countAt(1),
    distinctTools: countAt(2),
    today: countAt(3),
    top,
  };
}

export interface DailyPoint {
  day: string;
  uses: number;
}

export async function dailySeries(db: D1Database, days = 7): Promise<DailyPoint[]> {
  const res = await db
    .prepare('SELECT day, SUM(uses) AS uses FROM daily_stats GROUP BY day ORDER BY day DESC LIMIT ?1')
    .bind(days)
    .all<DailyPoint>();
  return (res.results ?? []).reverse();
}
