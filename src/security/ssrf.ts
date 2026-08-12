/**
 * SSRF hardening (requirement 16).
 *
 * The existing `assertPublicHost` in utils/validate.ts guards the *initial*
 * host. That is not enough: `safeFetch` defaults to `redirect: 'follow'`, so
 * `https://attacker.test/go` → `302 http://169.254.169.254/latest/meta-data/`
 * would reach cloud metadata with the platform following the hop internally,
 * completely bypassing the check.
 *
 * `safeFetchGuarded` below follows redirects *manually*, re-validating every
 * hop, which closes that bypass.
 */
import { LIMITS } from '../config/index.js';
import { errForbidden, errNetwork } from '../utils/errors.js';
import { assertPublicHost, isIPv4 } from '../utils/validate.js';
import { safeFetch, type SafeFetchOptions, type SafeFetchResult } from '../services/http.js';

/**
 * Extra host patterns beyond `BLOCKED_HOST_PATTERNS`, covering cloud metadata
 * services and internal DNS suffixes that the original list did not enumerate.
 */
export const METADATA_HOST_PATTERNS: readonly RegExp[] = [
  /^169\.254\.169\.254$/, // AWS / GCP / Azure / DigitalOcean IMDS
  /^metadata\.google\.internal$/i,
  /^metadata\.goog$/i,
  /^100\.100\.100\.200$/, // Alibaba Cloud
  /^169\.254\.170\.2$/, // AWS ECS task metadata
  /^fd00:ec2::254$/i, // AWS IMDS over IPv6
  /^\[?fd00:ec2::254\]?$/i,
  /\.consul$/i,
  /\.intranet$/i,
  /\.intra$/i,
  /\.corp$/i,
  /\.home$/i,
  /\.lan$/i,
  /\.private$/i,
  /^0x[0-9a-f]+$/i, // hex-encoded IP literal (0x7f000001)
  /^\d{8,10}$/, // decimal-encoded IP literal (2130706433 = 127.0.0.1)
];

/** IPv4 ranges that must never be contacted, as [firstOctet, predicate] tests. */
function isPrivateIPv4(ip: string): boolean {
  const parts = ip.split('.').map((part) => Number.parseInt(part, 10));
  const [a, b] = parts;
  if (a === undefined || b === undefined || parts.length !== 4) return false;
  if (parts.some((n) => !Number.isFinite(n) || n < 0 || n > 255)) return false;

  if (a === 0) return true; // "this" network
  if (a === 10) return true; // 10.0.0.0/8
  if (a === 127) return true; // loopback
  if (a === 169 && b === 254) return true; // link-local + IMDS
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
  if (a === 192 && b === 168) return true; // 192.168.0.0/16
  if (a === 192 && b === 0) return true; // 192.0.0.0/24 IETF protocol assignments
  if (a === 100 && b >= 64 && b <= 127) return true; // 100.64.0.0/10 CGNAT
  if (a === 198 && (b === 18 || b === 19)) return true; // benchmarking
  if (a >= 224) return true; // multicast + reserved + broadcast
  return false;
}

function isPrivateIPv6(host: string): boolean {
  const clean = host.replace(/^\[|\]$/g, '').toLowerCase();
  if (clean === '::1' || clean === '::') return true;
  if (/^f[cd][0-9a-f]{2}:/.test(clean)) return true; // unique local fc00::/7
  if (/^fe[89ab][0-9a-f]:/.test(clean)) return true; // link-local fe80::/10
  // IPv4-mapped / IPv4-compatible: ::ffff:127.0.0.1
  const mapped = /^::(ffff:)?(\d{1,3}(?:\.\d{1,3}){3})$/.exec(clean);
  if (mapped?.[2]) return isPrivateIPv4(mapped[2]);
  return false;
}

/**
 * Full SSRF validation of a single host. Throws `errForbidden` when the target
 * is internal. Complements (does not replace) `assertPublicHost`.
 */
export function assertSafeHost(host: string): string {
  const clean = host.trim().toLowerCase().replace(/^\[|\]$/g, '');
  if (!clean) {
    throw errForbidden('میزبان نامعتبر است.', 'Invalid host.');
  }

  // Reuse the project-wide blocklist first (no duplicate logic).
  assertPublicHost(clean);

  for (const pattern of METADATA_HOST_PATTERNS) {
    if (pattern.test(clean)) {
      throw errForbidden(
        'دسترسی به سرویس‌های متادیتای ابری و شبکه‌های داخلی مجاز نیست.',
        'Cloud metadata services and internal networks are not allowed.',
      );
    }
  }

  if (isIPv4(clean) && isPrivateIPv4(clean)) {
    throw errForbidden(
      'آدرس‌های IP خصوصی، لوکال و رزروشده مجاز نیستند.',
      'Private, loopback and reserved IP addresses are not allowed.',
    );
  }

  if (clean.includes(':') && isPrivateIPv6(clean)) {
    throw errForbidden(
      'آدرس‌های IPv6 داخلی و لوکال مجاز نیستند.',
      'Internal and loopback IPv6 addresses are not allowed.',
    );
  }

  return clean;
}

/** Validates a URL object end-to-end (scheme, port, host). */
export function assertSafeUrl(url: URL): URL {
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw errForbidden('فقط پروتکل‌های http و https مجاز هستند.', 'Only http/https are allowed.');
  }
  if (url.username || url.password) {
    throw errForbidden(
      'آدرس حاوی اطلاعات ورود (userinfo) پذیرفته نمی‌شود.',
      'URLs containing userinfo credentials are rejected.',
    );
  }
  assertSafeHost(url.hostname);
  return url;
}

export interface GuardedFetchResult extends SafeFetchResult {
  /** Every URL visited, in order. `chain[0]` is the original request. */
  chain: string[];
  /** Status codes of each redirect hop. */
  hopStatuses: number[];
}

const MAX_REDIRECTS = 5;

/**
 * `safeFetch` with per-hop SSRF revalidation.
 *
 * Redirects are followed manually (`redirect: 'manual'`) so each `Location`
 * is parsed, resolved against the current URL and re-checked with
 * `assertSafeUrl` before the next request is issued.
 */
export async function safeFetchGuarded(
  rawUrl: string,
  options: SafeFetchOptions = {},
): Promise<GuardedFetchResult> {
  let current: URL;
  try {
    current = new URL(rawUrl);
  } catch {
    throw errNetwork('آدرس معتبر نیست.', 'Invalid URL.');
  }
  assertSafeUrl(current);

  const chain: string[] = [current.toString()];
  const hopStatuses: number[] = [];

  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    const result = await safeFetch(current.toString(), {
      ...options,
      redirect: 'manual',
      maxBytes: options.maxBytes ?? LIMITS.maxRemoteBytes,
    });

    const isRedirect = result.status >= 300 && result.status < 400;
    const location = result.headers.get('location');

    if (!isRedirect || !location) {
      return { ...result, chain, hopStatuses };
    }

    hopStatuses.push(result.status);

    if (hop === MAX_REDIRECTS) {
      throw errNetwork(
        `تعداد تغییر مسیرها از حد مجاز (${MAX_REDIRECTS}) بیشتر شد.`,
        `Too many redirects (limit ${MAX_REDIRECTS}).`,
      );
    }

    let next: URL;
    try {
      next = new URL(location, current); // resolves relative Location headers
    } catch {
      throw errNetwork('هدر Location در پاسخ نامعتبر بود.', 'The Location header was not a valid URL.');
    }

    // ── The critical check: every hop is validated, not just the first one.
    assertSafeUrl(next);

    current = next;
    chain.push(current.toString());
  }

  throw errNetwork('تغییر مسیر بیش از حد.', 'Too many redirects.');
}
