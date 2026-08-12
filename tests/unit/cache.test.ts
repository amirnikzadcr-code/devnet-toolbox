import { describe, expect, it } from 'vitest';

import { cached } from '../../src/services/http.js';
import { FakeKV } from '../helpers/fakes.js';

/**
 * Regression tests for a bug found during live production testing:
 * `ipwho.is` replies with HTTP 200 and `{"success":false,"message":"Rate limit exceeded"}`
 * when it throttles us. The old cache wrapper stored that failure for the whole
 * TTL, so a single throttled request broke the IP tool for every user until the
 * key expired. `cached()` now takes a `shouldCache` predicate.
 */
describe('cached()', () => {
  it('stores and replays a successful payload', async () => {
    const kv = new FakeKV() as unknown as KVNamespace;
    let calls = 0;
    const producer = async () => {
      calls += 1;
      return { success: true, city: 'San Jose' };
    };

    const first = await cached(kv, 'ipinfo:8.8.8.8', 300, producer);
    const second = await cached(kv, 'ipinfo:8.8.8.8', 300, producer);

    expect(first).toEqual({ success: true, city: 'San Jose' });
    expect(second).toEqual(first);
    expect(calls).toBe(1); // second call was served from KV
  });

  it('never persists a payload rejected by shouldCache', async () => {
    const kv = new FakeKV();
    const failure = { success: false, message: 'Rate limit exceeded' };

    const value = await cached(
      kv as unknown as KVNamespace,
      'ipinfo:1.1.1.1',
      300,
      async () => failure,
      (payload: typeof failure) => payload.success !== false,
    );

    expect(value).toEqual(failure); // caller still sees the upstream answer
    expect(await kv.get('ipinfo:1.1.1.1')).toBeNull(); // but nothing was cached
  });

  it('re-runs the producer instead of replaying a poisoned cache entry', async () => {
    const kv = new FakeKV();
    // Simulate an entry written by an older build that cached the failure.
    await kv.put('ipinfo:9.9.9.9', JSON.stringify({ success: false, message: 'Rate limit exceeded' }));

    let calls = 0;
    const value = await cached(
      kv as unknown as KVNamespace,
      'ipinfo:9.9.9.9',
      300,
      async () => {
        calls += 1;
        return { success: true, city: 'Berkeley' };
      },
      (payload: { success: boolean }) => payload.success !== false,
    );

    expect(calls).toBe(1);
    expect(value).toEqual({ success: true, city: 'Berkeley' });
    expect(JSON.parse((await kv.get('ipinfo:9.9.9.9')) as string)).toEqual({ success: true, city: 'Berkeley' });
  });

  it('falls back to the producer when no KV binding is available', async () => {
    const value = await cached(undefined, 'k', 300, async () => 42);
    expect(value).toBe(42);
  });

  it('defaults to caching everything when no predicate is given', async () => {
    const kv = new FakeKV();
    await cached(kv as unknown as KVNamespace, 'plain', 300, async () => ({ ok: true }));
    expect(JSON.parse((await kv.get('plain')) as string)).toEqual({ ok: true });
  });
});
