import { afterEach, describe, expect, it, vi } from 'vitest';

import { sslInfoTool } from '../../src/tools/network/ssl.js';
import { asString } from '../../src/utils/text.js';
import { FakeKV } from '../helpers/fakes.js';

/**
 * Regression tests for a crash found by reading production Worker logs:
 *
 *   {"scope":"runner.unexpected","message":"(cn ?? o ?? issuer).trim is not a
 *    function","kind":"TypeError","tool":"ssl_info"}
 *
 * The code typed certspotter's `issuer` as a string, but the API actually
 * returns an object ({ name, friendly_name, pubkey_sha256 }). TypeScript cannot
 * catch that — the value crosses the boundary as untyped JSON — so every
 * ssl_info run died with a raw TypeError and the user saw "unexpected error".
 */

const future = new Date(Date.now() + 60 * 86_400_000).toISOString();
const past = new Date(Date.now() - 30 * 86_400_000).toISOString();

const ctx = () => ({
  lang: 'fa' as const,
  userId: 1,
  cache: new FakeKV() as unknown as KVNamespace,
});

/** Answers the CT API with `issuances`, and any other request with an empty 200. */
function stubCt(issuances: unknown): void {
  vi.stubGlobal('fetch', async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (url.includes('certspotter.com')) {
      return new Response(JSON.stringify(issuances), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    return new Response('', { status: 200 });
  });
}

const cert = (issuer: unknown) => [
  { id: '1', dns_names: ['cloudflare.com', 'www.cloudflare.com'], issuer, not_before: past, not_after: future },
];

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('ssl_info issuer parsing', () => {
  it('reads the real certspotter object shape without crashing', async () => {
    stubCt(
      cert({
        friendly_name: 'Google Trust Services',
        name: 'C=US, O=Google Trust Services, CN=WE1',
        pubkey_sha256: 'abc',
      }),
    );

    const out = await sslInfoTool.run('cloudflare.com', ctx());
    expect(out.html).toContain('Google Trust Services');
    expect(out.html).toContain('cloudflare.com');
  });

  it('falls back to the CN inside `name` when friendly_name is absent', async () => {
    stubCt(cert({ name: 'C=US, O=Let\u2019s Encrypt, CN=R11' }));
    const out = await sslInfoTool.run('cloudflare.com', ctx());
    expect(out.html).toContain('R11');
  });

  it('still supports the legacy plain-string issuer', async () => {
    stubCt(cert('C=US, O=DigiCert Inc, CN=DigiCert TLS RSA SHA256 2020 CA1'));
    const out = await sslInfoTool.run('cloudflare.com', ctx());
    expect(out.html).toContain('DigiCert TLS RSA SHA256 2020 CA1');
  });

  it('degrades gracefully on null, numeric or empty issuers', async () => {
    for (const weird of [null, 42, {}, { name: '' }, undefined]) {
      stubCt(cert(weird));
      const out = await sslInfoTool.run('cloudflare.com', ctx());
      expect(out.html).toContain('—');
      expect(out.html).not.toContain('undefined');
    }
  });

  it('never leaks a raw TypeError to the user', async () => {
    stubCt(cert({ name: { nested: 'unexpected' } }));
    const out = await sslInfoTool.run('cloudflare.com', ctx());
    expect(out.html).not.toMatch(/is not a function/);
  });
});

describe('asString', () => {
  it('passes strings through and coerces primitives', () => {
    expect(asString('hello')).toBe('hello');
    expect(asString(42)).toBe('42');
    expect(asString(true)).toBe('true');
  });

  it('returns the fallback for objects, arrays, null and undefined', () => {
    expect(asString({ a: 1 })).toBe('');
    expect(asString([1, 2])).toBe('');
    expect(asString(null)).toBe('');
    expect(asString(undefined)).toBe('');
    expect(asString(null, '—')).toBe('—');
  });
});
