import { defineTool } from '../types.js';
import { DIVIDER, escapeHtml, mono, asString } from '../../utils/text.js';
import { cached, fetchJson } from '../../services/http.js';
import { isIPv4, isIPv6, parseHostInput } from '../../utils/validate.js';
import { errInvalidInput, errNetwork } from '../../utils/errors.js';
import { STATE_TTL } from '../../config/index.js';

const DOH_ENDPOINT = 'https://cloudflare-dns.com/dns-query';

export interface DohAnswer {
  name: string;
  type: number;
  TTL: number;
  data: string;
}
export interface DohResponse {
  Status: number;
  Answer?: DohAnswer[];
  Authority?: DohAnswer[];
  Comment?: string;
}

export const DNS_TYPE_NAMES: Record<number, string> = {
  1: 'A', 2: 'NS', 5: 'CNAME', 6: 'SOA', 12: 'PTR', 15: 'MX', 16: 'TXT',
  28: 'AAAA', 33: 'SRV', 257: 'CAA', 99: 'SPF', 65: 'HTTPS',
};

export const DNS_RCODES: Record<number, { fa: string; en: string }> = {
  0: { fa: 'موفق', en: 'NOERROR' },
  1: { fa: 'خطای قالب پرس‌وجو', en: 'FORMERR' },
  2: { fa: 'خطای داخلی سرور DNS', en: 'SERVFAIL' },
  3: { fa: 'دامنه وجود ندارد', en: 'NXDOMAIN' },
  4: { fa: 'پشتیبانی نمی‌شود', en: 'NOTIMP' },
  5: { fa: 'پرس‌وجو رد شد', en: 'REFUSED' },
};

export async function dnsQuery(
  name: string,
  type: string,
  kv?: KVNamespace,
): Promise<DohResponse> {
  const url = `${DOH_ENDPOINT}?name=${encodeURIComponent(name)}&type=${encodeURIComponent(type)}`;
  return cached(
    kv,
    `dns:${type}:${name}`,
    STATE_TTL.networkCacheSec,
    async () => {
      const { data } = await fetchJson<DohResponse>(url, {
        headers: { accept: 'application/dns-json' },
      });
      return data;
    },
    // DoH Status 0 = NOERROR. Server failures (2 = SERVFAIL) are transient, so
    // only successful resolutions are worth keeping.
    (data) => data.Status === 0,
  );
}

const SUPPORTED_TYPES = ['A', 'AAAA', 'MX', 'TXT', 'NS', 'CNAME', 'SOA', 'CAA', 'SRV'];

export const dnsLookup = defineTool({
  id: 'dns_lookup',
  category: 'network',
  icon: '🔍',
  network: true,
  quick: true,
  needsInput: true,
  title: { fa: 'جست‌وجوی DNS', en: 'DNS Lookup' },
  description: {
    fa: 'رکوردهای DNS یک دامنه را از طریق DNS-over-HTTPS کلودفلر (1.1.1.1) می‌خواند و نوع رکورد، مقدار و TTL را نمایش می‌دهد.',
    en: 'Resolves DNS records through Cloudflare DNS-over-HTTPS (1.1.1.1), showing record type, value and TTL.',
  },
  usage: {
    fa: 'دامنه را ارسال کنید (پیش‌فرض A). برای نوع خاص: <code>example.com MX</code>\nانواع پشتیبانی‌شده: A, AAAA, MX, TXT, NS, CNAME, SOA, CAA, SRV',
    en: 'Send a domain (defaults to A). For a specific type: <code>example.com MX</code>\nSupported: A, AAAA, MX, TXT, NS, CNAME, SOA, CAA, SRV',
  },
  example: {
    fa: 'ورودی: example.com MX\nخروجی: فهرست رکوردهای MX با اولویت و TTL',
    en: 'Input: example.com MX\nOutput: MX records with priority and TTL',
  },
  limitations: {
    fa: 'فقط دامنه‌های عمومی. نتایج تا ۵ دقیقه کش می‌شوند. سقف ۸ درخواست شبکه در دقیقه.',
    en: 'Public domains only. Results are cached for up to 5 minutes. Limit: 8 network requests/minute.',
  },
  run: async (input, ctx) => {
    const fa = ctx.lang === 'fa';
    const parts = input.trim().split(/\s+/);
    const host = parseHostInput(parts[0] ?? '');
    const type = (parts[1] ?? 'A').toUpperCase();
    if (!SUPPORTED_TYPES.includes(type)) {
      throw errInvalidInput(
        `نوع رکورد پشتیبانی نمی‌شود. انواع مجاز: ${SUPPORTED_TYPES.join(', ')}`,
        `Unsupported record type. Allowed: ${SUPPORTED_TYPES.join(', ')}`,
      );
    }
    const data = await dnsQuery(host, type, ctx.cache);
    const rcode = DNS_RCODES[data.Status] ?? { fa: `کد ${data.Status}`, en: `RCODE ${data.Status}` };
    if (data.Status !== 0) {
      return {
        html: `❌ <b>${fa ? 'پرس‌وجو ناموفق' : 'Query failed'}</b>\n${DIVIDER}\n🌐 ${mono(host)} • ${type}\n🧾 ${fa ? rcode.fa : rcode.en}`,
      };
    }
    const answers = data.Answer ?? [];
    if (!answers.length) {
      return {
        html: `🔍 ${fa ? 'رکوردی از نوع' : 'No'} <b>${type}</b> ${fa ? 'برای' : 'records found for'} ${mono(host)} ${fa ? 'یافت نشد.' : ''}`,
      };
    }
    const rows = answers
      .slice(0, 25)
      .map((a) => {
        const typeName = DNS_TYPE_NAMES[a.type] ?? String(a.type);
        return `• <b>${typeName}</b> ${escapeHtml(asString(a.data).slice(0, 200))}\n  ↳ TTL ${a.TTL}s`;
      })
      .join('\n');
    return {
      html: `🌐 <b>${escapeHtml(host)}</b> — ${type}\n${DIVIDER}\n${rows}\n${DIVIDER}\n✅ ${answers.length} ${fa ? 'رکورد' : 'record(s)'} • ${fa ? 'منبع' : 'resolver'}: Cloudflare 1.1.1.1`,
    };
  },
});

export const reverseDns = defineTool({
  id: 'reverse_dns',
  category: 'network',
  icon: '↩️',
  network: true,
  needsInput: true,
  title: { fa: 'DNS معکوس', en: 'Reverse DNS' },
  description: {
    fa: 'با پرس‌وجوی رکورد PTR، نام میزبان مرتبط با یک آدرس IPv4 یا IPv6 را پیدا می‌کند.',
    en: 'Finds the hostname associated with an IPv4 or IPv6 address by querying its PTR record.',
  },
  usage: { fa: 'یک آدرس IP ارسال کنید؛ مثلاً <code>1.1.1.1</code>', en: 'Send an IP address, e.g. <code>1.1.1.1</code>' },
  example: { fa: 'ورودی: 1.1.1.1\nخروجی: one.one.one.one', en: 'Input: 1.1.1.1\nOutput: one.one.one.one' },
  limitations: {
    fa: 'بسیاری از IPها رکورد PTR ندارند. IPهای خصوصی مجاز نیستند.',
    en: 'Many IPs have no PTR record. Private IPs are not allowed.',
  },
  run: async (input, ctx) => {
    const fa = ctx.lang === 'fa';
    const ip = parseHostInput(input);
    if (!isIPv4(ip) && !isIPv6(ip)) {
      throw errInvalidInput('لطفاً یک آدرس IP معتبر ارسال کنید.', 'Please provide a valid IP address.');
    }
    const arpa = isIPv4(ip)
      ? `${ip.split('.').reverse().join('.')}.in-addr.arpa`
      : `${expandIPv6(ip).split('').reverse().join('.')}.ip6.arpa`;
    const data = await dnsQuery(arpa, 'PTR', ctx.cache);
    const answers = (data.Answer ?? []).filter((a) => a.type === 12);
    if (!answers.length) {
      return { html: `🔍 ${fa ? 'رکورد PTR برای' : 'No PTR record for'} ${mono(ip)} ${fa ? 'یافت نشد.' : ''}` };
    }
    return {
      html: `↩️ <b>${escapeHtml(ip)}</b>\n${DIVIDER}\n${answers.map((a) => `• ${mono(a.data)}`).join('\n')}\n${DIVIDER}\n🧭 ${mono(arpa)}`,
    };
  },
});

/** Expands a compressed IPv6 address into 32 hex nibbles. */
export function expandIPv6(ip: string): string {
  const [head = '', tail = ''] = ip.toLowerCase().split('::');
  const headParts = head ? head.split(':').filter(Boolean) : [];
  const tailParts = tail ? tail.split(':').filter(Boolean) : [];
  const missing = 8 - headParts.length - tailParts.length;
  if (missing < 0 && ip.includes('::')) {
    throw errNetwork('آدرس IPv6 نامعتبر است.', 'Invalid IPv6 address.');
  }
  const groups = ip.includes('::')
    ? [...headParts, ...Array<string>(Math.max(0, missing)).fill('0'), ...tailParts]
    : ip.split(':');
  return groups.map((g) => g.padStart(4, '0')).join('');
}
