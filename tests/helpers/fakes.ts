/**
 * In-memory fakes for Cloudflare bindings so integration tests can exercise the
 * real router / index handlers without a network or a live Cloudflare account.
 */
import type { Env } from '../../src/types/env.js';
import type { TgUpdate } from '../../src/types/telegram.js';

// ─── KV ──────────────────────────────────────────────────────
interface KvEntry {
  value: string;
  expiresAt?: number;
}

export class FakeKV {
  private store = new Map<string, KvEntry>();
  public puts = 0;
  public gets = 0;

  // Mirrors the real KV contract: get(key) → string, get(key, 'json') → parsed.
  async get(key: string, type?: unknown): Promise<unknown> {
    this.gets += 1;
    const entry = this.store.get(key);
    if (!entry) return null;
    if (entry.expiresAt !== undefined && Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return null;
    }
    const mode = typeof type === 'string' ? type : (type as { type?: string } | undefined)?.type;
    if (mode === 'json') {
      try {
        return JSON.parse(entry.value) as unknown;
      } catch {
        return null;
      }
    }
    return entry.value;
  }

  async put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void> {
    this.puts += 1;
    const entry: KvEntry = { value };
    if (options?.expirationTtl !== undefined) entry.expiresAt = Date.now() + options.expirationTtl * 1000;
    this.store.set(key, entry);
  }

  async delete(key: string): Promise<void> {
    this.store.delete(key);
  }

  async list(): Promise<{ keys: { name: string }[]; list_complete: boolean }> {
    return { keys: [...this.store.keys()].map((name) => ({ name })), list_complete: true };
  }

  /** Test helper: force an entry to look expired. */
  expire(key: string): void {
    const entry = this.store.get(key);
    if (entry) entry.expiresAt = Date.now() - 1;
  }

  size(): number {
    return this.store.size;
  }

  keys(): string[] {
    return [...this.store.keys()];
  }
}

// ─── D1 ──────────────────────────────────────────────────────
export interface D1Log {
  sql: string;
  params: unknown[];
}

/**
 * A deliberately dumb D1 fake: it records every statement and returns
 * caller-configured rows. Enough to assert the bot never crashes, never leaks
 * inputs into SQL, and always parameterises its queries.
 */
export class FakeD1 {
  public log: D1Log[] = [];
  public failNext = false;
  private responses = new Map<RegExp, unknown>();

  /** Register a canned first()/all() result for statements matching `pattern`. */
  when(pattern: RegExp, result: unknown): this {
    this.responses.set(pattern, result);
    return this;
  }

  private resolve(sql: string): unknown {
    for (const [pattern, result] of this.responses) if (pattern.test(sql)) return result;
    return undefined;
  }

  prepare(sql: string): FakeStatement {
    return new FakeStatement(this, sql);
  }

  async batch(statements: FakeStatement[]): Promise<{ results: unknown[]; success: boolean }[]> {
    if (this.failNext) {
      this.failNext = false;
      throw new Error('D1_ERROR: simulated failure');
    }
    return Promise.all(statements.map(async (s) => ({ results: (await s.all()).results, success: true })));
  }

  async exec(sql: string): Promise<{ count: number }> {
    this.log.push({ sql, params: [] });
    return { count: 0 };
  }

  record(sql: string, params: unknown[]): unknown {
    this.log.push({ sql, params });
    if (this.failNext) {
      this.failNext = false;
      throw new Error('D1_ERROR: simulated failure');
    }
    return this.resolve(sql);
  }

  /** Every logged statement, flattened, for leak assertions. */
  allSql(): string {
    return this.log.map((l) => l.sql).join('\n');
  }
}

export class FakeStatement {
  private params: unknown[] = [];
  constructor(
    private db: FakeD1,
    private sql: string,
  ) {}

  bind(...params: unknown[]): this {
    this.params = params;
    return this;
  }

  async first<T = unknown>(): Promise<T | null> {
    const result = this.db.record(this.sql, this.params);
    if (result === undefined) return null;
    if (Array.isArray(result)) return (result[0] as T) ?? null;
    return result as T;
  }

  async all<T = unknown>(): Promise<{ results: T[]; success: boolean }> {
    const result = this.db.record(this.sql, this.params);
    const rows = Array.isArray(result) ? result : result === undefined ? [] : [result];
    return { results: rows as T[], success: true };
  }

  async run(): Promise<{ success: boolean }> {
    this.db.record(this.sql, this.params);
    return { success: true };
  }
}

// ─── Telegram API capture ────────────────────────────────────
export interface TgCall {
  method: string;
  body: Record<string, unknown>;
}

export interface FakeFetchOptions {
  /** Force sendMessage/editMessageText to fail, to test fallbacks. */
  failMethods?: string[];
  /** Extra handler for non-Telegram (tool) requests. */
  onOther?: (url: string, init?: RequestInit) => Response | Promise<Response>;
}

export function installFakeTelegram(options: FakeFetchOptions = {}): {
  calls: TgCall[];
  restore: () => void;
  sentTexts: () => string[];
  methods: () => string[];
  rawUrls: () => string[];
} {
  const calls: TgCall[] = [];
  const rawUrls: string[] = [];
  const original = globalThis.fetch;

  globalThis.fetch = (async (input: unknown, init?: RequestInit): Promise<Response> => {
    const url = typeof input === 'string' ? input : String((input as { url?: string }).url ?? input);
    rawUrls.push(url);

    if (url.includes('api.telegram.org')) {
      const method = url.split('/').pop() ?? '';
      let body: Record<string, unknown> = {};
      if (typeof init?.body === 'string') {
        try {
          body = JSON.parse(init.body) as Record<string, unknown>;
        } catch {
          body = { _raw: init.body };
        }
      }
      calls.push({ method, body });

      if (options.failMethods?.includes(method)) {
        return new Response(JSON.stringify({ ok: false, error_code: 400, description: 'Bad Request: simulated' }), {
          status: 400,
          headers: { 'content-type': 'application/json' },
        });
      }
      const result =
        method === 'getMe'
          ? { id: 1, is_bot: true, username: 'devnet_toolbox_bot', first_name: 'DevNet' }
          : { message_id: 1000 + calls.length, chat: { id: (body['chat_id'] as number) ?? 1 }, date: 0 };
      return new Response(JSON.stringify({ ok: true, result }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }

    if (options.onOther) return options.onOther(url, init);
    return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;

  return {
    calls,
    restore: () => {
      globalThis.fetch = original;
    },
    sentTexts: () => calls.filter((c) => c.method === 'sendMessage' || c.method === 'editMessageText').map((c) => String(c.body['text'] ?? '')),
    methods: () => calls.map((c) => c.method),
    rawUrls: () => rawUrls,
  };
}

// ─── Env + update factories ──────────────────────────────────
// Obviously-fake fixtures. These are NOT credentials: the Telegram API is stubbed in
// every test, and the CI secret scan pattern (10 digits + 35 chars) deliberately
// does not match these values.
export const TEST_BOT_TOKEN = '123456789:TEST-TOKEN-DO-NOT-USE-abcdefghijklmnop';
export const TEST_WEBHOOK_SECRET = 'test-webhook-secret-value';
export const TEST_ADMIN_SECRET = 'test-admin-secret-value';

export function makeEnv(overrides: Partial<Env> = {}): Env & { STATE: FakeKV; DB: FakeD1 } {
  const kv = new FakeKV();
  const db = new FakeD1();
  return {
    BOT_TOKEN: TEST_BOT_TOKEN,
    WEBHOOK_SECRET: TEST_WEBHOOK_SECRET,
    ADMIN_SECRET: TEST_ADMIN_SECRET,
    BOT_USERNAME: 'devnet_toolbox_bot',
    ENVIRONMENT: 'test',
    STATE: kv as unknown as KVNamespace,
    DB: db as unknown as D1Database,
    ...overrides,
  } as Env & { STATE: FakeKV; DB: FakeD1 };
}

export function execCtx(): { waitUntil: (p: Promise<unknown>) => void; passThroughOnException: () => void; pending: Promise<unknown>[] } {
  const pending: Promise<unknown>[] = [];
  return {
    waitUntil: (p: Promise<unknown>) => {
      pending.push(Promise.resolve(p).catch(() => undefined));
    },
    passThroughOnException: () => undefined,
    pending,
  };
}

let updateId = 1;
export function nextUpdateId(): number {
  updateId += 1;
  return updateId;
}

export function messageUpdate(text: string, opts: { userId?: number; chatId?: number; chatType?: string; lang?: string } = {}): TgUpdate {
  const userId = opts.userId ?? 555;
  return {
    update_id: nextUpdateId(),
    message: {
      message_id: 10,
      date: Math.floor(Date.now() / 1000),
      text,
      chat: { id: opts.chatId ?? userId, type: opts.chatType ?? 'private' },
      from: {
        id: userId,
        is_bot: false,
        first_name: 'Test',
        username: 'tester',
        language_code: opts.lang ?? 'fa',
      },
    },
  } as unknown as TgUpdate;
}

export function callbackUpdate(data: string, opts: { userId?: number; messageId?: number } = {}): TgUpdate {
  const userId = opts.userId ?? 555;
  return {
    update_id: nextUpdateId(),
    callback_query: {
      id: `cb-${nextUpdateId()}`,
      data,
      from: { id: userId, is_bot: false, first_name: 'Test', username: 'tester', language_code: 'fa' },
      message: {
        message_id: opts.messageId ?? 20,
        date: Math.floor(Date.now() / 1000),
        chat: { id: userId, type: 'private' },
      },
    },
  } as unknown as TgUpdate;
}
