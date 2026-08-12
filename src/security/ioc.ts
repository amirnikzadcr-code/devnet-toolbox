/**
 * IOC Correlation Engine (requirement 5).
 *
 * Extracts indicators (IP / domain / URL / hash / e-mail) from arbitrary text
 * or binary blobs, scores each one, and renders the relationships as a tree.
 *
 * The extractor is deliberately conservative: binaries are full of byte
 * sequences that *look* like domains. Anything that fails a plausibility check
 * (known TLD, sane label shape) is dropped rather than reported with low
 * confidence, because a noisy IOC list is worse than a short one.
 */
import type { Ioc, IocKind, Severity } from './types.js';
import { severityRank } from './risk.js';
import { isIPv4 } from '../utils/validate.js';

/** TLDs that dominate abuse statistics or are free-registration. */
const SUSPICIOUS_TLDS = new Set([
  'tk', 'ml', 'ga', 'cf', 'gq', 'top', 'xyz', 'work', 'click', 'link', 'loan',
  'download', 'stream', 'bid', 'win', 'review', 'country', 'kim', 'party',
  'science', 'racing', 'date', 'faith', 'accountant', 'cricket', 'zip', 'mov',
  'rest', 'buzz', 'cam', 'surf', 'quest', 'monster', 'lol', 'sbs', 'cfd',
]);

/** Hosting patterns commonly used for throwaway payload delivery. */
const RISKY_HOST_PATTERNS: { pattern: RegExp; fa: string; en: string }[] = [
  { pattern: /\.ngrok(-free)?\.(io|app|dev)$/i, fa: 'تونل موقت ngrok', en: 'temporary ngrok tunnel' },
  { pattern: /\.(serveo|localtunnel|loca)\.(net|lt)$/i, fa: 'تونل معکوس عمومی', en: 'public reverse tunnel' },
  { pattern: /\.(duckdns|no-ip|ddns|dynu|hopto|zapto|sytes)\.(org|net|info|com)$/i, fa: 'DNS پویا (Dynamic DNS)', en: 'dynamic DNS provider' },
  { pattern: /^(pastebin|paste|ghostbin|hastebin|termbin)\./i, fa: 'سرویس اشتراک متن', en: 'paste service' },
  { pattern: /\.onion$/i, fa: 'سرویس مخفی Tor', en: 'Tor hidden service' },
  { pattern: /^(bit\.ly|tinyurl\.com|t\.co|goo\.gl|is\.gd|cutt\.ly|rb\.gy|shorturl\.at|rebrand\.ly)$/i, fa: 'کوتاه‌کننده‌ی لینک', en: 'URL shortener' },
  { pattern: /\.(workers\.dev|herokuapp\.com|repl\.co|glitch\.me|vercel\.app|netlify\.app|pages\.dev)$/i, fa: 'میزبانی رایگان قابل‌ثبت توسط هر کسی', en: 'free hosting anyone can register' },
];

/** Hosts that are normal in almost every app — reported as informational only. */
const BENIGN_HOST_PATTERNS: RegExp[] = [
  /(^|\.)google(apis|usercontent|tagmanager)?\.com$/i,
  /(^|\.)gstatic\.com$/i,
  /(^|\.)googlesource\.com$/i,
  /(^|\.)android\.com$/i,
  /(^|\.)firebaseio\.com$/i,
  /(^|\.)firebase(app|installations|remoteconfig)\.(com|googleapis\.com)$/i,
  /(^|\.)crashlytics\.com$/i,
  /(^|\.)apache\.org$/i,
  /(^|\.)w3\.org$/i,
  /(^|\.)xmlpull\.org$/i,
  /(^|\.)json\.org$/i,
  /(^|\.)oracle\.com$/i,
  /(^|\.)sun\.com$/i,
  /(^|\.)ietf\.org$/i,
  /(^|\.)example\.(com|org|net)$/i,
  /(^|\.)schemas\.android\.com$/i,
  /(^|\.)kotlinlang\.org$/i,
  /(^|\.)github\.com$/i,
  /(^|\.)mozilla\.org$/i,
  /(^|\.)openssl\.org$/i,
  /(^|\.)unicode\.org$/i,
  /(^|\.)microsoft\.com$/i,
  /(^|\.)apple\.com$/i,
];

/** A compact allowlist of TLDs; keeps binary noise out of the results. */
const KNOWN_TLDS = new Set([
  'com', 'net', 'org', 'io', 'dev', 'app', 'co', 'me', 'info', 'biz', 'edu', 'gov', 'mil', 'int',
  'ru', 'cn', 'de', 'uk', 'fr', 'jp', 'br', 'in', 'it', 'nl', 'au', 'ca', 'es', 'se', 'no', 'fi',
  'pl', 'ch', 'be', 'at', 'dk', 'cz', 'gr', 'pt', 'hu', 'ro', 'tr', 'ir', 'kr', 'tw', 'hk', 'sg',
  'ua', 'il', 'mx', 'ar', 'cl', 'za', 'nz', 'ie', 'id', 'th', 'vn', 'ph', 'my', 'pk', 'sa', 'ae',
  'eu', 'us', 'tv', 'cc', 'ws', 'to', 'gg', 'sh', 'st', 'so', 'ai', 'is', 'lu', 'li', 'lt', 'lv',
  'ee', 'bg', 'hr', 'si', 'sk', 'rs', 'by', 'kz', 'uz', 'ge', 'am', 'az', 'md', 'mk', 'al', 'ba',
  'cloud', 'online', 'site', 'store', 'shop', 'tech', 'space', 'website', 'live', 'life', 'world',
  'today', 'news', 'blog', 'wiki', 'agency', 'digital', 'network', 'systems', 'solutions', 'group',
  'pro', 'name', 'mobi', 'asia', 'tel', 'xxx', 'travel', 'jobs', 'coop', 'aero', 'museum', 'cat',
  ...SUSPICIOUS_TLDS,
]);

const URL_RE = /\bhttps?:\/\/[A-Za-z0-9\-._~:/?#[\]@!$&'()*+,;=%]{4,300}/g;
const DOMAIN_RE = /\b(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.){1,4}[a-zA-Z]{2,18}\b/g;
const IPV4_RE = /\b(?:\d{1,3}\.){3}\d{1,3}\b/g;
const EMAIL_RE = /\b[A-Za-z0-9._%+-]{1,64}@(?:[A-Za-z0-9-]{1,63}\.){1,4}[A-Za-z]{2,18}\b/g;
const HASH_RE = /\b(?:[a-fA-F0-9]{32}|[a-fA-F0-9]{40}|[a-fA-F0-9]{64})\b/g;

/** Version strings and resource ids masquerade as IPv4 — filter those out. */
function plausibleIp(value: string): boolean {
  if (!isIPv4(value)) return false;
  const octets = value.split('.').map(Number);
  const [a, b, c, d] = octets as [number, number, number, number];
  if (a === 0) return false;
  // 1.2.3.4-style placeholders and x.x.x.0/255 broadcast noise.
  if (a < 10 && b < 10 && c < 10 && d < 10) return false;
  if (octets.every((octet) => octet === octets[0])) return false;
  return true;
}

function plausibleDomain(value: string): boolean {
  const lower = value.toLowerCase();
  if (lower.length > 253) return false;
  const labels = lower.split('.');
  const tld = labels[labels.length - 1];
  if (!tld || !KNOWN_TLDS.has(tld)) return false;
  // Reject class/package names (`com.example.Foo` reversed reads as a domain,
  // but Java identifiers are camelCase and rarely all-lowercase leaf labels).
  if (labels.some((label) => label.length === 0 || label.length > 63)) return false;
  if (/^\d+$/.test(labels[0] ?? '')) return false;
  return true;
}

export function classifyHost(host: string): { severity: Severity; note?: { fa: string; en: string } } {
  const lower = host.toLowerCase();

  for (const { pattern, fa, en } of RISKY_HOST_PATTERNS) {
    if (pattern.test(lower)) {
      return {
        severity: 'medium',
        note: {
          fa: `${fa} — این نوع میزبانی برای زیرساخت موقت مهاجمان رایج است`,
          en: `${en} — commonly used for throwaway attacker infrastructure`,
        },
      };
    }
  }

  const tld = lower.split('.').pop() ?? '';
  if (SUSPICIOUS_TLDS.has(tld)) {
    return {
      severity: 'low',
      note: {
        fa: `دامنه‌ی سطح بالای «.${tld}» نرخ سوءاستفاده‌ی بالایی دارد`,
        en: `The ".${tld}" TLD has a high abuse rate`,
      },
    };
  }

  if (BENIGN_HOST_PATTERNS.some((pattern) => pattern.test(lower))) {
    return { severity: 'safe' };
  }

  return { severity: 'safe' };
}

export function isBenignHost(host: string): boolean {
  return BENIGN_HOST_PATTERNS.some((pattern) => pattern.test(host.toLowerCase()));
}

export interface ExtractOptions {
  /** Label recorded in `Ioc.sources`. */
  source: string;
  /** Cap per kind, to keep reports readable. */
  limit?: number;
  /** Skip hosts matching the benign allowlist. */
  skipBenign?: boolean;
}

/** Harvests every indicator kind from a text blob. */
export function extractIocs(text: string, options: ExtractOptions): Ioc[] {
  const limit = options.limit ?? 60;
  const out: Ioc[] = [];
  const seen = new Set<string>();

  const push = (kind: IocKind, rawValue: string, severity: Severity, confidence: number, note?: { fa: string; en: string }) => {
    const value = rawValue.trim();
    const key = `${kind}:${value.toLowerCase()}`;
    if (!value || seen.has(key)) return;
    seen.add(key);
    out.push({ kind, value, sources: [options.source], severity, confidence, ...(note ? { note } : {}) });
  };

  // ── URLs first: they also contribute their host as a domain/IP indicator.
  const urlHosts = new Set<string>();
  let count = 0;
  for (const match of text.matchAll(URL_RE)) {
    if (count++ >= limit) break;
    const raw = match[0].replace(/[).,;'"\]]+$/, '');
    let parsed: URL;
    try {
      parsed = new URL(raw);
    } catch {
      continue;
    }
    const host = parsed.hostname;
    urlHosts.add(host.toLowerCase());
    if (options.skipBenign && isBenignHost(host)) continue;

    const verdict = classifyHost(host);
    let severity = verdict.severity;
    let note = verdict.note;
    if (parsed.protocol === 'http:' && severityRank(severity) < severityRank('low')) {
      severity = 'low';
      note = note ?? {
        fa: 'ارتباط بدون رمزنگاری (HTTP)',
        en: 'Unencrypted HTTP endpoint',
      };
    }
    push('url', raw.slice(0, 300), severity, 85, note);
  }

  // ── Bare IPv4
  count = 0;
  for (const match of text.matchAll(IPV4_RE)) {
    if (count >= limit) break;
    const value = match[0];
    if (!plausibleIp(value)) continue;
    count++;
    push('ip', value, 'low', 60, {
      fa: 'آدرس IP ثابت در کد — ارتباط مستقیم بدون DNS',
      en: 'Hard-coded IP address — direct connection bypassing DNS',
    });
  }

  // ── E-mail
  count = 0;
  const emails = new Set<string>();
  for (const match of text.matchAll(EMAIL_RE)) {
    if (count >= Math.min(limit, 20)) break;
    const value = match[0];
    const domain = value.split('@')[1] ?? '';
    if (!plausibleDomain(domain)) continue;
    count++;
    emails.add(domain.toLowerCase());
    push('email', value, 'safe', 70);
  }

  // ── Domains.
  //
  // Hosts seen inside a URL are emitted as domain indicators too, rather than
  // skipped: the relationship tree groups URLs under their domain, so dropping
  // the host leaves several related URLs as unconnected orphans and hides
  // exactly the shared infrastructure the tree exists to reveal.
  count = 0;
  for (const host of urlHosts) {
    if (count >= limit) break;
    if (!plausibleDomain(host) && !isIPv4(host)) continue;
    if (isIPv4(host)) continue; // already recorded as an IP indicator
    if (options.skipBenign && isBenignHost(host)) continue;
    count++;
    const verdict = classifyHost(host);
    push('domain', host, verdict.severity, 80, verdict.note);
  }

  for (const match of text.matchAll(DOMAIN_RE)) {
    if (count >= limit) break;
    const value = match[0].toLowerCase().replace(/\.$/, '');
    if (urlHosts.has(value) || emails.has(value)) continue;
    if (!plausibleDomain(value)) continue;
    if (options.skipBenign && isBenignHost(value)) continue;
    count++;
    const verdict = classifyHost(value);
    push('domain', value, verdict.severity, 65, verdict.note);
  }

  // ── Hashes
  count = 0;
  for (const match of text.matchAll(HASH_RE)) {
    if (count >= Math.min(limit, 15)) break;
    count++;
    const value = match[0].toLowerCase();
    const kindNote =
      value.length === 32 ? 'MD5' : value.length === 40 ? 'SHA-1' : 'SHA-256';
    push('hash', value, 'safe', 50, {
      fa: `مقدار درهم‌ساز ${kindNote} یافت‌شده در محتوا`,
      en: `${kindNote} digest observed in content`,
    });
  }

  return out;
}

/**
 * Extracts printable ASCII runs from a binary buffer (the classic `strings`
 * utility). Needed because DEX files store URLs as raw MUTF-8.
 *
 * `maxTotal` must comfortably exceed a whole DEX: the string pool sits *after*
 * the bytecode, so truncating the buffer throws away exactly the part worth
 * reading. Measured on a real 8.7 MB DEX, a 4 MB cap yielded 29 KB of strings
 * versus 1.9 MB for the full file — and missed every API indicator.
 */
export function binaryStrings(data: Uint8Array, minLength = 6, maxTotal = 32 * 1024 * 1024): string {
  const parts: string[] = [];
  let current: number[] = [];
  const end = Math.min(data.length, maxTotal);

  for (let i = 0; i < end; i++) {
    const byte = data[i] as number;
    if (byte >= 0x20 && byte <= 0x7e) {
      current.push(byte);
      if (current.length > 2048) {
        parts.push(String.fromCharCode(...current));
        current = [];
      }
    } else {
      if (current.length >= minLength) parts.push(String.fromCharCode(...current));
      current = [];
    }
  }
  if (current.length >= minLength) parts.push(String.fromCharCode(...current));
  return parts.join('\n');
}

// ─── Relationship tree ────────────────────────────────────────────────────

const KIND_ICON: Record<IocKind, string> = {
  url: '🔗',
  domain: '🌐',
  ip: '📡',
  hash: '#️⃣',
  email: '📧',
};

export const iocIcon = (kind: IocKind): string => KIND_ICON[kind];

export interface IocNode {
  ioc: Ioc;
  children: IocNode[];
}

/**
 * Groups indicators into a tree: each domain becomes a parent of the URLs that
 * resolve to it and of e-mail addresses on that domain, so the report shows
 * *relationships* rather than a flat list.
 */
export function buildIocTree(iocs: Ioc[]): IocNode[] {
  const byDomain = new Map<string, IocNode>();
  const orphans: IocNode[] = [];

  const hostOf = (ioc: Ioc): string | null => {
    if (ioc.kind === 'domain') return ioc.value.toLowerCase();
    if (ioc.kind === 'url') {
      try {
        return new URL(ioc.value).hostname.toLowerCase();
      } catch {
        return null;
      }
    }
    if (ioc.kind === 'email') return (ioc.value.split('@')[1] ?? '').toLowerCase();
    return null;
  };

  for (const ioc of iocs) {
    if (ioc.kind === 'domain') {
      const key = ioc.value.toLowerCase();
      if (!byDomain.has(key)) byDomain.set(key, { ioc, children: [] });
    }
  }

  for (const ioc of iocs) {
    if (ioc.kind === 'domain') continue;
    const host = hostOf(ioc);
    const parent = host ? byDomain.get(host) : undefined;
    if (parent) parent.children.push({ ioc, children: [] });
    else orphans.push({ ioc, children: [] });
  }

  const roots = [...byDomain.values(), ...orphans];
  // Propagate the worst child severity upward so a bad URL surfaces its domain.
  for (const node of roots) {
    for (const child of node.children) {
      if (severityRank(child.ioc.severity) > severityRank(node.ioc.severity)) {
        node.ioc.severity = child.ioc.severity;
      }
    }
  }
  return roots.sort(
    (a, b) =>
      severityRank(b.ioc.severity) - severityRank(a.ioc.severity) ||
      b.children.length - a.children.length ||
      a.ioc.value.localeCompare(b.ioc.value),
  );
}
