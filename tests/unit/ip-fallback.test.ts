import { afterEach, describe, expect, it, vi } from 'vitest';

import { ipInfoTool } from '../../src/tools/network/ip.js';
import { FakeKV } from '../helpers/fakes.js';

/**
 * Regression tests for a bug found during live production testing.
 *
 * Cloudflare Workers share outbound IPs across the entire platform, so the free
 * tier of ipwho.is is permanently exhausted from a Worker: it answered HTTP 429
 * for every request, which made `ip_info` unusable in production even though it
 * worked fine from a developer machine. The tool now falls back to a second
 * provider (ip-api.com) whenever the primary one fails.
 */

const ctx = () => ({
  lang: 'fa' as const,
  userId: 1,
  cache: new FakeKV() as unknown as KVNamespace,
});

/** Builds a fetch stub that answers per-hostname. */
function stubFetch(handlers: Record<string, () => Response>): void {
  vi.stubGlobal('fetch', async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    for (const [host, make] of Object.entries(handlers)) {
      if (url.includes(host)) return make();
    }
    throw new Error(`unexpected fetch: ${url}`);
  });
}

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const IPAPI_OK = {
  status: 'success',
  query: '8.8.8.8',
  country: 'United States',
  countryCode: 'US',
  regionName: 'Virginia',
  city: 'Ashburn',
  lat: 39.03,
  lon: -77.5,
  timezone: 'America/New_York',
  isp: 'Google LLC',
  org: 'Google Public DNS',
  as: 'AS15169 Google LLC',
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('ip_info provider fallback', () => {
  it('uses the primary provider when it succeeds', async () => {
    stubFetch({
      'ipwho.is': () =>
        json({ success: true, ip: '8.8.8.8', type: 'IPv4', country: 'United States', country_code: 'US', city: 'Mountain View' }),
      'ip-api.com': () => {
        throw new Error('fallback must not be called');
      },
    });

    const out = await ipInfoTool.run('8.8.8.8', ctx());
    expect(out.html).toContain('Mountain View');
  });

  it('falls back to the secondary provider when the primary rate-limits us', async () => {
    stubFetch({
      'ipwho.is': () => json({ success: false, message: 'Rate limit exceeded' }, 429),
      'ip-api.com': () => json(IPAPI_OK),
    });

    const out = await ipInfoTool.run('8.8.8.8', ctx());
    expect(out.html).toContain('Ashburn');
    expect(out.html).toContain('15169');
    expect(out.html).not.toContain('Rate limit');
  });

  it('falls back when the primary answers 200 with success:false', async () => {
    stubFetch({
      'ipwho.is': () => json({ success: false, message: 'Rate limit exceeded' }),
      'ip-api.com': () => json(IPAPI_OK),
    });

    const out = await ipInfoTool.run('8.8.8.8', ctx());
    expect(out.html).toContain('Ashburn');
  });

  it('falls back when the primary connection throws', async () => {
    stubFetch({
      'ipwho.is': () => {
        throw new Error('ECONNRESET');
      },
      'ip-api.com': () => json(IPAPI_OK),
    });

    const out = await ipInfoTool.run('8.8.8.8', ctx());
    expect(out.html).toContain('United States');
  });

  it('reports a clean error when both providers fail, leaking no internals', async () => {
    stubFetch({
      'ipwho.is': () => json({ success: false }),
      'ip-api.com': () => json({ status: 'fail', message: 'reserved range' }),
    });

    await expect(ipInfoTool.run('8.8.8.8', ctx())).rejects.toMatchObject({ name: 'ToolError' });
  });

  it('derives the flag emoji from the country code', async () => {
    stubFetch({
      'ipwho.is': () => json({ success: false }),
      'ip-api.com': () => json(IPAPI_OK),
    });

    const out = await ipInfoTool.run('8.8.8.8', ctx());
    expect(out.html).toContain('🇺🇸');
  });

  it('does not cache a double failure', async () => {
    const kv = new FakeKV();
    stubFetch({
      'ipwho.is': () => json({ success: false }),
      'ip-api.com': () => json({ status: 'fail' }),
    });
    await Promise.resolve(
      ipInfoTool.run('8.8.8.8', { lang: 'fa', userId: 1, cache: kv as unknown as KVNamespace }),
    ).catch(() => undefined);

    expect(kv.keys().some((k) => k.startsWith('ipinfo:'))).toBe(false);
  });
});
