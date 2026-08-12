import { defineTool } from '../types.js';
import { codeBlock, DIVIDER, escapeHtml, formatBytes } from '../../utils/text.js';
import { safeFetch } from '../../services/http.js';
import { parseHttpUrl } from '../../utils/validate.js';
import { LIMITS } from '../../config/index.js';

const STATUS_MEANING: Record<number, { fa: string; en: string }> = {
  200: { fa: 'موفق', en: 'OK' },
  201: { fa: 'ایجاد شد', en: 'Created' },
  204: { fa: 'بدون محتوا', en: 'No Content' },
  301: { fa: 'انتقال دائمی', en: 'Moved Permanently' },
  302: { fa: 'انتقال موقت', en: 'Found' },
  304: { fa: 'تغییر نکرده', en: 'Not Modified' },
  400: { fa: 'درخواست نامعتبر', en: 'Bad Request' },
  401: { fa: 'احراز هویت لازم است', en: 'Unauthorized' },
  403: { fa: 'دسترسی ممنوع', en: 'Forbidden' },
  404: { fa: 'یافت نشد', en: 'Not Found' },
  405: { fa: 'متد مجاز نیست', en: 'Method Not Allowed' },
  429: { fa: 'درخواست بیش از حد', en: 'Too Many Requests' },
  500: { fa: 'خطای داخلی سرور', en: 'Internal Server Error' },
  502: { fa: 'دروازه نامعتبر', en: 'Bad Gateway' },
  503: { fa: 'سرویس در دسترس نیست', en: 'Service Unavailable' },
  504: { fa: 'اتمام مهلت دروازه', en: 'Gateway Timeout' },
};

function statusIcon(status: number): string {
  if (status >= 200 && status < 300) return '🟢';
  if (status >= 300 && status < 400) return '🔵';
  if (status >= 400 && status < 500) return '🟠';
  return '🔴';
}

export const httpStatusTool = defineTool({
  id: 'http_status',
  category: 'network',
  icon: '📡',
  network: true,
  quick: true,
  needsInput: true,
  title: { fa: 'بررسی وضعیت HTTP', en: 'HTTP Status Checker' },
  description: {
    fa: 'یک درخواست GET به آدرس می‌فرستد و کد وضعیت، زمان پاسخ، نوع محتوا، سرور و زنجیره‌ی ریدایرکت را گزارش می‌کند.',
    en: 'Sends a GET request and reports status code, response time, content type, server and redirect information.',
  },
  usage: { fa: 'آدرس سایت را ارسال کنید؛ مثلاً <code>example.com</code>', en: 'Send a URL, e.g. <code>example.com</code>' },
  example: {
    fa: 'ورودی: https://example.com\nخروجی: 🟢 200 OK • 142ms',
    en: 'Input: https://example.com\nOutput: 🟢 200 OK • 142ms',
  },
  limitations: {
    fa: `فقط http/https روی پورت‌های وب. مهلت ${LIMITS.networkTimeoutMs / 1000} ثانیه. آدرس‌های داخلی مسدودند. سقف ۸ درخواست در دقیقه.`,
    en: `http/https on web ports only. ${LIMITS.networkTimeoutMs / 1000}s timeout. Internal addresses are blocked. Limit: 8 requests/minute.`,
  },
  run: async (input, ctx) => {
    const fa = ctx.lang === 'fa';
    const url = parseHttpUrl(input);
    const res = await safeFetch(url.toString(), { maxBytes: 8192 });
    const meaning = STATUS_MEANING[res.status];
    const server = res.headers.get('server') ?? '—';
    const contentType = (res.headers.get('content-type') ?? '—').split(';')[0] ?? '—';
    const length = res.headers.get('content-length');
    const rows = fa
      ? [
          `${statusIcon(res.status)} <b>${res.status}</b> ${res.statusText || (meaning?.en ?? '')}${meaning ? ` — ${meaning.fa}` : ''}`,
          `⏱ زمان پاسخ: <b>${res.elapsedMs}ms</b>`,
          `📄 نوع محتوا: <code>${escapeHtml(contentType)}</code>`,
          `🖥 سرور: <code>${escapeHtml(server)}</code>`,
          length ? `📦 حجم: ${formatBytes(Number(length))}` : '',
          res.redirected ? `↪️ ریدایرکت به: <code>${escapeHtml(res.url)}</code>` : '',
        ]
      : [
          `${statusIcon(res.status)} <b>${res.status}</b> ${res.statusText || ''}${meaning ? ` — ${meaning.en}` : ''}`,
          `⏱ Response time: <b>${res.elapsedMs}ms</b>`,
          `📄 Content type: <code>${escapeHtml(contentType)}</code>`,
          `🖥 Server: <code>${escapeHtml(server)}</code>`,
          length ? `📦 Size: ${formatBytes(Number(length))}` : '',
          res.redirected ? `↪️ Redirected to: <code>${escapeHtml(res.url)}</code>` : '',
        ];
    return {
      html: `🌐 <b>${escapeHtml(url.hostname)}</b>\n${DIVIDER}\n${rows.filter(Boolean).join('\n')}`,
      toast: `${res.status} • ${res.elapsedMs}ms`,
    };
  },
});

export const httpHeadersTool = defineTool({
  id: 'http_headers',
  category: 'network',
  icon: '🧾',
  network: true,
  needsInput: true,
  title: { fa: 'هدرهای HTTP', en: 'HTTP Headers' },
  description: {
    fa: 'تمام هدرهای پاسخ سرور را نمایش می‌دهد و هدرهای امنیتی کلیدی (HSTS، CSP، X-Frame-Options و …) را ارزیابی می‌کند.',
    en: 'Lists all response headers and audits key security headers (HSTS, CSP, X-Frame-Options and more).',
  },
  usage: { fa: 'آدرس سایت را ارسال کنید.', en: 'Send a URL.' },
  example: {
    fa: 'ورودی: example.com\nخروجی: فهرست هدرها + گزارش امنیتی',
    en: 'Input: example.com\nOutput: header list + security audit',
  },
  limitations: {
    fa: 'حداکثر ۳۰ هدر نمایش داده می‌شود. برخی سایت‌ها هدرها را برای رباتها متفاوت برمی‌گردانند.',
    en: 'Up to 30 headers are shown. Some sites return different headers to bots.',
  },
  run: async (input, ctx) => {
    const fa = ctx.lang === 'fa';
    const url = parseHttpUrl(input);
    const res = await safeFetch(url.toString(), { maxBytes: 4096 });
    const entries = [...res.headers.entries()].slice(0, 30);
    const headerText = entries.map(([k, v]) => `${k}: ${v.slice(0, 160)}`).join('\n');

    const securityHeaders: [string, { fa: string; en: string }][] = [
      ['strict-transport-security', { fa: 'اجبار HTTPS', en: 'Force HTTPS' }],
      ['content-security-policy', { fa: 'سیاست امنیتی محتوا', en: 'Content Security Policy' }],
      ['x-frame-options', { fa: 'محافظت clickjacking', en: 'Clickjacking protection' }],
      ['x-content-type-options', { fa: 'جلوگیری از MIME sniffing', en: 'MIME sniffing protection' }],
      ['referrer-policy', { fa: 'سیاست ارجاع', en: 'Referrer policy' }],
      ['permissions-policy', { fa: 'سیاست دسترسی‌ها', en: 'Permissions policy' }],
    ];
    let score = 0;
    const audit = securityHeaders
      .map(([name, label]) => {
        const present = res.headers.has(name);
        if (present) score += 1;
        return `${present ? '✅' : '❌'} <code>${name}</code> — ${fa ? label.fa : label.en}`;
      })
      .join('\n');
    const grade = ['F', 'E', 'D', 'C', 'B', 'A', 'A+'][score] ?? 'F';

    return {
      html:
        `🌐 <b>${escapeHtml(url.hostname)}</b> • ${statusIcon(res.status)} ${res.status}\n` +
        `${codeBlock(headerText)}` +
        `${DIVIDER}\n${fa ? '🛡 <b>هدرهای امنیتی</b>' : '🛡 <b>Security headers</b>'}\n${audit}\n` +
        `${DIVIDER}\n${fa ? '🏅 نمره' : '🏅 Grade'}: <b>${grade}</b> (${score}/6)`,
    };
  },
});

export const urlInfoTool = defineTool({
  id: 'url_info',
  category: 'network',
  icon: '🔗',
  network: true,
  needsInput: true,
  title: { fa: 'اطلاعات URL', en: 'URL Information' },
  description: {
    fa: 'زنجیره‌ی ریدایرکت را دنبال می‌کند، آدرس نهایی را پیدا می‌کند و متادیتای صفحه (عنوان، توضیحات، charset) را استخراج می‌کند.',
    en: 'Follows the redirect chain to the final URL and extracts page metadata (title, description, charset).',
  },
  usage: { fa: 'آدرس را ارسال کنید.', en: 'Send a URL.' },
  example: {
    fa: 'ورودی: example.com\nخروجی: عنوان صفحه، آدرس نهایی، وضعیت',
    en: 'Input: example.com\nOutput: page title, final URL, status',
  },
  limitations: {
    fa: 'فقط ۶۴ کیلوبایت اول صفحه خوانده می‌شود؛ صفحات مبتنی بر JavaScript ممکن است متادیتا نداشته باشند.',
    en: 'Only the first 64 KB is read; JavaScript-rendered pages may expose no metadata.',
  },
  run: async (input, ctx) => {
    const fa = ctx.lang === 'fa';
    const url = parseHttpUrl(input);
    const res = await safeFetch(url.toString());
    const pick = (re: RegExp): string | null => re.exec(res.body)?.[1]?.trim() ?? null;
    const title = pick(/<title[^>]*>([\s\S]{0,300}?)<\/title>/i);
    const description =
      pick(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']{0,300})["']/i) ??
      pick(/<meta[^>]+content=["']([^"']{0,300})["'][^>]+name=["']description["']/i);
    const ogTitle = pick(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']{0,200})["']/i);
    const charset = pick(/<meta[^>]+charset=["']?([\w-]+)/i) ?? (res.headers.get('content-type') ?? '').split('charset=')[1] ?? '—';

    const rows = [
      `${statusIcon(res.status)} <b>${res.status}</b> • ⏱ ${res.elapsedMs}ms`,
      `🔗 ${fa ? 'آدرس نهایی' : 'Final URL'}: <code>${escapeHtml(res.url)}</code>`,
      title ? `📰 ${fa ? 'عنوان' : 'Title'}: ${escapeHtml(title.replace(/\s+/g, ' '))}` : '',
      ogTitle && ogTitle !== title ? `🏷 og:title: ${escapeHtml(ogTitle)}` : '',
      description ? `📝 ${fa ? 'توضیحات' : 'Description'}: ${escapeHtml(description.replace(/\s+/g, ' '))}` : '',
      `🔤 Charset: <code>${escapeHtml(String(charset).trim())}</code>`,
      res.redirected ? `↪️ ${fa ? 'ریدایرکت شد' : 'Redirected'}: ${fa ? 'بله' : 'yes'}` : '',
    ].filter(Boolean);
    return { html: `🌐 <b>${escapeHtml(url.hostname)}</b>\n${DIVIDER}\n${rows.join('\n')}` };
  },
});
