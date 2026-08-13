/**
 * Mini App initData verification.
 *
 * These tests build real signatures with Web Crypto rather than mocking the
 * verifier, so a regression in the HMAC construction (field ordering, the
 * "WebAppData" key derivation, the `hash`/`signature` exclusions) fails here.
 */
import { describe, expect, it } from 'vitest';
import { verifyInitData, AuthError } from '../../app-worker/src/auth.js';

// Deliberately not token-shaped: a realistic dummy would trip secret scanners.
const TOKEN = 'test-bot-token-value';

async function hmacRaw(key: ArrayBuffer | Uint8Array, message: string): Promise<ArrayBuffer> {
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    key as BufferSource,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  return crypto.subtle.sign('HMAC', cryptoKey, new TextEncoder().encode(message));
}

function hex(buffer: ArrayBuffer): string {
  return [...new Uint8Array(buffer)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** Produces a correctly signed initData string. */
async function sign(
  fields: Record<string, string>,
  token = TOKEN,
): Promise<string> {
  const params = new URLSearchParams(fields);
  const check = [...params.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');
  const secret = await hmacRaw(new TextEncoder().encode('WebAppData'), token);
  params.set('hash', hex(await hmacRaw(secret, check)));
  return params.toString();
}

const nowSec = (): number => Math.floor(Date.now() / 1000);

const baseUser = { id: 7951577342, first_name: 'Amir', last_name: 'N', username: 'amir', language_code: 'fa' };

describe('verifyInitData — valid', () => {
  it('accepts a correctly signed payload and returns the user', async () => {
    const data = await sign({
      auth_date: String(nowSec()),
      query_id: 'AAHdF6IQAAAAAN0XohDhrOrc',
      user: JSON.stringify(baseUser),
    });
    const user = await verifyInitData(data, TOKEN);
    expect(user.id).toBe(7951577342);
    expect(user.firstName).toBe('Amir');
    expect(user.username).toBe('amir');
    expect(user.languageCode).toBe('fa');
  });

  it('ignores a `signature` field when computing the check string', async () => {
    // Telegram's third-party Ed25519 flow adds `signature`, which must be
    // excluded from the HMAC input or every launch from a new client fails.
    const params = new URLSearchParams(
      await sign({ auth_date: String(nowSec()), user: JSON.stringify(baseUser) }),
    );
    params.set('signature', 'abc123_ed25519_signature');
    const user = await verifyInitData(params.toString(), TOKEN);
    expect(user.id).toBe(baseUser.id);
  });

  it('handles unicode names without corrupting the signature', async () => {
    const data = await sign({
      auth_date: String(nowSec()),
      user: JSON.stringify({ id: 42, first_name: 'امیر', last_name: 'نیک‌زاد' }),
    });
    const user = await verifyInitData(data, TOKEN);
    expect(user.firstName).toBe('امیر');
  });
});

describe('verifyInitData — rejection', () => {
  it('rejects an empty payload', async () => {
    await expect(verifyInitData('', TOKEN)).rejects.toThrowError(AuthError);
  });

  it('rejects a tampered user id', async () => {
    const data = await sign({ auth_date: String(nowSec()), user: JSON.stringify(baseUser) });
    // The classic attack: swap the user for someone else's id, keep the hash.
    const forged = data.replace('7951577342', '1111111111');
    await expect(verifyInitData(forged, TOKEN)).rejects.toThrowError(/signature mismatch/);
  });

  it('rejects a payload signed with a different bot token', async () => {
    const data = await sign({ auth_date: String(nowSec()), user: JSON.stringify(baseUser) }, 'different-test-token');
    await expect(verifyInitData(data, TOKEN)).rejects.toThrowError(/signature mismatch/);
  });

  it('rejects a missing hash', async () => {
    const params = new URLSearchParams(
      await sign({ auth_date: String(nowSec()), user: JSON.stringify(baseUser) }),
    );
    params.delete('hash');
    await expect(verifyInitData(params.toString(), TOKEN)).rejects.toThrowError(/bad hash/);
  });

  it('rejects a malformed hash', async () => {
    const params = new URLSearchParams(
      await sign({ auth_date: String(nowSec()), user: JSON.stringify(baseUser) }),
    );
    params.set('hash', 'not-hex');
    await expect(verifyInitData(params.toString(), TOKEN)).rejects.toThrowError(/bad hash/);
  });

  it('rejects an expired payload (older than 24h)', async () => {
    const data = await sign({
      auth_date: String(nowSec() - 25 * 60 * 60),
      user: JSON.stringify(baseUser),
    });
    await expect(verifyInitData(data, TOKEN)).rejects.toThrowError(/expired/);
  });

  it('rejects an auth_date far in the future', async () => {
    const data = await sign({ auth_date: String(nowSec() + 4000), user: JSON.stringify(baseUser) });
    await expect(verifyInitData(data, TOKEN)).rejects.toThrowError(/future/);
  });

  it('rejects a payload with no user object', async () => {
    const data = await sign({ auth_date: String(nowSec()), query_id: 'AAA' });
    await expect(verifyInitData(data, TOKEN)).rejects.toThrowError(/no user/);
  });

  it('rejects malformed user JSON', async () => {
    const data = await sign({ auth_date: String(nowSec()), user: '{not json' });
    await expect(verifyInitData(data, TOKEN)).rejects.toThrowError(/malformed user/);
  });

  it('rejects a non-positive user id', async () => {
    const data = await sign({ auth_date: String(nowSec()), user: JSON.stringify({ id: 0, first_name: 'X' }) });
    await expect(verifyInitData(data, TOKEN)).rejects.toThrowError(/bad user id/);
  });

  it('rejects an oversized payload before doing any crypto', async () => {
    await expect(verifyInitData('x'.repeat(9000), TOKEN)).rejects.toThrowError(/too large/);
  });

  it('fails closed when the server has no bot token', async () => {
    const data = await sign({ auth_date: String(nowSec()), user: JSON.stringify(baseUser) });
    await expect(verifyInitData(data, '')).rejects.toThrowError(/misconfigured/);
  });

  it('caps absurdly long names instead of trusting them', async () => {
    const data = await sign({
      auth_date: String(nowSec()),
      user: JSON.stringify({ id: 5, first_name: 'A'.repeat(500) }),
    });
    const user = await verifyInitData(data, TOKEN);
    expect(user.firstName.length).toBe(64);
  });
});
