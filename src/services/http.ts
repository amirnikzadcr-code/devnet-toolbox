import { LIMITS } from '../config/index.js';
import { errNetwork, errTimeout } from '../utils/errors.js';

export interface SafeFetchOptions {
  method?: string;
  headers?: Record<string, string>;
  timeoutMs?: number;
  redirect?: 'follow' | 'manual' | 'error';
  maxBytes?: number;
  body?: string;
}

export interface SafeFetchResult {
  status: number;
  statusText: string;
  headers: Headers;
  body: string;
  url: string;
  elapsedMs: number;
  redirected: boolean;
  truncated: boolean;
}

const USER_AGENT = 'DevNetToolbox/1.0 (+https://github.com; Telegram bot; contact via bot)';

/**
 * Outbound fetch with hard timeout, byte cap and a fixed identifying User-Agent.
 * Every network tool must go through this function.
 */
export async function safeFetch(url: string, options: SafeFetchOptions = {}): Promise<SafeFetchResult> {
  const timeoutMs = options.timeoutMs ?? LIMITS.networkTimeoutMs;
  const maxBytes = options.maxBytes ?? LIMITS.maxRemoteBytes;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const started = Date.now();

  try {
    const response = await fetch(url, {
      method: options.method ?? 'GET',
      headers: { 'user-agent': USER_AGENT, accept: '*/*', ...options.headers },
      redirect: options.redirect ?? 'follow',
      signal: controller.signal,
      ...(options.body !== undefined ? { body: options.body } : {}),
    });

    let body = '';
    let truncated = false;
    if (response.body && options.method !== 'HEAD') {
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let received = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        received += value.byteLength;
        if (received > maxBytes) {
          body += decoder.decode(value.slice(0, Math.max(0, maxBytes - (received - value.byteLength))));
          truncated = true;
          await reader.cancel();
          break;
        }
        body += decoder.decode(value, { stream: true });
      }
    }

    return {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
      body,
      url: response.url || url,
      elapsedMs: Date.now() - started,
      redirected: response.redirected,
      truncated,
    };
  } catch (error) {
    if (error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError')) {
      throw errTimeout();
    }
    throw errNetwork(
      'برقراری ارتباط با مقصد ممکن نشد. ممکن است دامنه وجود نداشته باشد یا سرور پاسخ ندهد.',
      'Could not reach the target. The host may not exist or the server is not responding.',
    );
  } finally {
    clearTimeout(timer);
  }
}

/** Fetch + JSON parse with a friendly error. */
export async function fetchJson<T>(url: string, options: SafeFetchOptions = {}): Promise<{ data: T; result: SafeFetchResult }> {
  const result = await safeFetch(url, {
    ...options,
    headers: { accept: 'application/json', ...options.headers },
  });
  try {
    return { data: JSON.parse(result.body) as T, result };
  } catch {
    throw errNetwork(
      'پاسخ سرویس بیرونی قابل پردازش نبود. لطفاً بعداً دوباره تلاش کنید.',
      'The upstream service returned an unreadable response. Please try again later.',
    );
  }
}

/** Small KV-backed cache wrapper for network answers. */
export async function cached<T>(
  kv: KVNamespace | undefined,
  key: string,
  ttlSec: number,
  producer: () => Promise<T>,
): Promise<T> {
  if (!kv) return producer();
  try {
    const hit = await kv.get(key, 'json');
    if (hit !== null) return hit as T;
  } catch {
    /* cache miss on error — fall through */
  }
  const value = await producer();
  try {
    await kv.put(key, JSON.stringify(value), { expirationTtl: Math.max(60, ttlSec) });
  } catch {
    /* non-fatal */
  }
  return value;
}
