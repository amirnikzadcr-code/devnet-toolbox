/**
 * Phase 3 — Regex generator & explainer.
 *
 * Two jobs in one tool:
 *  • explain a pattern the user already has (token breakdown, flags, sample
 *    matches);
 *  • build a validated pattern from a plain-language description.
 *
 * Every pattern — user-supplied or generated — is compiled and executed
 * against a bounded subject with a match cap, and patterns with the classic
 * catastrophic-backtracking shapes are refused before they ever run.
 */
import { defineTool } from '../types.js';
import { codeBlock, DIVIDER, escapeHtml, mono } from '../../utils/text.js';
import { errInvalidInput } from '../../utils/errors.js';
import { LIMITS } from '../../config/index.js';
import { runRegex } from './misc.js';

// ─── ReDoS screening ──────────────────────────────────────────────────────

/**
 * Refuses patterns whose shape makes catastrophic backtracking likely.
 *
 * This is deliberately conservative: nested quantifiers over a group that can
 * match the empty string — `(a+)+`, `(a*)*`, `(a|a)*` — are the shapes that
 * turn a 30-character input into minutes of CPU. A regex engine without a
 * backtracking limit (which is what JS gives us) has no other defence.
 */
export function screenForRedos(pattern: string): void {
  const risky: [RegExp, string, string][] = [
    [
      /\((?:[^()\\]|\\.)*[+*]\)[+*{]/,
      'کوانتیفایر تودرتو مثل (a+)+ می‌تواند باعث backtracking فاجعه‌بار شود.',
      'A nested quantifier such as (a+)+ can cause catastrophic backtracking.',
    ],
    [
      /\((?:[^()\\]|\\.)*\|(?:[^()\\]|\\.)*\)[+*]/,
      'تناوب داخل گروه تکرارشونده مثل (a|a)* می‌تواند نمایی شود؛ گروه را مشخص‌تر کنید.',
      'Alternation inside a repeated group such as (a|a)* can blow up exponentially; make the group more specific.',
    ],
    [
      /(\.\*){3,}|(\.\+){3,}/,
      'چند «.*» پشت‌سرهم عملاً همه‌ی حالت‌ها را می‌آزماید.',
      'Several consecutive ".*" force the engine to try every split.',
    ],
  ];
  for (const [re, fa, en] of risky) {
    if (re.test(pattern)) throw errInvalidInput(`⚠️ ${fa}`, `⚠️ ${en}`);
  }
}

// ─── Explanation ──────────────────────────────────────────────────────────

export interface RegexToken {
  token: string;
  fa: string;
  en: string;
}

const FLAG_MEANINGS: Record<string, { fa: string; en: string }> = {
  g: { fa: 'همه‌ی تطبیق‌ها، نه فقط اولی', en: 'global — find all matches, not just the first' },
  i: { fa: 'بی‌تفاوت به بزرگی و کوچکی حروف', en: 'case-insensitive' },
  m: { fa: '^ و $ به ابتدا/انتهای هر خط اشاره می‌کنند', en: 'multiline — ^ and $ match line boundaries' },
  s: { fa: 'نقطه، خط جدید را هم می‌گیرد', en: 'dotAll — . also matches newlines' },
  u: { fa: 'حالت یونیکد', en: 'unicode mode' },
  y: { fa: 'تطبیق چسبیده از موقعیت lastIndex', en: 'sticky — match exactly at lastIndex' },
};

const SIMPLE_TOKENS: Record<string, { fa: string; en: string }> = {
  '^': { fa: 'ابتدای متن (یا خط، با پرچم m)', en: 'start of the string (or line with the m flag)' },
  $: { fa: 'انتهای متن (یا خط، با پرچم m)', en: 'end of the string (or line with the m flag)' },
  '.': { fa: 'هر کاراکتری به‌جز خط جدید', en: 'any character except a newline' },
  '\\d': { fa: 'یک رقم (0-9)', en: 'a digit (0-9)' },
  '\\D': { fa: 'هر چیزی به‌جز رقم', en: 'anything except a digit' },
  '\\w': { fa: 'حرف، رقم یا زیرخط', en: 'a letter, digit or underscore' },
  '\\W': { fa: 'هر چیزی به‌جز حرف/رقم/زیرخط', en: 'anything except a word character' },
  '\\s': { fa: 'فاصله، تب یا خط جدید', en: 'whitespace: space, tab or newline' },
  '\\S': { fa: 'هر چیزی به‌جز فاصله', en: 'any non-whitespace character' },
  '\\b': { fa: 'مرز کلمه', en: 'a word boundary' },
  '\\B': { fa: 'جایی که مرز کلمه نیست', en: 'a position that is not a word boundary' },
  '\\n': { fa: 'خط جدید', en: 'a newline' },
  '\\t': { fa: 'تب', en: 'a tab' },
};

/** Walks the pattern and describes each construct in order. */
export function explainPattern(pattern: string): RegexToken[] {
  const tokens: RegexToken[] = [];
  let i = 0;

  const quantifier = (): { fa: string; en: string } | null => {
    const rest = pattern.slice(i);
    const repeat = /^(\{\d+(?:,\d*)?\}|\*|\+|\?)(\?)?/.exec(rest);
    if (!repeat) return null;
    i += repeat[0].length;
    const lazy = repeat[2] ? (true as const) : false;
    const base = repeat[1] as string;
    const describe: Record<string, { fa: string; en: string }> = {
      '*': { fa: 'صفر یا چند بار', en: 'zero or more times' },
      '+': { fa: 'یک یا چند بار', en: 'one or more times' },
      '?': { fa: 'اختیاری (صفر یا یک بار)', en: 'optional (zero or one time)' },
    };
    const braced = /^\{(\d+)(?:,(\d*))?\}$/.exec(base);
    const meaning =
      describe[base] ??
      (braced
        ? braced[2] === undefined
          ? { fa: `دقیقاً ${braced[1]} بار`, en: `exactly ${braced[1]} times` }
          : braced[2] === ''
            ? { fa: `حداقل ${braced[1]} بار`, en: `at least ${braced[1]} times` }
            : { fa: `بین ${braced[1]} تا ${braced[2]} بار`, en: `between ${braced[1]} and ${braced[2]} times` }
        : { fa: 'تکرار', en: 'repetition' });
    return lazy
      ? { fa: `${meaning.fa} (کم‌طمع)`, en: `${meaning.en} (lazy)` }
      : meaning;
  };

  const push = (token: string, fa: string, en: string): void => {
    const q = quantifier();
    tokens.push(q ? { token, fa: `${fa} — ${q.fa}`, en: `${en} — ${q.en}` } : { token, fa, en });
  };

  while (i < pattern.length && tokens.length < 60) {
    const ch = pattern[i] as string;

    if (ch === '\\') {
      const pair = pattern.slice(i, i + 2);
      i += 2;
      const known = SIMPLE_TOKENS[pair];
      if (known) push(pair, known.fa, known.en);
      else if (/^\\\d$/.test(pair)) push(pair, `ارجاع به گروه ${pair[1]}`, `back-reference to group ${pair[1]}`);
      else push(pair, `کاراکتر واقعی «${pair[1]}»`, `the literal character "${pair[1]}"`);
      continue;
    }

    if (ch === '[') {
      const end = findClosing(pattern, i, '[', ']');
      const body = pattern.slice(i + 1, end);
      const negated = body.startsWith('^');
      i = end + 1;
      push(
        pattern.slice(pattern.lastIndexOf('[', i), i),
        negated ? `هیچ‌کدام از کاراکترهای «${body.slice(1)}»` : `یکی از کاراکترهای «${body}»`,
        negated ? `none of the characters "${body.slice(1)}"` : `any one of the characters "${body}"`,
      );
      continue;
    }

    if (ch === '(') {
      const lookahead = /^\(\?(:|=|!|<=|<!|<([A-Za-z_][A-Za-z0-9_]*)>)/.exec(pattern.slice(i));
      const kind = lookahead?.[1];
      const name = lookahead?.[3];
      const label: { fa: string; en: string } =
        kind === ':'
          ? { fa: 'گروه بدون ثبت', en: 'non-capturing group' }
          : kind === '='
            ? { fa: 'پیش‌نگر مثبت: باید در ادامه بیاید ولی ثبت نمی‌شود', en: 'positive lookahead: must follow, not captured' }
            : kind === '!'
              ? { fa: 'پیش‌نگر منفی: نباید در ادامه بیاید', en: 'negative lookahead: must not follow' }
              : kind === '<='
                ? { fa: 'پس‌نگر مثبت: باید قبلش آمده باشد', en: 'positive lookbehind: must precede' }
                : kind === '<!'
                  ? { fa: 'پس‌نگر منفی: نباید قبلش آمده باشد', en: 'negative lookbehind: must not precede' }
                  : name
                    ? { fa: `گروه نام‌دار «${name}»`, en: `named capture group "${name}"` }
                    : { fa: 'گروه ثبت‌شونده', en: 'capturing group' };
      i += lookahead ? (lookahead[0] as string).length : 1;
      tokens.push({ token: lookahead?.[0] ?? '(', ...label });
      continue;
    }

    if (ch === ')') {
      i += 1;
      const q = quantifier();
      tokens.push(
        q
          ? { token: ')', fa: `پایان گروه — ${q.fa}`, en: `end of group — ${q.en}` }
          : { token: ')', fa: 'پایان گروه', en: 'end of group' },
      );
      continue;
    }

    if (ch === '|') {
      i += 1;
      tokens.push({ token: '|', fa: 'یا (یکی از دو طرف)', en: 'alternation: either side' });
      continue;
    }

    const known = SIMPLE_TOKENS[ch];
    i += 1;
    if (known) push(ch, known.fa, known.en);
    else push(ch, `کاراکتر واقعی «${ch}»`, `the literal character "${ch}"`);
  }

  return tokens;
}

function findClosing(source: string, start: number, open: string, close: string): number {
  let i = start + 1;
  while (i < source.length) {
    if (source[i] === '\\') {
      i += 2;
      continue;
    }
    if (source[i] === close) return i;
    if (source[i] === open) i = findClosing(source, i, open, close);
    i += 1;
  }
  return source.length - 1;
}

// ─── Generation from a description ────────────────────────────────────────

export interface GeneratedPattern {
  pattern: string;
  flags: string;
  fa: string;
  en: string;
  sample: string;
}

/** Curated, pre-validated patterns. Nothing is generated that we cannot test. */
export const PATTERN_LIBRARY: { keywords: RegExp; entry: GeneratedPattern }[] = [
  {
    keywords: /email|ایمیل|پست الکترونیک/i,
    entry: {
      pattern: "[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[A-Za-z]{2,}",
      flags: 'g',
      fa: 'نشانی ایمیل',
      en: 'Email address',
      sample: 'contact: ada@example.com, bob@dev.io',
    },
  },
  {
    keywords: /url|link|لینک|آدرس|نشانی اینترنت/i,
    entry: {
      pattern: "https?://[^\\s<>\"']+",
      flags: 'g',
      fa: 'نشانی اینترنتی (URL)',
      en: 'HTTP/HTTPS URL',
      sample: 'see https://example.com/docs?x=1 and http://a.io',
    },
  },
  {
    keywords: /ipv4|ip address|آی ?پی|ادرس ای پی/i,
    entry: {
      pattern: "\\b(?:25[0-5]|2[0-4]\\d|1\\d{2}|[1-9]?\\d)(?:\\.(?:25[0-5]|2[0-4]\\d|1\\d{2}|[1-9]?\\d)){3}\\b",
      flags: 'g',
      fa: 'نشانی IPv4',
      en: 'IPv4 address',
      sample: 'hosts 192.168.1.10 and 8.8.8.8 responded',
    },
  },
  {
    keywords: /date|تاریخ|iso.?date/i,
    entry: {
      pattern: "\\b\\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\\d|3[01])\\b",
      flags: 'g',
      fa: 'تاریخ به قالب YYYY-MM-DD',
      en: 'Date in YYYY-MM-DD format',
      sample: 'released 2024-01-31, patched 2024-02-29',
    },
  },
  {
    keywords: /time|ساعت|زمان hh/i,
    entry: {
      pattern: "\\b(?:[01]\\d|2[0-3]):[0-5]\\d(?::[0-5]\\d)?\\b",
      flags: 'g',
      fa: 'ساعت ۲۴ساعته (HH:MM یا HH:MM:SS)',
      en: '24-hour time (HH:MM or HH:MM:SS)',
      sample: 'starts 09:30, ends 17:45:10',
    },
  },
  {
    keywords: /phone|mobile|موبایل|تلفن|شماره تماس/i,
    entry: {
      pattern: "\\+?\\d{1,3}[\\s.-]?\\(?\\d{2,4}\\)?[\\s.-]?\\d{3,4}[\\s.-]?\\d{3,4}",
      flags: 'g',
      fa: 'شماره تلفن با قالب بین‌المللی یا محلی',
      en: 'Phone number, international or local format',
      sample: 'call +49 30 1234567 or 021-88776655',
    },
  },
  {
    keywords: /uuid|guid/i,
    entry: {
      pattern: "\\b[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}\\b",
      flags: 'g',
      fa: 'شناسه‌ی UUID نسخه ۱ تا ۵',
      en: 'UUID versions 1–5',
      sample: 'id 6ba7b810-9dad-11d1-80b4-00c04fd430c8 created',
    },
  },
  {
    keywords: /hex ?colou?r|رنگ|hexcolor/i,
    entry: {
      pattern: "#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})\\b",
      flags: 'g',
      fa: 'کد رنگ hex سه یا شش رقمی',
      en: '3- or 6-digit hex colour code',
      sample: 'brand #0af, accent #FF8800',
    },
  },
  {
    keywords: /password|رمز عبور|قدرت رمز/i,
    entry: {
      pattern: "^(?=.*[a-z])(?=.*[A-Z])(?=.*\\d)(?=.*[^A-Za-z0-9]).{8,}$",
      flags: '',
      fa: 'رمز عبور قوی: حداقل ۸ کاراکتر با حرف کوچک، بزرگ، رقم و نماد',
      en: 'Strong password: 8+ chars with lower, upper, digit and symbol',
      sample: 'Str0ng!Pass',
    },
  },
  {
    keywords: /username|نام کاربری/i,
    entry: {
      pattern: "^[a-zA-Z0-9_]{3,20}$",
      flags: '',
      fa: 'نام کاربری: ۳ تا ۲۰ کاراکتر شامل حرف، رقم و زیرخط',
      en: 'Username: 3–20 characters of letters, digits and underscore',
      sample: 'dev_user01',
    },
  },
  {
    keywords: /slug/i,
    entry: {
      pattern: "^[a-z0-9]+(?:-[a-z0-9]+)*$",
      flags: '',
      fa: 'اسلاگ URL با خط تیره',
      en: 'Hyphenated URL slug',
      sample: 'my-first-post',
    },
  },
  {
    keywords: /number|digit|عدد|رقم/i,
    entry: {
      pattern: "-?\\d+(?:\\.\\d+)?",
      flags: 'g',
      fa: 'عدد صحیح یا اعشاری با علامت اختیاری',
      en: 'Signed integer or decimal number',
      sample: 'values -3, 4.5 and 100',
    },
  },
  {
    keywords: /html ?tag|تگ/i,
    entry: {
      pattern: "</?[a-zA-Z][a-zA-Z0-9-]*(?:\\s[^<>]*)?/?>",
      flags: 'g',
      fa: 'تگ HTML باز یا بسته',
      en: 'Opening or closing HTML tag',
      sample: '<div class="x">text</div>',
    },
  },
  {
    keywords: /whitespace|فاصله اضاف|فضای خالی/i,
    entry: {
      pattern: "\\s{2,}",
      flags: 'g',
      fa: 'دو یا چند فاصله‌ی پشت‌سرهم',
      en: 'Two or more consecutive whitespace characters',
      sample: 'too   many    spaces',
    },
  },
];

export function generatePattern(description: string): GeneratedPattern {
  const found = PATTERN_LIBRARY.find(({ keywords }) => keywords.test(description));
  if (!found) {
    const available = PATTERN_LIBRARY.map((p) => p.entry.en.split(':')[0]).join(', ');
    throw errInvalidInput(
      `برای این توضیح الگوی آماده‌ای وجود ندارد. موضوعات پشتیبانی‌شده: email، url، ip، date، time، phone، uuid، hex color، password، username، slug، number، html tag، whitespace.\nمی‌توانید الگوی خودتان را هم برای توضیح بفرستید.`,
      `No curated pattern matches that description. Supported topics: ${available}.\nYou can also send your own pattern to have it explained.`,
    );
  }
  // Never hand back a pattern we have not compiled and run ourselves.
  const test = runRegex(found.entry.pattern, found.entry.flags || 'g', found.entry.sample);
  if (test.matchCount === 0 && found.entry.flags.includes('g')) {
    throw errInvalidInput(
      'الگوی تولیدشده اعتبارسنجی نشد.',
      'The generated pattern failed its own validation.',
    );
  }
  return found.entry;
}

export const regexHelperTool = defineTool({
  id: 'regex_helper',
  category: 'programming',
  icon: '🪄',
  quick: true,
  needsInput: true,
  title: { fa: 'سازنده و توضیح‌دهنده‌ی Regex', en: 'Regex Generator & Explainer' },
  description: {
    fa: 'یک الگوی Regex را جزءبه‌جزء به زبان ساده توضیح می‌دهد، پرچم‌ها را شرح می‌دهد و نمونه تطبیق نشان می‌دهد؛ یا از روی توصیف ساده (مثل «ایمیل») یک الگوی آزموده‌شده می‌سازد. الگوی نامعتبر و الگوهای مستعد ReDoS رد می‌شوند.',
    en: 'Explains a regex piece by piece in plain language, describes its flags and shows sample matches; or builds a tested pattern from a simple description such as "email". Invalid and ReDoS-prone patterns are rejected.',
  },
  usage: {
    fa:
      'یکی از این دو کار را بکنید:\n' +
      '• توضیح: الگو را بفرستید — <code>/^\\d{3}-\\d{4}$/</code>\n' +
      '• ساخت: <code>generate: email</code> یا <code>بساز: ایمیل</code>\n' +
      'برای آزمودن روی متن دلخواه، متن را در خط‌های بعدی بیاورید.',
    en:
      'Do either:\n' +
      '• Explain: send the pattern — <code>/^\\d{3}-\\d{4}$/</code>\n' +
      '• Generate: <code>generate: email</code>\n' +
      'Add a subject on the following lines to test it against your own text.',
  },
  example: {
    fa: 'ورودی: /\\d{4}-\\d{2}/g\nخروجی: ۴ رقم، خط تیره، ۲ رقم + توضیح پرچم g',
    en: 'Input: /\\d{4}-\\d{2}/g\nOutput: 4 digits, a dash, 2 digits + explanation of the g flag',
  },
  limitations: {
    fa: 'حداکثر ۳۰۰ کاراکتر الگو و ۴۰۰۰ کاراکتر متن آزمون؛ حداکثر ۶۰ جزء توضیح داده می‌شود. الگوهای با کوانتیفایر تودرتو (مثل (a+)+) به‌دلیل خطر ReDoS اجرا نمی‌شوند.',
    en: 'Max 300-character pattern and 4000-character subject; at most 60 tokens are explained. Patterns with nested quantifiers such as (a+)+ are refused because of the ReDoS risk.',
  },
  run: (input, ctx) => {
    const fa = ctx.lang === 'fa';
    const lines = input.split('\n');
    const firstLine = (lines[0] ?? '').trim();

    // ── Generation mode ──
    const genMatch = /^(?:generate|gen|make|بساز|ساخت)\s*[:=]\s*(.+)$/i.exec(firstLine);
    if (genMatch) {
      const entry = generatePattern((genMatch[1] ?? '').trim());
      const subject = lines.slice(1).join('\n').trim() || entry.sample;
      const test = runRegex(entry.pattern, entry.flags || 'g', subject);
      const matches = test.matches
        .slice(0, 8)
        .map((m, i) => `${i + 1}. <code>${escapeHtml(m.value.slice(0, 80))}</code> @ ${m.index}`)
        .join('\n');
      return {
        html:
          `${fa ? '🪄 <b>الگوی ساخته‌شده</b>' : '🪄 <b>Generated pattern</b>'} — ${escapeHtml(fa ? entry.fa : entry.en)}\n` +
          codeBlock(`/${entry.pattern}/${entry.flags}`) +
          `${DIVIDER}\n${fa ? '🧪 <b>آزمون روی نمونه</b>' : '🧪 <b>Tested against sample</b>'}\n${codeBlock(subject.slice(0, 200))}` +
          (test.matchCount
            ? `${fa ? `✅ ${test.matchCount} تطبیق` : `✅ ${test.matchCount} matches`}\n${matches}`
            : fa
              ? '⚠️ روی این متن تطبیقی پیدا نشد.'
              : '⚠️ No match on this subject.'),
        toast: fa ? 'الگو ساخته شد ✅' : 'Pattern generated ✅',
      };
    }

    // ── Explanation mode ──
    const patternMatch = /^\/(.*)\/([gimsuy]*)$/s.exec(firstLine);
    const pattern = patternMatch ? (patternMatch[1] ?? '') : firstLine;
    const flags = patternMatch ? (patternMatch[2] ?? '') : '';

    if (!pattern) {
      throw errInvalidInput(
        'الگو را بفرستید (مثل <code>/\\d+/g</code>) یا با <code>generate: email</code> یکی بسازید.',
        'Send a pattern (e.g. <code>/\\d+/g</code>) or build one with <code>generate: email</code>.',
      );
    }
    if (pattern.length > LIMITS.maxRegexPatternChars) {
      throw errInvalidInput(
        `طول الگو نباید بیش از ${LIMITS.maxRegexPatternChars} کاراکتر باشد.`,
        `The pattern must not exceed ${LIMITS.maxRegexPatternChars} characters.`,
      );
    }

    screenForRedos(pattern);

    try {
      new RegExp(pattern, flags);
    } catch (error) {
      throw errInvalidInput(
        `الگوی Regex معتبر نیست.\nجزئیات: ${error instanceof Error ? error.message : ''}`,
        `Invalid regex.\nDetails: ${error instanceof Error ? error.message : ''}`,
      );
    }

    const tokens = explainPattern(pattern);
    const breakdown = tokens
      .map((tok) => `• <code>${escapeHtml(tok.token)}</code> — ${escapeHtml(fa ? tok.fa : tok.en)}`)
      .join('\n');

    const flagRows = flags
      ? flags
          .split('')
          .map((flag) => {
            const meaning = FLAG_MEANINGS[flag];
            return `• ${mono(flag)} — ${escapeHtml(meaning ? (fa ? meaning.fa : meaning.en) : '?')}`;
          })
          .join('\n')
      : fa
        ? '<i>بدون پرچم</i>'
        : '<i>no flags</i>';

    const subject = lines.slice(1).join('\n').trim();
    let matchBlock = '';
    if (subject) {
      const test = runRegex(pattern, flags || 'g', subject);
      matchBlock =
        `\n${DIVIDER}\n${fa ? '🧪 <b>تطبیق‌ها روی متن شما</b>' : '🧪 <b>Matches in your subject</b>'}\n` +
        (test.matchCount
          ? test.matches
              .slice(0, 10)
              .map((m, i) => `${i + 1}. <code>${escapeHtml(m.value.slice(0, 80))}</code> @ ${m.index}`)
              .join('\n')
          : fa
            ? 'هیچ تطبیقی پیدا نشد.'
            : 'No matches found.');
    }

    return {
      html:
        `${fa ? '🔎 <b>الگو</b>' : '🔎 <b>Pattern</b>'}\n${codeBlock(`/${pattern}/${flags}`)}` +
        `${fa ? '🧩 <b>تجزیه‌ی جزءبه‌جزء</b>' : '🧩 <b>Token breakdown</b>'}\n${breakdown}\n` +
        `${DIVIDER}\n${fa ? '🚩 <b>پرچم‌ها</b>' : '🚩 <b>Flags</b>'}\n${flagRows}` +
        matchBlock,
    };
  },
});
