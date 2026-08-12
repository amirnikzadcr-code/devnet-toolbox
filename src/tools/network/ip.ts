import { defineTool } from '../types.js';
import { DIVIDER, escapeHtml, mono } from '../../utils/text.js';
import { cached, fetchJson } from '../../services/http.js';
import { isIP, parseHostInput } from '../../utils/validate.js';
import { STATE_TTL } from '../../config/index.js';
import { dnsQuery } from './dns.js';
import { errNetwork } from '../../utils/errors.js';

interface IpWhoResponse {
  ip?: string;
  success?: boolean;
  type?: string;
  continent?: string;
  country?: string;
  country_code?: string;
  region?: string;
  city?: string;
  latitude?: number;
  longitude?: number;
  timezone?: { id?: string; utc?: string };
  connection?: { asn?: number; org?: string; isp?: string; domain?: string };
  flag?: { emoji?: string };
}

/** Shape returned by the ip-api.com fallback provider. */
interface IpApiResponse {
  status?: string;
  message?: string;
  query?: string;
  country?: string;
  countryCode?: string;
  regionName?: string;
  city?: string;
  lat?: number;
  lon?: number;
  timezone?: string;
  isp?: string;
  org?: string;
  as?: string;
}

/** Turns a two-letter country code into its flag emoji (🇺🇸 from "US"). */
function flagOf(code: string | undefined): string {
  if (!code || code.length !== 2) return '🏳️';
  const base = 0x1f1e6;
  const upper = code.toUpperCase();
  return String.fromCodePoint(
    base + (upper.charCodeAt(0) - 65),
    base + (upper.charCodeAt(1) - 65),
  );
}

/** Normalises an ip-api.com answer into the shape the renderer expects. */
function fromIpApi(payload: IpApiResponse): IpWhoResponse {
  if (payload.status !== 'success') return { success: false };
  // `as` looks like "AS15169 Google LLC" — split the number from the name.
  const asMatch = /^AS(\d+)\s*(.*)$/.exec(payload.as ?? '');
  return {
    success: true,
    ip: payload.query,
    type: (payload.query ?? '').includes(':') ? 'IPv6' : 'IPv4',
    country: payload.country,
    country_code: payload.countryCode,
    region: payload.regionName,
    city: payload.city,
    latitude: payload.lat,
    longitude: payload.lon,
    timezone: { id: payload.timezone },
    connection: {
      asn: asMatch ? Number(asMatch[1]) : undefined,
      org: asMatch?.[2] || payload.org,
      isp: payload.isp,
    },
    flag: { emoji: flagOf(payload.countryCode) },
  };
}

/**
 * Look an IP up, trying providers in order.
 *
 * Cloudflare Workers share outbound IPs across the whole platform, so the free
 * tier of a single geolocation API is regularly exhausted by other tenants —
 * ipwho.is answers 429 for us even on the very first call of the day. Falling
 * back to a second provider keeps the tool usable instead of dead.
 */
async function lookupIp(ip: string): Promise<IpWhoResponse> {
  try {
    const { data } = await fetchJson<IpWhoResponse>(`https://ipwho.is/${encodeURIComponent(ip)}`);
    if (data.success !== false) return data;
  } catch {
    /* provider unavailable — try the next one */
  }
  const { data } = await fetchJson<IpApiResponse>(
    `http://ip-api.com/json/${encodeURIComponent(ip)}?fields=status,message,query,country,countryCode,regionName,city,lat,lon,timezone,isp,org,as`,
  );
  return fromIpApi(data);
}

export const ipInfoTool = defineTool({
  id: 'ip_info',
  category: 'network',
  icon: '📍',
  network: true,
  quick: true,
  needsInput: true,
  title: { fa: 'اطلاعات IP', en: 'IP Information' },
  description: {
    fa: 'اطلاعات جغرافیایی و شبکه‌ای یک IP یا دامنه را نشان می‌دهد: کشور، شهر، منطقه‌ی زمانی، ASN، اپراتور و نوع آدرس. اگر دامنه بدهید، ابتدا به IP تبدیل می‌شود.',
    en: 'Shows geolocation and network data for an IP or domain: country, city, timezone, ASN, operator and address type. Domains are resolved to an IP first.',
  },
  usage: {
    fa: 'یک IP یا دامنه ارسال کنید؛ مثلاً <code>1.1.1.1</code> یا <code>example.com</code>',
    en: 'Send an IP or domain, e.g. <code>1.1.1.1</code> or <code>example.com</code>',
  },
  example: {
    fa: 'ورودی: 1.1.1.1\nخروجی: 🇦🇺 Australia • AS13335 Cloudflare',
    en: 'Input: 1.1.1.1\nOutput: 🇦🇺 Australia • AS13335 Cloudflare',
  },
  limitations: {
    fa: 'داده‌ها از سرویس‌های عمومی ipwho.is و در صورت در دسترس نبودن، ip-api.com گرفته می‌شود و ممکن است دقیق نباشد. IPهای خصوصی مجاز نیستند. نتایج ۵ دقیقه کش می‌شوند.',
    en: 'Data comes from the public ipwho.is service, falling back to ip-api.com when it is unavailable, and may be approximate. Private IPs are rejected. Results are cached for 5 minutes.',
  },
  run: async (input, ctx) => {
    const fa = ctx.lang === 'fa';
    const host = parseHostInput(input);
    let ip = host;
    let resolvedFrom = '';
    if (!isIP(host)) {
      const dns = await dnsQuery(host, 'A', ctx.cache);
      const a = (dns.Answer ?? []).find((r) => r.type === 1);
      if (!a) {
        throw errNetwork(
          'برای این دامنه رکورد A پیدا نشد؛ امکان تعیین IP وجود ندارد.',
          'No A record found for this domain, cannot determine an IP.',
        );
      }
      ip = a.data;
      resolvedFrom = host;
    }

    const data = await cached(
      ctx.cache,
      `ipinfo:${ip}`,
      STATE_TTL.networkCacheSec,
      async () => lookupIp(ip),
      // Providers answer HTTP 200 with `success:false` when they rate-limit us.
      // Never cache that, otherwise one throttled call breaks the tool for the whole TTL.
      (payload) => payload.success !== false,
    );

    if (data.success === false) {
      throw errNetwork(
        'اطلاعاتی برای این آدرس در پایگاه داده موجود نیست.',
        'No information is available for this address.',
      );
    }
    const conn = data.connection ?? {};
    const rows = fa
      ? [
          `🌍 IP: ${mono(data.ip ?? ip)}${resolvedFrom ? ` (از ${escapeHtml(resolvedFrom)})` : ''}`,
          `🔢 نوع: ${mono(data.type ?? '—')}`,
          `${data.flag?.emoji ?? '🏳️'} کشور: <b>${escapeHtml(data.country ?? '—')}</b> (${escapeHtml(data.country_code ?? '—')})`,
          `🏙 شهر: ${escapeHtml(data.city ?? '—')}${data.region ? ` • ${escapeHtml(data.region)}` : ''}`,
          `🕒 منطقه زمانی: ${mono(data.timezone?.id ?? '—')} ${data.timezone?.utc ?? ''}`,
          `🛰 ASN: ${mono(conn.asn ? `AS${conn.asn}` : '—')}`,
          `🏢 سازمان: ${escapeHtml(conn.org ?? conn.isp ?? '—')}`,
          data.latitude && data.longitude ? `🗺 مختصات: ${mono(`${data.latitude}, ${data.longitude}`)}` : '',
        ]
      : [
          `🌍 IP: ${mono(data.ip ?? ip)}${resolvedFrom ? ` (from ${escapeHtml(resolvedFrom)})` : ''}`,
          `🔢 Type: ${mono(data.type ?? '—')}`,
          `${data.flag?.emoji ?? '🏳️'} Country: <b>${escapeHtml(data.country ?? '—')}</b> (${escapeHtml(data.country_code ?? '—')})`,
          `🏙 City: ${escapeHtml(data.city ?? '—')}${data.region ? ` • ${escapeHtml(data.region)}` : ''}`,
          `🕒 Timezone: ${mono(data.timezone?.id ?? '—')} ${data.timezone?.utc ?? ''}`,
          `🛰 ASN: ${mono(conn.asn ? `AS${conn.asn}` : '—')}`,
          `🏢 Organisation: ${escapeHtml(conn.org ?? conn.isp ?? '—')}`,
          data.latitude && data.longitude ? `🗺 Coordinates: ${mono(`${data.latitude}, ${data.longitude}`)}` : '',
        ];
    return { html: `📍 <b>${fa ? 'اطلاعات آدرس' : 'Address information'}</b>\n${DIVIDER}\n${rows.filter(Boolean).join('\n')}` };
  },
});

export const myIpTool = defineTool({
  id: 'my_ip',
  category: 'network',
  icon: '🛰',
  network: false,
  needsInput: false,
  title: { fa: 'IP و مسیر من', en: 'My Connection' },
  description: {
    fa: 'اطلاعات مسیر اتصال شما به ربات را که کلودفلر در لبه‌ی شبکه گزارش می‌کند نشان می‌دهد: مرکز داده، کشور و پروتکل. توجه: این اطلاعات مربوط به سرورهای تلگرام است، نه دستگاه شما.',
    en: 'Shows connection metadata reported by Cloudflare at the edge: data centre, country and protocol. Note: this reflects Telegram’s servers, not your device.',
  },
  usage: { fa: 'کافی است ابزار را اجرا کنید.', en: 'Just run the tool.' },
  example: { fa: 'خروجی: colo=FRA • country=DE', en: 'Output: colo=FRA • country=DE' },
  limitations: {
    fa: 'به دلیل معماری Webhook، IP شما در دسترس نیست و نمایش داده نمی‌شود (حریم خصوصی).',
    en: 'Because of the webhook architecture your own IP is not available and is never shown (privacy by design).',
  },
  run: (_input, ctx) => {
    const fa = ctx.lang === 'fa';
    return {
      html: fa
        ? `🛰 <b>اطلاعات لبه‌ی شبکه</b>\n${DIVIDER}\nاین ربات از طریق Webhook کار می‌کند؛ بنابراین درخواست‌ها از سرورهای تلگرام می‌رسند و IP شخصی شما هرگز دریافت یا ذخیره نمی‌شود.\n\n✅ حریم خصوصی: هیچ آدرس IP کاربری در پایگاه داده نگهداری نمی‌شود.\n\n💡 برای بررسی یک IP مشخص از ابزار «اطلاعات IP» استفاده کنید.`
        : `🛰 <b>Edge information</b>\n${DIVIDER}\nThis bot runs on webhooks, so requests originate from Telegram’s servers — your personal IP is never received or stored.\n\n✅ Privacy: no user IP addresses are kept in the database.\n\n💡 To inspect a specific IP use the “IP Information” tool.`,
    };
  },
});
