import { defineTool } from '../types.js';
import { codeBlock, DIVIDER, escapeHtml, isoUtc, mono } from '../../utils/text.js';
import { errInvalidInput } from '../../utils/errors.js';
import { LIMITS } from '../../config/index.js';
import { formatCss, formatHtml, formatJs, markdownToHtml, minifyCss } from '../../utils/format.js';
import { utf8Length } from '../../utils/encoding.js';

// ─── Regex tester ──────────────────────────────────────────
export interface RegexTestResult {
  matchCount: number;
  matches: { index: number; value: string; groups: string[] }[];
}

export function runRegex(pattern: string, flags: string, subject: string): RegexTestResult {
  if (pattern.length > LIMITS.maxRegexPatternChars) {
    throw errInvalidInput(
      `طول الگو نباید بیش از ${LIMITS.maxRegexPatternChars} کاراکتر باشد.`,
      `Pattern must not exceed ${LIMITS.maxRegexPatternChars} characters.`,
    );
  }
  if (subject.length > LIMITS.maxRegexSubjectChars) {
    throw errInvalidInput(
      `طول متن آزمون نباید بیش از ${LIMITS.maxRegexSubjectChars} کاراکتر باشد.`,
      `Subject must not exceed ${LIMITS.maxRegexSubjectChars} characters.`,
    );
  }
  const safeFlags = flags.replace(/[^gimsuy]/g, '');
  let re: RegExp;
  try {
    re = new RegExp(pattern, safeFlags.includes('g') ? safeFlags : `${safeFlags}g`);
  } catch (error) {
    throw errInvalidInput(
      `الگوی Regex معتبر نیست: ${error instanceof Error ? error.message : ''}`,
      `Invalid regex: ${error instanceof Error ? error.message : ''}`,
    );
  }
  const matches: RegexTestResult['matches'] = [];
  let guard = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(subject)) !== null) {
    matches.push({ index: m.index, value: m[0], groups: m.slice(1).map((g) => g ?? '') });
    if (m[0] === '') re.lastIndex += 1;
    guard += 1;
    if (guard >= 50) break;
  }
  return { matchCount: matches.length, matches };
}

export const regexTester = defineTool({
  id: 'regex_test',
  category: 'programming',
  icon: '🧪',
  needsInput: true,
  title: { fa: 'آزمایشگر Regex', en: 'Regex Tester' },
  description: {
    fa: 'الگوی Regular Expression را روی یک متن آزمون اجرا می‌کند و تمام تطبیق‌ها، موقعیت و گروه‌های ثبت‌شده را نشان می‌دهد.',
    en: 'Runs a regular expression against a test subject and lists every match, its index and capture groups.',
  },
  usage: {
    fa: 'خط اول: <code>/الگو/پرچم‌ها</code>\nخط‌های بعد: متن آزمون\nنمونه:\n/\\d+/g\nab 12 cd 34',
    en: 'Line 1: <code>/pattern/flags</code>\nRemaining lines: subject\nExample:\n/\\d+/g\nab 12 cd 34',
  },
  example: {
    fa: 'ورودی:\n/\\d+/g\nab 12 cd 34\nخروجی: 2 تطبیق → 12 (index 3)، 34 (index 9)',
    en: 'Input:\n/\\d+/g\nab 12 cd 34\nOutput: 2 matches → 12 (index 3), 34 (index 9)',
  },
  limitations: {
    fa: 'حداکثر ۳۰۰ کاراکتر الگو، ۴۰۰۰ کاراکتر متن و ۵۰ تطبیق نمایش داده می‌شود (محافظت در برابر ReDoS).',
    en: 'Max 300-char pattern, 4000-char subject and 50 reported matches (ReDoS protection).',
  },
  run: (input, ctx) => {
    const fa = ctx.lang === 'fa';
    const [firstLine = '', ...rest] = input.split('\n');
    const parsed = /^\/(.*)\/([gimsuy]*)$/s.exec(firstLine.trim());
    if (!parsed) {
      throw errInvalidInput(
        'خط اول باید به شکل /الگو/پرچم‌ها باشد. نمونه: /\\d+/g',
        'First line must be /pattern/flags, e.g. /\\d+/g',
      );
    }
    const subject = rest.join('\n');
    if (!subject) {
      throw errInvalidInput('متن آزمون را در خطوط بعدی وارد کنید.', 'Provide a subject on the next lines.');
    }
    const result = runRegex(parsed[1] ?? '', parsed[2] ?? '', subject);
    if (result.matchCount === 0) {
      return { html: fa ? '🔍 هیچ تطبیقی پیدا نشد.' : '🔍 No matches found.' };
    }
    const rows = result.matches
      .map(
        (m, i) =>
          `${i + 1}. <code>${escapeHtml(m.value.slice(0, 120))}</code> @ ${m.index}` +
          (m.groups.length ? `\n   ↳ ${m.groups.map((g) => `<code>${escapeHtml(g.slice(0, 60))}</code>`).join(', ')}` : ''),
      )
      .join('\n');
    return {
      html: `${fa ? `✅ <b>${result.matchCount} تطبیق</b>` : `✅ <b>${result.matchCount} matches</b>`}\n${DIVIDER}\n${rows}`,
    };
  },
});

// ─── Timestamp converter ───────────────────────────────────
export function convertTimestamp(raw: string): { epochSec: number; date: Date } {
  const trimmed = raw.trim().toLowerCase();
  if (trimmed === 'now' || trimmed === 'اکنون') {
    const now = Date.now();
    return { epochSec: Math.floor(now / 1000), date: new Date(now) };
  }
  if (/^-?\d{1,13}$/.test(trimmed)) {
    const n = Number(trimmed);
    const ms = trimmed.length > 10 ? n : n * 1000;
    const date = new Date(ms);
    if (Number.isNaN(date.getTime())) {
      throw errInvalidInput('عدد زمانی نامعتبر است.', 'Invalid timestamp number.');
    }
    return { epochSec: Math.floor(ms / 1000), date };
  }
  const date = new Date(raw.trim());
  if (Number.isNaN(date.getTime())) {
    throw errInvalidInput(
      'قالب تاریخ شناسایی نشد. نمونه‌های معتبر: 1700000000 یا 2024-01-01T00:00:00Z یا now',
      'Unrecognised date format. Valid examples: 1700000000, 2024-01-01T00:00:00Z, now',
    );
  }
  return { epochSec: Math.floor(date.getTime() / 1000), date };
}

function relativeTime(target: number, lang: 'fa' | 'en'): string {
  const diff = target - Date.now();
  const abs = Math.abs(diff);
  const units: [number, string, string][] = [
    [31_536_000_000, 'سال', 'year'],
    [2_592_000_000, 'ماه', 'month'],
    [86_400_000, 'روز', 'day'],
    [3_600_000, 'ساعت', 'hour'],
    [60_000, 'دقیقه', 'minute'],
    [1000, 'ثانیه', 'second'],
  ];
  for (const [ms, faU, enU] of units) {
    if (abs >= ms) {
      const value = Math.round(abs / ms);
      return lang === 'fa'
        ? diff >= 0
          ? `${value} ${faU} دیگر`
          : `${value} ${faU} پیش`
        : diff >= 0
          ? `in ${value} ${enU}${value === 1 ? '' : 's'}`
          : `${value} ${enU}${value === 1 ? '' : 's'} ago`;
    }
  }
  return lang === 'fa' ? 'همین حالا' : 'just now';
}

export const timestampTool = defineTool({
  id: 'timestamp',
  category: 'utilities',
  icon: '⏱',
  quick: true,
  needsInput: true,
  title: { fa: 'مبدل Unix Timestamp', en: 'Unix Timestamp Converter' },
  description: {
    fa: 'بین Unix timestamp (ثانیه یا میلی‌ثانیه) و تاریخ خوانا تبدیل انجام می‌دهد و فاصله‌ی زمانی نسبی، ISO 8601 و روز هفته را نشان می‌دهد.',
    en: 'Converts between Unix timestamps (s or ms) and human-readable dates, adding relative time, ISO 8601 and weekday.',
  },
  usage: {
    fa: 'یک عدد (مثل 1700000000)، یک تاریخ (مثل 2024-01-01) یا کلمه‌ی now بفرستید.',
    en: 'Send a number (e.g. 1700000000), a date (e.g. 2024-01-01) or the word now.',
  },
  example: {
    fa: 'ورودی: 1700000000\nخروجی: 2023-11-14 22:13:20 UTC',
    en: 'Input: 1700000000\nOutput: 2023-11-14 22:13:20 UTC',
  },
  limitations: {
    fa: 'خروجی همیشه بر مبنای UTC است؛ منطقه‌ی زمانی محلی محاسبه نمی‌شود.',
    en: 'Output is always UTC; local time zones are not applied.',
  },
  run: (input, ctx) => {
    const fa = ctx.lang === 'fa';
    const { epochSec, date } = convertTimestamp(input);
    const weekday = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][date.getUTCDay()] ?? '';
    return {
      html:
        `${fa ? '🕒 <b>تاریخ UTC</b>' : '🕒 <b>UTC date</b>'}\n${codeBlock(isoUtc(date.getTime()))}` +
        `\n${fa ? '📅 <b>ISO 8601</b>' : '📅 <b>ISO 8601</b>'}\n${codeBlock(date.toISOString())}` +
        `\n${fa ? '🔢 <b>ثانیه</b>' : '🔢 <b>Seconds</b>'}\n${codeBlock(String(epochSec))}` +
        `\n${fa ? '🔢 <b>میلی‌ثانیه</b>' : '🔢 <b>Milliseconds</b>'}\n${codeBlock(String(date.getTime()))}` +
        `\n${DIVIDER}\n📆 ${weekday} • ⏳ ${relativeTime(date.getTime(), fa ? 'fa' : 'en')}`,
    };
  },
});

// ─── Formatters ────────────────────────────────────────────
export const htmlFormatter = defineTool({
  id: 'html_format',
  category: 'programming',
  icon: '📐',
  needsInput: true,
  title: { fa: 'قالب‌بندی HTML', en: 'HTML Formatter' },
  description: {
    fa: 'کد HTML فشرده را با تورفتگی منظم و آگاه از تگ‌های void و pre مرتب می‌کند.',
    en: 'Re-indents minified HTML, aware of void elements and preformatted blocks.',
  },
  usage: { fa: 'کد HTML را ارسال کنید.', en: 'Send HTML source.' },
  example: {
    fa: 'ورودی: <div><p>hi</p></div>\nخروجی:\n<div>\n  <p>\n    hi\n  </p>\n</div>',
    en: 'Input: <div><p>hi</p></div>\nOutput:\n<div>\n  <p>\n    hi\n  </p>\n</div>',
  },
  limitations: {
    fa: 'قالب‌بندی سبک است و جایگزین Prettier نیست؛ HTML بسیار نامعتبر ممکن است دقیق مرتب نشود.',
    en: 'Lightweight formatting, not a Prettier replacement; severely malformed HTML may not indent perfectly.',
  },
  run: (input) => ({ html: codeBlock(formatHtml(input), 'html') }),
});

export const cssFormatter = defineTool({
  id: 'css_format',
  category: 'programming',
  icon: '🎨',
  needsInput: true,
  title: { fa: 'قالب‌بندی CSS', en: 'CSS Formatter' },
  description: {
    fa: 'CSS را مرتب می‌کند و در کنار آن نسخه‌ی فشرده‌شده (minified) و میزان کاهش حجم را می‌دهد.',
    en: 'Formats CSS and also returns a minified version with the size saving.',
  },
  usage: { fa: 'کد CSS را ارسال کنید.', en: 'Send CSS source.' },
  example: {
    fa: 'ورودی: a{color:red;}\nخروجی:\na {\n  color: red;\n}',
    en: 'Input: a{color:red;}\nOutput:\na {\n  color: red;\n}',
  },
  limitations: {
    fa: 'ساختارهای پیچیده‌ی SCSS/LESS پشتیبانی نمی‌شوند.',
    en: 'Complex SCSS/LESS syntax is not supported.',
  },
  run: (input, ctx) => {
    const pretty = formatCss(input);
    const min = minifyCss(input);
    const fa = ctx.lang === 'fa';
    const saved = input.length > 0 ? Math.round(((input.length - min.length) / input.length) * 1000) / 10 : 0;
    return {
      html:
        `${fa ? '🔹 <b>مرتب‌شده</b>' : '🔹 <b>Formatted</b>'}\n${codeBlock(pretty, 'css')}\n` +
        `${fa ? '🔹 <b>فشرده</b>' : '🔹 <b>Minified</b>'}\n${codeBlock(min, 'css')}\n` +
        `${DIVIDER}\n📉 ${saved}% ${fa ? 'کاهش حجم' : 'smaller'}`,
    };
  },
});

export const jsFormatter = defineTool({
  id: 'js_format',
  category: 'programming',
  icon: '📜',
  needsInput: true,
  title: { fa: 'قالب‌بندی JavaScript', en: 'JavaScript Formatter' },
  description: {
    fa: 'کد JavaScript را با تورفتگی منظم بازنویسی می‌کند. رشته‌ها، تمپلیت‌ها و کامنت‌ها دست‌نخورده باقی می‌مانند.',
    en: 'Re-indents JavaScript source while leaving strings, template literals and comments intact.',
  },
  usage: { fa: 'کد JS را ارسال کنید.', en: 'Send JavaScript source.' },
  example: {
    fa: 'ورودی: function a(){return 1;}\nخروجی:\nfunction a() {\n  return 1;\n}',
    en: 'Input: function a(){return 1;}\nOutput:\nfunction a() {\n  return 1;\n}',
  },
  limitations: {
    fa: 'قالب‌بندی مبتنی بر توکن است نه AST؛ برای کدهای بسیار پیچیده نتیجه ممکن است ایده‌آل نباشد. کد اجرا نمی‌شود.',
    en: 'Token-based (not AST-based) formatting; complex code may not be perfect. Code is never executed.',
  },
  run: (input) => ({ html: codeBlock(formatJs(input), 'javascript') }),
});

export const markdownTool = defineTool({
  id: 'markdown_html',
  category: 'programming',
  icon: '📝',
  needsInput: true,
  title: { fa: 'تبدیل Markdown به HTML', en: 'Markdown → HTML' },
  description: {
    fa: 'زیرمجموعه‌ای از CommonMark (عنوان، لیست، نقل‌قول، لینک، کد، بولد/ایتالیک) را به HTML امن تبدیل می‌کند؛ HTML خام ورودی escape می‌شود تا XSS رخ ندهد.',
    en: 'Converts a CommonMark subset (headings, lists, quotes, links, code, bold/italic) to safe HTML; raw HTML input is escaped to prevent XSS.',
  },
  usage: { fa: 'متن Markdown را ارسال کنید.', en: 'Send Markdown text.' },
  example: {
    fa: 'ورودی: # سلام\nخروجی: <h1>سلام</h1>',
    en: 'Input: # Hello\nOutput: <h1>Hello</h1>',
  },
  limitations: {
    fa: 'جدول، پاورقی و HTML خام پشتیبانی نمی‌شوند.',
    en: 'Tables, footnotes and raw HTML pass-through are not supported.',
  },
  run: (input) => ({ html: codeBlock(markdownToHtml(input), 'html') }),
});

// ─── Text statistics ───────────────────────────────────────
export interface TextStats {
  chars: number;
  charsNoSpaces: number;
  words: number;
  lines: number;
  sentences: number;
  paragraphs: number;
  bytes: number;
  readingMinutes: number;
}

export function textStats(input: string): TextStats {
  const chars = [...input].length;
  const charsNoSpaces = [...input.replace(/\s/g, '')].length;
  const words = input.trim() ? input.trim().split(/\s+/).length : 0;
  const lines = input ? input.split('\n').length : 0;
  const sentences = (input.match(/[.!?؟…]+(\s|$)/g) ?? []).length;
  const paragraphs = input.trim() ? input.trim().split(/\n\s*\n/).length : 0;
  return {
    chars,
    charsNoSpaces,
    words,
    lines,
    sentences,
    paragraphs,
    bytes: utf8Length(input),
    readingMinutes: Math.max(words > 0 ? 1 : 0, Math.round(words / 200)),
  };
}

export const textStatsTool = defineTool({
  id: 'text_stats',
  category: 'programming',
  icon: '📊',
  needsInput: true,
  title: { fa: 'آمار متن', en: 'Text Statistics' },
  description: {
    fa: 'تعداد کاراکتر، کلمه، خط، جمله، پاراگراف، حجم بایت (UTF-8)، پرتکرارترین کلمات و زمان تقریبی مطالعه را محاسبه می‌کند.',
    en: 'Counts characters, words, lines, sentences, paragraphs, UTF-8 bytes, top words and estimated reading time.',
  },
  usage: { fa: 'متن را ارسال کنید.', en: 'Send any text.' },
  example: {
    fa: 'ورودی: سلام دنیا\nخروجی: ۲ کلمه، ۱۰ کاراکتر',
    en: 'Input: hello world\nOutput: 2 words, 11 characters',
  },
  limitations: { fa: 'حداکثر ۸۰۰۰ کاراکتر.', en: 'Max 8000 characters.' },
  run: (input, ctx) => {
    const s = textStats(input);
    const fa = ctx.lang === 'fa';
    const freq = new Map<string, number>();
    for (const w of input.toLowerCase().match(/[\p{L}\p{N}']{2,}/gu) ?? []) {
      freq.set(w, (freq.get(w) ?? 0) + 1);
    }
    const top = [...freq.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([w, c], i) => `${i + 1}. <code>${escapeHtml(w)}</code> × ${c}`)
      .join('\n');
    const rows = fa
      ? [
          `🔤 کاراکترها: <b>${s.chars}</b> (بدون فاصله: ${s.charsNoSpaces})`,
          `📝 کلمات: <b>${s.words}</b>`,
          `📄 خطوط: <b>${s.lines}</b> • پاراگراف: <b>${s.paragraphs}</b>`,
          `💬 جملات: <b>${s.sentences}</b>`,
          `💾 حجم UTF-8: <b>${s.bytes}</b> بایت`,
          `⏱ زمان مطالعه: ~<b>${s.readingMinutes}</b> دقیقه`,
        ]
      : [
          `🔤 Characters: <b>${s.chars}</b> (no spaces: ${s.charsNoSpaces})`,
          `📝 Words: <b>${s.words}</b>`,
          `📄 Lines: <b>${s.lines}</b> • Paragraphs: <b>${s.paragraphs}</b>`,
          `💬 Sentences: <b>${s.sentences}</b>`,
          `💾 UTF-8 size: <b>${s.bytes}</b> bytes`,
          `⏱ Reading time: ~<b>${s.readingMinutes}</b> min`,
        ];
    return {
      html: `${rows.join('\n')}${top ? `\n${DIVIDER}\n${fa ? '🏆 <b>پرتکرارترین کلمات</b>' : '🏆 <b>Top words</b>'}\n${top}` : ''}`,
    };
  },
});

// ─── Case converter ────────────────────────────────────────
export function toCases(input: string): Record<string, string> {
  const words = input
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .split(/[\s_\-.]+/)
    .filter(Boolean);
  const lower = words.map((w) => w.toLowerCase());
  const cap = lower.map((w) => (w[0] ?? '').toUpperCase() + w.slice(1));
  return {
    UPPERCASE: input.toUpperCase(),
    lowercase: input.toLowerCase(),
    'Title Case': cap.join(' '),
    camelCase: (lower[0] ?? '') + cap.slice(1).join(''),
    PascalCase: cap.join(''),
    snake_case: lower.join('_'),
    'kebab-case': lower.join('-'),
    CONSTANT_CASE: lower.join('_').toUpperCase(),
    'dot.case': lower.join('.'),
  };
}

export const caseConverter = defineTool({
  id: 'case_convert',
  category: 'utilities',
  icon: '🔀',
  needsInput: true,
  title: { fa: 'مبدل حالت متن', en: 'Case Converter' },
  description: {
    fa: 'متن را به ۹ حالت رایج نام‌گذاری تبدیل می‌کند: camelCase، PascalCase، snake_case، kebab-case، CONSTANT_CASE و غیره.',
    en: 'Converts text into 9 common naming conventions: camelCase, PascalCase, snake_case, kebab-case, CONSTANT_CASE and more.',
  },
  usage: { fa: 'متن یا نام متغیر را ارسال کنید.', en: 'Send text or an identifier.' },
  example: {
    fa: 'ورودی: hello world\nخروجی: helloWorld، HelloWorld، hello_world …',
    en: 'Input: hello world\nOutput: helloWorld, HelloWorld, hello_world …',
  },
  limitations: {
    fa: 'برای متون بسیار طولانی مناسب نیست؛ جداکننده‌ها بر اساس فاصله، خط تیره، زیرخط و نقطه تشخیص داده می‌شوند.',
    en: 'Not intended for long prose; word boundaries are detected on spaces, dashes, underscores and dots.',
  },
  run: (input) => {
    const cases = toCases(input);
    const body = Object.entries(cases)
      .map(([name, value]) => `<b>${name}</b>\n${codeBlock(value)}`)
      .join('');
    return { html: body };
  },
});

// ─── Color converter ───────────────────────────────────────
export interface ColorValue {
  hex: string;
  rgb: [number, number, number];
  hsl: [number, number, number];
}

export function parseColor(raw: string): ColorValue {
  const value = raw.trim().toLowerCase();
  const named: Record<string, string> = {
    black: '#000000', white: '#ffffff', red: '#ff0000', green: '#008000', blue: '#0000ff',
    yellow: '#ffff00', cyan: '#00ffff', magenta: '#ff00ff', gray: '#808080', grey: '#808080',
    orange: '#ffa500', purple: '#800080', pink: '#ffc0cb',
  };
  let r = 0;
  let g = 0;
  let b = 0;
  const hexSource = named[value] ?? value;
  const hexMatch = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hexSource);
  const rgbMatch = /^rgba?\(\s*(\d{1,3})\s*[, ]\s*(\d{1,3})\s*[, ]\s*(\d{1,3})/i.exec(value);
  const hslMatch = /^hsla?\(\s*(-?\d{1,3}(?:\.\d+)?)\s*[, ]\s*(\d{1,3}(?:\.\d+)?)%\s*[, ]\s*(\d{1,3}(?:\.\d+)?)%/i.exec(value);

  if (hexMatch?.[1]) {
    let hex = hexMatch[1];
    if (hex.length === 3) hex = hex.split('').map((c) => c + c).join('');
    r = Number.parseInt(hex.slice(0, 2), 16);
    g = Number.parseInt(hex.slice(2, 4), 16);
    b = Number.parseInt(hex.slice(4, 6), 16);
  } else if (rgbMatch) {
    r = Math.min(255, Number(rgbMatch[1]));
    g = Math.min(255, Number(rgbMatch[2]));
    b = Math.min(255, Number(rgbMatch[3]));
  } else if (hslMatch) {
    const h = ((Number(hslMatch[1]) % 360) + 360) % 360;
    const s = Math.min(100, Number(hslMatch[2])) / 100;
    const l = Math.min(100, Number(hslMatch[3])) / 100;
    const c = (1 - Math.abs(2 * l - 1)) * s;
    const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
    const m = l - c / 2;
    const seg = Math.floor(h / 60) % 6;
    const table: [number, number, number][] = [
      [c, x, 0], [x, c, 0], [0, c, x], [0, x, c], [x, 0, c], [c, 0, x],
    ];
    const picked = table[seg] ?? [0, 0, 0];
    r = Math.round((picked[0] + m) * 255);
    g = Math.round((picked[1] + m) * 255);
    b = Math.round((picked[2] + m) * 255);
  } else {
    throw errInvalidInput(
      'قالب رنگ شناسایی نشد. نمونه‌های معتبر: #3498db یا rgb(52,152,219) یا hsl(204,70%,53%) یا blue',
      'Unrecognised colour format. Valid: #3498db, rgb(52,152,219), hsl(204,70%,53%), blue',
    );
  }

  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  const d = max - min;
  let h = 0;
  let s = 0;
  if (d !== 0) {
    s = d / (1 - Math.abs(2 * l - 1));
    if (max === rn) h = ((gn - bn) / d) % 6;
    else if (max === gn) h = (bn - rn) / d + 2;
    else h = (rn - gn) / d + 4;
    h = Math.round(h * 60);
    if (h < 0) h += 360;
  }
  return {
    hex: `#${[r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')}`,
    rgb: [r, g, b],
    hsl: [h, Math.round(s * 100), Math.round(l * 100)],
  };
}

export const colorConverter = defineTool({
  id: 'color_convert',
  category: 'utilities',
  icon: '🎨',
  quick: true,
  needsInput: true,
  title: { fa: 'مبدل رنگ', en: 'Color Converter' },
  description: {
    fa: 'رنگ را بین HEX، RGB، HSL و CMYK تبدیل می‌کند، نسبت کنتراست با سیاه/سفید را می‌سنجد و پیشنهاد رنگ متن می‌دهد.',
    en: 'Converts colours between HEX, RGB, HSL and CMYK, computes contrast against black/white and suggests a text colour.',
  },
  usage: {
    fa: 'یکی از قالب‌های #3498db، rgb(52,152,219)، hsl(204,70%,53%) یا نام رنگ انگلیسی را بفرستید.',
    en: 'Send #3498db, rgb(52,152,219), hsl(204,70%,53%) or an English colour name.',
  },
  example: {
    fa: 'ورودی: #3498db\nخروجی: rgb(52, 152, 219) • hsl(204, 70%, 53%)',
    en: 'Input: #3498db\nOutput: rgb(52, 152, 219) • hsl(204, 70%, 53%)',
  },
  limitations: {
    fa: 'کانال آلفا نادیده گرفته می‌شود و فقط ۱۳ نام رنگ رایج پشتیبانی می‌شود.',
    en: 'Alpha channel is ignored; only 13 common colour names are supported.',
  },
  run: (input, ctx) => {
    const c = parseColor(input);
    const fa = ctx.lang === 'fa';
    const [r, g, b] = c.rgb;
    const k = 1 - Math.max(r, g, b) / 255;
    const cy = k < 1 ? Math.round(((1 - r / 255 - k) / (1 - k)) * 100) : 0;
    const ma = k < 1 ? Math.round(((1 - g / 255 - k) / (1 - k)) * 100) : 0;
    const ye = k < 1 ? Math.round(((1 - b / 255 - k) / (1 - k)) * 100) : 0;
    const lum = (v: number): number => {
      const x = v / 255;
      return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
    };
    const L = 0.2126 * lum(r) + 0.7152 * lum(g) + 0.0722 * lum(b);
    const contrastWhite = Math.round((1.05 / (L + 0.05)) * 100) / 100;
    const contrastBlack = Math.round(((L + 0.05) / 0.05) * 100) / 100;
    const best = contrastWhite >= contrastBlack ? (fa ? 'سفید' : 'white') : (fa ? 'سیاه' : 'black');
    return {
      html:
        `<b>HEX</b> ${mono(c.hex)}\n` +
        `<b>RGB</b> ${mono(`rgb(${r}, ${g}, ${b})`)}\n` +
        `<b>HSL</b> ${mono(`hsl(${c.hsl[0]}, ${c.hsl[1]}%, ${c.hsl[2]}%)`)}\n` +
        `<b>CMYK</b> ${mono(`cmyk(${cy}%, ${ma}%, ${ye}%, ${Math.round(k * 100)}%)`)}\n` +
        `${DIVIDER}\n` +
        (fa
          ? `🌗 کنتراست با سفید: <b>${contrastWhite}</b> • با سیاه: <b>${contrastBlack}</b>\n✍️ رنگ متن پیشنهادی: <b>${best}</b>`
          : `🌗 Contrast vs white: <b>${contrastWhite}</b> • vs black: <b>${contrastBlack}</b>\n✍️ Suggested text colour: <b>${best}</b>`),
    };
  },
});
