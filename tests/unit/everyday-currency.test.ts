import { afterEach, describe, expect, it, vi } from 'vitest';

import { currencyTool, normalizeCurrency, parseConversionRequest } from '../../src/tools/everyday/currency.js';
import { ToolError } from '../../src/utils/errors.js';
import { FakeKV } from '../helpers/fakes.js';

/**
 * Phase 4 · Stage A — 💱 Currency converter.
 *
 * The hard requirement here is that the tool NEVER invents a rate. These tests
 * cover the four API states the spec asks for — success, timeout, error and an
 * invalid response — and assert that only the success path produces a number.
 */

const ctx = () => ({ lang: 'en' as const, userId: 1, cache: new FakeKV() as unknown as KVNamespace });

function stubFetch(handler: (url: string) => Response | Promise<Response>): void {
  vi.stubGlobal('fetch', async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    return handler(url);
  });
}

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const FRANKFURTER_OK = { amount: 1, base: 'USD', date: '2026-08-12', rates: { EUR: 0.86618 } };
const ERAPI_OK = {
  result: 'success',
  provider: 'https://www.exchangerate-api.com',
  base_code: 'USD',
  time_last_update_utc: 'Thu, 13 Aug 2026 00:02:31 +0000',
  rates: { EUR: 0.8659, IRR: 42000 },
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('currency input parsing', () => {
  it('normalises symbols, names and ISO codes', () => {
    expect(normalizeCurrency('usd')).toBe('USD');
    expect(normalizeCurrency('$')).toBe('USD');
    expect(normalizeCurrency('یورو')).toBe('EUR');
    expect(normalizeCurrency('  Eur ')).toBe('EUR');
  });

  it('rejects codes that are not three letters', () => {
    for (const bad of ['', 'dollarz', '12', 'US']) {
      expect(() => normalizeCurrency(bad), bad).toThrowError(ToolError);
    }
  });

  it('parses every documented request shape', () => {
    expect(parseConversionRequest('100 USD to EUR')).toEqual({ amount: 100, from: 'USD', to: 'EUR' });
    expect(parseConversionRequest('250 EUR TRY')).toEqual({ amount: 250, from: 'EUR', to: 'TRY' });
    expect(parseConversionRequest('USD EUR')).toEqual({ amount: 1, from: 'USD', to: 'EUR' });
    expect(parseConversionRequest('۱۰۰ USD به EUR')).toEqual({ amount: 100, from: 'USD', to: 'EUR' });
  });

  it('rejects empty, incomplete, negative and oversized requests', () => {
    for (const bad of ['', '100', '100 USD', '-5 USD EUR', '0 USD EUR', `1${'0'.repeat(20)} USD EUR`, 'x'.repeat(200)]) {
      expect(() => parseConversionRequest(bad), JSON.stringify(bad)).toThrowError(ToolError);
    }
  });
});

describe('currency_convert · API states', () => {
  it('converts using the primary provider and names the source', async () => {
    stubFetch((url) => {
      if (url.includes('frankfurter')) return json(FRANKFURTER_OK);
      throw new Error(`unexpected fetch: ${url}`);
    });
    const result = await currencyTool.run('100 USD to EUR', ctx());
    expect(result.html).toContain('86.618');
    expect(result.html).toContain('Frankfurter');
    expect(result.html).toContain('2026-08-12');
    expect(result.html).toMatch(/Last updated/);
  });

  it('falls back to the second provider when the first fails', async () => {
    stubFetch((url) => {
      if (url.includes('frankfurter')) return json({ error: 'boom' }, 503);
      if (url.includes('er-api')) return json(ERAPI_OK);
      throw new Error(`unexpected fetch: ${url}`);
    });
    const result = await currencyTool.run('10 USD to EUR', ctx());
    expect(result.html).toContain('ExchangeRate-API');
    expect(result.html).toContain('8.659');
  });

  it('fails loudly — with no number at all — when every provider errors', async () => {
    stubFetch(() => json({ error: 'down' }, 500));
    await expect(currencyTool.run('100 USD to EUR', ctx())).rejects.toThrowError(ToolError);
  });

  it('fails loudly on a timeout / network exception', async () => {
    stubFetch(() => {
      throw new Error('The operation was aborted');
    });
    const error = await Promise.resolve(currencyTool.run('100 USD to EUR', ctx())).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ToolError);
    expect((error as ToolError).en).toMatch(/never shows a cached guess|unavailable/i);
  });

  it('fails loudly on a well-formed but useless response', async () => {
    stubFetch((url) => {
      if (url.includes('frankfurter')) return json({ amount: 1, base: 'USD', rates: {} });
      return json({ result: 'error', 'error-type': 'unsupported-code' });
    });
    await expect(currencyTool.run('100 USD to XXX', ctx())).rejects.toThrowError(ToolError);
  });

  it('fails loudly on a non-JSON response', async () => {
    stubFetch(() => new Response('<html>maintenance</html>', { status: 200 }));
    await expect(currencyTool.run('100 USD to EUR', ctx())).rejects.toThrowError(ToolError);
  });

  it('rejects a negative or zero rate instead of trusting it', async () => {
    stubFetch((url) => {
      if (url.includes('frankfurter')) return json({ base: 'USD', date: '2026-08-12', rates: { EUR: 0 } });
      return json({ result: 'success', rates: { EUR: -1 } });
    });
    await expect(currencyTool.run('100 USD to EUR', ctx())).rejects.toThrowError(ToolError);
  });

  it('short-circuits an identity conversion without any network call', async () => {
    stubFetch(() => {
      throw new Error('no network expected');
    });
    const result = await currencyTool.run('100 USD to USD', ctx());
    expect(result.html).toContain('100');
  });

  it('caches a successful quote instead of re-querying', async () => {
    let calls = 0;
    stubFetch((url) => {
      calls += 1;
      if (url.includes('frankfurter')) return json(FRANKFURTER_OK);
      throw new Error('unexpected');
    });
    const shared = ctx();
    await currencyTool.run('1 USD to EUR', shared);
    await currencyTool.run('5 USD to EUR', shared);
    expect(calls).toBe(1);
  });

  it('never caches a failure', async () => {
    let calls = 0;
    stubFetch(() => {
      calls += 1;
      return json({ error: 'down' }, 500);
    });
    const shared = ctx();
    await Promise.resolve(currencyTool.run('1 USD to EUR', shared)).catch(() => undefined);
    await Promise.resolve(currencyTool.run('1 USD to EUR', shared)).catch(() => undefined);
    expect(calls).toBeGreaterThan(2); // both providers retried on the second run
  });

  it('translates toman to the official rial rate and says so', async () => {
    stubFetch((url) => {
      if (url.includes('frankfurter')) return json({ base: 'USD', date: '2026-08-12', rates: {} });
      return json({ result: 'success', base_code: 'USD', time_last_update_utc: 'x', rates: { IRR: 42000 } });
    });
    const result = await currencyTool.run('1 USD to IRT', ctx());
    expect(result.html).toContain('4,200');
    expect(result.html).toMatch(/10 rials/);
  });
});
