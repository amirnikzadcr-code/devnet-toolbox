/**
 * Advanced Secret Scanner (requirement 9).
 *
 * **Privacy rule (requirement 15): a matched secret is NEVER echoed back.**
 * Every value passes through `mask()` before it can reach a finding, a log, or
 * the database. The user gets enough context to locate the leak (pattern name,
 * line number, first/last characters) and nothing an observer could reuse.
 */
import type { Finding, Severity } from './types.js';

export interface SecretRule {
  id: string;
  severity: Severity;
  confidence: number;
  pattern: RegExp;
  /** Capture group holding the sensitive part; 0 = whole match. */
  secretGroup?: number;
  title: { fa: string; en: string };
  explanation: { fa: string; en: string };
  recommendation: { fa: string; en: string };
  /** Extra check to suppress obvious placeholders. */
  validate?: (match: string) => boolean;
}

/**
 * Rejects the placeholder values that fill every README and .env.example.
 * Without this the scanner cries wolf on `API_KEY=your_api_key_here`.
 */
const looksLikePlaceholder = (value: string): boolean => {
  const lower = value.toLowerCase();
  return (
    /^(x{4,}|y{4,}|z{4,}|a{6,}|0{6,}|1{6,}|\.{3,})$/.test(lower) ||
    /(your|my|the)[-_]?(api|secret|token|key|password)/.test(lower) ||
    /(example|placeholder|changeme|change_me|dummy|sample|test|fake|redacted|insert|todo|xxx+|<.*>|\{\{.*\}\}|\$\{.*\})/.test(lower) ||
    /^(none|null|undefined|empty|123456|password|secret|abc123)$/.test(lower)
  );
};

/** Shannon entropy — random-looking strings are far likelier to be real keys. */
export function entropy(value: string): number {
  if (value.length === 0) return 0;
  const counts = new Map<string, number>();
  for (const char of value) counts.set(char, (counts.get(char) ?? 0) + 1);
  let total = 0;
  for (const count of counts.values()) {
    const probability = count / value.length;
    total -= probability * Math.log2(probability);
  }
  return total;
}

export const SECRET_RULES: SecretRule[] = [
  {
    id: 'secret.private_key',
    severity: 'critical',
    confidence: 98,
    pattern: /-----BEGIN\s+(RSA|DSA|EC|OPENSSH|PGP|ENCRYPTED)?\s*PRIVATE KEY(\s+BLOCK)?-----/g,
    title: { fa: 'کلید خصوصی رمزنگاری', en: 'Cryptographic private key' },
    explanation: {
      fa: 'یک بلوک کلید خصوصی یافت شد. کلید خصوصی معادل هویت شماست: هرکس آن را داشته باشد می‌تواند به سرور متصل شود، امضا جعل کند یا ترافیک رمزنگاری‌شده را بخواند. این کلید باید همان لحظه که در جایی خارج از محل امن دیده شد، سوخته تلقی شود.',
      en: 'A private-key block was found. A private key is your identity: anyone holding it can authenticate to your servers, forge signatures, or decrypt traffic. The moment it appears outside secure storage it must be considered burned.',
    },
    recommendation: {
      fa: 'کلید را فوراً باطل و جایگزین کنید. حذف فایل کافی نیست — اگر در Git کامیت شده، در تاریخچه باقی می‌ماند.',
      en: 'Revoke and rotate the key immediately. Deleting the file is not enough — if it was committed to Git it remains in history.',
    },
  },
  {
    id: 'secret.aws_access_key',
    severity: 'critical',
    confidence: 95,
    pattern: /\b((?:AKIA|ASIA|ABIA|ACCA|AGPA|AIDA|AIPA|ANPA|ANVA|AROA)[0-9A-Z]{16})\b/g,
    secretGroup: 1,
    title: { fa: 'کلید دسترسی AWS', en: 'AWS access key ID' },
    explanation: {
      fa: 'یک شناسه‌ی کلید دسترسی AWS یافت شد. بات‌های خودکار مخازن عمومی را برای همین الگو پویش می‌کنند و کلیدهای افشاشده معمولاً در کمتر از چند دقیقه برای استخراج ارز دیجیتال استفاده می‌شوند.',
      en: 'An AWS access key ID was found. Automated bots scan public repositories for exactly this pattern, and leaked keys are typically abused for crypto-mining within minutes.',
    },
    recommendation: {
      fa: 'کلید را در کنسول IAM غیرفعال کنید، صورت‌حساب و CloudTrail را بررسی کنید و از IAM Roles به‌جای کلید ثابت استفاده کنید.',
      en: 'Disable the key in the IAM console, review billing and CloudTrail, and prefer IAM roles over static keys.',
    },
  },
  {
    id: 'secret.aws_secret_key',
    severity: 'critical',
    confidence: 70,
    pattern: /\baws_?secret_?access_?key["'\s:=]+([A-Za-z0-9/+=]{40})\b/gi,
    secretGroup: 1,
    title: { fa: 'کلید محرمانه AWS', en: 'AWS secret access key' },
    explanation: {
      fa: 'مقدار کلید محرمانه AWS در کنار نام متغیر آن یافت شد. این کلید همراه با Access Key ID دسترسی کامل به حساب را می‌دهد.',
      en: 'An AWS secret access key value was found next to its variable name. Together with the access key ID it grants full account access.',
    },
    recommendation: {
      fa: 'کلید را فوراً باطل کنید و آن را از تاریخچه‌ی نسخه‌بندی حذف کنید.',
      en: 'Revoke the key immediately and purge it from version-control history.',
    },
  },
  {
    id: 'secret.gcp_key',
    severity: 'critical',
    confidence: 90,
    pattern: /"type"\s*:\s*"service_account"[\s\S]{0,400}?"private_key_id"/g,
    title: { fa: 'فایل کلید حساب سرویس Google Cloud', en: 'Google Cloud service-account key file' },
    explanation: {
      fa: 'ساختار فایل JSON کلید حساب سرویس GCP شناسایی شد. این فایل هویت یک حساب سرویس را در بر دارد و اغلب دسترسی گسترده‌ای به منابع پروژه می‌دهد.',
      en: 'The JSON structure of a GCP service-account key file was detected. It carries a service account’s identity and often grants broad access to project resources.',
    },
    recommendation: {
      fa: 'کلید را در IAM حذف کنید و Workload Identity را جایگزین آن کنید.',
      en: 'Delete the key in IAM and switch to Workload Identity.',
    },
  },
  {
    id: 'secret.google_api_key',
    severity: 'high',
    confidence: 85,
    pattern: /\b(AIza[0-9A-Za-z_-]{35})\b/g,
    secretGroup: 1,
    title: { fa: 'کلید API گوگل', en: 'Google API key' },
    explanation: {
      fa: 'یک کلید API گوگل یافت شد. اگر این کلید محدودسازی (بر اساس دامنه، اپلیکیشن یا API) نداشته باشد، هر کسی می‌تواند با آن سهمیه‌ی شما را مصرف کند و هزینه ایجاد کند.',
      en: 'A Google API key was found. Without restrictions (by referrer, app, or API) anyone can consume your quota and generate charges.',
    },
    recommendation: {
      fa: 'کلید را بازتولید کنید و در Cloud Console برای آن محدودیت تعریف کنید.',
      en: 'Regenerate the key and apply restrictions in the Cloud Console.',
    },
  },
  {
    id: 'secret.github_token',
    severity: 'critical',
    confidence: 95,
    pattern: /\b((?:ghp|gho|ghu|ghs|ghr|github_pat)_[A-Za-z0-9_]{22,255})\b/g,
    secretGroup: 1,
    title: { fa: 'توکن دسترسی GitHub', en: 'GitHub access token' },
    explanation: {
      fa: 'یک توکن GitHub یافت شد. بسته به دامنه‌ی دسترسی، می‌تواند اجازه‌ی خواندن مخازن خصوصی، تغییر کد یا انتشار بسته را بدهد.',
      en: 'A GitHub token was found. Depending on its scopes it can allow reading private repositories, modifying code, or publishing packages.',
    },
    recommendation: {
      fa: 'توکن را در Settings ← Developer settings باطل کنید. GitHub معمولاً توکن‌های عمومی‌شده را خودکار باطل می‌کند، اما به آن اتکا نکنید.',
      en: 'Revoke it under Settings → Developer settings. GitHub often auto-revokes publicly exposed tokens, but do not rely on that.',
    },
  },
  {
    id: 'secret.slack_token',
    severity: 'high',
    confidence: 92,
    pattern: /\b(xox[baprs]-[0-9A-Za-z-]{10,72})\b/g,
    secretGroup: 1,
    title: { fa: 'توکن Slack', en: 'Slack token' },
    explanation: {
      fa: 'یک توکن Slack یافت شد که می‌تواند اجازه‌ی خواندن پیام‌ها و ارسال پیام به‌جای کاربر یا ربات را بدهد.',
      en: 'A Slack token was found; it can allow reading messages and posting as the user or bot.',
    },
    recommendation: { fa: 'توکن را در تنظیمات اپ Slack باطل کنید.', en: 'Revoke it in the Slack app settings.' },
  },
  {
    id: 'secret.telegram_token',
    severity: 'critical',
    confidence: 88,
    pattern: /\b(\d{8,12}:AA[A-Za-z0-9_-]{32,35})\b/g,
    secretGroup: 1,
    title: { fa: 'توکن ربات تلگرام', en: 'Telegram bot token' },
    explanation: {
      fa: 'یک توکن ربات تلگرام یافت شد. هرکس این توکن را داشته باشد کنترل کامل ربات را در اختیار می‌گیرد و می‌تواند پیام‌های کاربران آن را بخواند.',
      en: 'A Telegram bot token was found. Anyone holding it gains full control of the bot and can read its users’ messages.',
    },
    recommendation: {
      fa: 'در @BotFather دستور /revoke را اجرا کنید تا توکن جدید صادر شود.',
      en: 'Run /revoke in @BotFather to issue a new token.',
    },
  },
  {
    id: 'secret.stripe_key',
    severity: 'critical',
    confidence: 95,
    pattern: /\b((?:sk|rk)_(?:live|test)_[A-Za-z0-9]{20,99})\b/g,
    secretGroup: 1,
    title: { fa: 'کلید محرمانه Stripe', en: 'Stripe secret key' },
    explanation: {
      fa: 'کلید محرمانه Stripe یافت شد. کلید live امکان انجام تراکنش مالی و دسترسی به داده‌ی مشتریان را می‌دهد.',
      en: 'A Stripe secret key was found. A live key permits financial transactions and access to customer data.',
    },
    recommendation: { fa: 'کلید را در داشبورد Stripe فوراً بچرخانید.', en: 'Roll the key in the Stripe dashboard immediately.' },
  },
  {
    id: 'secret.openai_key',
    severity: 'high',
    confidence: 90,
    pattern: /\b(sk-(?:proj-|svcacct-|admin-)?[A-Za-z0-9_-]{20,200})\b/g,
    secretGroup: 1,
    title: { fa: 'کلید API سرویس هوش مصنوعی', en: 'AI service API key' },
    explanation: {
      fa: 'یک کلید API با الگوی سرویس‌های هوش مصنوعی (مانند OpenAI) یافت شد. کلید افشاشده مستقیماً روی صورت‌حساب شما مصرف می‌شود.',
      en: 'An API key matching AI-service format (e.g. OpenAI) was found. A leaked key is billed directly to your account.',
    },
    recommendation: { fa: 'کلید را باطل و جایگزین کنید و سقف هزینه تعیین کنید.', en: 'Revoke and rotate the key, and set a spending limit.' },
  },
  {
    id: 'secret.jwt',
    severity: 'high',
    confidence: 85,
    pattern: /\b(eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,})\b/g,
    secretGroup: 1,
    title: { fa: 'توکن JWT', en: 'JSON Web Token' },
    explanation: {
      fa: 'یک JWT یافت شد. توجه کنید که بدنه‌ی JWT فقط Base64 است، نه رمزنگاری‌شده — هرکس آن را ببیند می‌تواند محتوای آن (شناسه‌ی کاربر، نقش‌ها، زمان انقضا) را بخواند. اگر توکن هنوز منقضی نشده باشد، قابل استفاده‌ی مجدد است.',
      en: 'A JWT was found. Note that a JWT payload is Base64, not encrypted — anyone who sees it can read its claims (user id, roles, expiry). If it has not expired it can be replayed.',
    },
    recommendation: {
      fa: 'توکن‌های نشست نباید در کد یا لاگ ذخیره شوند؛ عمر کوتاه برای آن‌ها تعیین کنید.',
      en: 'Session tokens must not be stored in code or logs; give them short lifetimes.',
    },
  },
  {
    id: 'secret.bearer',
    severity: 'high',
    confidence: 70,
    pattern: /\b[Aa]uthorization["'\s:=]+["']?Bearer\s+([A-Za-z0-9_\-.=]{16,})/g,
    secretGroup: 1,
    title: { fa: 'هدر Authorization با توکن Bearer', en: 'Authorization header with bearer token' },
    explanation: {
      fa: 'یک هدر Authorization به‌همراه مقدار توکن یافت شد. چنین مقادیری معمولاً از کپی کردن درخواست‌های واقعی وارد کد یا مستندات می‌شوند و اغلب هنوز معتبرند.',
      en: 'An Authorization header with a token value was found. These usually enter code or docs by copying real requests and are frequently still valid.',
    },
    recommendation: { fa: 'توکن را باطل کنید و نمونه‌های مستندات را با مقدار ساختگی جایگزین کنید.', en: 'Revoke the token and replace documentation samples with dummy values.' },
  },
  {
    id: 'secret.db_url',
    severity: 'critical',
    confidence: 90,
    pattern: /\b((?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis|amqp|mssql|clickhouse|mariadb):\/\/[^\s"'<>{}\\|^`]{1,80}:[^\s"'<>{}\\|^`@]{3,80}@[^\s"'<>{}\\|^`]{3,120})/gi,
    secretGroup: 1,
    title: { fa: 'رشته اتصال پایگاه‌داده با رمز عبور', en: 'Database connection string with credentials' },
    explanation: {
      fa: 'یک آدرس اتصال پایگاه‌داده شامل نام کاربری و رمز عبور یافت شد. اگر پایگاه‌داده از اینترنت قابل دسترسی باشد، این یعنی دسترسی مستقیم به تمام داده‌ها.',
      en: 'A database connection URL containing a username and password was found. If the database is reachable from the internet this means direct access to all data.',
    },
    recommendation: {
      fa: 'رمز را تغییر دهید، اتصال را به شبکه‌ی داخلی محدود کنید و رشته‌ی اتصال را از متغیر محیطی بخوانید.',
      en: 'Change the password, restrict the database to a private network, and read the connection string from an environment variable.',
    },
  },
  {
    id: 'secret.webhook_url',
    severity: 'medium',
    confidence: 90,
    pattern: /\b(https:\/\/(?:hooks\.slack\.com\/services\/[A-Za-z0-9/_-]{20,}|discord(?:app)?\.com\/api\/webhooks\/\d+\/[A-Za-z0-9_-]{20,}|[a-z0-9-]+\.webhook\.office\.com\/[A-Za-z0-9/_-]{20,}))/gi,
    secretGroup: 1,
    title: { fa: 'آدرس Webhook محرمانه', en: 'Secret webhook URL' },
    explanation: {
      fa: 'آدرس یک webhook یافت شد. این آدرس‌ها خودشان نقش رمز عبور را دارند: هرکس آن را داشته باشد می‌تواند در کانال شما پیام منتشر کند.',
      en: 'A webhook URL was found. Such URLs act as passwords in themselves: anyone holding one can post into your channel.',
    },
    recommendation: { fa: 'webhook را حذف و دوباره ایجاد کنید.', en: 'Delete and recreate the webhook.' },
  },
  {
    id: 'secret.npm_token',
    severity: 'high',
    confidence: 90,
    pattern: /\b(npm_[A-Za-z0-9]{36})\b/g,
    secretGroup: 1,
    title: { fa: 'توکن npm', en: 'npm access token' },
    explanation: {
      fa: 'توکن انتشار npm یافت شد. با این توکن می‌توان نسخه‌ی مخرب از بسته‌های شما منتشر کرد — یک حمله‌ی زنجیره‌ی تأمین تمام‌عیار.',
      en: 'An npm publish token was found. It allows publishing a malicious version of your packages — a full supply-chain attack.',
    },
    recommendation: { fa: 'توکن را در تنظیمات npm باطل کنید و 2FA را برای انتشار فعال کنید.', en: 'Revoke it in npm settings and require 2FA for publishing.' },
  },
  {
    id: 'secret.twilio',
    severity: 'high',
    confidence: 88,
    pattern: /\b(SK[0-9a-fA-F]{32}|AC[0-9a-fA-F]{32})\b/g,
    secretGroup: 1,
    title: { fa: 'شناسه حساب/کلید Twilio', en: 'Twilio account SID or API key' },
    explanation: {
      fa: 'شناسه‌ای با الگوی Twilio یافت شد. سوءاستفاده از آن می‌تواند به ارسال انبوه پیامک به هزینه‌ی شما منجر شود.',
      en: 'An identifier matching Twilio format was found. Abuse can lead to mass SMS sending at your expense.',
    },
    recommendation: { fa: 'کلید را در کنسول Twilio باطل کنید.', en: 'Revoke the key in the Twilio console.' },
  },
  {
    id: 'secret.generic_api_key',
    severity: 'medium',
    confidence: 55,
    pattern: /\b(?:api[_-]?key|apikey|access[_-]?token|auth[_-]?token|client[_-]?secret|app[_-]?secret|private[_-]?token|secret[_-]?key)["'\s]*[:=]\s*["']([A-Za-z0-9_\-./+]{16,120})["']/gi,
    secretGroup: 1,
    title: { fa: 'کلید API عمومی', en: 'Generic API key assignment' },
    explanation: {
      fa: 'یک انتساب با نام متغیر مرتبط با کلید/توکن و مقداری با آنتروپی بالا یافت شد. سرویس صادرکننده مشخص نیست، اما شکل مقدار با یک اعتبارنامه‌ی واقعی سازگار است.',
      en: 'An assignment with a key/token-style variable name and a high-entropy value was found. The issuing service is unknown, but the value’s shape is consistent with a real credential.',
    },
    recommendation: {
      fa: 'اعتبارنامه را به متغیر محیطی یا Secret Store منتقل کنید و مقدار فعلی را بچرخانید.',
      en: 'Move the credential to an environment variable or secret store and rotate the current value.',
    },
    validate: (match) => entropy(match) >= 3.0 && !looksLikePlaceholder(match),
  },
  {
    id: 'secret.password_assignment',
    severity: 'medium',
    confidence: 50,
    pattern: /\b(?:password|passwd|pwd|db[_-]?pass)["'\s]*[:=]\s*["']([^"'\s]{8,80})["']/gi,
    secretGroup: 1,
    title: { fa: 'رمز عبور در کد', en: 'Hard-coded password' },
    explanation: {
      fa: 'یک رمز عبور به‌صورت مستقیم در کد نوشته شده است. رمزهای درون کد در تمام کپی‌های مخزن، لاگ‌های CI و ایمیج‌های کانتینر پخش می‌شوند.',
      en: 'A password is written directly into the code. Hard-coded passwords spread into every clone of the repository, CI logs, and container images.',
    },
    recommendation: { fa: 'رمز را بچرخانید و از متغیر محیطی استفاده کنید.', en: 'Rotate the password and read it from an environment variable.' },
    validate: (match) => !looksLikePlaceholder(match) && entropy(match) >= 2.2,
  },
  {
    id: 'secret.high_entropy',
    severity: 'low',
    confidence: 40,
    pattern: /\b([A-Za-z0-9+/]{40,120}={0,2})\b/g,
    secretGroup: 1,
    title: { fa: 'رشته با آنتروپی بالا', en: 'High-entropy string' },
    explanation: {
      fa: 'رشته‌ای طولانی و تصادفی‌نما یافت شد که ممکن است یک اعتبارنامه‌ی کدگذاری‌شده باشد. این یافته با اطمینان پایین گزارش می‌شود، چون هش‌ها، شناسه‌ها و داده‌ی Base64 نیز همین شکل را دارند.',
      en: 'A long, random-looking string was found that may be an encoded credential. Reported with low confidence, because hashes, identifiers, and Base64 data look the same.',
    },
    recommendation: { fa: 'در صورتی که این مقدار اعتبارنامه است، آن را جابه‌جا کنید.', en: 'If this value is a credential, move it out of the file.' },
    validate: (match) => entropy(match) >= 4.5 && !looksLikePlaceholder(match),
  },
];

/**
 * Irreversibly masks a secret for display.
 * Keeps 3 leading and 2 trailing characters only when the value is long enough
 * that those characters cannot meaningfully reduce the search space.
 */
export function mask(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length <= 8) return '•'.repeat(Math.max(4, trimmed.length));
  const head = trimmed.slice(0, 3);
  const tail = trimmed.slice(-2);
  return `${head}${'•'.repeat(Math.min(16, Math.max(4, trimmed.length - 5)))}${tail} (${trimmed.length} chars)`;
}

export interface SecretHit {
  ruleId: string;
  masked: string;
  line: number;
  severity: Severity;
}

export interface SecretScanResult {
  findings: Finding[];
  hits: SecretHit[];
  linesScanned: number;
}

const lineOf = (text: string, index: number): number => {
  let line = 1;
  for (let i = 0; i < index && i < text.length; i++) if (text.charCodeAt(i) === 10) line++;
  return line;
};

/** Scans text for credentials. The input text itself is never retained. */
export function scanSecrets(text: string, sourceLabel = 'input'): SecretScanResult {
  const hits: SecretHit[] = [];
  const byRule = new Map<string, SecretHit[]>();

  for (const rule of SECRET_RULES) {
    // Fresh regex per run: shared /g regexes carry lastIndex between calls.
    const regex = new RegExp(rule.pattern.source, rule.pattern.flags);
    let match: RegExpExecArray | null;
    let guard = 0;

    while ((match = regex.exec(text)) !== null && guard++ < 500) {
      if (match[0].length === 0) {
        regex.lastIndex++;
        continue;
      }
      const raw = rule.secretGroup !== undefined ? (match[rule.secretGroup] ?? match[0]) : match[0];
      if (!raw) continue;
      if (rule.validate && !rule.validate(raw)) continue;

      const hit: SecretHit = {
        ruleId: rule.id,
        masked: mask(raw),
        line: lineOf(text, match.index),
        severity: rule.severity,
      };
      hits.push(hit);
      if (!byRule.has(rule.id)) byRule.set(rule.id, []);
      byRule.get(rule.id)?.push(hit);
    }
  }

  // A specific rule match makes the generic ones redundant on the same line.
  const specificLines = new Set(
    hits.filter((hit) => hit.ruleId !== 'secret.high_entropy' && hit.ruleId !== 'secret.generic_api_key').map((hit) => hit.line),
  );
  for (const generic of ['secret.high_entropy', 'secret.generic_api_key']) {
    const list = byRule.get(generic);
    if (!list) continue;
    const filtered = list.filter((hit) => !specificLines.has(hit.line));
    if (filtered.length === 0) byRule.delete(generic);
    else byRule.set(generic, filtered);
  }

  const findings: Finding[] = [];
  for (const rule of SECRET_RULES) {
    const list = byRule.get(rule.id);
    if (!list || list.length === 0) continue;
    findings.push({
      id: rule.id,
      category: 'secret',
      severity: rule.severity,
      confidence: rule.confidence,
      title: rule.title,
      // Only masked values and line numbers — never the secret itself.
      evidence: list
        .slice(0, 6)
        .map((hit) => `${sourceLabel}:${hit.line} → ${hit.masked}`)
        .concat(list.length > 6 ? [`+${list.length - 6} more`] : []),
      explanation: rule.explanation,
      recommendation: rule.recommendation,
    });
  }

  return {
    findings,
    hits: hits.filter((hit) => byRule.has(hit.ruleId)),
    linesScanned: text.split('\n').length,
  };
}
