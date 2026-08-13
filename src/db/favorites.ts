/**
 * Personal favourites (Phase 4, requirement 50).
 *
 * Deliberately separate from `tool_usage`: that table powers "most used tools"
 * and is derived from behaviour, whereas this one records an explicit choice.
 * Merging them would make it impossible to keep a rarely-used tool starred.
 *
 * Privacy: only `(user_id, tool_id, added_at)` is stored. Nothing about what
 * the user ran through the tool is persisted here.
 */
import { logError } from '../utils/errors.js';

/** Hard cap so one account cannot grow the table without bound. */
export const MAX_FAVORITES = 30;

const nowSec = (): number => Math.floor(Date.now() / 1000);

export interface FavoriteRow {
  tool_id: string;
  added_at: number;
}

export async function listFavorites(db: D1Database, userId: number): Promise<string[]> {
  try {
    const result = await db
      .prepare('SELECT tool_id FROM favorites WHERE user_id = ?1 ORDER BY added_at DESC LIMIT ?2')
      .bind(userId, MAX_FAVORITES)
      .all<FavoriteRow>();
    return (result.results ?? []).map((row) => row.tool_id);
  } catch (error) {
    logError('favorites.list', error);
    return [];
  }
}

/** Throws on a database error; used by `toggleFavorite`, which must not guess. */
async function isFavoriteStrict(db: D1Database, userId: number, toolId: string): Promise<boolean> {
  const row = await db
    .prepare('SELECT 1 AS hit FROM favorites WHERE user_id = ?1 AND tool_id = ?2')
    .bind(userId, toolId)
    .first<{ hit: number }>();
  return row !== null;
}

/**
 * Read-only check used for rendering the ⭐ button. A database hiccup degrades
 * to "not starred" rather than breaking the tool page.
 */
export async function isFavorite(db: D1Database, userId: number, toolId: string): Promise<boolean> {
  try {
    return await isFavoriteStrict(db, userId, toolId);
  } catch (error) {
    logError('favorites.is', error);
    return false;
  }
}

export async function countFavorites(db: D1Database, userId: number): Promise<number> {
  try {
    const row = await db
      .prepare('SELECT COUNT(*) AS n FROM favorites WHERE user_id = ?1')
      .bind(userId)
      .first<{ n: number }>();
    return row?.n ?? 0;
  } catch (error) {
    logError('favorites.count', error);
    return 0;
  }
}

export type ToggleResult =
  | { status: 'added'; count: number }
  | { status: 'removed'; count: number }
  | { status: 'full'; count: number }
  | { status: 'error'; count: number };

/**
 * Adds the tool if absent, removes it if present. Returns the resulting state
 * so the caller can re-render the ⭐ button without a second query.
 */
export async function toggleFavorite(db: D1Database, userId: number, toolId: string): Promise<ToggleResult> {
  try {
    // Strict on purpose: if the lookup fails we must report an error, not fall
    // through to an INSERT that silently reports "added" without changing anything.
    const existing = await isFavoriteStrict(db, userId, toolId);
    if (existing) {
      await db.prepare('DELETE FROM favorites WHERE user_id = ?1 AND tool_id = ?2').bind(userId, toolId).run();
      return { status: 'removed', count: await countFavorites(db, userId) };
    }
    const count = await countFavorites(db, userId);
    if (count >= MAX_FAVORITES) return { status: 'full', count };
    await db
      .prepare('INSERT OR IGNORE INTO favorites (user_id, tool_id, added_at) VALUES (?1, ?2, ?3)')
      .bind(userId, toolId, nowSec())
      .run();
    return { status: 'added', count: count + 1 };
  } catch (error) {
    logError('favorites.toggle', error);
    return { status: 'error', count: 0 };
  }
}

/** Removes favourites pointing at tool ids that no longer exist in the registry. */
export async function pruneFavorites(db: D1Database, userId: number, validIds: ReadonlySet<string>): Promise<string[]> {
  const stored = await listFavorites(db, userId);
  const stale = stored.filter((id) => !validIds.has(id));
  if (stale.length === 0) return stored;
  try {
    const placeholders = stale.map((_, index) => `?${index + 2}`).join(', ');
    await db
      .prepare(`DELETE FROM favorites WHERE user_id = ?1 AND tool_id IN (${placeholders})`)
      .bind(userId, ...stale)
      .run();
  } catch (error) {
    logError('favorites.prune', error);
  }
  return stored.filter((id) => validIds.has(id));
}
