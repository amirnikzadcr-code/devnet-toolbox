import { RATE_LIMIT } from '../config/index.js';

export type Bucket = keyof typeof RATE_LIMIT;

export interface RateVerdict {
  allowed: boolean;
  remaining: number;
  retryAfterSec: number;
}

interface Counter {
  count: number;
  resetAt: number;
}

/**
 * Fixed-window counter in KV. Chosen over a sliding window on purpose:
 * one read + one write per check keeps the hot path cheap at the edge.
 */
export async function consume(kv: KVNamespace, bucket: Bucket, userId: number): Promise<RateVerdict> {
  const rule = RATE_LIMIT[bucket];
  const now = Math.floor(Date.now() / 1000);
  const windowStart = Math.floor(now / rule.windowSec) * rule.windowSec;
  const key = `rl:${bucket}:${userId}:${windowStart}`;

  let counter: Counter = { count: 0, resetAt: windowStart + rule.windowSec };
  try {
    const stored = await kv.get<Counter>(key, 'json');
    if (stored && typeof stored.count === 'number') counter = stored;
  } catch {
    // KV unavailable → fail open, the Worker itself is still protected by Cloudflare.
    return { allowed: true, remaining: rule.max, retryAfterSec: 0 };
  }

  if (counter.count >= rule.max) {
    return { allowed: false, remaining: 0, retryAfterSec: Math.max(1, counter.resetAt - now) };
  }

  counter.count += 1;
  try {
    await kv.put(key, JSON.stringify(counter), { expirationTtl: Math.max(60, rule.windowSec + 10) });
  } catch {
    /* non-fatal */
  }
  return { allowed: true, remaining: rule.max - counter.count, retryAfterSec: 0 };
}

/** Network tools consume the minute bucket AND the daily bucket. */
export async function consumeNetwork(kv: KVNamespace, userId: number): Promise<RateVerdict> {
  const minute = await consume(kv, 'network', userId);
  if (!minute.allowed) return minute;
  const daily = await consume(kv, 'networkDaily', userId);
  return daily.allowed ? minute : daily;
}
