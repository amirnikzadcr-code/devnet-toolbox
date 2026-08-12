import { BLOCKED_HOST_PATTERNS, LIMITS } from '../config/index.js';
import { errForbidden, errInvalidInput, errTooLarge } from './errors.js';

export function assertNotEmpty(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) {
    throw errInvalidInput('ورودی خالی است. لطفاً مقدار معتبری ارسال کنید.', 'Input is empty.');
  }
  return trimmed;
}

export function assertMaxLength(input: string, max: number = LIMITS.maxInputChars): string {
  if (input.length > max) {
    throw errTooLarge(
      `حجم ورودی بیش از حد مجاز است (حداکثر ${max} کاراکتر).`,
      `Input exceeds the maximum of ${max} characters.`,
    );
  }
  return input;
}

const DOMAIN_RE = /^(?=.{1,253}$)(?!-)[a-z0-9-]{1,63}(?<!-)(\.(?!-)[a-z0-9-]{1,63}(?<!-))*$/i;
const IPV4_RE = /^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}$/;
const IPV6_RE = /^(([0-9a-f]{1,4}:){7}[0-9a-f]{1,4}|::|([0-9a-f]{1,4}:){1,7}:|:(:[0-9a-f]{1,4}){1,7}|([0-9a-f]{1,4}:){1,6}(:[0-9a-f]{1,4}){1,1}|([0-9a-f]{1,4}:){1,5}(:[0-9a-f]{1,4}){1,2}|([0-9a-f]{1,4}:){1,4}(:[0-9a-f]{1,4}){1,3}|([0-9a-f]{1,4}:){1,3}(:[0-9a-f]{1,4}){1,4}|([0-9a-f]{1,4}:){1,2}(:[0-9a-f]{1,4}){1,5})$/i;

export const isIPv4 = (value: string): boolean => IPV4_RE.test(value);
export const isIPv6 = (value: string): boolean => IPV6_RE.test(value);
export const isIP = (value: string): boolean => isIPv4(value) || isIPv6(value);
export const isDomain = (value: string): boolean => DOMAIN_RE.test(value) && value.includes('.');

/** Rejects private/loopback/link-local targets (SSRF & internal-scan protection). */
export function assertPublicHost(host: string): string {
  const clean = host.trim().toLowerCase().replace(/^\[|\]$/g, '');
  if (!clean) {
    throw errInvalidInput('میزبان (host) نامعتبر است.', 'Invalid host.');
  }
  for (const pattern of BLOCKED_HOST_PATTERNS) {
    if (pattern.test(clean)) {
      throw errForbidden(
        'آدرس‌های داخلی، لوکال و شبکه‌های خصوصی مجاز نیستند.',
        'Internal, loopback and private-network targets are not allowed.',
      );
    }
  }
  return clean;
}

/** Parses & validates a hostname or a domain, returning a safe lowercase host. */
export function parseHostInput(raw: string): string {
  let value = assertNotEmpty(raw).toLowerCase();
  if (value.includes('://')) {
    try {
      value = new URL(value).hostname;
    } catch {
      throw errInvalidInput('آدرس واردشده معتبر نیست.', 'The provided URL is not valid.');
    }
  }
  value = value.replace(/^\/+/, '').split('/')[0] ?? '';
  value = value.split('@').pop() ?? value;
  value = value.replace(/:\d+$/, '');
  if (!isDomain(value) && !isIP(value)) {
    throw errInvalidInput(
      'دامنه یا IP معتبر نیست. نمونه صحیح: example.com',
      'Not a valid domain or IP. Example: example.com',
    );
  }
  return assertPublicHost(value);
}

/** Parses & validates an http(s) URL for outbound requests. */
export function parseHttpUrl(raw: string): URL {
  const value = assertNotEmpty(raw);
  // Reject any explicit non-http(s) scheme up front, otherwise prefixing
  // "https://" would silently turn "ftp://example.com" into host "ftp".
  const schemeMatch = /^([a-z][a-z0-9+.-]*):/i.exec(value);
  if (schemeMatch?.[1] && !/^https?$/i.test(schemeMatch[1])) {
    throw errInvalidInput('فقط پروتکل‌های http و https پشتیبانی می‌شوند.', 'Only http/https are supported.');
  }
  const candidate = /^https?:\/\//i.test(value) ? value : `https://${value}`;
  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    throw errInvalidInput(
      'آدرس معتبر نیست. نمونه صحیح: https://example.com',
      'Invalid URL. Example: https://example.com',
    );
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw errInvalidInput('فقط پروتکل‌های http و https پشتیبانی می‌شوند.', 'Only http/https are supported.');
  }
  if (url.port && !['', '80', '443', '8080', '8443'].includes(url.port)) {
    throw errForbidden(
      'فقط پورت‌های استاندارد وب (80، 443، 8080، 8443) مجاز هستند.',
      'Only standard web ports (80, 443, 8080, 8443) are allowed.',
    );
  }
  assertPublicHost(url.hostname);
  return url;
}

export function parsePositiveInt(raw: string, fallback: number, min: number, max: number): number {
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}
