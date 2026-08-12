import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import worker from '../../src/index.js';
import { TOTAL_TOOLS } from '../../src/tools/registry.js';
import {
  execCtx,
  installFakeTelegram,
  makeEnv,
  messageUpdate,
  TEST_ADMIN_SECRET,
  TEST_BOT_TOKEN,
  TEST_WEBHOOK_SECRET,
} from '../helpers/fakes.js';

let tg: ReturnType<typeof installFakeTelegram>;
let env: ReturnType<typeof makeEnv>;

beforeEach(() => {
  tg = installFakeTelegram();
  env = makeEnv();
});

afterEach(() => {
  tg.restore();
});

async function call(request: Request): Promise<{ res: Response; drained: Promise<unknown>[] }> {
  const ctx = execCtx();
  const res = await worker.fetch(request, env, ctx as never);
  await Promise.all(ctx.pending);
  return { res, drained: ctx.pending };
}

function webhookRequest(body: unknown, secret: string | null = TEST_WEBHOOK_SECRET, method = 'POST'): Request {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (secret !== null) headers['x-telegram-bot-api-secret-token'] = secret;
  return new Request('https://worker.example/webhook', {
    method,
    headers,
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

describe('GET / and /health', () => {
  it('returns a healthy JSON payload', async () => {
    const { res } = await call(new Request('https://worker.example/health'));
    expect(res.status).toBe(200);
    const json = (await res.json()) as Record<string, unknown>;
    expect(json['ok']).toBe(true);
    expect(json['tools']).toBe(TOTAL_TOOLS);
    expect(json['name']).toBeTruthy();
    expect(json['version']).toBeTruthy();
  });

  it('serves the root path too', async () => {
    const { res } = await call(new Request('https://worker.example/'));
    expect(res.status).toBe(200);
  });

  it('never exposes secrets in the health payload', async () => {
    const { res } = await call(new Request('https://worker.example/health'));
    const body = await res.text();
    expect(body).not.toContain(TEST_BOT_TOKEN);
    expect(body).not.toContain(TEST_WEBHOOK_SECRET);
    expect(body).not.toContain(TEST_ADMIN_SECRET);
    expect(body).not.toMatch(/\d{8,10}:[A-Za-z0-9_-]{30,}/);
  });

  it('returns 404 for unknown paths', async () => {
    const { res } = await call(new Request('https://worker.example/nope'));
    expect(res.status).toBe(404);
  });
});

describe('POST /webhook authentication', () => {
  it('accepts a request carrying the correct secret token', async () => {
    const { res } = await call(webhookRequest(messageUpdate('/start')));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it('rejects a missing secret header with 401', async () => {
    const { res } = await call(webhookRequest(messageUpdate('/start'), null));
    expect(res.status).toBe(401);
    expect(tg.calls).toHaveLength(0);
  });

  it('rejects a wrong secret with 401', async () => {
    const { res } = await call(webhookRequest(messageUpdate('/start'), 'wrong-secret'));
    expect(res.status).toBe(401);
    expect(tg.calls).toHaveLength(0);
  });

  it('rejects a secret that is a prefix of the real one', async () => {
    const { res } = await call(webhookRequest(messageUpdate('/start'), TEST_WEBHOOK_SECRET.slice(0, -1)));
    expect(res.status).toBe(401);
  });

  it('rejects an empty secret', async () => {
    const { res } = await call(webhookRequest(messageUpdate('/start'), ''));
    expect(res.status).toBe(401);
  });

  it('never reveals the expected secret in the 401 body', async () => {
    const { res } = await call(webhookRequest(messageUpdate('/start'), 'wrong'));
    const body = await res.text();
    expect(body).not.toContain(TEST_WEBHOOK_SECRET);
    expect(body).not.toContain(TEST_BOT_TOKEN);
  });

  it('rejects GET on the webhook route', async () => {
    const { res } = await call(new Request('https://worker.example/webhook', { method: 'GET' }));
    expect([404, 405]).toContain(res.status);
  });
});

describe('POST /webhook payload validation', () => {
  it('rejects malformed JSON with 400 and does not crash', async () => {
    const { res } = await call(webhookRequest('{not json'));
    expect(res.status).toBe(400);
    expect(tg.calls).toHaveLength(0);
  });

  it('rejects an empty body', async () => {
    const { res } = await call(webhookRequest(''));
    expect(res.status).toBe(400);
  });

  it('rejects a payload without update_id', async () => {
    const { res } = await call(webhookRequest({ message: { text: 'hi' } }));
    expect(res.status).toBe(400);
  });

  it('rejects a JSON array payload', async () => {
    const { res } = await call(webhookRequest([1, 2, 3]));
    expect(res.status).toBe(400);
  });

  it('rejects an oversized body with 413', async () => {
    const huge = JSON.stringify({ update_id: 1, message: { text: 'x'.repeat(300_000) } });
    const { res } = await call(webhookRequest(huge));
    expect(res.status).toBe(413);
    expect(tg.calls).toHaveLength(0);
  });

  it('always answers 200 quickly for a valid update, even if handling fails later', async () => {
    env.DB.failNext = true;
    const { res } = await call(webhookRequest(messageUpdate('/start')));
    expect(res.status).toBe(200);
  });

  it('processes the update and replies through the Telegram API', async () => {
    await call(webhookRequest(messageUpdate('/start')));
    expect(tg.methods()).toContain('sendMessage');
  });

  it('survives deeply nested junk payloads', async () => {
    let nested: Record<string, unknown> = { update_id: 4242 };
    for (let i = 0; i < 50; i += 1) nested = { update_id: 4242, message: nested };
    const { res } = await call(webhookRequest(nested));
    expect(res.status).toBe(200);
  });
});

describe('admin endpoints', () => {
  const adminRequest = (path: string, secret: string | null = TEST_ADMIN_SECRET, method = 'GET'): Request => {
    const headers: Record<string, string> = {};
    if (secret !== null) headers['x-admin-secret'] = secret;
    return new Request(`https://worker.example${path}`, { method, headers });
  };

  it('rejects self-test without the admin secret', async () => {
    const { res } = await call(adminRequest('/admin/self-test', null));
    expect(res.status).toBe(401);
  });

  it('rejects a wrong admin secret', async () => {
    const { res } = await call(adminRequest('/admin/self-test', 'nope'));
    expect(res.status).toBe(401);
  });

  it('runs the self-test with the right secret', async () => {
    const { res } = await call(adminRequest('/admin/self-test'));
    expect(res.status).toBe(200);
    const json = (await res.json()) as Record<string, unknown>;
    expect(json['ok']).toBeDefined();
  });

  it('protects set-webhook', async () => {
    const { res } = await call(adminRequest('/admin/set-webhook', null, 'POST'));
    expect(res.status).toBe(401);
  });

  it('protects webhook-info', async () => {
    const { res } = await call(adminRequest('/admin/webhook-info', null));
    expect(res.status).toBe(401);
  });

  it('never echoes secrets in any admin response', async () => {
    for (const path of ['/admin/self-test', '/admin/webhook-info']) {
      const { res } = await call(adminRequest(path));
      const body = await res.text();
      expect(body, path).not.toContain(TEST_BOT_TOKEN);
      expect(body, path).not.toContain(TEST_ADMIN_SECRET);
      expect(body, path).not.toContain(TEST_WEBHOOK_SECRET);
    }
  });

  it('denies admin access entirely when ADMIN_SECRET is not configured', async () => {
    env = makeEnv({ ADMIN_SECRET: undefined });
    const { res } = await call(adminRequest('/admin/self-test', 'anything'));
    expect(res.status).toBe(401);
  });
});
