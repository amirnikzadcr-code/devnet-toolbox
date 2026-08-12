import { defineTool } from '../types.js';
import { DIVIDER, escapeHtml, isoUtc, mono } from '../../utils/text.js';
import { cached, fetchJson, safeFetch } from '../../services/http.js';
import { parseHostInput, assertPublicHost } from '../../utils/validate.js';
import { STATE_TTL } from '../../config/index.js';
import { errNetwork } from '../../utils/errors.js';

interface CertSpotterIssuance {
  id?: string;
  tbs_sha256?: string;
  dns_names?: string[];
  pubkey_sha256?: string;
  issuer?: string;
  not_before?: string;
  not_after?: string;
  revoked?: boolean;
}

function issuerCommonName(issuer: string | undefined): string {
  if (!issuer) return '—';
  const cn = /CN=([^,]+)/.exec(issuer)?.[1];
  const o = /O=([^,]+)/.exec(issuer)?.[1];
  return (cn ?? o ?? issuer).trim();
}

function daysBetween(from: number, to: number): number {
  return Math.round((to - from) / 86_400_000);
}

export const sslInfoTool = defineTool({
  id: 'ssl_info',
  category: 'network',
  icon: '🔒',
  network: true,
  needsInput: true,
  title: { fa: 'اطلاعات SSL/TLS', en: 'SSL/TLS Information' },
  description: {
    fa: 'گواهی فعال دامنه را از لاگ‌های عمومی Certificate Transparency می‌خواند و صادرکننده، تاریخ صدور، تاریخ انقضا، روزهای باقی‌مانده و دامنه‌های پوشش‌داده‌شده را نشان می‌دهد. همچنین در دسترس بودن HTTPS و هدر HSTS بررسی می‌شود.',
    en: 'Reads the active certificate from public Certificate Transparency logs and shows issuer, validity window, days remaining and covered domains. HTTPS reachability and the HSTS header are checked too.',
  },
  usage: { fa: 'یک دامنه ارسال کنید؛ مثلاً <code>github.com</code>', en: 'Send a domain, e.g. <code>github.com</code>' },
  example: {
    fa: 'ورودی: github.com\nخروجی: 🔒 معتبر • صادرکننده Sectigo • ۲۴۵ روز باقی‌مانده',
    en: 'Input: github.com\nOutput: 🔒 Valid • Issuer Sectigo • 245 days left',
  },
  limitations: {
    fa: 'داده از لاگ‌های عمومی CT (certspotter) خوانده می‌شود، نه از دست‌دادن مستقیم TLS؛ گواهی‌های داخلی یا غیرلاگ‌شده دیده نمی‌شوند. نتایج ۵ دقیقه کش می‌شوند.',
    en: 'Data comes from public CT logs (certspotter), not a direct TLS handshake; private or unlogged certificates are invisible. Results are cached for 5 minutes.',
  },
  run: async (input, ctx) => {
    const fa = ctx.lang === 'fa';
    const host = assertPublicHost(parseHostInput(input));

    const certs = await cached(ctx.cache, `ct:${host}`, STATE_TTL.networkCacheSec, async () => {
      const url =
        `https://api.certspotter.com/v1/issuances?domain=${encodeURIComponent(host)}` +
        '&include_subdomains=false&expand=dns_names&expand=issuer';
      const { data } = await fetchJson<CertSpotterIssuance[] | { message?: string }>(url);
      if (!Array.isArray(data)) {
        throw errNetwork(
          'سرویس گواهی‌نامه فعلاً پاسخ نمی‌دهد. کمی بعد دوباره تلاش کنید.',
          'The certificate service is unavailable right now. Please try again shortly.',
        );
      }
      return data;
    });

    const now = Date.now();
    const active = certs
      .filter((c) => c.not_after && Date.parse(c.not_after) > now)
      .sort((a, b) => Date.parse(b.not_before ?? '0') - Date.parse(a.not_before ?? '0'))[0];

    let https = '❔';
    let hsts = false;
    try {
      const res = await safeFetch(`https://${host}/`, { maxBytes: 1024, timeoutMs: 6000 });
      https = res.status > 0 ? '✅' : '❌';
      hsts = res.headers.has('strict-transport-security');
    } catch {
      https = '❌';
    }

    if (!active) {
      return {
        html: fa
          ? `🔒 <b>${escapeHtml(host)}</b>\n${DIVIDER}\n⚠️ گواهی فعالی در لاگ‌های عمومی CT پیدا نشد.\n🌐 دسترسی HTTPS: ${https}\n\n💡 ممکن است دامنه از گواهی داخلی استفاده کند یا اصلاً HTTPS نداشته باشد.`
          : `🔒 <b>${escapeHtml(host)}</b>\n${DIVIDER}\n⚠️ No active certificate found in public CT logs.\n🌐 HTTPS reachable: ${https}\n\n💡 The domain may use a private certificate or no HTTPS at all.`,
      };
    }

    const notBefore = Date.parse(active.not_before ?? '');
    const notAfter = Date.parse(active.not_after ?? '');
    const daysLeft = daysBetween(now, notAfter);
    const lifetime = Number.isFinite(notBefore) ? daysBetween(notBefore, notAfter) : 0;
    const health = daysLeft > 30 ? '🟢' : daysLeft > 7 ? '🟠' : '🔴';
    const names = (active.dns_names ?? []).slice(0, 12);
    const extra = (active.dns_names ?? []).length - names.length;

    const rows = fa
      ? [
          `${health} وضعیت: <b>${daysLeft > 0 ? 'معتبر' : 'منقضی'}</b> • ${daysLeft} روز باقی‌مانده`,
          `🏛 صادرکننده: <b>${escapeHtml(issuerCommonName(active.issuer))}</b>`,
          `📅 صدور: ${mono(Number.isFinite(notBefore) ? isoUtc(notBefore) : '—')}`,
          `📅 انقضا: ${mono(Number.isFinite(notAfter) ? isoUtc(notAfter) : '—')}`,
          lifetime ? `⏳ طول اعتبار: ${lifetime} روز` : '',
          `🌐 دسترسی HTTPS: ${https} • HSTS: ${hsts ? '✅' : '❌'}`,
          `🔗 دامنه‌های پوشش‌داده‌شده (${(active.dns_names ?? []).length}):\n${names.map((n) => `• <code>${escapeHtml(n)}</code>`).join('\n')}${extra > 0 ? `\n• … و ${extra} مورد دیگر` : ''}`,
        ]
      : [
          `${health} Status: <b>${daysLeft > 0 ? 'Valid' : 'Expired'}</b> • ${daysLeft} days left`,
          `🏛 Issuer: <b>${escapeHtml(issuerCommonName(active.issuer))}</b>`,
          `📅 Issued: ${mono(Number.isFinite(notBefore) ? isoUtc(notBefore) : '—')}`,
          `📅 Expires: ${mono(Number.isFinite(notAfter) ? isoUtc(notAfter) : '—')}`,
          lifetime ? `⏳ Lifetime: ${lifetime} days` : '',
          `🌐 HTTPS reachable: ${https} • HSTS: ${hsts ? '✅' : '❌'}`,
          `🔗 Covered domains (${(active.dns_names ?? []).length}):\n${names.map((n) => `• <code>${escapeHtml(n)}</code>`).join('\n')}${extra > 0 ? `\n• … and ${extra} more` : ''}`,
        ];

    return {
      html: `🔒 <b>${escapeHtml(host)}</b>\n${DIVIDER}\n${rows.filter(Boolean).join('\n')}`,
      toast: `${daysLeft} ${fa ? 'روز' : 'days'}`,
    };
  },
});
