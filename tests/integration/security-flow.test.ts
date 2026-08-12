/**
 * End-to-end tests for the 🛡️ Advanced Security section, driven through the
 * real router with fake Cloudflare bindings — the same approach as the phase-1
 * integration suite.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { handleUpdate } from '../../src/bot/router.js';
import {
  callbackUpdate,
  documentUpdate,
  execCtx,
  installFakeTelegram,
  makeEnv,
  messageUpdate,
} from '../helpers/fakes.js';
import { buildApk, BENIGN_APK } from '../helpers/apk-builder.js';
import { redactLabel, newScanId } from '../../src/db/scans.js';

/**
 * Fixtures are assembled from fragments so no secret-shaped literal is ever
 * committed — credential scanners (including GitHub push protection) flag
 * those on sight, and a security feature should not ship bait in its tests.
 */
const join = (...parts: string[]): string => parts.join('');
const FAKE_AWS_KEY = join('AKIA', 'IOSFODNN', '7EXAMPLE');
const FAKE_GH_TOKEN = join('ghp', '_', 'A1b2C3d4E5f6', 'G7h8I9j0K1l2', 'M3n4O5p6Q7r8');

let tg: ReturnType<typeof installFakeTelegram>;

const flush = async (ctx: ReturnType<typeof execCtx>): Promise<void> => {
  await Promise.allSettled(ctx.pending);
};

afterEach(() => {
  tg?.restore();
});

describe('Security section navigation', () => {
  beforeEach(() => {
    tg = installFakeTelegram();
  });

  it('opens the security menu from its callback', async () => {
    const env = makeEnv();
    const ctx = execCtx();
    await handleUpdate(callbackUpdate('sec'), env, ctx);
    await flush(ctx);

    const text = tg.sentTexts().join('\n');
    expect(text).toContain('🛡️');
    // Every scan type must be reachable from this one screen.
    const keyboard = JSON.stringify(tg.calls.map((call) => call.body['reply_markup']));
    for (const kind of ['secr:apk', 'secr:url', 'secr:file', 'secr:secret', 'secr:dependency', 'secr:ioc']) {
      expect(keyboard).toContain(kind);
    }
  });

  it('offers the security section from the home screen', async () => {
    const env = makeEnv();
    const ctx = execCtx();
    await handleUpdate(messageUpdate('/start'), env, ctx);
    await flush(ctx);
    expect(JSON.stringify(tg.calls)).toContain('"sec"');
  });

  it('responds to the /security command', async () => {
    const env = makeEnv();
    const ctx = execCtx();
    await handleUpdate(messageUpdate('/security'), env, ctx);
    await flush(ctx);
    expect(tg.sentTexts().join('')).toContain('🛡️');
  });

  it('prompts for input when a scan type is chosen and records the pending state', async () => {
    const env = makeEnv();
    const ctx = execCtx();
    await handleUpdate(callbackUpdate('secr:url'), env, ctx);
    await flush(ctx);

    const pending = await env.STATE.get('pending:555', 'json');
    expect((pending as { toolId?: string } | null)?.toolId).toBe('sec:url');
    expect(tg.sentTexts().join('')).toMatch(/http|نشانی/i);
  });

  it('rejects an unknown scan type without crashing', async () => {
    const env = makeEnv();
    const ctx = execCtx();
    await handleUpdate(callbackUpdate('secr:bogus'), env, ctx);
    await flush(ctx);
    expect(tg.methods()).toContain('answerCallbackQuery');
  });

  it('cancels back to the security menu', async () => {
    const env = makeEnv();
    const ctx = execCtx();
    await handleUpdate(callbackUpdate('secr:apk'), env, ctx);
    await handleUpdate(callbackUpdate('sec'), env, ctx);
    await flush(ctx);
    expect(await env.STATE.get('pending:555')).toBeNull();
  });
});

describe('URL scan through the bot', () => {
  beforeEach(() => {
    tg = installFakeTelegram({
      onOther: () =>
        new Response('<html><title>Sign in</title><input type="password" name="p"></html>', {
          status: 200,
          headers: { 'content-type': 'text/html' },
        }),
    });
  });

  it('analyses a phishing URL and reports a high risk', async () => {
    const env = makeEnv();
    const ctx = execCtx();
    await handleUpdate(callbackUpdate('secr:url'), env, ctx);
    await handleUpdate(messageUpdate('http://apple.com.verify-login.tk/signin?password=x'), env, ctx);
    await flush(ctx);

    const text = tg.sentTexts().join('\n');
    expect(text).toMatch(/🔴|⚫️/);
    expect(text).toContain('verify-login.tk');
  });

  it('refuses to scan an internal address', async () => {
    const env = makeEnv();
    const ctx = execCtx();
    await handleUpdate(callbackUpdate('secr:url'), env, ctx);
    await handleUpdate(messageUpdate('http://169.254.169.254/latest/meta-data/'), env, ctx);
    await flush(ctx);

    const text = tg.sentTexts().join('\n');
    expect(text).toMatch(/❌|مجاز نیست|not allowed/i);
    // A refusal must not look like a clean bill of health.
    expect(text).not.toMatch(/🟢/);
  });

  it('clears the pending state after a scan so the next message is not swallowed', async () => {
    const env = makeEnv();
    const ctx = execCtx();
    await handleUpdate(callbackUpdate('secr:url'), env, ctx);
    await handleUpdate(messageUpdate('https://example.com/'), env, ctx);
    await flush(ctx);
    expect(await env.STATE.get('pending:555')).toBeNull();
  });
});

describe('File scans through the bot', () => {
  const apk = buildApk({
    ...BENIGN_APK,
    permissions: ['android.permission.RECORD_AUDIO', 'android.permission.INTERNET'],
  });

  it('analyses an uploaded APK', async () => {
    tg = installFakeTelegram({ files: { 'apk-1': { data: apk, path: 'documents/app.apk' } } });
    const env = makeEnv();
    const ctx = execCtx();

    await handleUpdate(callbackUpdate('secr:apk'), env, ctx);
    await handleUpdate(documentUpdate({ fileId: 'apk-1', fileName: 'app.apk', fileSize: apk.length }), env, ctx);
    await flush(ctx);

    const text = tg.sentTexts().join('\n');
    expect(text).toContain('com.example.notes');
    expect(text).toMatch(/RECORD_AUDIO|میکروفون|Microphone/i);
  });

  it('tells the user which scan to pick when a file arrives unprompted', async () => {
    tg = installFakeTelegram({ files: { 'apk-2': { data: apk, path: 'documents/app.apk' } } });
    const env = makeEnv();
    const ctx = execCtx();

    await handleUpdate(documentUpdate({ fileId: 'apk-2', fileName: 'app.apk' }), env, ctx);
    await flush(ctx);

    expect(tg.sentTexts().join('')).toContain('🛡️');
  });

  it('reports a clear error when Telegram cannot supply the file', async () => {
    tg = installFakeTelegram({ files: {} });
    const env = makeEnv();
    const ctx = execCtx();

    await handleUpdate(callbackUpdate('secr:apk'), env, ctx);
    await handleUpdate(documentUpdate({ fileId: 'missing', fileName: 'x.apk' }), env, ctx);
    await flush(ctx);

    const text = tg.sentTexts().join('\n');
    expect(text).toMatch(/❌/);
    expect(text).not.toMatch(/undefined|\[object|TypeError/);
  });

  it('refuses a file that exceeds the size limit', async () => {
    tg = installFakeTelegram({ files: { big: { data: apk, path: 'documents/big.apk' } } });
    const env = makeEnv();
    const ctx = execCtx();

    await handleUpdate(callbackUpdate('secr:apk'), env, ctx);
    await handleUpdate(
      documentUpdate({ fileId: 'big', fileName: 'big.apk', fileSize: 64 * 1024 * 1024 }),
      env,
      ctx,
    );
    await flush(ctx);

    expect(tg.sentTexts().join('\n')).toMatch(/❌/);
  });

  it('asks for a Document when the user sends a photo for metadata analysis', async () => {
    tg = installFakeTelegram();
    const env = makeEnv();
    const ctx = execCtx();

    await handleUpdate(callbackUpdate('secr:file'), env, ctx);
    const update = messageUpdate('', {});
    (update.message as unknown as Record<string, unknown>)['photo'] = [
      { file_id: 'p1', file_unique_id: 'p1u', width: 100, height: 100 },
    ];
    delete (update.message as unknown as Record<string, unknown>)['text'];
    await handleUpdate(update, env, ctx);
    await flush(ctx);

    expect(tg.sentTexts().join('\n')).toMatch(/Document|فایل/i);
  });
});

describe('Secret scan through the bot', () => {
  beforeEach(() => {
    tg = installFakeTelegram();
  });

  it('detects credentials in pasted text and never echoes them back', async () => {
    const env = makeEnv();
    const ctx = execCtx();
    const secret = FAKE_AWS_KEY;

    await handleUpdate(callbackUpdate('secr:secret'), env, ctx);
    await handleUpdate(messageUpdate(`aws_key = "${secret}"`), env, ctx);
    await flush(ctx);

    const text = tg.sentTexts().join('\n');
    expect(text).toMatch(/AWS/i);
    // The masked form may show a prefix, but never the whole value.
    expect(text).not.toContain(secret);
    expect(text).not.toContain('IOSFODNN7EXAMPLE');
  });

  it('never writes a secret into the database', async () => {
    const env = makeEnv();
    const ctx = execCtx();
    const secret = FAKE_GH_TOKEN;

    await handleUpdate(callbackUpdate('secr:secret'), env, ctx);
    await handleUpdate(messageUpdate(`token=${secret}`), env, ctx);
    await flush(ctx);

    const persisted = JSON.stringify(env.DB.log);
    expect(persisted).not.toContain(secret);
    expect(persisted).not.toContain('A1b2C3d4E5f6');
  });

  it('reports a clean result for text with no secrets', async () => {
    const env = makeEnv();
    const ctx = execCtx();
    await handleUpdate(callbackUpdate('secr:secret'), env, ctx);
    await handleUpdate(messageUpdate('const sum = (a, b) => a + b;'), env, ctx);
    await flush(ctx);
    expect(tg.sentTexts().join('\n')).toMatch(/🟢/);
  });
});

describe('Scan history and dashboard', () => {
  beforeEach(() => {
    tg = installFakeTelegram();
  });

  it('shows an empty history for a new user', async () => {
    const env = makeEnv();
    const ctx = execCtx();
    await handleUpdate(callbackUpdate('sech:1'), env, ctx);
    await flush(ctx);
    expect(tg.sentTexts().join('')).toMatch(/📊/);
  });

  it('lists stored scans without revealing what was scanned', async () => {
    const env = makeEnv();
    env.DB.when(/SELECT COUNT\(\*\) AS n FROM security_scans/, { n: 1 }).when(/SELECT \* FROM security_scans/, [
      {
        scan_id: 'ABCDEF1234',
        user_id: 555,
        scan_type: 'apk',
        target_hash: 'f'.repeat(64),
        target_label: '*.apk',
        severity: 'high',
        score: 62,
        findings: 7,
        high_count: 2,
        created_at: Math.floor(Date.now() / 1000) - 3600,
      },
    ]);

    const ctx = execCtx();
    await handleUpdate(callbackUpdate('sech:1'), env, ctx);
    await flush(ctx);

    const text = tg.sentTexts().join('\n');
    expect(text).toContain('ABCDEF1234');
    expect(text).toContain('*.apk');
    expect(text).toMatch(/🔴/);
  });

  it('renders the security dashboard', async () => {
    const env = makeEnv();
    env.DB.when(/GROUP BY scan_type/, [{ scan_type: 'apk', n: 3 }])
      .when(/GROUP BY severity/, [{ severity: 'high', n: 2 }])
      .when(/ORDER BY created_at DESC LIMIT 5/, [])
      .when(/created_at >= /, [{ n: 3 }]);

    const ctx = execCtx();
    await handleUpdate(callbackUpdate('secd'), env, ctx);
    await flush(ctx);

    expect(tg.sentTexts().join('')).toMatch(/📈/);
  });

  it('writes only privacy-safe columns to the scan history', async () => {
    const env = makeEnv();
    const ctx = execCtx();
    await handleUpdate(callbackUpdate('secr:secret'), env, ctx);
    await handleUpdate(messageUpdate('password = "SuperSecret123!"'), env, ctx);
    await flush(ctx);

    const insert = env.DB.log.find((entry) => entry.sql.includes('INSERT INTO security_scans'));
    expect(insert).toBeDefined();
    const params = JSON.stringify(insert?.params ?? []);
    expect(params).not.toContain('SuperSecret123');
  });
});

describe('History storage helpers', () => {
  it('reduces a URL to scheme and host only', () => {
    expect(redactLabel('url', 'https://example.com/reset?token=abcd1234')).toBe('https://example.com');
  });

  it('reduces a file name to its extension', () => {
    // A file name can itself be sensitive ("passport_scan.jpg").
    expect(redactLabel('file', 'my_passport_scan.jpg')).toBe('*.jpg');
    expect(redactLabel('apk', 'BankApp-v2.apk')).toBe('*.apk');
  });

  it('never returns the raw text for a secret scan', () => {
    expect(redactLabel('secret', FAKE_AWS_KEY)).toBe('text input');
  });

  it('generates distinct scan ids', () => {
    const ids = new Set(Array.from({ length: 200 }, () => newScanId()));
    expect(ids.size).toBe(200);
  });
});

describe('Rate limiting', () => {
  beforeEach(() => {
    tg = installFakeTelegram();
  });

  it('stops runaway scanning by the same user', async () => {
    const env = makeEnv();
    // The security bucket allows 10 per 5 minutes.
    for (let i = 0; i < 12; i++) {
      const ctx = execCtx();
      await handleUpdate(callbackUpdate('secr:secret', { userId: 777 }), env, ctx);
      await handleUpdate(messageUpdate(`plain text ${i}`, { userId: 777 }), env, ctx);
      await flush(ctx);
    }
    expect(tg.sentTexts().join('\n')).toMatch(/🚦|صبر|wait/i);
  });
});
