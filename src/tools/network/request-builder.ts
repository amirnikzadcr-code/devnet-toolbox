/**
 * Phase 3 — Advanced URL parser and the HTTP Request Builder.
 *
 * The request builder is the single most security-sensitive tool in the whole
 * project: it lets a user aim an HTTP request from Cloudflare's network at a
 * host of their choosing. Every guard rail is therefore mandatory and
 * enforced here rather than left to the caller:
 *
 *   • `assertSafeUrl` before the first request AND on every redirect hop
 *     (via `safeFetchGuarded`), which blocks localhost, private ranges,
 *     link-local, CGNAT and every cloud metadata endpoint;
 *   • an allow-list of ports, so the tool cannot become a port scanner;
 *   • a header deny-list, so `Host`, `X-Forwarded-For` and `Cookie` cannot be
 *     spoofed and the Worker's identity cannot be hidden;
 *   • hard timeout, request-body cap and response-byte cap;
 *   • the strict `network` rate-limit bucket (8/min, 120/day).
 */
import { defineTool } from '../types.js';
import { codeBlock, DIVIDER, escapeHtml, formatBytes, truncate } from '../../utils/text.js';
import { errForbidden, errInvalidInput, errTooLarge } from '../../utils/errors.js';
import { HTTP_BUILDER } from '../../config/index.js';
import { assertSafeUrl, safeFetchGuarded } from '../../security/ssrf.js';
import { utf8Length } from '../../utils/encoding.js';
import { statusIcon, STATUS_MEANING } from './http.js';

// ─── 13. Advanced URL parser ──────────────────────────────────────────────

/**
 * Public-suffix handling without shipping the full PSL: the multi-label
 * suffixes people actually hit (`co.uk`, `com.au`, `ac.ir` …) are enumerated,
 * everything else falls back to the last label.
 */
const MULTI_LABEL_SUFFIXES = new Set([
  'co.uk', 'org.uk', 'ac.uk', 'gov.uk', 'me.uk', 'net.uk',
  'com.au', 'net.au', 'org.au', 'edu.au', 'gov.au',
  'co.nz', 'co.za', 'co.jp', 'or.jp', 'ne.jp', 'ac.jp',
  'co.in', 'net.in', 'org.in', 'gov.in', 'ac.in',
  'com.br', 'com.cn', 'com.tr', 'com.mx', 'com.ar', 'com.sg', 'com.hk',
  'ac.ir', 'co.ir', 'gov.ir', 'id.ir', 'net.ir', 'org.ir', 'sch.ir',
  'com.pk', 'com.ua', 'com.pl', 'com.tw', 'com.my', 'com.ph',
]);

export interface DomainParts {
  subdomain: string;
  domain: string;
  tld: string;
  registrable: string;
}

export function splitDomain(hostname: string): DomainParts {
  const labels = hostname.split('.').filter(Boolean);
  if (labels.length < 2) {
    return { subdomain: '', domain: hostname, tld: '', registrable: hostname };
  }
  const lastTwo = labels.slice(-2).join('.');
  const suffixLength = MULTI_LABEL_SUFFIXES.has(lastTwo) ? 3 : 2;
  const registrableLabels = labels.slice(-suffixLength);
  return {
    subdomain: labels.slice(0, -suffixLength).join('.'),
    domain: registrableLabels[0] ?? '',
    tld: registrableLabels.slice(1).join('.'),
    registrable: registrableLabels.join('.'),
  };
}

export const urlParserProTool = defineTool({
  id: 'url_parse_pro',
  category: 'utilities',
  icon: '🔗',
  quick: true,
  needsInput: true,
  title: { fa: 'تجزیه‌گر پیشرفته‌ی URL', en: 'Advanced URL Parser' },
  description: {
    fa: 'آدرس را کامل تجزیه می‌کند: پروتکل، نام کاربری، میزبان، پورت، مسیر، کوئری، fragment، دامنه، زیردامنه و TLD؛ پارامترها را جدا می‌کند، نسخه‌ی Encode و Decode شده را می‌سازد و هشدار می‌دهد اگر آدرس به شبکه‌ی داخلی اشاره کند.',
    en: 'Fully decomposes a URL: scheme, userinfo, host, port, path, query, fragment, domain, subdomain and TLD; lists every parameter, produces encoded and decoded forms, and warns when the URL points at an internal network.',
  },
  usage: {
    fa: 'یک آدرس کامل ارسال کنید؛ مثل <code>https://user@api.example.co.uk:8443/v1/items?q=a%20b&page=2#top</code>',
    en: 'Send a full URL, e.g. <code>https://user@api.example.co.uk:8443/v1/items?q=a%20b&page=2#top</code>',
  },
  example: {
    fa: 'ورودی: https://api.example.co.uk/v1?x=1\nخروجی: scheme=https • subdomain=api • domain=example • tld=co.uk',
    en: 'Input: https://api.example.co.uk/v1?x=1\nOutput: scheme=https • subdomain=api • domain=example • tld=co.uk',
  },
  limitations: {
    fa: 'تجزیه کاملاً محلی است و هیچ درخواستی به آدرس ارسال نمی‌شود. تشخیص TLD بر پایه‌ی فهرست پرکاربردترین پسوندهاست، نه فهرست کامل Public Suffix List.',
    en: 'Parsing is entirely local; no request is sent to the URL. TLD detection uses a list of the most common suffixes rather than the full Public Suffix List.',
  },
  run: (input, ctx) => {
    const fa = ctx.lang === 'fa';
    const raw = input.trim();
    if (!raw) {
      throw errInvalidInput('آدرسی وارد نشده است.', 'No URL was provided.');
    }
    let url: URL;
    try {
      url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`);
    } catch {
      throw errInvalidInput(
        'آدرس معتبر نیست. نمونه: https://example.com/path?a=1',
        'Invalid URL. Example: https://example.com/path?a=1',
      );
    }
    // `new URL` is lenient: it happily accepts a hostname full of characters
    // no resolver would ever answer for. Reject those explicitly.
    if (!/^\[?[a-z0-9._:%-]+\]?$/i.test(url.hostname)) {
      throw errInvalidInput(
        `میزبان «${url.hostname}» معتبر نیست.`,
        `The host "${url.hostname}" is not valid.`,
      );
    }

    const parts = splitDomain(url.hostname);
    const defaultPort = url.protocol === 'https:' ? '443' : url.protocol === 'http:' ? '80' : '';

    const rows: [string, string, string][] = [
      ['پروتکل', 'Scheme', url.protocol.replace(':', '')],
      ['نام کاربری', 'Username', url.username || '—'],
      ['رمز', 'Password', url.password ? '•••••• (redacted)' : '—'],
      ['میزبان', 'Host', url.hostname],
      ['پورت', 'Port', url.port || `${defaultPort} (default)`],
      ['زیردامنه', 'Subdomain', parts.subdomain || '—'],
      ['دامنه', 'Domain', parts.domain || '—'],
      ['TLD', 'TLD', parts.tld || '—'],
      ['دامنه‌ی قابل ثبت', 'Registrable domain', parts.registrable],
      ['مسیر', 'Path', url.pathname || '/'],
      ['کوئری', 'Query', url.search || '—'],
      ['قطعه', 'Fragment', url.hash || '—'],
      ['مبدأ', 'Origin', url.origin],
    ];

    const table = rows
      .map(([faLabel, enLabel, value]) => `• <b>${fa ? faLabel : enLabel}</b>: <code>${escapeHtml(value)}</code>`)
      .join('\n');

    const params = [...url.searchParams.entries()];
    const paramBlock = params.length
      ? `\n${DIVIDER}\n${fa ? `🔎 <b>پارامترها (${params.length})</b>` : `🔎 <b>Query parameters (${params.length})</b>`}\n` +
        params
          .slice(0, 25)
          .map(([key, value], i) => `${i + 1}. <code>${escapeHtml(key)}</code> = <code>${escapeHtml(truncate(value, 120))}</code>`)
          .join('\n') +
        (params.length > 25 ? `\n<i>… +${params.length - 25}</i>` : '')
      : '';

    // A password in the URL must never be echoed back — not in the breakdown
    // and not in the encoded/decoded forms either.
    const safeUrl = new URL(url.toString());
    if (safeUrl.password) safeUrl.password = 'REDACTED';

    const encoded = encodeURI(safeUrl.toString());
    const decoded = (() => {
      try {
        return decodeURIComponent(safeUrl.toString());
      } catch {
        return safeUrl.toString();
      }
    })();

    // The URL is only parsed here, never fetched — but flagging an internal
    // target is still useful, and it is the same check the request builder
    // enforces before it would send anything.
    let safetyNote = '';
    try {
      assertSafeUrl(url);
      safetyNote = fa ? '✅ میزبان عمومی است.' : '✅ The host is public.';
    } catch {
      safetyNote = fa
        ? '⚠️ این آدرس به شبکه‌ی داخلی، لوکال یا سرویس متادیتا اشاره می‌کند. ابزار «HTTP Request Builder» چنین مقصدی را ارسال نخواهد کرد.'
        : '⚠️ This URL points at an internal, loopback or metadata target. The HTTP Request Builder would refuse to send to it.';
    }

    return {
      html:
        `${fa ? '🔗 <b>تجزیه‌ی آدرس</b>' : '🔗 <b>URL breakdown</b>'}\n${table}` +
        paramBlock +
        `\n${DIVIDER}\n${fa ? '🔐 <b>Encode</b>' : '🔐 <b>Encoded</b>'}\n${codeBlock(truncate(encoded, 400))}` +
        `${fa ? '🔓 <b>Decode</b>' : '🔓 <b>Decoded</b>'}\n${codeBlock(truncate(decoded, 400))}` +
        `${DIVIDER}\n${safetyNote}`,
    };
  },
});

// ─── 14. HTTP Request Builder ─────────────────────────────────────────────

export interface BuiltRequest {
  method: string;
  url: URL;
  headers: Record<string, string>;
  body?: string;
}

/**
 * Parses the request DSL.
 *
 * Grammar (one directive per line, body after a blank line):
 *   POST https://api.example.com/items
 *   Content-Type: application/json
 *   ?tag=beta
 *
 *   {"name":"x"}
 */
export function parseRequestSpec(input: string): BuiltRequest {
  // A bare CR is never legitimate here. Splitting on "\n" alone would let
  // "X-Test: a\r\nInjected: b" become two separate headers, quietly honouring
  // an injection attempt instead of refusing it.
  if (input.includes('\r')) {
    throw errForbidden(
      'ورودی شامل کاراکتر بازگشت کالسکه (CR) است؛ این الگو برای تزریق هدر به‌کار می‌رود و پذیرفته نمی‌شود.',
      'The input contains a carriage-return character; that pattern is used for header injection and is refused.',
    );
  }
  const lines = input.split('\n');
  const firstLine = (lines[0] ?? '').trim();
  if (!firstLine) {
    throw errInvalidInput(
      'خط اول باید متد و آدرس باشد؛ مثل <code>GET https://example.com</code>',
      'The first line must be the method and URL, e.g. <code>GET https://example.com</code>',
    );
  }

  const requestLine = /^([A-Za-z]+)\s+(\S+)$/.exec(firstLine);
  const methodRaw = requestLine ? (requestLine[1] as string).toUpperCase() : 'GET';
  const urlRaw = requestLine ? (requestLine[2] as string) : firstLine;

  if (!(HTTP_BUILDER.methods as readonly string[]).includes(methodRaw)) {
    throw errInvalidInput(
      `متد «${methodRaw}» پشتیبانی نمی‌شود. متدهای مجاز: ${HTTP_BUILDER.methods.join('، ')}`,
      `Method "${methodRaw}" is not supported. Allowed: ${HTTP_BUILDER.methods.join(', ')}`,
    );
  }

  // Reject a non-http scheme up front: prefixing "https://" would otherwise
  // silently turn "file:///etc/passwd" into the host "file".
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(urlRaw);
  if (scheme?.[1] && !/^https?$/i.test(scheme[1])) {
    throw errForbidden(
      `پروتکل «${scheme[1]}» مجاز نیست؛ فقط http و https پشتیبانی می‌شوند.`,
      `The "${scheme[1]}" scheme is not allowed; only http and https are supported.`,
    );
  }

  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(urlRaw) ? urlRaw : `https://${urlRaw}`);
  } catch {
    throw errInvalidInput(
      'آدرس معتبر نیست. نمونه: <code>GET https://api.example.com/status</code>',
      'Invalid URL. Example: <code>GET https://api.example.com/status</code>',
    );
  }
  if (!url.hostname || !/^\[?[a-z0-9._:%-]+\]?$/i.test(url.hostname)) {
    throw errInvalidInput(
      'میزبان آدرس معتبر نیست.',
      'The URL host is not valid.',
    );
  }

  // Split headers/query directives from the body at the first blank line.
  let bodyStart = lines.length;
  for (let i = 1; i < lines.length; i += 1) {
    if ((lines[i] ?? '').trim() === '') {
      bodyStart = i + 1;
      break;
    }
  }

  const headers: Record<string, string> = {};
  for (let i = 1; i < Math.min(bodyStart, lines.length); i += 1) {
    const line = (lines[i] ?? '').trim();
    if (!line) continue;

    // `?key=value` adds a query parameter without rewriting the whole URL.
    if (line.startsWith('?') || line.startsWith('&')) {
      const [key = '', ...rest] = line.slice(1).split('=');
      if (!key) continue;
      url.searchParams.set(key.trim(), rest.join('='));
      continue;
    }

    const separator = line.indexOf(':');
    if (separator === -1) {
      throw errInvalidInput(
        `خط «${line}» نه هدر است و نه پارامتر. هدر را به شکل <code>Name: value</code> و پارامتر را به شکل <code>?key=value</code> بنویسید.`,
        `The line "${line}" is neither a header nor a parameter. Write headers as <code>Name: value</code> and parameters as <code>?key=value</code>.`,
      );
    }
    const name = line.slice(0, separator).trim().toLowerCase();
    const value = line.slice(separator + 1).trim();

    if (!/^[a-z0-9-]+$/.test(name)) {
      throw errInvalidInput(
        `نام هدر «${name}» معتبر نیست.`,
        `The header name "${name}" is not valid.`,
      );
    }
    // Header injection: a CR or LF inside a value could smuggle a second
    // request. Reject rather than strip, so the user sees what happened.
    // eslint-disable-next-line no-control-regex
    if (/[\r\n\u0000]/.test(value)) {
      throw errForbidden(
        'مقدار هدر نباید شامل کاراکتر خط جدید باشد.',
        'A header value must not contain newline characters.',
      );
    }
    if (HTTP_BUILDER.blockedHeaders.includes(name)) {
      throw errForbidden(
        `هدر «${name}» به دلایل امنیتی قابل تنظیم نیست (جلوگیری از جعل هویت و سوءاستفاده).`,
        `The "${name}" header cannot be set for security reasons (identity spoofing / abuse prevention).`,
      );
    }
    if (value.length > HTTP_BUILDER.maxHeaderValueChars) {
      throw errTooLarge(
        `مقدار هدر «${name}» بیش از ${HTTP_BUILDER.maxHeaderValueChars} کاراکتر است.`,
        `The "${name}" header value exceeds ${HTTP_BUILDER.maxHeaderValueChars} characters.`,
      );
    }
    headers[name] = value;
    if (Object.keys(headers).length > HTTP_BUILDER.maxHeaders) {
      throw errTooLarge(
        `حداکثر ${HTTP_BUILDER.maxHeaders} هدر مجاز است.`,
        `At most ${HTTP_BUILDER.maxHeaders} headers are allowed.`,
      );
    }
  }

  const body = lines.slice(bodyStart).join('\n').trim();
  if (body && (methodRaw === 'GET' || methodRaw === 'HEAD')) {
    throw errInvalidInput(
      `متد ${methodRaw} بدنه (body) نمی‌پذیرد.`,
      `The ${methodRaw} method does not accept a body.`,
    );
  }
  if (body && utf8Length(body) > HTTP_BUILDER.maxBodyBytes) {
    throw errTooLarge(
      `حجم بدنه‌ی درخواست بیش از ${formatBytes(HTTP_BUILDER.maxBodyBytes)} است.`,
      `The request body exceeds ${formatBytes(HTTP_BUILDER.maxBodyBytes)}.`,
    );
  }

  // Default a JSON content type when the body obviously is JSON.
  if (body && !headers['content-type']) {
    headers['content-type'] = /^[[{]/.test(body) ? 'application/json' : 'text/plain; charset=utf-8';
  }

  return { method: methodRaw, url, headers, ...(body ? { body } : {}) };
}

/** Ports outside the allow-list would turn this tool into a port scanner. */
export function assertAllowedPort(url: URL): void {
  if (!url.port) return;
  const port = Number(url.port);
  if (!HTTP_BUILDER.allowedPorts.includes(port)) {
    throw errForbidden(
      `پورت ${port} مجاز نیست. پورت‌های مجاز: ${HTTP_BUILDER.allowedPorts.join('، ')}`,
      `Port ${port} is not allowed. Allowed ports: ${HTTP_BUILDER.allowedPorts.join(', ')}`,
    );
  }
}

/** Header names whose values must never be echoed back to the chat. */
const SENSITIVE_HEADERS = new Set(['authorization', 'proxy-authorization', 'cookie', 'set-cookie', 'x-api-key', 'api-key', 'x-auth-token']);

export const httpRequestBuilderTool = defineTool({
  id: 'http_request',
  category: 'network',
  icon: '🚀',
  network: true,
  needsInput: true,
  title: { fa: 'سازنده‌ی درخواست HTTP', en: 'HTTP Request Builder' },
  description: {
    fa: 'یک درخواست HTTP دلخواه (GET، POST، PUT، PATCH، DELETE، HEAD) با هدر، پارامتر و بدنه‌ی دلخواه می‌سازد و می‌فرستد، سپس کد وضعیت، هدرهای پاسخ، بدنه و زمان پاسخ را نشان می‌دهد. مقصدهای داخلی، لوکال و متادیتای ابری — حتی پس از ریدایرکت — مسدود هستند.',
    en: 'Builds and sends a custom HTTP request (GET, POST, PUT, PATCH, DELETE, HEAD) with your headers, query parameters and body, then reports the status code, response headers, body and response time. Internal, loopback and cloud-metadata targets are blocked — including after a redirect.',
  },
  usage: {
    fa:
      'خط اول: متد و آدرس. خط‌های بعد: هدر (<code>Name: value</code>) یا پارامتر (<code>?key=value</code>). بدنه پس از یک خط خالی:\n' +
      '<code>POST https://httpbin.org/post\nContent-Type: application/json\n?debug=1\n\n{"name":"test"}</code>',
    en:
      'First line: method and URL. Next lines: headers (<code>Name: value</code>) or parameters (<code>?key=value</code>). Body after one blank line:\n' +
      '<code>POST https://httpbin.org/post\nContent-Type: application/json\n?debug=1\n\n{"name":"test"}</code>',
  },
  example: {
    fa: 'ورودی: GET https://api.github.com/zen\nخروجی: 200 OK • ~180ms • بدنه‌ی پاسخ',
    en: 'Input: GET https://api.github.com/zen\nOutput: 200 OK • ~180ms • response body',
  },
  limitations: {
    fa:
      `مهلت پاسخ ${HTTP_BUILDER.timeoutMs / 1000} ثانیه • حداکثر بدنه‌ی ارسالی ${HTTP_BUILDER.maxBodyBytes / 1024} کیلوبایت • ` +
      `حداکثر پاسخ خوانده‌شده ${HTTP_BUILDER.maxResponseBytes / 1024} کیلوبایت • حداکثر ${HTTP_BUILDER.maxHeaders} هدر • ` +
      'حداکثر ۵ ریدایرکت (هرکدام دوباره اعتبارسنجی می‌شوند) • سقف ۸ درخواست در دقیقه و ۱۲۰ در روز. ' +
      'هدرهای Host، Cookie و X-Forwarded-* و آدرس‌های داخلی/خصوصی/متادیتا پذیرفته نمی‌شوند.',
    en:
      `${HTTP_BUILDER.timeoutMs / 1000}s timeout • ${HTTP_BUILDER.maxBodyBytes / 1024} KB request body • ` +
      `${HTTP_BUILDER.maxResponseBytes / 1024} KB of response read • at most ${HTTP_BUILDER.maxHeaders} headers • ` +
      'at most 5 redirects (each re-validated) • 8 requests per minute and 120 per day. ' +
      'Host, Cookie and X-Forwarded-* headers and internal/private/metadata addresses are refused.',
  },
  run: async (input, ctx) => {
    const fa = ctx.lang === 'fa';
    const spec = parseRequestSpec(input);

    // ── Security gate, before a single byte leaves the Worker ──
    assertSafeUrl(spec.url);
    assertAllowedPort(spec.url);

    const started = Date.now();
    const response = await safeFetchGuarded(spec.url.toString(), {
      method: spec.method,
      headers: spec.headers,
      timeoutMs: HTTP_BUILDER.timeoutMs,
      maxBytes: HTTP_BUILDER.maxResponseBytes,
      ...(spec.body !== undefined ? { body: spec.body } : {}),
    });
    const elapsed = Date.now() - started;

    const meaning = STATUS_MEANING[response.status];
    const statusLine =
      `${statusIcon(response.status)} <b>${response.status} ${escapeHtml(response.statusText || '')}</b>` +
      (meaning ? ` — ${escapeHtml(fa ? meaning.fa : meaning.en)}` : '');

    const headerRows = [...response.headers.entries()]
      .slice(0, 20)
      .map(([name, value]) => {
        const shown = SENSITIVE_HEADERS.has(name.toLowerCase())
          ? fa
            ? '•••••• (پنهان شد)'
            : '•••••• (redacted)'
          : truncate(value, 140);
        return `• <b>${escapeHtml(name)}</b>: <code>${escapeHtml(shown)}</code>`;
      })
      .join('\n');

    const contentType = response.headers.get('content-type') ?? '';
    const language = contentType.includes('json')
      ? 'json'
      : contentType.includes('html')
        ? 'html'
        : contentType.includes('xml')
          ? 'xml'
          : undefined;

    let bodyBlock: string;
    if (spec.method === 'HEAD') {
      bodyBlock = `<i>${fa ? 'متد HEAD بدنه برنمی‌گرداند.' : 'HEAD responses carry no body.'}</i>`;
    } else if (!response.body) {
      bodyBlock = `<i>${fa ? 'بدنه‌ی پاسخ خالی است.' : 'The response body is empty.'}</i>`;
    } else {
      // Pretty-print JSON when it is small enough to be worth it.
      let shown = response.body;
      if (language === 'json' && shown.length < 4000) {
        try {
          shown = JSON.stringify(JSON.parse(shown), null, 2);
        } catch {
          /* not valid JSON after all — show it raw */
        }
      }
      bodyBlock = codeBlock(truncate(shown, HTTP_BUILDER.maxShownBodyChars), language);
    }

    const redirectBlock =
      response.chain.length > 1
        ? `\n${DIVIDER}\n${fa ? '↪️ <b>زنجیره‌ی ریدایرکت</b>' : '↪️ <b>Redirect chain</b>'}\n` +
          response.chain
            .map((url, i) => `${i + 1}. <code>${escapeHtml(truncate(url, 90))}</code>${response.hopStatuses[i] ? ` → ${response.hopStatuses[i]}` : ''}`)
            .join('\n') +
          `\n<i>${fa ? 'هر مرحله دوباره از نظر SSRF بررسی شد.' : 'Every hop was re-validated against the SSRF rules.'}</i>`
        : '';

    const sentHeaders = Object.keys(spec.headers).length
      ? Object.entries(spec.headers)
          .map(([name, value]) => `• <code>${escapeHtml(name)}: ${escapeHtml(SENSITIVE_HEADERS.has(name) ? '••••••' : truncate(value, 80))}</code>`)
          .join('\n')
      : `<i>${fa ? 'بدون هدر سفارشی' : 'no custom headers'}</i>`;

    return {
      html:
        `${fa ? '🚀 <b>درخواست</b>' : '🚀 <b>Request</b>'}\n` +
        codeBlock(`${spec.method} ${spec.url.toString()}`) +
        `${fa ? '📤 <b>هدرهای ارسالی</b>' : '📤 <b>Sent headers</b>'}\n${sentHeaders}\n` +
        (spec.body ? `${fa ? '📦 <b>بدنه‌ی ارسالی</b>' : '📦 <b>Sent body</b>'}\n${codeBlock(truncate(spec.body, 300))}` : '') +
        `${DIVIDER}\n${statusLine}\n` +
        `⏱ ${elapsed} ms • 📦 ${formatBytes(utf8Length(response.body))}${response.truncated ? (fa ? ' (بریده‌شده)' : ' (truncated)') : ''}\n` +
        redirectBlock +
        `\n${DIVIDER}\n${fa ? '📥 <b>هدرهای پاسخ</b>' : '📥 <b>Response headers</b>'}\n${headerRows || '—'}\n` +
        `${DIVIDER}\n${fa ? '📄 <b>بدنه‌ی پاسخ</b>' : '📄 <b>Response body</b>'}\n${bodyBlock}`,
      toast: `${response.status} • ${elapsed}ms`,
    };
  },
});
