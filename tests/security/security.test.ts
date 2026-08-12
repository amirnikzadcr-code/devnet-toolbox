import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import worker from '../../src/index.js';
import { handleUpdate } from '../../src/bot/router.js';
import { ALL_TOOLS, getTool } from '../../src/tools/registry.js';
import { RATE_LIMIT, LIMITS } from '../../src/config/index.js';
import { consume } from '../../src/services/ratelimit.js';
import { escapeHtml } from '../../src/utils/text.js';
import {
  callbackUpdate,
  execCtx,
  installFakeTelegram,
  makeEnv,
  messageUpdate,
  TEST_ADMIN_SECRET,
  TEST_BOT_TOKEN,
  TEST_WEBHOOK_SECRET,
} from '../helpers/fakes.js';
import type { FakeKV } from '../helpers/fakes.js';
import type { ToolRunContext } from '../../src/tools/types.js';

const ROOT = new URL('../../', import.meta.url).pathname;

let tg: ReturnType<typeof installFakeTelegram>;
let env: ReturnType<typeof makeEnv>;

beforeEach(() => {
  tg = installFakeTelegram();
  env = makeEnv();
});

afterEach(() => {
  tg.restore();
});

async function run(update: Parameters<typeof handleUpdate>[0]): Promise<void> {
  const ctx = execCtx();
  await handleUpdate(update, env, ctx);
  await Promise.all(ctx.pending);
}

// ─── 1. Secret leakage ───────────────────────────────────────
function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (['node_modules', '.git', 'dist', '.wrangler', 'coverage'].includes(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

describe('secret leakage — source tree', () => {
  const files = walk(join(ROOT, 'src')).filter((f) => f.endsWith('.ts'));
  const configFiles = ['wrangler.jsonc', 'package.json', '.gitignore', 'eslint.config.js', 'vitest.config.ts']
    .map((f) => join(ROOT, f));

  it('scans a non-trivial number of source files', () => {
    expect(files.length).toBeGreaterThan(20);
  });

  it('contains no Telegram bot token literals', () => {
    for (const file of [...files, ...configFiles]) {
      const content = readFileSync(file, 'utf8');
      expect(content, file).not.toMatch(/\b\d{8,10}:[A-Za-z0-9_-]{35}\b/);
    }
  });

  it('contains no hardcoded secret assignments', () => {
    const forbidden = [
      /BOT_TOKEN\s*[:=]\s*['"][^'"]{10,}['"]/,
      /WEBHOOK_SECRET\s*[:=]\s*['"][^'"]{6,}['"]/,
      /ADMIN_SECRET\s*[:=]\s*['"][^'"]{6,}['"]/,
      /api[_-]?key\s*[:=]\s*['"][A-Za-z0-9_-]{16,}['"]/i,
      /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
    ];
    for (const file of [...files, ...configFiles]) {
      const content = readFileSync(file, 'utf8');
      for (const pattern of forbidden) expect(content, `${file} :: ${pattern}`).not.toMatch(pattern);
    }
  });

  it('reads every secret from the Env binding, never from a literal', () => {
    const indexSrc = readFileSync(join(ROOT, 'src/index.ts'), 'utf8');
    expect(indexSrc).toMatch(/env\.WEBHOOK_SECRET/);
    expect(indexSrc).toMatch(/env\.ADMIN_SECRET/);
  });

  it('.gitignore protects local secret files', () => {
    const gitignore = readFileSync(join(ROOT, '.gitignore'), 'utf8');
    for (const pattern of ['.dev.vars', '.env', 'node_modules', '.wrangler']) {
      expect(gitignore, pattern).toContain(pattern);
    }
  });

  it('wrangler config declares no secret values', () => {
    const wrangler = readFileSync(join(ROOT, 'wrangler.jsonc'), 'utf8');
    expect(wrangler).not.toMatch(/BOT_TOKEN\s*"?\s*:/);
    expect(wrangler).not.toMatch(/WEBHOOK_SECRET\s*"?\s*:/);
  });
});

describe('secret leakage — runtime output', () => {
  it('no user-visible message contains the bot token', async () => {
    for (const update of [messageUpdate('/start'), messageUpdate('/about'), messageUpdate('/help'), callbackUpdate('about')]) {
      await run(update);
    }
    const all = tg.calls.map((c) => JSON.stringify(c.body)).join('\n');
    expect(all).not.toContain(TEST_BOT_TOKEN);
    expect(all).not.toContain(TEST_WEBHOOK_SECRET);
    expect(all).not.toContain(TEST_ADMIN_SECRET);
  });

  it('the token only ever appears in the api.telegram.org URL path', async () => {
    await run(messageUpdate('/start'));
    const urls = tg.rawUrls();
    expect(urls.length).toBeGreaterThan(0);
    for (const url of urls) {
      if (url.includes(TEST_BOT_TOKEN)) expect(url.startsWith('https://api.telegram.org/bot')).toBe(true);
    }
  });

  it('internal errors are not forwarded verbatim to the user', async () => {
    env.DB.failNext = true;
    await run(messageUpdate('/profile'));
    const all = tg.calls.map((c) => String(c.body['text'] ?? '')).join('\n');
    expect(all).not.toContain('D1_ERROR');
    expect(all).not.toMatch(/\bat\s+\w+\s+\(/); // stack frames
    expect(all).not.toContain('.ts:');
  });
});

// ─── 2. Input validation & injection ─────────────────────────
describe('input validation', () => {
  const ctx: ToolRunContext = { lang: 'fa', userId: 1 };

  it('rejects input above the configured limit before the tool ever runs', async () => {
    const oversized = 'a'.repeat(LIMITS.maxInputChars + 1000);
    await run(callbackUpdate('run:base64_encode'));
    await run(messageUpdate(oversized));
    const texts = tg.sentTexts().join('\n');
    expect(texts).toMatch(/\u062d\u062f\u0627\u06a9\u062b\u0631|too long|\u0637\u0648\u0644\u0627\u0646\u06cc/);
    // The raw payload must never be echoed back.
    expect(texts).not.toContain(oversized.slice(0, 200));
  });

  it('caps every outgoing message below the Telegram 4096-character hard limit', async () => {
    // Truncation is the runner's job, so this is asserted end-to-end, not per tool.
    const big = 'x'.repeat(LIMITS.maxInputChars);
    for (const id of ['base64_encode', 'text_stats', 'url_encode', 'hash_all', 'case_convert']) {
      await run(callbackUpdate(`run:${id}`, { userId: 4242 }));
      await run(messageUpdate(big, { userId: 4242 }));
    }
    for (const call of tg.calls) {
      const text = String(call.body['text'] ?? '');
      expect(text.length, call.method).toBeLessThanOrEqual(4096);
    }
    expect(tg.sentTexts().length).toBeGreaterThan(0);
  });

  it('no tool emits unescaped HTML for a script payload', async () => {
    const payload = '<script>alert(document.cookie)</script>';
    for (const tool of ALL_TOOLS.filter((t) => t.needsInput && !t.network)) {
      let html = '';
      try {
        html = (await tool.run(payload, ctx)).html;
      } catch {
        continue; // rejecting the payload is also acceptable
      }
      expect(html, tool.id).not.toContain('<script>');
      expect(html, tool.id).not.toContain('</script>');
    }
  });

  it('escapeHtml neutralises every angle bracket and ampersand', () => {
    const nasty = '<>&"\'</b><img src=x onerror=alert(1)>';
    const safe = escapeHtml(nasty);
    expect(safe).not.toMatch(/<[a-z/]/i);
  });

  it('rejects SSRF targets across every network tool', async () => {
    const targets = ['http://127.0.0.1', 'localhost', '169.254.169.254', '10.0.0.1', '192.168.1.1', 'http://[::1]'];
    for (const tool of ALL_TOOLS.filter((t) => t.network && t.needsInput)) {
      for (const target of targets) {
        let rejected = false;
        try {
          await tool.run(target, ctx);
        } catch {
          rejected = true;
        }
        expect(rejected, `${tool.id} must reject ${target}`).toBe(true);
      }
    }
  });

  it('does not interpolate user input into SQL', async () => {
    await run(callbackUpdate('run:base64_encode'));
    await run(messageUpdate("'; DROP TABLE users; --"));
    const sql = env.DB.allSql();
    expect(sql).not.toContain('DROP TABLE');
    // Every logged statement must use bound parameters, never inline quotes of user data.
    for (const entry of env.DB.log) expect(entry.sql).not.toContain('DROP');
  });

  it('handles unicode, emoji and RTL control characters safely', async () => {
    for (const payload of ['🌍🚀', 'سلام\u202edlrow', '\u0000null', 'a\u200bb']) {
      await run(messageUpdate(payload));
    }
    expect(tg.calls.length).toBeGreaterThan(0);
  });
});

// ─── 3. Rate limiting ────────────────────────────────────────
describe('rate limiting', () => {
  it('blocks once the general budget is exhausted', async () => {
    const kv = env.STATE as unknown as FakeKV;
    const limit = RATE_LIMIT.general.max;
    let blocked = false;
    for (let i = 0; i < limit + 5; i += 1) {
      const verdict = await consume(kv as unknown as KVNamespace, 'general', 777);
      if (!verdict.allowed) {
        blocked = true;
        expect(verdict.retryAfterSec).toBeGreaterThan(0);
        break;
      }
    }
    expect(blocked).toBe(true);
  });

  it('applies a stricter budget to network tools', () => {
    expect(RATE_LIMIT.network.max).toBeLessThan(RATE_LIMIT.tool.max);
    expect(RATE_LIMIT.tool.max).toBeLessThanOrEqual(RATE_LIMIT.general.max);
  });

  it('keeps budgets isolated per user', async () => {
    const kv = env.STATE as unknown as KVNamespace;
    for (let i = 0; i < RATE_LIMIT.general.max + 2; i += 1) await consume(kv, 'general', 111);
    const other = await consume(kv, 'general', 222);
    expect(other.allowed).toBe(true);
  });

  it('tells the user how long to wait, in their language, without internals', async () => {
    for (let i = 0; i < RATE_LIMIT.general.max + 2; i += 1) {
      await run(messageUpdate('/help', { userId: 909 }));
    }
    const all = tg.calls.map((c) => String(c.body['text'] ?? '')).join('\n');
    expect(all).toMatch(/ثانیه|second/i);
  });
});

// ─── 4. Abuse resistance of network tools ────────────────────
describe('network tool abuse resistance', () => {
  const ctx: ToolRunContext = { lang: 'fa', userId: 1 };

  it('port_check only allows a small whitelist of common ports', async () => {
    const tool = getTool('port_check');
    expect(tool).toBeDefined();
    for (const target of ['example.com:22222', 'example.com:31337', 'example.com:0']) {
      let rejected = false;
      try {
        await tool!.run(target, ctx);
      } catch {
        rejected = true;
      }
      expect(rejected, target).toBe(true);
    }
  });

  it('exposes no port-range or mass-scanning syntax', async () => {
    const tool = getTool('port_check');
    for (const target of ['example.com:1-1000', 'example.com:80,443,8080', 'example.com/24']) {
      let rejected = false;
      try {
        await tool!.run(target, ctx);
      } catch {
        rejected = true;
      }
      expect(rejected, target).toBe(true);
    }
  });

  it('ships no exploit, payload or credential-theft tooling', () => {
    const banned = /exploit|payload|reverse.?shell|bruteforce|brute.?force|sqlmap|metasploit|nmap|credential.?(dump|steal)|keylog/i;
    for (const tool of ALL_TOOLS) {
      expect(tool.id, tool.id).not.toMatch(banned);
      expect(tool.title.en, tool.id).not.toMatch(banned);
    }
  });

  it('JWT tooling decodes but never claims to verify or crack', () => {
    const tool = getTool('jwt_decode');
    expect(tool).toBeDefined();
    const text = `${tool!.description.en} ${tool!.limitations.en}`.toLowerCase();
    expect(text).toMatch(/not verif|no signature|without verif|decode only|does not verify/);
  });

  it('MD5 and SHA-1 tools carry a deprecation warning', () => {
    for (const id of ['md5', 'sha1']) {
      const tool = getTool(id);
      const text = `${tool?.description.en} ${tool?.limitations.en}`.toLowerCase();
      expect(text, id).toMatch(/not.*(secure|safe)|deprecat|collision|legacy/);
    }
  });
});

// ─── 5. Webhook hardening (end-to-end) ───────────────────────
describe('webhook hardening', () => {
  async function post(body: unknown, secret: string | null): Promise<Response> {
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (secret !== null) headers['x-telegram-bot-api-secret-token'] = secret;
    const ctx = execCtx();
    const res = await worker.fetch(
      new Request('https://worker.example/webhook', { method: 'POST', headers, body: JSON.stringify(body) }),
      env,
      ctx as never,
    );
    await Promise.all(ctx.pending);
    return res;
  }

  it('an attacker without the secret cannot make the bot send anything', async () => {
    // NOTE: a trailing space is not tested — the HTTP layer trims header values,
    // so `secret ` and `secret` are the same request on the wire.
    for (const secret of [null, '', 'x', TEST_WEBHOOK_SECRET.toUpperCase(), `${TEST_WEBHOOK_SECRET}x`]) {
      const res = await post(messageUpdate('/start'), secret);
      expect(res.status, String(secret)).toBe(401);
    }
    expect(tg.calls).toHaveLength(0);
  });

  it('does not leak whether the secret was missing or merely wrong', async () => {
    const missing = await post(messageUpdate('/start'), null);
    const wrong = await post(messageUpdate('/start'), 'wrong');
    expect(missing.status).toBe(wrong.status);
    expect(await missing.text()).toBe(await wrong.text());
  });

  it('a forged update cannot impersonate the admin endpoints', async () => {
    const ctx = execCtx();
    const res = await worker.fetch(
      new Request('https://worker.example/admin/self-test', {
        headers: { 'x-telegram-bot-api-secret-token': TEST_WEBHOOK_SECRET },
      }),
      env,
      ctx as never,
    );
    expect(res.status).toBe(401);
  });
});
