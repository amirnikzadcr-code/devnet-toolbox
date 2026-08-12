import { defineTool } from '../types.js';
import { codeBlock, DIVIDER, escapeHtml, mono } from '../../utils/text.js';
import { errInvalidInput } from '../../utils/errors.js';
import { parseHttpUrl } from '../../utils/validate.js';

// ─── Calculator (safe expression evaluator, no eval) ───────
type Token = { type: 'num'; value: number } | { type: 'op'; value: string } | { type: 'fn'; value: string };

const FUNCTIONS: Record<string, (x: number) => number> = {
  sqrt: Math.sqrt, abs: Math.abs, sin: Math.sin, cos: Math.cos, tan: Math.tan,
  log: Math.log10, ln: Math.log, exp: Math.exp, floor: Math.floor, ceil: Math.ceil,
  round: Math.round, sign: Math.sign,
};
const CONSTANTS: Record<string, number> = { pi: Math.PI, e: Math.E };
const PRECEDENCE: Record<string, number> = { '+': 1, '-': 1, '*': 2, '/': 2, '%': 2, '^': 3 };

function tokenize(expr: string): Token[] {
  const tokens: Token[] = [];
  const src = expr.replace(/\s+/g, '').replace(/×/g, '*').replace(/÷/g, '/').replace(/,/g, '');
  let i = 0;
  while (i < src.length) {
    const ch = src[i] as string;
    if (/[0-9.]/.test(ch)) {
      let num = '';
      while (i < src.length && /[0-9.eE]/.test(src[i] as string)) {
        // scientific notation sign
        if (/[eE]/.test(src[i] as string) && /[+-]/.test(src[i + 1] ?? '')) {
          num += src[i] as string;
          i += 1;
        }
        num += src[i] as string;
        i += 1;
      }
      const value = Number(num);
      if (!Number.isFinite(value)) {
        throw errInvalidInput(`عدد نامعتبر: ${num}`, `Invalid number: ${num}`);
      }
      tokens.push({ type: 'num', value });
      continue;
    }
    if (/[a-z]/i.test(ch)) {
      let name = '';
      while (i < src.length && /[a-z]/i.test(src[i] as string)) {
        name += src[i] as string;
        i += 1;
      }
      const lower = name.toLowerCase();
      if (lower in CONSTANTS) tokens.push({ type: 'num', value: CONSTANTS[lower] as number });
      else if (lower in FUNCTIONS) tokens.push({ type: 'fn', value: lower });
      else throw errInvalidInput(`تابع یا ثابت ناشناخته: ${name}`, `Unknown function/constant: ${name}`);
      continue;
    }
    if ('+-*/%^()'.includes(ch)) {
      tokens.push({ type: 'op', value: ch });
      i += 1;
      continue;
    }
    throw errInvalidInput(`کاراکتر غیرمجاز: ${ch}`, `Illegal character: ${ch}`);
  }
  return tokens;
}

/** Shunting-yard → RPN evaluation. Never uses eval/Function. */
export function evaluateExpression(expr: string): number {
  if (expr.length > 200) {
    throw errInvalidInput('عبارت بیش از حد طولانی است.', 'Expression too long.');
  }
  const tokens = tokenize(expr);
  if (!tokens.length) throw errInvalidInput('عبارت خالی است.', 'Empty expression.');

  // unary minus → 0 - x
  const normalized: Token[] = [];
  for (let i = 0; i < tokens.length; i += 1) {
    const tok = tokens[i] as Token;
    const prev = normalized[normalized.length - 1];
    const isUnary =
      tok.type === 'op' &&
      (tok.value === '-' || tok.value === '+') &&
      (!prev || (prev.type === 'op' && prev.value !== ')'));
    if (isUnary) {
      normalized.push({ type: 'num', value: 0 });
    }
    normalized.push(tok);
  }

  const output: Token[] = [];
  const stack: Token[] = [];
  for (const tok of normalized) {
    if (tok.type === 'num') output.push(tok);
    else if (tok.type === 'fn') stack.push(tok);
    else if (tok.value === '(') stack.push(tok);
    else if (tok.value === ')') {
      let found = false;
      while (stack.length) {
        const top = stack.pop() as Token;
        if (top.type === 'op' && top.value === '(') {
          found = true;
          break;
        }
        output.push(top);
      }
      if (!found) throw errInvalidInput('پرانتزها متوازن نیستند.', 'Unbalanced parentheses.');
      const top = stack[stack.length - 1];
      if (top?.type === 'fn') output.push(stack.pop() as Token);
    } else {
      while (stack.length) {
        const top = stack[stack.length - 1] as Token;
        if (top.type === 'fn') {
          output.push(stack.pop() as Token);
          continue;
        }
        if (
          top.type === 'op' &&
          top.value !== '(' &&
          ((PRECEDENCE[top.value] ?? 0) > (PRECEDENCE[tok.value] ?? 0) ||
            ((PRECEDENCE[top.value] ?? 0) === (PRECEDENCE[tok.value] ?? 0) && tok.value !== '^'))
        ) {
          output.push(stack.pop() as Token);
          continue;
        }
        break;
      }
      stack.push(tok);
    }
  }
  while (stack.length) {
    const top = stack.pop() as Token;
    if (top.type === 'op' && (top.value === '(' || top.value === ')')) {
      throw errInvalidInput('پرانتزها متوازن نیستند.', 'Unbalanced parentheses.');
    }
    output.push(top);
  }

  const evalStack: number[] = [];
  for (const tok of output) {
    if (tok.type === 'num') evalStack.push(tok.value);
    else if (tok.type === 'fn') {
      const x = evalStack.pop();
      if (x === undefined) throw errInvalidInput('عبارت ناقص است.', 'Incomplete expression.');
      evalStack.push((FUNCTIONS[tok.value] as (n: number) => number)(x));
    } else {
      const b = evalStack.pop();
      const a = evalStack.pop();
      if (a === undefined || b === undefined) {
        throw errInvalidInput('عبارت ناقص است.', 'Incomplete expression.');
      }
      switch (tok.value) {
        case '+': evalStack.push(a + b); break;
        case '-': evalStack.push(a - b); break;
        case '*': evalStack.push(a * b); break;
        case '/':
          if (b === 0) throw errInvalidInput('تقسیم بر صفر مجاز نیست.', 'Division by zero.');
          evalStack.push(a / b);
          break;
        case '%':
          if (b === 0) throw errInvalidInput('باقیمانده بر صفر مجاز نیست.', 'Modulo by zero.');
          evalStack.push(a % b);
          break;
        case '^': evalStack.push(a ** b); break;
        default: throw errInvalidInput('عملگر ناشناخته.', 'Unknown operator.');
      }
    }
  }
  const result = evalStack.pop();
  if (result === undefined || evalStack.length > 0 || !Number.isFinite(result)) {
    throw errInvalidInput('نتیجه‌ی محاسبه معتبر نیست.', 'The computation did not produce a finite result.');
  }
  return result;
}

export const calculatorTool = defineTool({
  id: 'calculator',
  category: 'utilities',
  icon: '🧮',
  quick: true,
  needsInput: true,
  title: { fa: 'ماشین‌حساب', en: 'Calculator' },
  description: {
    fa: 'عبارت‌های ریاضی را با اولویت درست عملگرها، پرانتز، توان و توابع (sqrt, sin, cos, log, ln …) محاسبه می‌کند. ارزیابی با الگوریتم Shunting-yard انجام می‌شود و هرگز از eval استفاده نمی‌کند.',
    en: 'Evaluates mathematical expressions with correct precedence, parentheses, exponentiation and functions (sqrt, sin, cos, log, ln …) using a Shunting-yard parser — never eval.',
  },
  usage: {
    fa: 'عبارت را ارسال کنید؛ مثلاً <code>(2+3)*4^2</code> یا <code>sqrt(144)+pi</code>.',
    en: 'Send an expression, e.g. <code>(2+3)*4^2</code> or <code>sqrt(144)+pi</code>.',
  },
  example: { fa: 'ورودی: (2+3)*4\nخروجی: 20', en: 'Input: (2+3)*4\nOutput: 20' },
  limitations: {
    fa: 'حداکثر ۲۰۰ کاراکتر، فقط اعداد اعشاری IEEE-754، بدون متغیر و بدون اعداد مختلط.',
    en: 'Max 200 characters, IEEE-754 doubles only, no variables, no complex numbers.',
  },
  run: (input, ctx) => {
    const result = evaluateExpression(input);
    const fa = ctx.lang === 'fa';
    const rounded = Math.round(result * 1e10) / 1e10;
    return {
      html:
        `${codeBlock(`${input.trim()} = ${rounded}`)}${DIVIDER}\n` +
        (fa
          ? `🔢 دقیق: ${mono(String(result))}\n🔬 نمایی: ${mono(result.toExponential(6))}`
          : `🔢 Exact: ${mono(String(result))}\n🔬 Exponential: ${mono(result.toExponential(6))}`),
      toast: `= ${rounded}`,
    };
  },
});

// ─── Unit converter ────────────────────────────────────────
const UNITS: Record<string, Record<string, number>> = {
  length: { m: 1, km: 1000, cm: 0.01, mm: 0.001, mi: 1609.344, yd: 0.9144, ft: 0.3048, in: 0.0254, nmi: 1852 },
  mass: { kg: 1, g: 0.001, mg: 1e-6, t: 1000, lb: 0.45359237, oz: 0.028349523125 },
  data: { b: 1, kb: 1024, mb: 1024 ** 2, gb: 1024 ** 3, tb: 1024 ** 4, bit: 0.125 },
  time: { s: 1, ms: 0.001, min: 60, h: 3600, d: 86400, wk: 604800 },
  speed: { 'm/s': 1, 'km/h': 0.277778, mph: 0.44704, kn: 0.514444 },
  area: { m2: 1, km2: 1e6, ha: 1e4, ft2: 0.092903, ac: 4046.86 },
  volume: { l: 1, ml: 0.001, m3: 1000, gal: 3.785411784, qt: 0.946352946 },
};

export function convertUnit(value: number, from: string, to: string): number {
  const f = from.toLowerCase();
  const t = to.toLowerCase();
  if (['c', 'f', 'k'].includes(f) && ['c', 'f', 'k'].includes(t)) {
    const celsius = f === 'c' ? value : f === 'f' ? (value - 32) * (5 / 9) : value - 273.15;
    if (t === 'c') return celsius;
    if (t === 'f') return celsius * (9 / 5) + 32;
    return celsius + 273.15;
  }
  for (const table of Object.values(UNITS)) {
    const fromFactor = table[f];
    const toFactor = table[t];
    if (fromFactor !== undefined && toFactor !== undefined) return (value * fromFactor) / toFactor;
  }
  throw errInvalidInput(
    `تبدیل «${from}» به «${to}» پشتیبانی نمی‌شود یا واحدها هم‌خانواده نیستند.`,
    `Conversion from "${from}" to "${to}" is unsupported or the units are incompatible.`,
  );
}

export const unitConverter = defineTool({
  id: 'unit_convert',
  category: 'utilities',
  icon: '📐',
  needsInput: true,
  title: { fa: 'مبدل واحد', en: 'Unit Converter' },
  description: {
    fa: 'بین واحدهای طول، جرم، داده، زمان، سرعت، مساحت، حجم و دما تبدیل انجام می‌دهد.',
    en: 'Converts between length, mass, data, time, speed, area, volume and temperature units.',
  },
  usage: {
    fa: 'قالب: <code>عدد واحد‌مبدأ to واحد‌مقصد</code>\nنمونه: <code>10 km to mi</code> یا <code>100 c to f</code>',
    en: 'Format: <code>value from to target</code>\nExample: <code>10 km to mi</code> or <code>100 c to f</code>',
  },
  example: { fa: 'ورودی: 10 km to mi\nخروجی: 6.2137', en: 'Input: 10 km to mi\nOutput: 6.2137' },
  limitations: {
    fa: 'واحدهای پشتیبانی‌شده: m,km,cm,mm,mi,yd,ft,in,nmi • kg,g,mg,t,lb,oz • b,kb,mb,gb,tb • s,ms,min,h,d,wk • m/s,km/h,mph,kn • m2,km2,ha,ft2,ac • l,ml,m3,gal,qt • c,f,k',
    en: 'Supported: m,km,cm,mm,mi,yd,ft,in,nmi • kg,g,mg,t,lb,oz • b,kb,mb,gb,tb • s,ms,min,h,d,wk • m/s,km/h,mph,kn • m2,km2,ha,ft2,ac • l,ml,m3,gal,qt • c,f,k',
  },
  run: (input) => {
    const m = /^\s*(-?[\d.]+)\s*([a-z0-9/²³]+)\s*(?:to|=>|→|>)\s*([a-z0-9/²³]+)\s*$/i.exec(input.trim());
    if (!m) {
      throw errInvalidInput(
        'قالب صحیح: <عدد> <واحد مبدأ> to <واحد مقصد> — نمونه: 10 km to mi',
        'Correct format: <value> <from> to <to> — e.g. 10 km to mi',
      );
    }
    const value = Number(m[1]);
    const from = (m[2] ?? '').replace('²', '2').replace('³', '3');
    const to = (m[3] ?? '').replace('²', '2').replace('³', '3');
    if (!Number.isFinite(value)) throw errInvalidInput('عدد نامعتبر است.', 'Invalid number.');
    const result = convertUnit(value, from, to);
    const rounded = Math.round(result * 1e6) / 1e6;
    return { html: codeBlock(`${value} ${from} = ${rounded} ${to}`), toast: `${rounded} ${to}` };
  },
});

// ─── QR code ───────────────────────────────────────────────
export const qrTool = defineTool({
  id: 'qr_code',
  category: 'utilities',
  icon: '🔳',
  quick: true,
  needsInput: true,
  title: { fa: 'تولید QR Code', en: 'QR Code Generator' },
  description: {
    fa: 'برای متن، آدرس، Wi-Fi یا هر داده‌ی کوتاه، لینک تصویر QR در اندازه‌های مختلف می‌سازد. تصویر روی سرویس عمومی qrserver ساخته می‌شود و داده در ربات ذخیره نمی‌شود.',
    en: 'Builds QR image links (multiple sizes) for text, URLs, Wi-Fi or any short payload. Images are rendered by the public qrserver service; data is not stored by the bot.',
  },
  usage: { fa: 'متن یا آدرس موردنظر را ارسال کنید.', en: 'Send the text or URL to encode.' },
  example: {
    fa: 'ورودی: https://example.com\nخروجی: لینک تصویر QR',
    en: 'Input: https://example.com\nOutput: QR image link',
  },
  limitations: {
    fa: 'حداکثر ۹۰۰ کاراکتر. تولید تصویر توسط سرویس بیرونی api.qrserver.com انجام می‌شود.',
    en: 'Max 900 characters. Image rendering is delegated to the external api.qrserver.com service.',
  },
  run: (input, ctx) => {
    if (input.length > 900) {
      throw errInvalidInput(
        'حداکثر ۹۰۰ کاراکتر برای QR مجاز است.',
        'QR payload must not exceed 900 characters.',
      );
    }
    const data = encodeURIComponent(input);
    const url = (size: number): string =>
      `https://api.qrserver.com/v1/create-qr-code/?size=${size}x${size}&data=${data}`;
    const fa = ctx.lang === 'fa';
    return {
      html:
        (fa ? '🔳 <b>لینک تصویر QR</b>\n' : '🔳 <b>QR image links</b>\n') +
        `• 200×200\n${codeBlock(url(200))}` +
        `• 512×512\n${codeBlock(url(512))}` +
        `${DIVIDER}\n📦 ${input.length} ${fa ? 'کاراکتر رمزگذاری شد' : 'characters encoded'}`,
    };
  },
});

// ─── URL parser ────────────────────────────────────────────
export const urlParser = defineTool({
  id: 'url_parse',
  category: 'utilities',
  icon: '🧭',
  needsInput: true,
  title: { fa: 'تجزیه‌گر URL', en: 'URL Parser' },
  description: {
    fa: 'آدرس را به اجزای آن (پروتکل، دامنه، پورت، مسیر، کوئری، fragment) تجزیه می‌کند و تمام پارامترهای query را جدا نمایش می‌دهد.',
    en: 'Breaks a URL into its components (scheme, host, port, path, query, fragment) and lists every query parameter.',
  },
  usage: { fa: 'یک آدرس کامل ارسال کنید.', en: 'Send a full URL.' },
  example: {
    fa: 'ورودی: https://a.com/p?x=1#f\nخروجی: scheme=https، host=a.com، x=1',
    en: 'Input: https://a.com/p?x=1#f\nOutput: scheme=https, host=a.com, x=1',
  },
  limitations: {
    fa: 'فقط تجزیه‌ی محلی انجام می‌شود؛ هیچ درخواستی به آدرس ارسال نمی‌شود.',
    en: 'Local parsing only; no request is sent to the URL.',
  },
  run: (input, ctx) => {
    const raw = input.trim();
    let url: URL;
    try {
      url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`);
    } catch {
      throw errInvalidInput('آدرس معتبر نیست.', 'Invalid URL.');
    }
    const fa = ctx.lang === 'fa';
    const params = [...url.searchParams.entries()];
    const labels = fa
      ? ['پروتکل', 'میزبان', 'پورت', 'مسیر', 'کوئری', 'قطعه', 'مبدأ']
      : ['Scheme', 'Host', 'Port', 'Path', 'Query', 'Fragment', 'Origin'];
    const values = [
      url.protocol.replace(':', ''),
      url.hostname,
      url.port || (url.protocol === 'https:' ? '443' : '80'),
      url.pathname || '/',
      url.search || '—',
      url.hash || '—',
      url.origin,
    ];
    const rows = labels.map((l, i) => `• <b>${l}</b>: <code>${escapeHtml(values[i] ?? '')}</code>`).join('\n');
    const paramRows = params.length
      ? `\n${DIVIDER}\n${fa ? '🔎 <b>پارامترها</b>' : '🔎 <b>Query parameters</b>'}\n` +
        params.map(([k, v]) => `• <code>${escapeHtml(k)}</code> = <code>${escapeHtml(v.slice(0, 100))}</code>`).join('\n')
      : '';
    return { html: `${rows}${paramRows}` };
  },
});

// ─── Cron helper ───────────────────────────────────────────
const CRON_PRESETS: Record<string, { fa: string; en: string }> = {
  '* * * * *': { fa: 'هر دقیقه', en: 'Every minute' },
  '*/5 * * * *': { fa: 'هر ۵ دقیقه', en: 'Every 5 minutes' },
  '0 * * * *': { fa: 'هر ساعت (دقیقه ۰)', en: 'Hourly at minute 0' },
  '0 0 * * *': { fa: 'هر روز نیمه‌شب', en: 'Daily at midnight' },
  '0 9 * * 1-5': { fa: 'روزهای کاری ساعت ۹', en: 'Weekdays at 09:00' },
  '0 0 1 * *': { fa: 'اول هر ماه', en: 'First day of each month' },
};

export function describeCron(expr: string): { fa: string; en: string } {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) {
    throw errInvalidInput(
      'عبارت Cron باید دقیقاً ۵ بخش داشته باشد: دقیقه ساعت روز ماه روزهفته',
      'A cron expression must have exactly 5 fields: minute hour day month weekday',
    );
  }
  const [min = '', hour = '', dom = '', mon = '', dow = ''] = parts;
  const ranges: [string, number, number][] = [
    [min, 0, 59], [hour, 0, 23], [dom, 1, 31], [mon, 1, 12], [dow, 0, 7],
  ];
  for (const [field, lo, hi] of ranges) {
    if (!/^(\*|\d+|\d+-\d+|(\*|\d+(-\d+)?)\/\d+|(\d+(-\d+)?)(,\d+(-\d+)?)*)$/.test(field)) {
      throw errInvalidInput(`بخش «${field}» در عبارت Cron معتبر نیست.`, `Cron field "${field}" is invalid.`);
    }
    for (const n of field.match(/\d+/g) ?? []) {
      const value = Number(n);
      if (!field.includes('/') && (value < lo || value > hi)) {
        throw errInvalidInput(
          `مقدار ${value} خارج از بازه‌ی مجاز (${lo}-${hi}) است.`,
          `Value ${value} is out of range (${lo}-${hi}).`,
        );
      }
    }
  }
  const preset = CRON_PRESETS[parts.join(' ')];
  if (preset) return preset;
  const f = (v: string, faL: string, enL: string): [string, string] =>
    v === '*' ? [`هر ${faL}`, `every ${enL}`] : [`${faL} ${v}`, `${enL} ${v}`];
  const [fMin, eMin] = f(min, 'دقیقه', 'minute');
  const [fHour, eHour] = f(hour, 'ساعت', 'hour');
  const [fDom, eDom] = f(dom, 'روز ماه', 'day-of-month');
  const [fMon, eMon] = f(mon, 'ماه', 'month');
  const [fDow, eDow] = f(dow, 'روز هفته', 'day-of-week');
  return {
    fa: `${fMin} • ${fHour} • ${fDom} • ${fMon} • ${fDow}`,
    en: `${eMin} • ${eHour} • ${eDom} • ${eMon} • ${eDow}`,
  };
}

export const cronTool = defineTool({
  id: 'cron_helper',
  category: 'utilities',
  icon: '⏰',
  needsInput: true,
  title: { fa: 'راهنمای Cron', en: 'Cron Expression Helper' },
  description: {
    fa: 'عبارت Cron پنج‌بخشی را اعتبارسنجی و به زبان ساده توصیف می‌کند و الگوهای پرکاربرد را نشان می‌دهد.',
    en: 'Validates a 5-field cron expression, describes it in plain language and shows common presets.',
  },
  usage: { fa: 'عبارت Cron را ارسال کنید؛ مثلاً <code>*/5 * * * *</code>', en: 'Send a cron expression, e.g. <code>*/5 * * * *</code>' },
  example: { fa: 'ورودی: 0 9 * * 1-5\nخروجی: روزهای کاری ساعت ۹', en: 'Input: 0 9 * * 1-5\nOutput: Weekdays at 09:00' },
  limitations: {
    fa: 'فقط قالب استاندارد ۵ بخشی (بدون ثانیه و بدون نام ماه/روز) پشتیبانی می‌شود.',
    en: 'Standard 5-field syntax only (no seconds field, no month/day names).',
  },
  run: (input, ctx) => {
    const desc = describeCron(input);
    const fa = ctx.lang === 'fa';
    const presets = Object.entries(CRON_PRESETS)
      .map(([expr, d]) => `• <code>${expr}</code> — ${fa ? d.fa : d.en}`)
      .join('\n');
    return {
      html:
        `${codeBlock(input.trim())}` +
        `${fa ? '🗣 <b>توصیف</b>' : '🗣 <b>Description</b>'}\n${fa ? desc.fa : desc.en}\n` +
        `${DIVIDER}\n${fa ? '📚 <b>الگوهای رایج</b>' : '📚 <b>Common presets</b>'}\n${presets}`,
    };
  },
});

// ─── Text counter (utilities-side alias with different focus) ──
export const textCounter = defineTool({
  id: 'text_counter',
  category: 'utilities',
  icon: '🔢',
  needsInput: true,
  title: { fa: 'شمارشگر متن', en: 'Text Counter' },
  description: {
    fa: 'کاراکترها را برای محدودیت‌های رایج پلتفرم‌ها (توییت، SMS، متادیتای SEO، پیام تلگرام) می‌شمارد و باقی‌مانده‌ی مجاز را نشان می‌دهد.',
    en: 'Counts characters against common platform limits (tweet, SMS, SEO metadata, Telegram message) and shows the remaining budget.',
  },
  usage: { fa: 'متن را ارسال کنید.', en: 'Send any text.' },
  example: { fa: 'ورودی: سلام\nخروجی: ۴ کاراکتر، ۱ کلمه', en: 'Input: hello\nOutput: 5 characters, 1 word' },
  limitations: { fa: 'حداکثر ۸۰۰۰ کاراکتر.', en: 'Max 8000 characters.' },
  run: (input, ctx) => {
    const chars = [...input].length;
    const words = input.trim() ? input.trim().split(/\s+/).length : 0;
    const fa = ctx.lang === 'fa';
    const limits: [string, number][] = [
      ['Tweet (X)', 280],
      ['SMS', 160],
      ['SEO title', 60],
      ['SEO description', 160],
      ['Telegram message', 4096],
    ];
    const rows = limits
      .map(([name, limit]) => {
        const left = limit - chars;
        const icon = left >= 0 ? '✅' : '❌';
        return `${icon} <b>${name}</b>: ${chars}/${limit} (${left >= 0 ? `${left} ${fa ? 'باقی' : 'left'}` : `${-left} ${fa ? 'اضافه' : 'over'}`})`;
      })
      .join('\n');
    return {
      html: `${fa ? `🔤 کاراکتر: <b>${chars}</b> • کلمه: <b>${words}</b>` : `🔤 Characters: <b>${chars}</b> • Words: <b>${words}</b>`}\n${DIVIDER}\n${rows}`,
    };
  },
});

export const urlInfoLocal = defineTool({
  id: 'url_normalize',
  category: 'utilities',
  icon: '🧹',
  needsInput: true,
  title: { fa: 'پاک‌سازی و نرمال‌سازی URL', en: 'URL Cleaner / Normalizer' },
  description: {
    fa: 'پارامترهای ردیابی (utm_*, fbclid, gclid …) را حذف می‌کند، مسیر را نرمال می‌سازد و نسخه‌ی تمیز آدرس را می‌دهد.',
    en: 'Strips tracking parameters (utm_*, fbclid, gclid …), normalises the path and returns a clean URL.',
  },
  usage: { fa: 'آدرس را ارسال کنید.', en: 'Send the URL.' },
  example: {
    fa: 'ورودی: https://a.com/p?utm_source=x&id=2\nخروجی: https://a.com/p?id=2',
    en: 'Input: https://a.com/p?utm_source=x&id=2\nOutput: https://a.com/p?id=2',
  },
  limitations: {
    fa: 'کاملاً محلی؛ هیچ درخواستی ارسال نمی‌شود و ریدایرکت‌ها دنبال نمی‌شوند.',
    en: 'Fully local; no request is sent and redirects are not followed.',
  },
  run: (input, ctx) => {
    const url = parseHttpUrl(input);
    const trackers = /^(utm_|fbclid|gclid|msclkid|mc_eid|mc_cid|igshid|ref|ref_src|yclid|_ga)/i;
    const removed: string[] = [];
    for (const key of [...url.searchParams.keys()]) {
      if (trackers.test(key)) {
        removed.push(key);
        url.searchParams.delete(key);
      }
    }
    url.hash = '';
    const fa = ctx.lang === 'fa';
    return {
      html:
        `${codeBlock(url.toString())}${DIVIDER}\n` +
        (removed.length
          ? `${fa ? '🧹 حذف‌شده' : '🧹 Removed'}: ${removed.map((r) => `<code>${escapeHtml(r)}</code>`).join(', ')}`
          : fa
            ? '✨ پارامتر ردیابی‌ای پیدا نشد.'
            : '✨ No tracking parameters found.'),
    };
  },
});
