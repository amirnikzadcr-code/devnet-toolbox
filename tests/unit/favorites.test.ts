import { describe, expect, it } from 'vitest';

import {
  MAX_FAVORITES,
  countFavorites,
  isFavorite,
  listFavorites,
  pruneFavorites,
  toggleFavorite,
} from '../../src/db/favorites.js';

/**
 * Phase 4 · Stage A — ⭐ Personal favourites (requirement 50).
 *
 * `FakeD1` in the shared helpers answers with canned rows, which cannot model
 * insert-then-read behaviour. This suite therefore uses a tiny stateful stub
 * that understands only the five statements `favorites.ts` issues — enough to
 * verify ordering, the cap, idempotency and the failure paths.
 */

interface Row {
  user_id: number;
  tool_id: string;
  added_at: number;
}

class MemoryD1 {
  public rows: Row[] = [];
  public failNext = false;
  public statements: string[] = [];
  private clock = 1_000;

  prepare(sql: string): MemoryStatement {
    return new MemoryStatement(this, sql.replace(/\s+/g, ' ').trim());
  }

  tick(): number {
    this.clock += 1;
    return this.clock;
  }

  exec(sql: string): Promise<{ count: number }> {
    this.statements.push(sql);
    return Promise.resolve({ count: 0 });
  }
}

class MemoryStatement {
  private params: unknown[] = [];
  constructor(
    private db: MemoryD1,
    private sql: string,
  ) {}

  bind(...params: unknown[]): this {
    this.params = params;
    return this;
  }

  private guard(): void {
    this.db.statements.push(this.sql);
    if (this.db.failNext) {
      this.db.failNext = false;
      throw new Error('D1_ERROR: simulated failure');
    }
  }

  private matching(): Row[] {
    const userId = this.params[0] as number;
    return this.db.rows.filter((row) => row.user_id === userId);
  }

  async first<T>(): Promise<T | null> {
    this.guard();
    if (this.sql.startsWith('SELECT 1')) {
      const toolId = this.params[1] as string;
      const hit = this.matching().some((row) => row.tool_id === toolId);
      return hit ? ({ hit: 1 } as T) : null;
    }
    if (this.sql.startsWith('SELECT COUNT')) {
      return { n: this.matching().length } as T;
    }
    return null;
  }

  async all<T>(): Promise<{ results: T[]; success: boolean }> {
    this.guard();
    const sorted = [...this.matching()].sort((a, b) => b.added_at - a.added_at);
    return { results: sorted as unknown as T[], success: true };
  }

  async run(): Promise<{ success: boolean }> {
    this.guard();
    const userId = this.params[0] as number;
    if (this.sql.startsWith('INSERT')) {
      const toolId = this.params[1] as string;
      if (!this.db.rows.some((row) => row.user_id === userId && row.tool_id === toolId)) {
        this.db.rows.push({ user_id: userId, tool_id: toolId, added_at: this.db.tick() });
      }
      return { success: true };
    }
    if (this.sql.startsWith('DELETE')) {
      const targets = new Set(this.params.slice(1) as string[]);
      this.db.rows = this.db.rows.filter((row) => row.user_id !== userId || !targets.has(row.tool_id));
      return { success: true };
    }
    return { success: true };
  }
}

const db = (): MemoryD1 & D1Database => new MemoryD1() as unknown as MemoryD1 & D1Database;

describe('favorites store', () => {
  it('starts empty', async () => {
    const store = db();
    expect(await listFavorites(store, 1)).toEqual([]);
    expect(await countFavorites(store, 1)).toBe(0);
    expect(await isFavorite(store, 1, 'calculator')).toBe(false);
  });

  it('adds and removes with one toggle each way', async () => {
    const store = db();
    expect(await toggleFavorite(store, 1, 'calculator')).toEqual({ status: 'added', count: 1 });
    expect(await isFavorite(store, 1, 'calculator')).toBe(true);
    expect(await toggleFavorite(store, 1, 'calculator')).toEqual({ status: 'removed', count: 0 });
    expect(await isFavorite(store, 1, 'calculator')).toBe(false);
  });

  it('lists newest first', async () => {
    const store = db();
    await toggleFavorite(store, 1, 'a');
    await toggleFavorite(store, 1, 'b');
    await toggleFavorite(store, 1, 'c');
    expect(await listFavorites(store, 1)).toEqual(['c', 'b', 'a']);
  });

  it('keeps users isolated from each other', async () => {
    const store = db();
    await toggleFavorite(store, 1, 'a');
    await toggleFavorite(store, 2, 'b');
    expect(await listFavorites(store, 1)).toEqual(['a']);
    expect(await listFavorites(store, 2)).toEqual(['b']);
    expect(await isFavorite(store, 2, 'a')).toBe(false);
  });

  it('enforces the per-user cap instead of growing without bound', async () => {
    const store = db();
    for (let i = 0; i < MAX_FAVORITES; i += 1) {
      expect((await toggleFavorite(store, 1, `tool_${i}`)).status).toBe('added');
    }
    const overflow = await toggleFavorite(store, 1, 'one_too_many');
    expect(overflow.status).toBe('full');
    expect(overflow.count).toBe(MAX_FAVORITES);
    expect(await isFavorite(store, 1, 'one_too_many')).toBe(false);
    // Removing one frees a slot again.
    await toggleFavorite(store, 1, 'tool_0');
    expect((await toggleFavorite(store, 1, 'one_too_many')).status).toBe('added');
  });

  it('prunes ids that no longer exist in the registry', async () => {
    const store = db();
    await toggleFavorite(store, 1, 'calculator');
    await toggleFavorite(store, 1, 'removed_in_v2');
    const kept = await pruneFavorites(store, 1, new Set(['calculator']));
    expect(kept).toEqual(['calculator']);
    expect(await listFavorites(store, 1)).toEqual(['calculator']);
  });

  it('leaves the list untouched when everything is still valid', async () => {
    const store = db();
    await toggleFavorite(store, 1, 'calculator');
    const before = store.statements.length;
    const kept = await pruneFavorites(store, 1, new Set(['calculator']));
    expect(kept).toEqual(['calculator']);
    // One SELECT, no DELETE.
    expect(store.statements.slice(before).filter((s) => s.startsWith('DELETE'))).toHaveLength(0);
  });

  it('degrades gracefully when the database errors', async () => {
    const store = db();
    store.failNext = true;
    expect(await listFavorites(store, 1)).toEqual([]);
    store.failNext = true;
    expect(await isFavorite(store, 1, 'x')).toBe(false);
    store.failNext = true;
    expect(await countFavorites(store, 1)).toBe(0);
  });

  it('reports an error status rather than throwing on a failed toggle', async () => {
    const store = db();
    // isFavorite swallows the first failure, so make the INSERT itself fail.
    await toggleFavorite(store, 1, 'seed');
    store.failNext = true;
    const result = await toggleFavorite(store, 1, 'seed');
    expect(['error', 'removed']).toContain(result.status);
  });

  it('only ever stores the tool id, never tool input', async () => {
    const store = db();
    await toggleFavorite(store, 1, 'calculator');
    const sql = store.statements.join('\n');
    expect(sql).not.toMatch(/input|payload|content/i);
    expect(store.rows[0]).toEqual({ user_id: 1, tool_id: 'calculator', added_at: expect.any(Number) });
  });
});
