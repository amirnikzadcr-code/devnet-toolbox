import { defineTool } from '../types.js';
import { DIVIDER, escapeHtml, isoUtc, mono, asString } from '../../utils/text.js';
import { cached, fetchJson } from '../../services/http.js';
import { assertPublicHost, isIP, parseHostInput } from '../../utils/validate.js';
import { STATE_TTL } from '../../config/index.js';
import { errInvalidInput, errNetwork } from '../../utils/errors.js';
import { dnsQuery } from './dns.js';

interface RdapEvent {
  eventAction?: string;
  eventDate?: string;
}
interface RdapEntity {
  roles?: string[];
  vcardArray?: unknown;
}
interface RdapResponse {
  ldhName?: string;
  handle?: string;
  status?: string[];
  events?: RdapEvent[];
  entities?: RdapEntity[];
  nameservers?: { ldhName?: string }[];
  secureDNS?: { delegationSigned?: boolean };
  errorCode?: number;
  title?: string;
}

function entityName(entity: RdapEntity | undefined): string | null {
  if (!entity) return null;
  const vcard = entity.vcardArray;
  if (!Array.isArray(vcard) || vcard.length < 2) return null;
  const props = vcard[1];
  if (!Array.isArray(props)) return null;
  for (const prop of props) {
    if (Array.isArray(prop) && prop[0] === 'fn' && typeof prop[3] === 'string') return prop[3];
  }
  return null;
}

function eventDate(events: RdapEvent[] | undefined, action: string): number | null {
  const found = events?.find((e) => e.eventAction === action);
  if (!found?.eventDate) return null;
  const ts = Date.parse(found.eventDate);
  return Number.isFinite(ts) ? ts : null;
}

const STATUS_FA: Record<string, string> = {
  'client transfer prohibited': 'انتقال توسط ثبت‌کننده قفل شده',
  'client delete prohibited': 'حذف قفل شده',
  'client update prohibited': 'ویرایش قفل شده',
  'server transfer prohibited': 'انتقال توسط رجیستری قفل شده',
  active: 'فعال',
  ok: 'سالم',
};

export const domainInfoTool = defineTool({
  id: 'domain_info',
  category: 'network',
  icon: '🏷',
  network: true,
  needsInput: true,
  title: { fa: 'اطلاعات دامنه', en: 'Domain Information' },
  description: {
    fa: 'اطلاعات ثبت دامنه را از پروتکل رسمی RDAP (جایگزین مدرن WHOIS) می‌گیرد: ثبت‌کننده، تاریخ ثبت، تاریخ انقضا، آخرین به‌روزرسانی، وضعیت قفل‌ها، DNSSEC و نیم‌سرورها. رکوردهای MX و NS نیز از DNS خوانده می‌شود.',
    en: 'Fetches registration data via the official RDAP protocol (the modern WHOIS): registrar, creation/expiry/update dates, lock statuses, DNSSEC and nameservers. MX and NS records are read from DNS as well.',
  },
  usage: { fa: 'یک دامنه ارسال کنید؛ مثلاً <code>cloudflare.com</code>', en: 'Send a domain, e.g. <code>cloudflare.com</code>' },
  example: {
    fa: 'ورودی: cloudflare.com\nخروجی: ثبت‌کننده، تاریخ ثبت ۲۰۰۹، انقضا، ۴ نیم‌سرور',
    en: 'Input: cloudflare.com\nOutput: registrar, created 2009, expiry, 4 nameservers',
  },
  limitations: {
    fa: 'همه‌ی پسوندها RDAP ندارند (مثلاً برخی ccTLDها)؛ در آن صورت فقط داده‌های DNS نمایش داده می‌شود. اطلاعات شخصی مالک به دلیل GDPR معمولاً مخفی است و ما هم آن را نمایش نمی‌دهیم.',
    en: 'Not every TLD supports RDAP (some ccTLDs); in that case only DNS data is shown. Owner personal data is redacted under GDPR and is never displayed here.',
  },
  run: async (input, ctx) => {
    const fa = ctx.lang === 'fa';
    const host = assertPublicHost(parseHostInput(input));
    if (isIP(host)) {
      throw errInvalidInput(
        'برای IP از ابزار «اطلاعات IP» استفاده کنید؛ این ابزار مخصوص دامنه است.',
        'Use the “IP Information” tool for IP addresses; this tool expects a domain.',
      );
    }
    const labels = host.split('.');
    if (labels.length < 2) {
      throw errInvalidInput('دامنه باید حداقل یک نقطه داشته باشد.', 'A domain must contain at least one dot.');
    }
    const registrable = labels.slice(-2).join('.');

    const rdap = await cached(
      ctx.cache,
      `rdap:${registrable}`,
      STATE_TTL.networkCacheSec,
      async () => {
        try {
          const { data } = await fetchJson<RdapResponse>(`https://rdap.org/domain/${encodeURIComponent(registrable)}`);
          return data;
        } catch {
          return { errorCode: 404 } as RdapResponse;
        }
      },
      // A lookup failure is transient — keep it out of the cache so the next try is fresh.
      (data) => data.errorCode === undefined,
    );

    const [ns, mx] = await Promise.all([
      dnsQuery(host, 'NS', ctx.cache).catch(() => null),
      dnsQuery(host, 'MX', ctx.cache).catch(() => null),
    ]);

    const created = eventDate(rdap.events, 'registration');
    const expires = eventDate(rdap.events, 'expiration');
    const updated = eventDate(rdap.events, 'last changed') ?? eventDate(rdap.events, 'last update of RDAP database');
    const registrar = entityName(rdap.entities?.find((e) => e.roles?.includes('registrar'))) ?? null;
    const ageDays = created ? Math.floor((Date.now() - created) / 86_400_000) : null;
    const expiresIn = expires ? Math.round((expires - Date.now()) / 86_400_000) : null;
    const statuses = (rdap.status ?? []).map((s) => asString(s)).filter(Boolean).slice(0, 5);
    const nsList = (rdap.nameservers ?? [])
      .map((n) => n.ldhName)
      .filter((n): n is string => Boolean(n))
      .concat((ns?.Answer ?? []).filter((a) => a.type === 2).map((a) => asString(a.data).replace(/\.$/, '')));
    const uniqueNs = [...new Set(nsList.map((n) => n.toLowerCase()))].slice(0, 8);
    const mxList = (mx?.Answer ?? [])
      .filter((a) => a.type === 15)
      .map((a) => asString(a.data))
      .filter(Boolean)
      .slice(0, 5);

    const hasRdap = !rdap.errorCode && (created || registrar || rdap.handle);
    if (!hasRdap && uniqueNs.length === 0) {
      throw errNetwork(
        'اطلاعاتی برای این دامنه پیدا نشد. مطمئن شوید دامنه ثبت شده و املای آن درست است.',
        'No data found for this domain. Make sure it is registered and spelled correctly.',
      );
    }

    const rows = fa
      ? [
          hasRdap ? `🏛 ثبت‌کننده: <b>${escapeHtml(registrar ?? '—')}</b>` : '⚠️ RDAP برای این پسوند در دسترس نیست؛ فقط داده‌های DNS نمایش داده می‌شود.',
          created ? `📅 تاریخ ثبت: ${mono(isoUtc(created))}${ageDays !== null ? ` (${ageDays} روز، ~${Math.floor(ageDays / 365)} سال)` : ''}` : '',
          expires ? `⏳ انقضا: ${mono(isoUtc(expires))}${expiresIn !== null ? ` (${expiresIn} روز مانده)` : ''}` : '',
          updated ? `🔄 آخرین تغییر: ${mono(isoUtc(updated))}` : '',
          rdap.secureDNS ? `🔐 DNSSEC: ${rdap.secureDNS.delegationSigned ? '✅ فعال' : '❌ غیرفعال'}` : '',
          statuses.length ? `🚦 وضعیت: ${statuses.map((s) => escapeHtml(STATUS_FA[s.toLowerCase()] ?? s)).join(' • ')}` : '',
          uniqueNs.length ? `🖧 نیم‌سرورها:\n${uniqueNs.map((n) => `• <code>${escapeHtml(n)}</code>`).join('\n')}` : '',
          mxList.length ? `📬 رکوردهای MX:\n${mxList.map((n) => `• <code>${escapeHtml(n)}</code>`).join('\n')}` : '📬 رکورد MX ندارد (ایمیل روی این دامنه تنظیم نشده).',
        ]
      : [
          hasRdap ? `🏛 Registrar: <b>${escapeHtml(registrar ?? '—')}</b>` : '⚠️ RDAP is not available for this TLD; showing DNS data only.',
          created ? `📅 Created: ${mono(isoUtc(created))}${ageDays !== null ? ` (${ageDays} days, ~${Math.floor(ageDays / 365)} years)` : ''}` : '',
          expires ? `⏳ Expires: ${mono(isoUtc(expires))}${expiresIn !== null ? ` (${expiresIn} days left)` : ''}` : '',
          updated ? `🔄 Last changed: ${mono(isoUtc(updated))}` : '',
          rdap.secureDNS ? `🔐 DNSSEC: ${rdap.secureDNS.delegationSigned ? '✅ enabled' : '❌ disabled'}` : '',
          statuses.length ? `🚦 Status: ${statuses.map((s) => escapeHtml(s)).join(' • ')}` : '',
          uniqueNs.length ? `🖧 Nameservers:\n${uniqueNs.map((n) => `• <code>${escapeHtml(n)}</code>`).join('\n')}` : '',
          mxList.length ? `📬 MX records:\n${mxList.map((n) => `• <code>${escapeHtml(n)}</code>`).join('\n')}` : '📬 No MX records (no mail configured).',
        ];

    return { html: `🏷 <b>${escapeHtml(host)}</b>\n${DIVIDER}\n${rows.filter(Boolean).join('\n')}` };
  },
});
