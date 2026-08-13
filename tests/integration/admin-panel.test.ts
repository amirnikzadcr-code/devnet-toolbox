/**
 * End-to-end tests against the panel Worker's real `fetch` handler.
 *
 * The full login dance is exercised once and then reused, so the protected
 * routes are tested exactly the way a browser reaches them.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import worker from '../../admin/src/index.js';
import type { AdminEnv } from '../../admin/src/types.js';
import {
  AdminD1,
  cookieFrom,
  execCtx,
  get,
  installFakeTelegram,
  makeAdminEnv,
  post,
  seedDashboard,
  type TgCall,
} from '../helpers/admin-fakes.js';

const PASSWORD = 'correct-horse-battery-staple';

let telegram: { calls: TgCall[]; restore: () => void };

beforeEach(() => {
  telegram = installFakeTelegram();
});

afterEach(() => {
  telegram.restore();
});

function envWithData(): AdminEnv {
  return makeAdminEnv({ DB: seedDashboard(new AdminD1()) as unknown as D1Database });
}

/** Runs the two-step login and returns the resulting Cookie header value. */
async function login(env: AdminEnv): Promise<string> {
  const first = await worker.fetch(post('/login', { password: PASSWORD }), env, execCtx());
  expect(first.status).toBe(200);

  const codeCall = telegram.calls.find((call) => call.method === 'sendMessage');
  const code = /(\d{6})/.exec(String(codeCall?.payload['text'] ?? ''))?.[1] ?? '';
  expect(code).toMatch(/^\d{6}$/);

  const body = await first.text();
  const challenge = /name="challenge" value="([^"]+)"/.exec(body)?.[1] ?? '';
  expect(challenge).not.toBe('');

  const second = await worker.fetch(post('/login/verify', { challenge, code }), env, execCtx());
  expect(second.status).toBe(303);
  return cookieFrom(second);
}

describe('health', () => {
  it('answers without authentication', async () => {
    const response = await worker.fetch(get('/health'), envWithData(), execCtx());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, service: 'devnet-admin' });
  });
});

describe('authentication gate', () => {
  it('redirects an anonymous GET to the login page', async () => {
    const response = await worker.fetch(get('/'), envWithData(), execCtx());
    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe('/login');
  });

  it('rejects an anonymous POST with 401 rather than a redirect', async () => {
    const response = await worker.fetch(post('/users/1/ban'), envWithData(), execCtx());
    expect(response.status).toBe(401);
  });

  it('serves the login form', async () => {
    const response = await worker.fetch(get('/login'), envWithData(), execCtx());
    expect(response.status).toBe(200);
    expect(await response.text()).toContain('رمز عبور');
  });

  it('rejects a wrong password and does not send a code', async () => {
    const response = await worker.fetch(post('/login', { password: 'wrong' }), envWithData(), execCtx());
    expect(response.status).toBe(401);
    expect(telegram.calls.filter((call) => call.method === 'sendMessage')).toHaveLength(0);
  });

  it('rejects an empty password', async () => {
    const response = await worker.fetch(post('/login', { password: '' }), envWithData(), execCtx());
    expect(response.status).toBe(401);
  });

  it('gives the same vague message for a wrong password as for a wrong code', async () => {
    const env = envWithData();
    const bad = await worker.fetch(post('/login', { password: 'wrong' }), env, execCtx());
    expect(await bad.text()).toContain('اطلاعات ورود نادرست است');
  });

  it('sends a six-digit code to the administrator after a correct password', async () => {
    const env = envWithData();
    const response = await worker.fetch(post('/login', { password: PASSWORD }), env, execCtx());
    expect(response.status).toBe(200);
    const call = telegram.calls.find((c) => c.method === 'sendMessage');
    expect(call?.payload['chat_id']).toBe(env.ADMIN_CHAT_ID);
    expect(String(call?.payload['text'])).toMatch(/\d{6}/);
  });

  it('does not grant a session at the password step', async () => {
    const response = await worker.fetch(post('/login', { password: PASSWORD }), envWithData(), execCtx());
    expect(response.headers.get('set-cookie')).toBeNull();
  });

  it('completes login and sets a session cookie', async () => {
    const env = envWithData();
    const cookie = await login(env);
    expect(cookie).toContain('dnt_admin=');
  });

  it('rejects a wrong code', async () => {
    const env = envWithData();
    const first = await worker.fetch(post('/login', { password: PASSWORD }), env, execCtx());
    const challenge = /name="challenge" value="([^"]+)"/.exec(await first.text())?.[1] ?? '';
    const response = await worker.fetch(
      post('/login/verify', { challenge, code: '000000' }),
      env,
      execCtx(),
    );
    expect(response.status).toBe(401);
    expect(response.headers.get('set-cookie')).toBeNull();
  });

  it('locks out after repeated password failures', async () => {
    const env = envWithData();
    for (let i = 0; i < 5; i += 1) {
      await worker.fetch(post('/login', { password: 'wrong' }), env, execCtx());
    }
    const response = await worker.fetch(post('/login', { password: PASSWORD }), env, execCtx());
    expect(response.status).toBe(429);
  });

  it('reports a Telegram outage instead of letting the user in', async () => {
    telegram.restore();
    telegram = installFakeTelegram({ fail: (method) => method === 'sendMessage' });
    const response = await worker.fetch(post('/login', { password: PASSWORD }), envWithData(), execCtx());
    expect(response.status).toBe(502);
    expect(response.headers.get('set-cookie')).toBeNull();
  });

  it('logs out and clears the cookie', async () => {
    const env = envWithData();
    const cookie = await login(env);
    const response = await worker.fetch(post('/logout', {}, { cookie }), env, execCtx());
    expect(response.headers.get('set-cookie')).toContain('Max-Age=0');

    const after = await worker.fetch(get('/', { cookie }), env, execCtx());
    expect(after.status).toBe(303);
  });

  it('sends an authenticated visitor away from the login page', async () => {
    const env = envWithData();
    const cookie = await login(env);
    const response = await worker.fetch(get('/login', { cookie }), env, execCtx());
    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe('/');
  });
});

describe('CSRF', () => {
  it('rejects a POST from another origin', async () => {
    const env = envWithData();
    const cookie = await login(env);
    const response = await worker.fetch(
      post('/users/5/ban', {}, { cookie, origin: 'https://evil.example' }),
      env,
      execCtx(),
    );
    expect(response.status).toBe(403);
  });
});

describe('pages', () => {
  let env: AdminEnv;
  let cookie: string;

  beforeEach(async () => {
    env = envWithData();
    cookie = await login(env);
  });

  it('renders the dashboard with statistics', async () => {
    const response = await worker.fetch(get('/', { cookie }), env, execCtx());
    expect(response.status).toBe(200);
    const body = await response.text();
    expect(body).toContain('داشبورد');
    expect(body).toContain('کاربران کل');
  });

  it('renders the user list', async () => {
    const response = await worker.fetch(get('/users', { cookie }), env, execCtx());
    expect(response.status).toBe(200);
    expect(await response.text()).toContain('جستجو');
  });

  it('renders the tools page', async () => {
    const response = await worker.fetch(get('/tools', { cookie }), env, execCtx());
    expect(response.status).toBe(200);
    expect(await response.text()).toContain('آمار ابزارها');
  });

  it('renders the broadcast page', async () => {
    const response = await worker.fetch(get('/broadcast', { cookie }), env, execCtx());
    expect(response.status).toBe(200);
    expect(await response.text()).toContain('پیام همگانی');
  });

  it('renders the bot settings page with current descriptions', async () => {
    const response = await worker.fetch(get('/bot', { cookie }), env, execCtx());
    expect(response.status).toBe(200);
    const body = await response.text();
    expect(body).toContain('توضیح فعلی');
    expect(body).toContain('Toolsbotxbot');
  });

  it('renders the audit page', async () => {
    const response = await worker.fetch(get('/audit', { cookie }), env, execCtx());
    expect(response.status).toBe(200);
    expect(await response.text()).toContain('رویدادهای مدیریتی');
  });

  it('returns 404 for an unknown path', async () => {
    const response = await worker.fetch(get('/nope', { cookie }), env, execCtx());
    expect(response.status).toBe(404);
  });

  it('returns 404 for a user who does not exist', async () => {
    const bare = makeAdminEnv({ STATE: env.STATE });
    const response = await worker.fetch(get('/users/424242', { cookie }), bare, execCtx());
    expect(response.status).toBe(404);
  });

  it('sets strict security headers on every page', async () => {
    const response = await worker.fetch(get('/', { cookie }), env, execCtx());
    expect(response.headers.get('x-frame-options')).toBe('DENY');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(response.headers.get('cache-control')).toContain('no-store');
    expect(response.headers.get('content-security-policy')).toContain("frame-ancestors 'none'");
  });

  it('never sends the panel token or password to the browser', async () => {
    for (const path of ['/', '/users', '/bot', '/broadcast', '/audit']) {
      const body = await (await worker.fetch(get(path, { cookie }), env, execCtx())).text();
      expect(body).not.toContain(env.BOT_TOKEN);
      expect(body).not.toContain(PASSWORD);
      expect(body).not.toContain(env.SESSION_SECRET);
    }
  });

  it('survives a database failure with a 500 page rather than a stack trace', async () => {
    const broken = new AdminD1();
    broken.failOn = /SELECT/i;
    const failing = makeAdminEnv({ STATE: env.STATE, DB: broken as unknown as D1Database });
    const response = await worker.fetch(get('/', { cookie }), failing, execCtx());
    expect(response.status).toBe(500);
    const body = await response.text();
    expect(body).not.toContain('D1_ERROR');
    expect(body).toContain('خطای داخلی');
  });
});

describe('user actions', () => {
  let env: AdminEnv;
  let cookie: string;

  beforeEach(async () => {
    env = envWithData();
    cookie = await login(env);
  });

  it('bans a user and mirrors it to KV', async () => {
    const response = await worker.fetch(
      post('/users/555/ban', { reason: 'spam' }, { cookie }),
      env,
      execCtx(),
    );
    expect(response.status).toBe(303);
    expect(await env.STATE.get('ban:555')).toBe('1');
  });

  it('records the ban in the audit trail', async () => {
    await worker.fetch(post('/users/555/ban', { reason: 'spam' }, { cookie }), env, execCtx());
    const fake = env.DB as unknown as AdminD1;
    expect(fake.sqlText()).toContain('INSERT INTO admin_audit');
  });

  it('unbans a user', async () => {
    await worker.fetch(post('/users/555/ban', {}, { cookie }), env, execCtx());
    await worker.fetch(post('/users/555/unban', {}, { cookie }), env, execCtx());
    expect(await env.STATE.get('ban:555')).toBeNull();
  });

  it('purges a user and returns to the list', async () => {
    const response = await worker.fetch(post('/users/555/purge', {}, { cookie }), env, execCtx());
    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toContain('/users?ok=');
  });

  it('sends a direct message', async () => {
    const before = telegram.calls.length;
    await worker.fetch(post('/users/555/message', { text: 'سلام' }, { cookie }), env, execCtx());
    const sent = telegram.calls.slice(before).filter((call) => call.method === 'sendMessage');
    expect(sent[0]?.payload['chat_id']).toBe(555);
    expect(sent[0]?.payload['text']).toBe('سلام');
  });

  it('refuses to send an empty message', async () => {
    const before = telegram.calls.length;
    const response = await worker.fetch(post('/users/555/message', { text: '   ' }, { cookie }), env, execCtx());
    expect(response.headers.get('location')).toContain('err=');
    expect(telegram.calls.slice(before).filter((c) => c.method === 'sendMessage')).toHaveLength(0);
  });

  it('reports a failed delivery without breaking the page', async () => {
    telegram.restore();
    telegram = installFakeTelegram({ fail: (method) => method === 'sendMessage' });
    const response = await worker.fetch(post('/users/555/message', { text: 'hi' }, { cookie }), env, execCtx());
    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toContain('err=');
  });

  it('rejects a non-numeric user id as 404', async () => {
    const response = await worker.fetch(post('/users/abc/ban', {}, { cookie }), env, execCtx());
    expect(response.status).toBe(404);
  });

  it('rejects an unknown action verb as 404', async () => {
    const response = await worker.fetch(post('/users/555/promote', {}, { cookie }), env, execCtx());
    expect(response.status).toBe(404);
  });
});

describe('broadcast', () => {
  let env: AdminEnv;
  let cookie: string;

  beforeEach(async () => {
    env = makeAdminEnv({
      DB: seedDashboard(new AdminD1()).when(/SELECT u\.user_id FROM users/i, [
        { user_id: 101 },
        { user_id: 102 },
        { user_id: 103 },
      ]) as unknown as D1Database,
    });
    cookie = await login(env);
  });

  it('queues a broadcast and returns immediately', async () => {
    const ctx = execCtx();
    const response = await worker.fetch(
      post('/broadcast', { body: 'اطلاعیه', audience: 'all' }, { cookie }),
      env,
      ctx,
    );
    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toContain('ok=');
    expect(ctx.pending.length).toBe(1);
  });

  it('delivers to every recipient in the background', async () => {
    const ctx = execCtx();
    const before = telegram.calls.length;
    await worker.fetch(post('/broadcast', { body: 'اطلاعیه', audience: 'all' }, { cookie }), env, ctx);
    await Promise.all(ctx.pending);
    const sent = telegram.calls.slice(before).filter((call) => call.method === 'sendMessage');
    expect(sent.map((call) => call.payload['chat_id'])).toEqual([101, 102, 103]);
  });

  it('marks the broadcast finished with counts', async () => {
    const ctx = execCtx();
    await worker.fetch(post('/broadcast', { body: 'x', audience: 'all' }, { cookie }), env, ctx);
    await Promise.all(ctx.pending);
    const fake = env.DB as unknown as AdminD1;
    const update = fake.find(/UPDATE broadcasts/);
    expect(update?.params).toEqual(expect.arrayContaining([3, 0, 'done']));
  });

  it('counts failures without aborting the run', async () => {
    telegram.restore();
    telegram = installFakeTelegram({ fail: (method) => method === 'sendMessage' });
    const ctx = execCtx();
    // Re-login is impossible while sendMessage fails, so reuse the cookie.
    await worker.fetch(post('/broadcast', { body: 'x', audience: 'all' }, { cookie }), env, ctx);
    await Promise.all(ctx.pending);
    const update = (env.DB as unknown as AdminD1).find(/UPDATE broadcasts/);
    expect(update?.params).toEqual(expect.arrayContaining([0, 3, 'done']));
  });

  it('refuses an empty message', async () => {
    const response = await worker.fetch(post('/broadcast', { body: '  ' }, { cookie }), env, execCtx());
    expect(response.headers.get('location')).toContain('err=');
  });

  it('refuses when the audience is empty', async () => {
    const empty = makeAdminEnv({ STATE: env.STATE, DB: seedDashboard(new AdminD1()) as unknown as D1Database });
    const response = await worker.fetch(post('/broadcast', { body: 'x' }, { cookie }), empty, execCtx());
    expect(response.headers.get('location')).toContain('err=');
  });
});

describe('bot settings', () => {
  let env: AdminEnv;
  let cookie: string;

  beforeEach(async () => {
    env = envWithData();
    cookie = await login(env);
  });

  it('updates the webhook', async () => {
    const before = telegram.calls.length;
    const response = await worker.fetch(
      post('/bot/webhook', { url: 'https://bot.example.workers.dev/webhook', secret: 'a-secret-value' }, { cookie }),
      env,
      execCtx(),
    );
    expect(response.headers.get('location')).toContain('ok=');
    const call = telegram.calls.slice(before).find((c) => c.method === 'setWebhook');
    expect(call?.payload['url']).toBe('https://bot.example.workers.dev/webhook');
  });

  it('rejects a non-HTTPS webhook URL', async () => {
    const before = telegram.calls.length;
    const response = await worker.fetch(
      post('/bot/webhook', { url: 'http://bot.example/webhook', secret: 'a-secret-value' }, { cookie }),
      env,
      execCtx(),
    );
    expect(response.headers.get('location')).toContain('err=');
    expect(telegram.calls.slice(before).some((c) => c.method === 'setWebhook')).toBe(false);
  });

  it('rejects a too-short secret', async () => {
    const response = await worker.fetch(
      post('/bot/webhook', { url: 'https://bot.example.workers.dev/webhook', secret: 'abc' }, { cookie }),
      env,
      execCtx(),
    );
    expect(response.headers.get('location')).toContain('err=');
  });

  it('never writes the webhook secret into the audit trail', async () => {
    await worker.fetch(
      post('/bot/webhook', { url: 'https://bot.example.workers.dev/webhook', secret: 'super-secret-value' }, { cookie }),
      env,
      execCtx(),
    );
    const inserts = (env.DB as unknown as AdminD1).log.filter((entry) => /admin_audit/.test(entry.sql));
    for (const entry of inserts) {
      expect(JSON.stringify(entry.params)).not.toContain('super-secret-value');
    }
  });

  it('syncs the command list', async () => {
    const before = telegram.calls.length;
    const response = await worker.fetch(post('/bot/commands', {}, { cookie }), env, execCtx());
    expect(response.headers.get('location')).toContain('ok=');
    const call = telegram.calls.slice(before).find((c) => c.method === 'setMyCommands');
    expect(Array.isArray(call?.payload['commands'])).toBe(true);
  });

  it('updates descriptions in both languages', async () => {
    const before = telegram.calls.length;
    const response = await worker.fetch(
      post(
        '/bot/profile',
        { fa: 'توضیح فارسی', faShort: 'کوتاه', en: 'English description', enShort: 'Short' },
        { cookie },
      ),
      env,
      execCtx(),
    );
    expect(response.headers.get('location')).toContain('ok=');
    const calls = telegram.calls.slice(before);
    expect(calls.filter((c) => c.method === 'setMyDescription')).toHaveLength(3);
    expect(calls.filter((c) => c.method === 'setMyShortDescription')).toHaveLength(3);
  });

  it('reports partial failure when Telegram rejects an update', async () => {
    telegram.restore();
    telegram = installFakeTelegram({ fail: (method) => method === 'setMyDescription' });
    const response = await worker.fetch(
      post('/bot/profile', { fa: 'x', faShort: 'y', en: 'z', enShort: 'w' }, { cookie }),
      env,
      execCtx(),
    );
    expect(response.headers.get('location')).toContain('err=');
  });
});
