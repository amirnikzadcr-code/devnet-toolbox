/**
 * Phishing Analysis (requirement 7).
 *
 * A *layer on top of* the existing URL tooling, not a replacement: host
 * validation still comes from `utils/validate`, and every network request goes
 * through `security/ssrf#safeFetchGuarded`, which re-validates each redirect.
 *
 * Two levels of analysis:
 *   • static  — everything derivable from the URL string itself
 *   • live    — optional fetch that follows and inspects the redirect chain
 */
import type { Finding, Ioc, Severity } from './types.js';
import { classifyHost } from './ioc.js';
import { safeFetchGuarded } from './ssrf.js';
import { isIP } from '../utils/validate.js';

/** Brands most frequently impersonated in credential-phishing campaigns. */
const BRANDS: { name: string; domains: string[]; tokens: string[] }[] = [
  { name: 'Google', domains: ['google.com', 'youtube.com', 'gmail.com'], tokens: ['google', 'gmail', 'youtube', 'gooogle', 'g00gle'] },
  { name: 'Microsoft', domains: ['microsoft.com', 'live.com', 'outlook.com', 'office.com'], tokens: ['microsoft', 'outlook', 'office365', 'onedrive', 'msn'] },
  { name: 'Apple', domains: ['apple.com', 'icloud.com'], tokens: ['apple', 'icloud', 'appleid'] },
  { name: 'Amazon', domains: ['amazon.com', 'aws.amazon.com'], tokens: ['amazon', 'amazonaws'] },
  { name: 'PayPal', domains: ['paypal.com'], tokens: ['paypal', 'paypa1', 'payapl'] },
  { name: 'Facebook', domains: ['facebook.com', 'instagram.com', 'whatsapp.com'], tokens: ['facebook', 'instagram', 'whatsapp', 'faceb00k'] },
  { name: 'Telegram', domains: ['telegram.org', 't.me', 'telegram.me'], tokens: ['telegram', 'telegramm', 'te1egram'] },
  { name: 'Netflix', domains: ['netflix.com'], tokens: ['netflix', 'netfl1x'] },
  { name: 'Binance', domains: ['binance.com'], tokens: ['binance', 'blnance'] },
  { name: 'Coinbase', domains: ['coinbase.com'], tokens: ['coinbase'] },
  { name: 'MetaMask', domains: ['metamask.io'], tokens: ['metamask', 'meta-mask'] },
  { name: 'Steam', domains: ['steampowered.com', 'steamcommunity.com'], tokens: ['steam', 'steamcommunity'] },
  { name: 'GitHub', domains: ['github.com'], tokens: ['github', 'githup'] },
  { name: 'LinkedIn', domains: ['linkedin.com'], tokens: ['linkedin'] },
  { name: 'DHL', domains: ['dhl.com'], tokens: ['dhl'] },
  { name: 'FedEx', domains: ['fedex.com'], tokens: ['fedex'] },
];

/** Words that dominate credential-harvesting URLs. */
const PHISHY_WORDS = [
  'login', 'signin', 'sign-in', 'verify', 'verification', 'account', 'update',
  'secure', 'security', 'confirm', 'unlock', 'suspended', 'billing', 'invoice',
  'password', 'recover', 'recovery', 'wallet', 'authenticate', 'validation',
  'session', 'webscr', 'support', 'alert', 'limited', 'restricted',
];

/** Parameter names whose presence in a link suggests credential/token capture. */
const SENSITIVE_PARAMS = ['password', 'passwd', 'pwd', 'token', 'session', 'sessionid', 'auth', 'apikey', 'api_key', 'secret', 'access_token', 'id_token', 'code', 'otp', 'pin', 'card', 'cvv', 'ssn'];

/** Latin look-alikes for Cyrillic/Greek characters — the homograph core. */
const CONFUSABLES: Record<string, string> = {
  а: 'a', е: 'e', о: 'o', р: 'p', с: 'c', у: 'y', х: 'x', і: 'i', ѕ: 's', ԁ: 'd', һ: 'h', ӏ: 'l',
  α: 'a', ο: 'o', ρ: 'p', ε: 'e', ι: 'i', ν: 'v', τ: 't', κ: 'k', υ: 'u', χ: 'x',
};

/** Levenshtein distance, capped for speed. */
function editDistance(a: string, b: string, max = 3): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      const value = Math.min(
        (current[j - 1] ?? 0) + 1,
        (previous[j] ?? 0) + 1,
        (previous[j - 1] ?? 0) + cost,
      );
      current.push(value);
      if (value < rowMin) rowMin = value;
    }
    if (rowMin > max) return max + 1;
    previous = current;
  }
  return previous[b.length] ?? max + 1;
}


/**
 * Decodes a punycode label (RFC 3492) back to Unicode.
 *
 * Required, not cosmetic: `new URL()` normalises an IDN host to its ASCII
 * `xn--` form, so `url.hostname` never contains the original characters. Any
 * homograph check that inspects `hostname` directly is therefore dead code —
 * the confusable characters only reappear after decoding.
 */
function punyDecodeLabel(label: string): string {
  if (!label.startsWith('xn--')) return label;
  const input = label.slice(4);
  const base = 36;
  const tMin = 1;
  const tMax = 26;
  const skew = 38;
  const damp = 700;
  const initialBias = 72;
  const initialN = 128;

  const delimiter = input.lastIndexOf('-');
  const output: number[] = [];
  for (let i = 0; i < (delimiter < 0 ? 0 : delimiter); i++) output.push(input.charCodeAt(i));

  const adapt = (delta: number, numPoints: number, firstTime: boolean): number => {
    let d = firstTime ? Math.floor(delta / damp) : delta >> 1;
    d += Math.floor(d / numPoints);
    let k = 0;
    while (d > ((base - tMin) * tMax) >> 1) {
      d = Math.floor(d / (base - tMin));
      k += base;
    }
    return k + Math.floor(((base - tMin + 1) * d) / (d + skew));
  };

  let n = initialN;
  let bias = initialBias;
  let i = 0;

  for (let index = delimiter < 0 ? 0 : delimiter + 1; index < input.length; ) {
    const oldi = i;
    let w = 1;
    for (let k = base; ; k += base) {
      if (index >= input.length) return label; // malformed
      const code = input.charCodeAt(index++);
      let digit: number;
      if (code >= 0x30 && code <= 0x39) digit = code - 0x30 + 26;
      else if (code >= 0x61 && code <= 0x7a) digit = code - 0x61;
      else if (code >= 0x41 && code <= 0x5a) digit = code - 0x41;
      else return label;

      i += digit * w;
      const t = k <= bias ? tMin : k >= bias + tMax ? tMax : k - bias;
      if (digit < t) break;
      w *= base - t;
    }
    const outLength = output.length + 1;
    bias = adapt(i - oldi, outLength, oldi === 0);
    n += Math.floor(i / outLength);
    i %= outLength;
    output.splice(i, 0, n);
    i++;
  }

  try {
    return String.fromCodePoint(...output);
  } catch {
    return label;
  }
}

/** Decodes every punycode label in a host. */
export function punyDecodeHost(host: string): string {
  return host.split('.').map(punyDecodeLabel).join('.');
}

/** Extracts the registrable part, good enough without a public-suffix list. */
export function registrableDomain(host: string): string {
  const labels = host.toLowerCase().split('.');
  if (labels.length <= 2) return labels.join('.');
  const twoLevelTlds = new Set(['co.uk', 'com.au', 'co.jp', 'com.br', 'co.in', 'com.tr', 'co.kr', 'com.mx', 'co.za', 'com.cn', 'org.uk', 'net.au', 'ac.uk', 'gov.uk', 'com.ar', 'co.nz']);
  const lastTwo = labels.slice(-2).join('.');
  return twoLevelTlds.has(lastTwo) ? labels.slice(-3).join('.') : lastTwo;
}

export interface PhishingStatic {
  findings: Finding[];
  iocs: Ioc[];
  /** 0..100 — share of indicators that fired, used for the confidence figure. */
  indicatorRatio: number;
}

/** Analyses everything derivable from the URL string alone. */
export function analyseUrlStatic(url: URL): PhishingStatic {
  const findings: Finding[] = [];
  const iocs: Ioc[] = [];
  const host = url.hostname.toLowerCase();
  const registrable = registrableDomain(host);
  const fullUrl = url.href;
  let checks = 0;

  const add = (finding: Finding) => {
    findings.push(finding);
  };

  // ── 1. Punycode / IDN
  checks++;
  if (host.includes('xn--')) {
    // Show the human-readable form: that is what the victim would see.
    const decoded = punyDecodeHost(host);
    add({
      id: 'phish.punycode',
      category: 'phishing',
      severity: 'high',
      confidence: 85,
      title: { fa: 'دامنه‌ی Punycode (کاراکتر غیرلاتین)', en: 'Punycode domain (non-Latin characters)' },
      evidence: [host, decoded !== host ? `decoded: ${decoded}` : 'IDN encoding detected'],
      explanation: {
        fa: 'این دامنه با Punycode کدگذاری شده است، یعنی حاوی کاراکترهای غیرلاتین است. مرورگر ممکن است آن را به شکل حروف عادی نمایش دهد؛ به این ترتیب دامنه‌ای که در نوار آدرس «apple.com» به نظر می‌رسد می‌تواند در واقع دامنه‌ی دیگری با حروف سیریلیک باشد. استفاده‌ی مشروع (دامنه‌های فارسی، چینی و…) هم وجود دارد، اما در پیوندهای ناخواسته این یک هشدار جدی است.',
        en: 'The domain is Punycode-encoded, meaning it contains non-Latin characters. A browser may render it as ordinary letters, so a domain that reads "apple.com" in the address bar can in fact be a different domain written in Cyrillic. Legitimate uses exist (Persian, Chinese domains…), but in an unsolicited link this is a serious warning.',
      },
      recommendation: {
        fa: 'آدرس را با کپی کردن در ویرایشگر متن بررسی کنید تا شکل واقعی آن را ببینید.',
        en: 'Paste the address into a text editor to see its true form.',
      },
    });
  }

  // ── 2. Homograph / confusable characters
  checks++;
  // Against the decoded host: `url.hostname` is always ASCII punycode.
  const unicodeHost = punyDecodeHost(host);
  const confusableChars = [...unicodeHost].filter((char) => CONFUSABLES[char] !== undefined);
  if (confusableChars.length > 0) {
    const normalised = [...unicodeHost].map((char) => CONFUSABLES[char] ?? char).join('');
    add({
      id: 'phish.homograph',
      category: 'phishing',
      severity: 'critical',
      confidence: 90,
      title: { fa: 'حمله‌ی هوموگراف (کاراکترهای هم‌شکل)', en: 'Homograph attack (look-alike characters)' },
      evidence: [
        `punycode: ${host}`,
        `actual: ${unicodeHost}`,
        `confusable chars: ${[...new Set(confusableChars)].join(' ')}`,
        `reads as: ${normalised}`,
      ],
      explanation: {
        fa: `این دامنه شامل کاراکترهایی است که ظاهری یکسان با حروف لاتین دارند اما کد متفاوتی دارند. چشم انسان تفاوت را تشخیص نمی‌دهد: دامنه در نگاه اول «${normalised}» خوانده می‌شود، در حالی که دامنه‌ی واقعی چیز دیگری است. این تکنیک تقریباً همیشه با قصد فریب به کار می‌رود.`,
        en: `The domain contains characters that look identical to Latin letters but have different code points. The human eye cannot tell: it reads as "${normalised}" while the actual domain is something else. This technique is almost always deliberate deception.`,
      },
      recommendation: { fa: 'این لینک را باز نکنید.', en: 'Do not open this link.' },
    });
  }

  // ── 3. IP address instead of a name
  checks++;
  if (isIP(host)) {
    add({
      id: 'phish.ip_host',
      category: 'phishing',
      severity: 'medium',
      confidence: 85,
      title: { fa: 'استفاده از آدرس IP به‌جای نام دامنه', en: 'Raw IP address instead of a domain name' },
      evidence: [host],
      explanation: {
        fa: 'لینک مستقیماً به یک آدرس IP اشاره می‌کند. سرویس‌های واقعی تقریباً همیشه نام دامنه دارند؛ IP خام معمولاً یعنی سرور موقت، بدون گواهی معتبر و بدون سابقه‌ی قابل بررسی.',
        en: 'The link points directly at an IP address. Real services almost always use a domain name; a bare IP usually means a temporary server with no valid certificate and no traceable history.',
      },
    });
    iocs.push({ kind: 'ip', value: host, sources: ['url'], severity: 'medium', confidence: 90 });
  } else {
    iocs.push({ kind: 'domain', value: host, sources: ['url'], severity: classifyHost(host).severity, confidence: 90 });
  }

  // ── 4. Transport security
  checks++;
  if (url.protocol === 'http:') {
    add({
      id: 'phish.no_https',
      category: 'phishing',
      severity: 'medium',
      confidence: 100,
      title: { fa: 'ارتباط بدون رمزنگاری (HTTP)', en: 'Unencrypted connection (HTTP)' },
      evidence: [`${url.protocol}//${host}`],
      explanation: {
        fa: 'این صفحه از HTTPS استفاده نمی‌کند. هر داده‌ای که در آن وارد کنید به‌صورت متن ساده روی شبکه منتقل می‌شود. امروزه گواهی رایگان در دسترس همه است، بنابراین نبود HTTPS در صفحه‌ای که اطلاعات می‌خواهد، غیرعادی است.',
        en: 'The page does not use HTTPS. Anything you type is transmitted in clear text. Free certificates are universally available today, so the absence of HTTPS on a page requesting information is abnormal.',
      },
    });
  }

  // ── 5. Suspicious TLD / risky hosting
  checks++;
  const hostVerdict = classifyHost(host);
  if (hostVerdict.severity !== 'safe' && hostVerdict.note) {
    add({
      id: 'phish.host_reputation',
      category: 'phishing',
      severity: hostVerdict.severity,
      confidence: 75,
      title: { fa: 'میزبانی یا دامنه‌ی پرریسک', en: 'Risky hosting or TLD' },
      evidence: [host],
      explanation: {
        fa: `${hostVerdict.note.fa}. زیرساخت ارزان یا یک‌بارمصرف برای کمپین‌های فیشینگ ترجیح داده می‌شود، چون پس از مسدود شدن به‌سادگی جایگزین می‌شود.`,
        en: `${hostVerdict.note.en}. Cheap or disposable infrastructure is preferred for phishing campaigns because it is trivially replaced once blocked.`,
      },
    });
  }

  // ── 6. Brand impersonation
  checks++;
  for (const brand of BRANDS) {
    if (brand.domains.includes(registrable)) break; // genuine domain
    const hostTokens = host.split(/[.\-_]/);
    const inSubdomain = brand.tokens.some((token) => hostTokens.includes(token) || host.includes(token));
    const inPath = brand.tokens.some((token) => url.pathname.toLowerCase().includes(token));
    const nameLabel = registrable.split('.')[0] ?? '';
    const typo = brand.domains.some((domain) => {
      const brandLabel = domain.split('.')[0] ?? '';
      return brandLabel.length >= 5 && editDistance(nameLabel, brandLabel) > 0 && editDistance(nameLabel, brandLabel) <= 2;
    });

    if (inSubdomain || typo || (inPath && hostVerdict.severity !== 'safe')) {
      add({
        id: 'phish.brand_impersonation',
        category: 'phishing',
        severity: typo ? 'critical' : 'high',
        confidence: typo ? 88 : 75,
        title: { fa: `جعل هویت برند: ${brand.name}`, en: `Brand impersonation: ${brand.name}` },
        evidence: [
          `host: ${host}`,
          `registrable domain: ${registrable}`,
          `official: ${brand.domains.join(', ')}`,
        ],
        explanation: {
          fa: `آدرس به «${brand.name}» اشاره می‌کند اما دامنه‌ی ثبت‌شده‌ی آن «${registrable}» است و به این برند تعلق ندارد.${
            typo ? ' نام دامنه تنها با یکی دو حرف با دامنه‌ی رسمی تفاوت دارد — الگوی کلاسیک typosquatting.' : ' نام برند در زیردامنه یا مسیر قرار داده شده است تا در نگاه سریع معتبر به نظر برسد.'
          } آنچه در یک آدرس اهمیت دارد، بخش درست قبل از اولین اسلش است، نه ابتدای آن.`,
          en: `The address references "${brand.name}" but its registrable domain is "${registrable}", which does not belong to that brand.${
            typo ? ' The name differs from the official domain by only one or two characters — classic typosquatting.' : ' The brand name is placed in a subdomain or path so it looks legitimate at a glance.'
          } What matters in a URL is the part immediately before the first slash, not the beginning.`,
        },
        recommendation: {
          fa: `به‌جای کلیک روی لینک، آدرس رسمی ${brand.domains[0]} را مستقیماً در مرورگر وارد کنید.`,
          en: `Instead of clicking the link, type the official address ${brand.domains[0]} into your browser.`,
        },
      });
      break;
    }
  }

  // ── 7. Login page indicators
  checks++;
  const haystack = `${url.pathname}${url.search}`.toLowerCase();
  const wordHits = PHISHY_WORDS.filter((word) => haystack.includes(word) || host.includes(word));
  if (wordHits.length >= 2) {
    add({
      id: 'phish.login_keywords',
      category: 'phishing',
      severity: wordHits.length >= 3 ? 'medium' : 'low',
      confidence: 65,
      title: { fa: 'واژگان مرتبط با صفحه‌ی ورود', en: 'Credential-page keywords' },
      evidence: wordHits.slice(0, 6),
      explanation: {
        fa: 'آدرس شامل چند واژه‌ی مرتبط با ورود، تأیید هویت یا مسدود شدن حساب است. این واژگان به‌تنهایی مشکوک نیستند، اما تراکم آن‌ها در یک آدرس، الگوی معمول صفحات جمع‌آوری اعتبارنامه است.',
        en: 'The address contains several words related to login, verification, or account suspension. Individually harmless, but such density in one URL is the typical pattern of credential-harvesting pages.',
      },
    });
  }

  // ── 8. Sensitive parameters
  checks++;
  const sensitive = [...url.searchParams.keys()].filter((key) => SENSITIVE_PARAMS.includes(key.toLowerCase()));
  if (sensitive.length > 0) {
    add({
      id: 'phish.sensitive_params',
      category: 'phishing',
      severity: 'medium',
      confidence: 80,
      title: { fa: 'پارامترهای حساس در آدرس', en: 'Sensitive parameters in the URL' },
      // Names only — values may themselves be secrets.
      evidence: sensitive.map((key) => `${key}=<hidden>`),
      explanation: {
        fa: 'آدرس شامل پارامترهایی با نام حساس است. مقادیر این پارامترها در تاریخچه‌ی مرورگر، لاگ سرور و هدر Referer ثبت می‌شوند؛ به همین دلیل مقادیر آن‌ها در این گزارش نمایش داده نشده‌اند.',
        en: 'The URL contains sensitively named parameters. Their values end up in browser history, server logs and the Referer header — which is why the values are not shown in this report.',
      },
    });
  }

  // ── 9. Embedded credentials / @ trick
  checks++;
  if (url.username || url.password || fullUrl.includes('@')) {
    const beforeAt = fullUrl.split('://')[1]?.split('/')[0] ?? '';
    if (beforeAt.includes('@')) {
      add({
        id: 'phish.userinfo_trick',
        category: 'phishing',
        severity: 'high',
        confidence: 85,
        title: { fa: 'ترفند «@» در آدرس', en: 'The "@" URL trick' },
        evidence: [`authority: ${beforeAt.replace(/:[^@]*@/, ':<hidden>@')}`],
        explanation: {
          fa: 'در یک آدرس، هر چیزی که پیش از علامت @ بیاید نام کاربری است و مرورگر آن را نادیده می‌گیرد؛ مقصد واقعی بخش پس از @ است. مهاجمان با نوشتن نام یک سایت معتبر پیش از @، آدرس را قابل‌اعتماد جلوه می‌دهند.',
          en: 'In a URL everything before the "@" is a username the browser ignores; the real destination is what follows it. Attackers put a trusted site’s name before the "@" to make the address look legitimate.',
        },
        recommendation: { fa: 'همیشه بخش بلافاصله پس از @ را به‌عنوان مقصد واقعی بخوانید.', en: 'Always read the part immediately after "@" as the true destination.' },
      });
    }
  }

  // ── 10. Excessive subdomains / long host
  checks++;
  const labelCount = host.split('.').length;
  if (labelCount >= 5 || host.length > 50) {
    add({
      id: 'phish.subdomain_stuffing',
      category: 'phishing',
      severity: 'low',
      confidence: 70,
      title: { fa: 'انباشت زیردامنه', en: 'Subdomain stuffing' },
      evidence: [`${labelCount} labels, ${host.length} characters`],
      explanation: {
        fa: 'دامنه لایه‌های زیردامنه‌ی زیادی دارد. این کار باعث می‌شود بخش واقعی دامنه در نوار آدرس گوشی از دید خارج شود — روشی رایج برای پنهان کردن مقصد اصلی.',
        en: 'The host has many subdomain levels. This pushes the real domain out of view in a mobile address bar — a common way to hide the true destination.',
      },
    });
  }

  // ── 11. Encoded/obfuscated path
  checks++;
  const encodedRatio = (fullUrl.match(/%[0-9a-fA-F]{2}/g) ?? []).length;
  if (encodedRatio >= 6 || /(%25|%252)/i.test(fullUrl)) {
    add({
      id: 'phish.encoded_url',
      category: 'phishing',
      severity: 'medium',
      confidence: 70,
      title: { fa: 'کدگذاری بیش از حد در آدرس', en: 'Heavily encoded URL' },
      evidence: [`${encodedRatio} percent-encoded sequences`],
      explanation: {
        fa: 'آدرس به‌شکل غیرعادی کدگذاری شده است. کدگذاری چندلایه معمولاً برای عبور از فیلترها و پنهان کردن مقصد یا محتوای واقعی پارامترها استفاده می‌شود.',
        en: 'The URL is unusually encoded. Multi-layer encoding is typically used to bypass filters and hide the real destination or parameter content.',
      },
    });
  }

  // ── 12. Data / file-download links
  checks++;
  if (/\.(apk|exe|scr|bat|cmd|jar|msi|dmg|vbs|ps1|hta)(\?|$)/i.test(url.pathname)) {
    const extension = url.pathname.split('.').pop()?.split('?')[0] ?? '';
    add({
      id: 'phish.executable_download',
      category: 'phishing',
      severity: 'high',
      confidence: 85,
      title: { fa: 'لینک مستقیم به فایل اجرایی', en: 'Direct link to an executable file' },
      evidence: [`.${extension}`, url.pathname.slice(0, 100)],
      explanation: {
        fa: `این لینک مستقیماً یک فایل اجرایی (.${extension}) دانلود می‌کند. دریافت نرم‌افزار از لینک‌های ارسالی در پیام، خارج از فروشگاه رسمی، متداول‌ترین راه آلوده شدن دستگاه است.`,
        en: `The link downloads an executable file (.${extension}) directly. Installing software from links received in messages, outside official stores, is the most common infection route.`,
      },
      recommendation: {
        fa: 'فایل را نصب نکنید. اگر لازم است، ابتدا آن را با همین ربات (تحلیل APK) بررسی کنید.',
        en: 'Do not install it. If needed, analyse the file first with this bot’s APK scanner.',
      },
    });
  }

  const fired = new Set(findings.map((finding) => finding.id)).size;
  return { findings, iocs, indicatorRatio: Math.round((fired / checks) * 100) };
}

export interface RedirectHop {
  url: string;
  status: number;
}

export interface PhishingLive {
  findings: Finding[];
  iocs: Ioc[];
  chain: RedirectHop[];
  finalUrl: string;
  status: number;
  /** Present only when the body could be read. */
  bodyIndicators?: string[];
}

const LOGIN_FORM_PATTERNS: { pattern: RegExp; fa: string; en: string }[] = [
  { pattern: /<input[^>]+type=["']?password/i, fa: 'فیلد ورود رمز عبور', en: 'password input field' },
  { pattern: /<form[^>]+action=["']?https?:\/\//i, fa: 'ارسال فرم به دامنه‌ی خارجی', en: 'form posting to an external domain' },
  { pattern: /(otp|two[- ]?factor|verification code|کد تایید|رمز یکبار)/i, fa: 'درخواست کد یک‌بارمصرف', en: 'one-time code request' },
  { pattern: /(card number|cvv|expiry|شماره کارت|رمز دوم)/i, fa: 'درخواست اطلاعات کارت بانکی', en: 'bank-card details request' },
  { pattern: /<meta[^>]+http-equiv=["']?refresh/i, fa: 'هدایت خودکار با meta refresh', en: 'automatic meta-refresh redirect' },
  { pattern: /window\.location\s*(\.href)?\s*=/i, fa: 'هدایت با جاوااسکریپت', en: 'JavaScript-based redirect' },
];

/**
 * Follows the URL live through the SSRF-guarded fetcher and inspects the
 * redirect chain plus the final document.
 */
export async function analyseUrlLive(url: URL, timeoutMs = 8000): Promise<PhishingLive> {
  const findings: Finding[] = [];
  const iocs: Ioc[] = [];

  const response = await safeFetchGuarded(url.href, {
    method: 'GET',
    timeoutMs,
    maxBytes: 64 * 1024,
    headers: { accept: 'text/html,application/xhtml+xml' },
  });

  // `chain[i]` is the URL requested at hop i; `hopStatuses[i]` is the redirect
  // status that led away from it. The last URL has the final response status.
  const chain: RedirectHop[] = response.chain.map((hopUrl, index) => ({
    url: hopUrl,
    status: response.hopStatuses[index] ?? response.status,
  }));
  const startHost = url.hostname.toLowerCase();
  const finalHost = (() => {
    try {
      return new URL(response.url).hostname.toLowerCase();
    } catch {
      return startHost;
    }
  })();

  // ── Cross-domain redirect
  if (chain.length > 1) {
    const crossDomain = registrableDomain(finalHost) !== registrableDomain(startHost);
    findings.push({
      id: crossDomain ? 'phish.redirect_cross_domain' : 'phish.redirect_chain',
      category: 'phishing',
      severity: crossDomain ? 'high' : 'low',
      confidence: 90,
      title: crossDomain
        ? { fa: 'هدایت به دامنه‌ی دیگر', en: 'Redirect to a different domain' }
        : { fa: 'زنجیره‌ی هدایت', en: 'Redirect chain' },
      evidence: chain.map((hop, index) => `${index + 1}. [${hop.status}] ${hop.url.slice(0, 120)}`),
      explanation: crossDomain
        ? {
            fa: `آدرس اولیه روی «${startHost}» بود اما مقصد نهایی «${finalHost}» است. آنچه کاربر می‌بیند و آنچه واقعاً باز می‌شود دو چیز متفاوت‌اند؛ این روش استاندارد پنهان کردن مقصد در پیام‌های فیشینگ است.`,
            en: `The link starts on "${startHost}" but ends on "${finalHost}". What the user sees and what actually opens are different — the standard way phishing messages hide their destination.`,
          }
        : {
            fa: `آدرس پیش از رسیدن به مقصد از ${chain.length} مرحله عبور می‌کند. زنجیره‌ی هدایت به‌خودی‌خود مشکل نیست، اما هر مرحله فرصتی برای تغییر مقصد است.`,
            en: `The address passes through ${chain.length} hops before its destination. A redirect chain is not a problem in itself, but each hop is an opportunity to change the target.`,
          },
      ...(crossDomain
        ? {
            recommendation: {
              fa: 'پیش از وارد کردن هر اطلاعاتی، دامنه‌ی نهایی را در نوار آدرس بررسی کنید.',
              en: 'Verify the final domain in the address bar before entering any information.',
            },
          }
        : {}),
    });

    for (const hop of chain) {
      try {
        const hopHost = new URL(hop.url).hostname;
        const verdict = classifyHost(hopHost);
        iocs.push({
          kind: 'domain',
          value: hopHost,
          sources: ['redirect-chain'],
          severity: verdict.severity,
          confidence: 85,
          ...(verdict.note ? { note: verdict.note } : {}),
        });
      } catch {
        // Malformed hop URL — the guard already rejected anything unsafe.
      }
    }
  }

  // ── HTTPS downgrade
  const downgraded = chain.some((hop, index) => index > 0 && hop.url.startsWith('http://')) || response.url.startsWith('http://');
  if (downgraded && url.protocol === 'https:') {
    findings.push({
      id: 'phish.https_downgrade',
      category: 'phishing',
      severity: 'high',
      confidence: 90,
      title: { fa: 'تنزل از HTTPS به HTTP', en: 'HTTPS to HTTP downgrade' },
      evidence: chain.filter((hop) => hop.url.startsWith('http://')).map((hop) => hop.url.slice(0, 120)),
      explanation: {
        fa: 'زنجیره‌ی هدایت از ارتباط رمزنگاری‌شده به ارتباط ساده تنزل پیدا می‌کند. هیچ سرویس معتبری کاربر را از HTTPS به HTTP نمی‌برد.',
        en: 'The redirect chain downgrades from an encrypted to an unencrypted connection. No legitimate service moves a user from HTTPS to HTTP.',
      },
    });
  }

  // ── Body inspection
  const bodyIndicators: string[] = [];
  if (response.body) {
    for (const { pattern, fa, en } of LOGIN_FORM_PATTERNS) {
      if (pattern.test(response.body)) bodyIndicators.push(`${en} / ${fa}`);
    }

    const hasPasswordField = /<input[^>]+type=["']?password/i.test(response.body);
    if (hasPasswordField) {
      findings.push({
        id: 'phish.login_form',
        category: 'phishing',
        severity: response.url.startsWith('http://') ? 'critical' : 'medium',
        confidence: 85,
        title: { fa: 'صفحه شامل فرم ورود رمز عبور', en: 'Page contains a password form' },
        evidence: bodyIndicators.slice(0, 5),
        explanation: {
          fa: `این صفحه فرم دریافت رمز عبور دارد.${
            response.url.startsWith('http://')
              ? ' صفحه روی HTTP بدون رمزنگاری ارائه می‌شود، بنابراین رمز واردشده به‌صورت متن ساده منتقل می‌شود — این ترکیب به‌ندرت اتفاقی است.'
              : ' وجود فرم ورود به‌تنهایی مشکل نیست؛ آنچه اهمیت دارد این است که دامنه‌ی صفحه واقعاً متعلق به همان سرویسی باشد که ادعا می‌کند.'
          }`,
          en: `The page contains a password form.${
            response.url.startsWith('http://')
              ? ' It is served over unencrypted HTTP, so the entered password travels in clear text — that combination is rarely accidental.'
              : ' A login form is not a problem by itself; what matters is that the page’s domain genuinely belongs to the service it claims to be.'
          }`,
        },
        recommendation: {
          fa: 'اعتبارنامه را فقط در دامنه‌ای وارد کنید که خودتان تایپ کرده‌اید یا در نشانک‌ها ذخیره کرده‌اید.',
          en: 'Only enter credentials on a domain you typed yourself or opened from a bookmark.',
        },
      });
    }

    // Title/brand mismatch
    const titleMatch = response.body.match(/<title[^>]*>([^<]{1,120})<\/title>/i);
    const title = titleMatch?.[1]?.trim() ?? '';
    if (title) {
      for (const brand of BRANDS) {
        const titleLower = title.toLowerCase();
        const mentions = brand.tokens.some((token) => titleLower.includes(token));
        if (mentions && !brand.domains.includes(registrableDomain(finalHost))) {
          findings.push({
            id: 'phish.title_mismatch',
            category: 'phishing',
            severity: 'high',
            confidence: 80,
            title: { fa: 'ناهم‌خوانی عنوان صفحه با دامنه', en: 'Page title does not match the domain' },
            evidence: [`title: ${title.slice(0, 80)}`, `domain: ${finalHost}`],
            explanation: {
              fa: `عنوان صفحه به «${brand.name}» اشاره می‌کند، اما صفحه روی دامنه‌ی «${finalHost}» میزبانی شده که متعلق به این برند نیست. صفحه خود را چیزی معرفی می‌کند که نیست.`,
              en: `The page title references "${brand.name}", but the page is hosted on "${finalHost}", which does not belong to that brand. The page presents itself as something it is not.`,
            },
            recommendation: { fa: 'در این صفحه هیچ اطلاعاتی وارد نکنید.', en: 'Do not enter any information on this page.' },
          });
          break;
        }
      }
    }
  }

  return {
    findings,
    iocs,
    chain,
    finalUrl: response.url,
    status: response.status,
    ...(bodyIndicators.length > 0 ? { bodyIndicators } : {}),
  };
}

/** Correlation rules specific to phishing verdicts. */
export const PHISHING_CORRELATIONS = [
  {
    id: 'phish.corr.credential_harvest',
    requires: ['phish.login_form', 'phish.brand_impersonation'],
    severity: 'critical' as Severity,
    confidence: 92,
    title: { fa: 'صفحه‌ی سرقت اعتبارنامه', en: 'Credential-harvesting page' },
    explanation: {
      fa: 'دو نشانه‌ی مستقل کنار هم قرار گرفته‌اند: صفحه فرم دریافت رمز عبور دارد و هم‌زمان خود را به‌جای یک برند شناخته‌شده جا می‌زند در حالی که دامنه‌اش متعلق به آن برند نیست. این دقیقاً تعریف یک صفحه‌ی فیشینگ است.',
      en: 'Two independent indicators coincide: the page presents a password form while impersonating a well-known brand on a domain that does not belong to it. This is the definition of a phishing page.',
    },
    recommendation: {
      fa: 'هیچ اطلاعاتی وارد نکنید. اگر پیش‌تر اطلاعاتی وارد کرده‌اید، فوراً رمز آن سرویس را از طریق سایت رسمی تغییر دهید.',
      en: 'Enter nothing. If you already submitted data, change that service’s password immediately via its official site.',
    },
  },
  {
    id: 'phish.corr.hidden_destination',
    requires: ['phish.redirect_cross_domain', 'phish.host_reputation', 'phish.login_keywords'],
    minMatches: 2,
    severity: 'high' as Severity,
    confidence: 80,
    title: { fa: 'پنهان‌سازی مقصد واقعی', en: 'Concealed final destination' },
    explanation: {
      fa: 'لینک کاربر را به دامنه‌ای دیگر روی زیرساخت پرریسک هدایت می‌کند و واژگان آدرس نیز به صفحه‌ی ورود اشاره دارد. ترکیب پنهان‌کاری مقصد با محتوای مرتبط با احراز هویت، الگوی رایج کمپین‌های فیشینگ است.',
      en: 'The link redirects to a different domain on risky infrastructure, and the URL wording points to a login page. Concealing the destination while presenting authentication-related content is a common phishing pattern.',
    },
  },
  {
    id: 'phish.corr.deceptive_domain',
    requires: ['phish.homograph', 'phish.punycode', 'phish.brand_impersonation'],
    minMatches: 2,
    severity: 'critical' as Severity,
    confidence: 90,
    title: { fa: 'دامنه‌ی عمداً فریبنده', en: 'Deliberately deceptive domain' },
    explanation: {
      fa: 'دامنه هم‌زمان از کاراکترهای هم‌شکل یا کدگذاری IDN استفاده می‌کند و نام یک برند شناخته‌شده را تقلید می‌کند. این ترکیب اتفاقی نیست؛ هدف آن این است که آدرس در نگاه کاربر معتبر به نظر برسد.',
      en: 'The domain simultaneously uses look-alike characters or IDN encoding and mimics a known brand. This combination is not accidental; its purpose is to make the address look legitimate to the user.',
    },
    recommendation: { fa: 'این آدرس را باز نکنید و آن را گزارش کنید.', en: 'Do not open this address; report it.' },
  },
];
