/**
 * Fakes for the admin panel Worker.
 *
 * Kept separate from `fakes.ts` because the panel needs a D1 stub that can
 * answer `batch()` with per-statement rows (the dashboard issues one batch of
 * eleven different counts), which the bot's simpler fake does not model.
 */
import type { AdminEnv } from '../../admin/src/types.js';
import { FakeKV } from './fakes.js';

export interface SqlLog {
  sql: string;
  params: unknown[];
}

export class AdminD1 {
  public log: SqlLog[] = [];
  public failOn: RegExp | null = null;
  private rules: { pattern: RegExp; rows: Record<string, unknown>[] }[] = [];

  /** Statements matching `pattern` return `rows`. First match wins. */
  when(pattern: RegExp, rows: Record<string, unknown>[]): this {
    this.rules.push({ pattern, rows });
    return this;
  }

  rowsFor(sql: string): Record<string, unknown>[] {
    for (const rule of this.rules) if (rule.pattern.test(sql)) return rule.rows;
    return [];
  }

  record(sql: string, params: unknown[]): void {
    this.log.push({ sql, params });
    if (this.failOn?.test(sql) === true) throw new Error('D1_ERROR: simulated failure');
  }

  prepare(sql: string): AdminStatement {
    return new AdminStatement(this, sql);
  }

  async batch(statements: AdminStatement[]): Promise<{ results: Record<string, unknown>[]; success: boolean }[]> {
    return Promise.all(statements.map(async (statement) => ({ results: (await statement.all()).results, success: true })));
  }

  async exec(sql: string): Promise<{ count: number }> {
    this.log.push({ sql, params: [] });
    return { count: 0 };
  }

  /** Every statement the fake has seen, for assertions about parameterisation. */
  sqlText(): string {
    return this.log.map((entry) => entry.sql).join('\n');
  }

  find(pattern: RegExp): SqlLog | undefined {
    return this.log.find((entry) => pattern.test(entry.sql));
  }
}

class AdminStatement {
  private params: unknown[] = [];
  constructor(
    private readonly db: AdminD1,
    private readonly sql: string,
  ) {}

  bind(...params: unknown[]): this {
    this.params = params;
    return this;
  }

  async all<T = Record<string, unknown>>(): Promise<{ results: T[]; success: boolean }> {
    this.db.record(this.sql, this.params);
    return { results: this.db.rowsFor(this.sql) as T[], success: true };
  }

  async first<T = Record<string, unknown>>(): Promise<T | null> {
    this.db.record(this.sql, this.params);
    return (this.db.rowsFor(this.sql)[0] as T) ?? null;
  }

  async run(): Promise<{ success: boolean }> {
    this.db.record(this.sql, this.params);
    return { success: true };
  }
}

// ─── Telegram ────────────────────────────────────────────────────────────

export interface TgCall {
  method: string;
  payload: Record<string, unknown>;
}

/**
 * Replaces global fetch and records every Bot API call. Returns the recorded
 * list plus a restore function.
 */
export function installFakeTelegram(
  options: {
    fail?: (method: string) => boolean;
    result?: (method: string) => unknown;
  } = {},
): { calls: TgCall[]; restore: () => void } {
  const calls: TgCall[] = [];
  const original = globalThis.fetch;

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const method = url.split('/').pop() ?? '';
    const payload = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};
    calls.push({ method, payload });

    if (options.fail?.(method) === true) {
      return new Response(JSON.stringify({ ok: false, description: 'Forbidden: bot was blocked by the user' }), {
        status: 403,
        headers: { 'content-type': 'application/json' },
      });
    }
    const result = options.result?.(method) ?? defaultResult(method);
    return new Response(JSON.stringify({ ok: true, result }), {
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;

  return {
    calls,
    restore: () => {
      globalThis.fetch = original;
    },
  };
}

function defaultResult(method: string): unknown {
  switch (method) {
    case 'getMe':
      return { id: 8836788795, username: 'Toolsbotxbot', first_name: 'DevNet Toolbox' };
    case 'getWebhookInfo':
      return {
        url: 'https://devnet-toolbox.example.workers.dev/webhook',
        has_custom_certificate: false,
        pending_update_count: 0,
        max_connections: 40,
      };
    case 'getMyDescription':
      return { description: 'توضیح فعلی' };
    case 'getMyShortDescription':
      return { short_description: 'توضیح کوتاه' };
    case 'sendMessage':
      return { message_id: 1 };
    default:
      return true;
  }
}

// ─── Env & helpers ───────────────────────────────────────────────────────

export function makeAdminEnv(overrides: Partial<AdminEnv> = {}): AdminEnv {
  return {
    ADMIN_PASSWORD: 'correct-horse-battery-staple',
    SESSION_SECRET: 'unit-test-session-signing-key',
    BOT_TOKEN: '111:unit-test-token',
    ADMIN_CHAT_ID: '7951577342',
    BOT_WORKER_URL: 'https://devnet-toolbox.example.workers.dev',
    BOT_USERNAME: 'Toolsbotxbot',
    STATE: new FakeKV() as unknown as KVNamespace,
    DB: new AdminD1() as unknown as D1Database,
    ...overrides,
  };
}

export function execCtx(): { waitUntil(p: Promise<unknown>): void; pending: Promise<unknown>[] } {
  const pending: Promise<unknown>[] = [];
  return {
    pending,
    waitUntil(promise: Promise<unknown>) {
      pending.push(promise);
    },
  };
}

const ORIGIN = 'https://admin.example.workers.dev';

export function get(path: string, headers: Record<string, string> = {}): Request {
  return new Request(`${ORIGIN}${path}`, { headers });
}

export function post(
  path: string,
  fields: Record<string, string> = {},
  headers: Record<string, string> = {},
): Request {
  const body = new URLSearchParams(fields);
  return new Request(`${ORIGIN}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', origin: ORIGIN, ...headers },
    body,
  });
}

/**
 * A POST with no body and no Content-Type — what `fetch`/curl send for an
 * action that needs no fields. `request.formData()` rejects on these, so the
 * panel must tolerate them.
 */
export function barePost(path: string, headers: Record<string, string> = {}): Request {
  return new Request(`${ORIGIN}${path}`, {
    method: 'POST',
    headers: { origin: ORIGIN, ...headers },
  });
}

/** Extracts the session cookie value from a Set-Cookie header. */
export function cookieFrom(response: Response): string {
  const header = response.headers.get('set-cookie') ?? '';
  return header.split(';')[0] ?? '';
}

/** Populates a D1 fake with rows that satisfy every dashboard query. */
export function seedDashboard(db: AdminD1): AdminD1 {
  return db
    .when(/FROM counters/i, [
      { key: 'requests', value: 1500 },
      { key: 'tool_runs', value: 900 },
    ])
    .when(/COUNT\(DISTINCT tool_id\)/i, [{ c: 42 }])
    .when(/COUNT\(\*\) AS c FROM banned_users/i, [{ c: 2 }])
    .when(/COUNT\(\*\) AS c FROM favorites/i, [{ c: 5 }])
    .when(/FROM favorites/i, [{ tool_id: 'json_format' }])
    .when(/FROM security_scans/i, [{ c: 7 }])
    .when(/FROM daily_stats/i, [{ day: new Date().toISOString().slice(0, 10), uses: 12 }])
    .when(/FROM tool_usage/i, [{ tool_id: 'json_format', uses: 120, users: 30, last_used: 1_700_000_000 }])
    // Must stay narrower than the broadcast-audience query, which also reads
    // FROM users but expects rows of user ids rather than a count.
    .when(/COUNT\(\*\) AS c FROM users/i, [{ c: 250 }])
    .when(/FROM admin_audit/i, [
      { id: 1, action: 'login.success', target: 'admin', detail: '', ip: '1.1.1.1', created_at: 1_700_000_000 },
    ])
    .when(/FROM broadcasts/i, []);
}
