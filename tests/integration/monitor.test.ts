/**
 * Monitor page, broadcast delivery detail and the Cloudflare usage card.
 *
 * The most important assertions here are negative ones: the usage card must
 * never present a fabricated zero, and the delivery page must never call
 * anything a "read receipt", because the Bot API cannot report one.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import worker from '../../admin/src/index.js';
import {
  AdminD1,
  cookieFrom,
  execCtx,
  get,
  installFakeTelegram,
  makeAdminEnv,
  post,
} from '../helpers/admin-fakes.js';

/** Logs in and returns the session cookie, so page tests start authenticated. */
async function login(env: ReturnType<typeof makeAdminEnv>): Promise<string> {
  const tg = installFakeTelegram();
  try {
    const ctx = execCtx();
    const first = await worker.fetch(post('/login', { password: 'correct-horse-battery-staple' }), env, ctx);
    const body = await first.text();
    const challenge = /name="challenge" value="([^"]+)"/.exec(body)?.[1] ?? '';
    const code = String(tg.calls.find((call) => call.method === 'sendMessage')?.payload['text'] ?? '').match(
      /(\d{6})/,
    )?.[1];
    const second = await worker.fetch(
      post('/login/verify', { challenge, code: code ?? '' }),
      env,
      execCtx(),
    );
    return cookieFrom(second);
  } finally {
    tg.restore();
  }
}

function seedMonitor(db: AdminD1): void {
  db.when(/FROM activity a/, [
    {
      id: 9,
      user_id: 501,
      kind: 'tool',
      detail: 'jwt_decode',
      ok: 1,
      ms: 42,
      created_at: Math.floor(Date.now() / 1000) - 20,
      first_name: 'نیکی',
      username: 'niki',
    },
    {
      id: 8,
      user_id: 502,
      kind: 'command',
      detail: '/start',
      ok: 0,
      ms: 0,
      created_at: Math.floor(Date.now() / 1000) - 90,
      first_name: null,
      username: null,
    },
  ]);
  db.when(/COUNT\(\*\) AS c FROM activity/, [{ c: 3 }]);
  db.when(/COUNT\(DISTINCT user_id\) AS c FROM activity/, [{ c: 2 }]);
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('GET /monitor', () => {
  it('requires a session', async () => {
    const env = makeAdminEnv();
    const response = await worker.fetch(get('/monitor'), env, execCtx());
    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe('/login');
  });

  it('renders the activity feed with user names and outcomes', async () => {
    const db = new AdminD1();
    seedMonitor(db);
    const env = makeAdminEnv({ DB: db as unknown as D1Database });
    const cookie = await login(env);

    const response = await worker.fetch(get('/monitor', { cookie }), env, execCtx());
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(body).toContain('jwt_decode');
    expect(body).toContain('نیکی');
    expect(body).toContain('/users/501');
    expect(body).toContain('ناموفق'); // the failed row
  });

  it('auto-refreshes without inline script, so the strict CSP still holds', async () => {
    const db = new AdminD1();
    seedMonitor(db);
    const env = makeAdminEnv({ DB: db as unknown as D1Database });
    const cookie = await login(env);

    const response = await worker.fetch(get('/monitor', { cookie }), env, execCtx());
    const body = await response.text();

    expect(body).toContain('http-equiv="refresh"');
    // No <script> anywhere: the CSP forbids it and the page must not need it.
    expect(body).not.toMatch(/<script/i);
    expect(response.headers.get('content-security-policy')).toContain("default-src 'none'");
  });

  it('clamps an absurd refresh interval instead of trusting the query string', async () => {
    const db = new AdminD1();
    seedMonitor(db);
    const env = makeAdminEnv({ DB: db as unknown as D1Database });
    const cookie = await login(env);

    const fast = await worker.fetch(get('/monitor?refresh=1', { cookie }), env, execCtx());
    expect(await fast.text()).toContain('content="3"');

    const slow = await worker.fetch(get('/monitor?refresh=99999', { cookie }), env, execCtx());
    expect(await slow.text()).toContain('content="60"');

    // Junk and zero fall back to the default rather than disabling refresh.
    const junk = await worker.fetch(get('/monitor?refresh=abc', { cookie }), env, execCtx());
    expect(await junk.text()).toContain('content="5"');
  });

  it('ignores an unknown kind filter rather than passing it to SQL', async () => {
    const db = new AdminD1();
    seedMonitor(db);
    const env = makeAdminEnv({ DB: db as unknown as D1Database });
    const cookie = await login(env);

    await worker.fetch(get("/monitor?kind=' OR 1=1--", { cookie }), env, execCtx());

    const feed = db.find(/FROM activity a/);
    expect(feed?.sql).not.toContain('OR 1=1');
    // Only the LIMIT is bound when no valid filter is supplied.
    expect(feed?.params).toEqual([60]);
  });

  it('binds a valid kind filter as a parameter', async () => {
    const db = new AdminD1();
    seedMonitor(db);
    const env = makeAdminEnv({ DB: db as unknown as D1Database });
    const cookie = await login(env);

    await worker.fetch(get('/monitor?kind=tool', { cookie }), env, execCtx());

    const feed = db.find(/FROM activity a/);
    expect(feed?.params).toEqual(['tool', 60]);
  });

  it('prunes rows past the retention window in the background', async () => {
    const db = new AdminD1();
    seedMonitor(db);
    const env = makeAdminEnv({ DB: db as unknown as D1Database });
    const cookie = await login(env);

    const ctx = execCtx();
    await worker.fetch(get('/monitor', { cookie }), env, ctx);
    await Promise.all(ctx.pending);

    expect(db.find(/DELETE FROM activity WHERE created_at </)).toBeDefined();
  });

  it('states the privacy guarantee on the page', async () => {
    const db = new AdminD1();
    seedMonitor(db);
    const env = makeAdminEnv({ DB: db as unknown as D1Database });
    const cookie = await login(env);

    const body = await (await worker.fetch(get('/monitor', { cookie }), env, execCtx())).text();
    expect(body).toContain('متن پیام‌ها و ورودی ابزارها هرگز ذخیره نمی‌شود');
  });
});

describe('Cloudflare usage card', () => {
  it('explains what is missing instead of showing zeros when unconfigured', async () => {
    const db = new AdminD1();
    seedMonitor(db);
    // No CF_ANALYTICS_TOKEN is set.
    const env = makeAdminEnv({ DB: db as unknown as D1Database });
    const cookie = await login(env);

    const body = await (await worker.fetch(get('/monitor', { cookie }), env, execCtx())).text();
    expect(body).toContain('CF_ANALYTICS_TOKEN');
    expect(body).toContain('Account Analytics: Read');
    expect(body).not.toContain('سقف روزانه پلن رایگان'); // no bars drawn
  });

  it('renders real figures when the analytics API answers', async () => {
    const db = new AdminD1();
    seedMonitor(db);
    const env = makeAdminEnv({
      DB: db as unknown as D1Database,
      CF_ANALYTICS_TOKEN: 'cf-token-for-tests',
      CF_ACCOUNT_ID: 'acc123',
    });
    const cookie = await login(env);

    vi.stubGlobal('fetch', async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (url.includes('api.cloudflare.com')) {
        return new Response(
          JSON.stringify({
            data: {
              viewer: {
                accounts: [
                  {
                    workersInvocationsAdaptive: [
                      { sum: { requests: 1200, errors: 3, subrequests: 40 }, dimensions: { scriptName: 'devnet-toolbox' } },
                      { sum: { requests: 80, errors: 0, subrequests: 0 }, dimensions: { scriptName: 'devnet-admin' } },
                    ],
                    d1AnalyticsAdaptiveGroups: [{ sum: { readQueries: 5000, writeQueries: 250 } }],
                  },
                ],
              },
            },
          }),
          { headers: { 'content-type': 'application/json' } },
        );
      }
      return new Response(JSON.stringify({ ok: true, result: true }), {
        headers: { 'content-type': 'application/json' },
      });
    });

    const body = await (await worker.fetch(get('/monitor', { cookie }), env, execCtx())).text();
    expect(body).toContain('devnet-toolbox');
    expect(body).toContain('devnet-admin');
    expect(body).toContain('سقف روزانه پلن رایگان');
  });

  it('never renders the analytics token', async () => {
    const db = new AdminD1();
    seedMonitor(db);
    const secret = 'super-secret-cf-token-value';
    const env = makeAdminEnv({
      DB: db as unknown as D1Database,
      CF_ANALYTICS_TOKEN: secret,
      CF_ACCOUNT_ID: 'acc123',
    });
    const cookie = await login(env);

    vi.stubGlobal('fetch', async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (url.includes('api.cloudflare.com')) {
        return new Response(JSON.stringify({ errors: [{ message: 'nope' }] }), {
          headers: { 'content-type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({ ok: true, result: true }), {
        headers: { 'content-type': 'application/json' },
      });
    });

    const body = await (await worker.fetch(get('/monitor', { cookie }), env, execCtx())).text();
    expect(body).not.toContain(secret);
  });

  it('reports a permission problem in plain language on 403', async () => {
    const db = new AdminD1();
    seedMonitor(db);
    const env = makeAdminEnv({
      DB: db as unknown as D1Database,
      CF_ANALYTICS_TOKEN: 'weak-token',
      CF_ACCOUNT_ID: 'acc123',
    });
    const cookie = await login(env);

    vi.stubGlobal('fetch', async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (url.includes('api.cloudflare.com')) return new Response('forbidden', { status: 403 });
      return new Response(JSON.stringify({ ok: true, result: true }), {
        headers: { 'content-type': 'application/json' },
      });
    });

    const body = await (await worker.fetch(get('/monitor', { cookie }), env, execCtx())).text();
    expect(body).toContain('Account Analytics: Read');
  });
});

describe('GET /broadcast/:id', () => {
  const sentAt = Math.floor(Date.now() / 1000) - 600;

  function seedBroadcast(db: AdminD1): void {
    db.when(/FROM broadcasts WHERE id/, [
      {
        id: 'bc123',
        body: 'سلام به همه',
        audience: 'all',
        total: 3,
        sent: 2,
        failed: 1,
        status: 'done',
        created_at: sentAt,
        finished_at: sentAt + 20,
      },
    ]);
    db.when(/FROM broadcast_delivery d/, [
      { user_id: 501, status: 'sent', error: '', sent_at: sentAt, first_name: 'نیکی', username: 'niki' },
      {
        user_id: 502,
        status: 'failed',
        error: 'Forbidden: bot was blocked by the user',
        sent_at: sentAt,
        first_name: 'رضا',
        username: null,
      },
    ]);
    db.when(/COUNT\(DISTINCT a\.user_id\)/, [{ c: 1 }]);
  }

  it('lists each recipient with their delivery status', async () => {
    const db = new AdminD1();
    seedBroadcast(db);
    const env = makeAdminEnv({ DB: db as unknown as D1Database });
    const cookie = await login(env);

    const response = await worker.fetch(get('/broadcast/bc123', { cookie }), env, execCtx());
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(body).toContain('نیکی');
    expect(body).toContain('تحویل شد');
    expect(body).toContain('bot was blocked by the user');
  });

  it('is explicit that Telegram cannot report read receipts', async () => {
    const db = new AdminD1();
    seedBroadcast(db);
    const env = makeAdminEnv({ DB: db as unknown as D1Database });
    const cookie = await login(env);

    const body = await (await worker.fetch(get('/broadcast/bc123', { cookie }), env, execCtx())).text();
    expect(body).toContain('read receipt');
    expect(body).toContain('«سین» نیست');
  });

  it('filters by status through a bound parameter', async () => {
    const db = new AdminD1();
    seedBroadcast(db);
    const env = makeAdminEnv({ DB: db as unknown as D1Database });
    const cookie = await login(env);

    await worker.fetch(get('/broadcast/bc123?status=failed', { cookie }), env, execCtx());
    const query = db.find(/FROM broadcast_delivery d/);
    expect(query?.params).toEqual(['bc123', 'failed']);
  });

  it('ignores an invalid status filter', async () => {
    const db = new AdminD1();
    seedBroadcast(db);
    const env = makeAdminEnv({ DB: db as unknown as D1Database });
    const cookie = await login(env);

    await worker.fetch(get('/broadcast/bc123?status=everything', { cookie }), env, execCtx());
    const query = db.find(/FROM broadcast_delivery d/);
    expect(query?.params).toEqual(['bc123']);
  });

  it('returns 404 for a broadcast that does not exist', async () => {
    const db = new AdminD1(); // no canned broadcast row
    const env = makeAdminEnv({ DB: db as unknown as D1Database });
    const cookie = await login(env);

    const response = await worker.fetch(get('/broadcast/missing1', { cookie }), env, execCtx());
    expect(response.status).toBe(404);
  });
});

describe('broadcast delivery recording', () => {
  it('stores a row per recipient, including Telegram\'s failure reason', async () => {
    const db = new AdminD1();
    db.when(/SELECT u\.user_id FROM users u/, [{ user_id: 501 }, { user_id: 502 }]);
    const env = makeAdminEnv({ DB: db as unknown as D1Database });
    const cookie = await login(env);

    // Fail delivery for everyone, so the error path is the one under test.
    const tg = installFakeTelegram({ fail: (method) => method === 'sendMessage' });
    try {
      const ctx = execCtx();
      await worker.fetch(
        post('/broadcast', { body: 'خبر مهم', audience: 'all' }, { cookie }),
        env,
        ctx,
      );
      await Promise.all(ctx.pending);
    } finally {
      tg.restore();
    }

    const insert = db.find(/INSERT INTO broadcast_delivery/);
    expect(insert).toBeDefined();
    expect(insert?.params).toContain('failed');
    expect(String(insert?.params[3])).toContain('blocked by the user');
  });
});
