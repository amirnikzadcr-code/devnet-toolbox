import { defineTool } from '../types.js';
import { DIVIDER, escapeHtml, mono } from '../../utils/text.js';
import { assertPublicHost, isIP, parseHostInput, parsePositiveInt } from '../../utils/validate.js';
import { ALLOWED_PORTS, LIMITS } from '../../config/index.js';
import { errForbidden, errInvalidInput } from '../../utils/errors.js';
import { safeFetch } from '../../services/http.js';

const PORT_SERVICES: Record<number, string> = {
  21: 'FTP',
  22: 'SSH',
  25: 'SMTP',
  53: 'DNS',
  80: 'HTTP',
  110: 'POP3',
  143: 'IMAP',
  443: 'HTTPS',
  465: 'SMTPS',
  587: 'SMTP submission',
  993: 'IMAPS',
  995: 'POP3S',
  3306: 'MySQL',
  5432: 'PostgreSQL',
  6379: 'Redis',
  8080: 'HTTP alt',
  8443: 'HTTPS alt',
  27017: 'MongoDB',
};

interface SocketLike {
  opened: Promise<unknown>;
  close(): Promise<void>;
}

/**
 * Opens a single TCP connection to check whether a port accepts connections.
 * Deliberately limited to ONE host and ONE port per invocation, from a fixed
 * allow-list of well-known service ports — this is a diagnostics helper, not a scanner.
 */
async function checkPort(host: string, port: number, timeoutMs: number): Promise<{ open: boolean; ms: number; reason?: string }> {
  const started = Date.now();
  let socket: SocketLike | undefined;
  try {
    const mod = (await import('cloudflare:sockets')) as {
      connect: (address: { hostname: string; port: number }, options?: Record<string, unknown>) => SocketLike;
    };
    socket = mod.connect({ hostname: host, port }, { allowHalfOpen: false });
    await Promise.race([
      socket.opened,
      new Promise((_resolve, reject) => setTimeout(() => reject(new Error('timeout')), timeoutMs)),
    ]);
    return { open: true, ms: Date.now() - started };
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'unknown';
    return { open: false, ms: Date.now() - started, reason };
  } finally {
    try {
      await socket?.close();
    } catch {
      /* ignore */
    }
  }
}

export const portCheckTool = defineTool({
  id: 'port_check',
  category: 'network',
  icon: '🚪',
  network: true,
  needsInput: true,
  title: { fa: 'بررسی پورت', en: 'Port Check' },
  description: {
    fa: 'بررسی می‌کند که آیا یک پورت مشخص روی یک میزبان، اتصال TCP را می‌پذیرد یا نه. فقط پورت‌های سرویس‌های شناخته‌شده و فقط یک پورت در هر درخواست پشتیبانی می‌شود.',
    en: 'Checks whether a single TCP port on a host accepts connections. Only well-known service ports are allowed, and only one port per request.',
  },
  usage: {
    fa: 'به شکل <code>host:port</code> یا <code>host port</code> ارسال کنید؛ مثلاً <code>example.com:443</code>',
    en: 'Send <code>host:port</code> or <code>host port</code>, e.g. <code>example.com:443</code>',
  },
  example: {
    fa: 'ورودی: example.com:443\nخروجی: 🟢 باز • HTTPS • 38ms',
    en: 'Input: example.com:443\nOutput: 🟢 Open • HTTPS • 38ms',
  },
  limitations: {
    fa: `فقط یک پورت در هر بار (بدون اسکن محدوده). پورت‌های مجاز: ${ALLOWED_PORTS.join('، ')}. میزبان‌های داخلی و خصوصی مسدودند. سقف ۸ درخواست شبکه در دقیقه و ۱۲۰ در روز.`,
    en: `One port per request (range scanning is not supported). Allowed ports: ${ALLOWED_PORTS.join(', ')}. Internal and private hosts are blocked. Limit: 8 network requests/minute, 120/day.`,
  },
  run: async (input, ctx) => {
    const fa = ctx.lang === 'fa';
    const cleaned = input.trim().replace(/\s+/g, ' ');
    const match = /^([^\s:]+)(?::|\s)(\d{1,5})$/.exec(cleaned);
    if (!match?.[1] || !match[2]) {
      throw errInvalidInput(
        'قالب درست: <code>host:port</code> — مثلاً <code>example.com:443</code>',
        'Correct format: <code>host:port</code> — e.g. <code>example.com:443</code>',
      );
    }
    const host = assertPublicHost(parseHostInput(match[1]));
    const port = parsePositiveInt(match[2], 0, 1, 65535);
    if (!ALLOWED_PORTS.includes(port)) {
      throw errForbidden(
        `پورت ${port} در فهرست مجاز نیست. پورت‌های مجاز: ${ALLOWED_PORTS.join('، ')}`,
        `Port ${port} is not allowed. Allowed ports: ${ALLOWED_PORTS.join(', ')}`,
      );
    }

    const result = await checkPort(host, port, Math.min(LIMITS.networkTimeoutMs, 6000));
    const service = PORT_SERVICES[port] ?? (fa ? 'نامشخص' : 'unknown');
    const icon = result.open ? '🟢' : '🔴';
    const verdict = result.open ? (fa ? 'باز / پاسخ‌گو' : 'Open / accepting') : fa ? 'بسته یا فیلترشده' : 'Closed or filtered';

    const rows = fa
      ? [
          `🎯 میزبان: ${mono(host)}${isIP(host) ? '' : ''}`,
          `🚪 پورت: ${mono(String(port))} (${escapeHtml(service)})`,
          `${icon} وضعیت: <b>${verdict}</b>`,
          `⏱ زمان: ${result.ms}ms`,
          result.open ? '' : '💡 نتیجه‌ی «بسته» می‌تواند به‌دلیل فایروال، محدودیت شبکه‌ی لبه یا واقعاً بسته‌بودن پورت باشد.',
        ]
      : [
          `🎯 Host: ${mono(host)}`,
          `🚪 Port: ${mono(String(port))} (${escapeHtml(service)})`,
          `${icon} Status: <b>${verdict}</b>`,
          `⏱ Time: ${result.ms}ms`,
          result.open ? '' : '💡 A “closed” result can mean a firewall, an edge network restriction, or a genuinely closed port.',
        ];

    return {
      html: `🚪 <b>${fa ? 'بررسی پورت' : 'Port check'}</b>\n${DIVIDER}\n${rows.filter(Boolean).join('\n')}`,
      toast: result.open ? (fa ? 'باز' : 'Open') : fa ? 'بسته' : 'Closed',
    };
  },
});

export const pingTool = defineTool({
  id: 'ping',
  category: 'network',
  icon: '📶',
  network: true,
  quick: true,
  needsInput: true,
  title: { fa: 'تست دسترسی (Ping)', en: 'Connectivity Test (Ping)' },
  description: {
    fa: 'سه درخواست پشت سر هم به میزبان می‌فرستد و کمینه، میانگین و بیشینه‌ی زمان پاسخ را گزارش می‌کند. چون ICMP در محیط Workers در دسترس نیست، اندازه‌گیری روی لایه‌ی HTTP/TLS انجام می‌شود.',
    en: 'Sends three consecutive requests and reports min/avg/max response time. ICMP is unavailable in the Workers runtime, so timings are measured at the HTTP/TLS layer.',
  },
  usage: { fa: 'یک دامنه یا آدرس ارسال کنید؛ مثلاً <code>google.com</code>', en: 'Send a domain or URL, e.g. <code>google.com</code>' },
  example: {
    fa: 'ورودی: google.com\nخروجی: 🟢 ۳/۳ موفق • میانگین ۴۱ms',
    en: 'Input: google.com\nOutput: 🟢 3/3 successful • avg 41ms',
  },
  limitations: {
    fa: 'این تست ICMP واقعی نیست و زمان‌ها شامل TLS و پردازش سرور می‌شود. تنها ۳ نمونه گرفته می‌شود تا بار اضافی روی مقصد ایجاد نشود.',
    en: 'This is not real ICMP; timings include TLS and server processing. Only 3 samples are taken to avoid loading the target.',
  },
  run: async (input, ctx) => {
    const fa = ctx.lang === 'fa';
    const host = assertPublicHost(parseHostInput(input));
    const target = `https://${host}/`;
    const samples: (number | null)[] = [];
    let status = 0;
    for (let i = 0; i < 3; i += 1) {
      try {
        const res = await safeFetch(target, { maxBytes: 512, timeoutMs: 6000 });
        status = res.status;
        samples.push(res.elapsedMs);
      } catch {
        samples.push(null);
      }
    }
    const ok = samples.filter((s): s is number => s !== null);
    const loss = Math.round(((samples.length - ok.length) / samples.length) * 100);
    const min = ok.length ? Math.min(...ok) : 0;
    const max = ok.length ? Math.max(...ok) : 0;
    const avg = ok.length ? Math.round(ok.reduce((a, b) => a + b, 0) / ok.length) : 0;
    const icon = ok.length === 3 ? '🟢' : ok.length > 0 ? '🟠' : '🔴';
    const quality = avg === 0 ? '—' : avg < 100 ? (fa ? 'عالی' : 'excellent') : avg < 300 ? (fa ? 'خوب' : 'good') : fa ? 'کند' : 'slow';

    const lines = samples
      .map((s, i) => (s === null ? `  ${i + 1}. ❌ ${fa ? 'بدون پاسخ' : 'no response'}` : `  ${i + 1}. ✅ ${s}ms`))
      .join('\n');

    const rows = fa
      ? [
          `🎯 مقصد: ${mono(host)}`,
          `${icon} موفق: <b>${ok.length}/3</b> • از دست رفته: ${loss}%`,
          status ? `📡 کد وضعیت: ${mono(String(status))}` : '',
          lines,
          `📊 کمینه ${min}ms • میانگین <b>${avg}ms</b> • بیشینه ${max}ms`,
          `⭐️ کیفیت: ${quality}`,
        ]
      : [
          `🎯 Target: ${mono(host)}`,
          `${icon} Successful: <b>${ok.length}/3</b> • loss: ${loss}%`,
          status ? `📡 Status code: ${mono(String(status))}` : '',
          lines,
          `📊 min ${min}ms • avg <b>${avg}ms</b> • max ${max}ms`,
          `⭐️ Quality: ${quality}`,
        ];

    return {
      html: `📶 <b>${fa ? 'تست دسترسی' : 'Connectivity test'}</b>\n${DIVIDER}\n${rows.filter(Boolean).join('\n')}`,
      toast: `${avg}ms`,
    };
  },
});
