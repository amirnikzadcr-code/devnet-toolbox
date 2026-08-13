/**
 * Authentication primitives for the admin panel.
 *
 * These tests are the safety net for the only thing standing between the
 * public internet and a broadcast button, so they cover the failure modes
 * (forged signature, replayed code, lockout) rather than just the happy path.
 */
import { describe, expect, it } from 'vitest';
import {
  clearFailures,
  clearedCookie,
  COOKIE_NAME,
  createChallenge,
  createSession,
  destroySession,
  generateCode,
  isLockedOut,
  originAllowed,
  randomId,
  readCookie,
  readSession,
  recordFailure,
  safeEqual,
  sessionCookie,
  verifyChallenge,
} from '../../admin/src/auth.js';
import { makeAdminEnv } from '../helpers/admin-fakes.js';

describe('safeEqual', () => {
  it('accepts identical strings', () => {
    expect(safeEqual('abc123', 'abc123')).toBe(true);
  });

  it('rejects different strings of equal length', () => {
    expect(safeEqual('abc123', 'abc124')).toBe(false);
  });

  it('rejects different lengths without throwing', () => {
    expect(safeEqual('short', 'much-longer-value')).toBe(false);
  });

  it('rejects empty against non-empty', () => {
    expect(safeEqual('', 'x')).toBe(false);
  });

  it('treats two empty strings as equal', () => {
    expect(safeEqual('', '')).toBe(true);
  });
});

describe('generateCode', () => {
  it('always returns exactly six digits', () => {
    for (let i = 0; i < 200; i += 1) expect(generateCode()).toMatch(/^[0-9]{6}$/);
  });

  it('produces varied values', () => {
    const seen = new Set(Array.from({ length: 100 }, () => generateCode()));
    expect(seen.size).toBeGreaterThan(50);
  });
});

describe('randomId', () => {
  it('is URL-safe', () => {
    for (let i = 0; i < 50; i += 1) expect(randomId()).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('does not repeat', () => {
    const seen = new Set(Array.from({ length: 200 }, () => randomId()));
    expect(seen.size).toBe(200);
  });
});

describe('two-factor challenge', () => {
  it('verifies the correct code', async () => {
    const env = makeAdminEnv();
    const { id, code } = await createChallenge(env);
    expect(await verifyChallenge(env, id, code)).toBe(true);
  });

  it('rejects a wrong code', async () => {
    const env = makeAdminEnv();
    const { id, code } = await createChallenge(env);
    const wrong = code === '000000' ? '111111' : '000000';
    expect(await verifyChallenge(env, id, wrong)).toBe(false);
  });

  it('burns the challenge after one attempt, so a code cannot be replayed', async () => {
    const env = makeAdminEnv();
    const { id, code } = await createChallenge(env);
    expect(await verifyChallenge(env, id, code)).toBe(true);
    expect(await verifyChallenge(env, id, code)).toBe(false);
  });

  it('burns the challenge even when the guess was wrong', async () => {
    const env = makeAdminEnv();
    const { id, code } = await createChallenge(env);
    await verifyChallenge(env, id, '000000');
    expect(await verifyChallenge(env, id, code)).toBe(false);
  });

  it('rejects an unknown challenge id', async () => {
    const env = makeAdminEnv();
    expect(await verifyChallenge(env, 'no-such-challenge', '123456')).toBe(false);
  });

  it('rejects malformed codes without touching storage', async () => {
    const env = makeAdminEnv();
    const { id } = await createChallenge(env);
    for (const bad of ['', '12345', '1234567', 'abcdef', '12 34 56']) {
      expect(await verifyChallenge(env, id, bad)).toBe(false);
    }
  });
});

describe('sessions', () => {
  it('round-trips a valid session', async () => {
    const env = makeAdminEnv();
    const token = await createSession(env, 42);
    const session = await readSession(env, token);
    expect(session?.uid).toBe(42);
  });

  it('rejects a token with a tampered signature', async () => {
    const env = makeAdminEnv();
    const token = await createSession(env, 42);
    const [id] = token.split('.');
    expect(await readSession(env, `${id}.forged-signature`)).toBeNull();
  });

  it('rejects a token signed with a different secret', async () => {
    const env = makeAdminEnv();
    const token = await createSession(env, 42);
    const other = makeAdminEnv({ SESSION_SECRET: 'a-completely-different-key', STATE: env.STATE });
    expect(await readSession(other, token)).toBeNull();
  });

  it('rejects a well-signed token whose server record was revoked', async () => {
    const env = makeAdminEnv();
    const token = await createSession(env, 42);
    await destroySession(env, token);
    expect(await readSession(env, token)).toBeNull();
  });

  it('rejects null, empty and malformed tokens', async () => {
    const env = makeAdminEnv();
    for (const bad of [null, '', 'no-dot', '.', '.sig', '../../etc/passwd.sig']) {
      expect(await readSession(env, bad)).toBeNull();
    }
  });

  it('rejects an id that is not URL-safe base64', async () => {
    const env = makeAdminEnv();
    expect(await readSession(env, 'has spaces.signature')).toBeNull();
  });

  it('issues a cookie that is HttpOnly, Secure and SameSite=Strict', async () => {
    const env = makeAdminEnv();
    const cookie = sessionCookie(await createSession(env, 1));
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('Secure');
    expect(cookie).toContain('SameSite=Strict');
  });

  it('clears the cookie with a zero Max-Age', () => {
    expect(clearedCookie()).toContain('Max-Age=0');
  });
});

describe('readCookie', () => {
  it('finds the session cookie among others', () => {
    const request = new Request('https://x.dev', {
      headers: { cookie: `other=1; ${COOKIE_NAME}=abc.def; last=2` },
    });
    expect(readCookie(request, COOKIE_NAME)).toBe('abc.def');
  });

  it('returns null when the header is absent', () => {
    expect(readCookie(new Request('https://x.dev'), COOKIE_NAME)).toBeNull();
  });

  it('returns null when the named cookie is absent', () => {
    const request = new Request('https://x.dev', { headers: { cookie: 'a=1; b=2' } });
    expect(readCookie(request, COOKIE_NAME)).toBeNull();
  });

  it('keeps base64 padding that contains "="', () => {
    const request = new Request('https://x.dev', { headers: { cookie: `${COOKIE_NAME}=aa.bb==` } });
    expect(readCookie(request, COOKIE_NAME)).toBe('aa.bb==');
  });
});

describe('login throttling', () => {
  it('locks out after five failures', async () => {
    const env = makeAdminEnv();
    for (let i = 0; i < 4; i += 1) await recordFailure(env, 'pw', '1.2.3.4');
    expect(await isLockedOut(env, 'pw', '1.2.3.4')).toBe(false);
    await recordFailure(env, 'pw', '1.2.3.4');
    expect(await isLockedOut(env, 'pw', '1.2.3.4')).toBe(true);
  });

  it('tracks each IP separately', async () => {
    const env = makeAdminEnv();
    for (let i = 0; i < 5; i += 1) await recordFailure(env, 'pw', '1.1.1.1');
    expect(await isLockedOut(env, 'pw', '2.2.2.2')).toBe(false);
  });

  it('tracks password and code attempts separately', async () => {
    const env = makeAdminEnv();
    for (let i = 0; i < 5; i += 1) await recordFailure(env, 'pw', '9.9.9.9');
    expect(await isLockedOut(env, 'code', '9.9.9.9')).toBe(false);
  });

  it('clears the counter on success', async () => {
    const env = makeAdminEnv();
    for (let i = 0; i < 5; i += 1) await recordFailure(env, 'pw', '3.3.3.3');
    await clearFailures(env, 'pw', '3.3.3.3');
    expect(await isLockedOut(env, 'pw', '3.3.3.3')).toBe(false);
  });
});

describe('originAllowed', () => {
  it('allows a same-origin POST', () => {
    const request = new Request('https://admin.dev/broadcast', {
      method: 'POST',
      headers: { origin: 'https://admin.dev' },
    });
    expect(originAllowed(request)).toBe(true);
  });

  it('rejects a cross-origin POST', () => {
    const request = new Request('https://admin.dev/broadcast', {
      method: 'POST',
      headers: { origin: 'https://evil.example' },
    });
    expect(originAllowed(request)).toBe(false);
  });

  it('allows a request with no Origin header (curl, tests)', () => {
    expect(originAllowed(new Request('https://admin.dev/x', { method: 'POST' }))).toBe(true);
  });

  it('rejects a malformed Origin header', () => {
    const request = new Request('https://admin.dev/x', {
      method: 'POST',
      headers: { origin: 'not a url' },
    });
    expect(originAllowed(request)).toBe(false);
  });
});
