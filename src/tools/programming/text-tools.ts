/**
 * Phase 3 — text-oriented developer tools: diff checker, duplicate-line
 * remover and the extended text transformer.
 */
import { defineTool } from '../types.js';
import { codeBlock, DIVIDER, escapeHtml, truncate } from '../../utils/text.js';
import { errInvalidInput, errTooLarge } from '../../utils/errors.js';
import { TOOL_LIMITS } from '../../config/index.js';
import { diffLines, type DiffResult, type DiffRow } from '../../utils/diff.js';
import { toCases } from './misc.js';

/** Separators accepted between the two sides of a diff. */
const DIFF_SEPARATORS = [/^-{3,}$/, /^={3,}$/, /^~{3,}$/, /^\s*\|\|\|\s*$/];

export interface DiffInput {
  original: string;
  updated: string;
  ignoreCase: boolean;
  ignoreWhitespace: boolean;
}

/**
 * Splits the message into "before" and "after".
 *
 * A dedicated separator line is required rather than guessing, because both
 * halves are arbitrary code and any heuristic would eventually cut a file in
 * the wrong place.
 */
export function parseDiffInput(input: string): DiffInput {
  let body = input;
  let ignoreCase = false;
  let ignoreWhitespace = false;

  const lines = body.split('\n');
  const firstLine = (lines[0] ?? '').trim().toLowerCase();
  if (/^(flags?|options?)\s*[:=]/.test(firstLine)) {
    ignoreCase = /\bignorecase\b|\bnocase\b|\bi\b/.test(firstLine);
    ignoreWhitespace = /\bignorewhitespace\b|\bnows\b|\bw\b/.test(firstLine);
    body = lines.slice(1).join('\n');
  }

  const bodyLines = body.split('\n');
  const separatorIndex = bodyLines.findIndex((line) =>
    DIFF_SEPARATORS.some((re) => re.test(line.trim())),
  );
  if (separatorIndex === -1) {
    throw errInvalidInput(
      'دو متن را با یک خط جداکننده از هم جدا کنید:\nمتن اول\n<code>---</code>\nمتن دوم',
      'Separate the two texts with a divider line:\nfirst text\n<code>---</code>\nsecond text',
    );
  }

  const original = bodyLines.slice(0, separatorIndex).join('\n').replace(/^\n+|\n+$/g, '');
  const updated = bodyLines.slice(separatorIndex + 1).join('\n').replace(/^\n+|\n+$/g, '');

  for (const [side, value] of [['اول / first', original], ['دوم / second', updated]] as const) {
    if (value.length > TOOL_LIMITS.maxDiffCharsPerSide) {
      throw errTooLarge(
        `متن ${side} بیش از ${TOOL_LIMITS.maxDiffCharsPerSide} کاراکتر است.`,
        `The ${side} text exceeds ${TOOL_LIMITS.maxDiffCharsPerSide} characters.`,
      );
    }
  }
  const totalLines = original.split('\n').length + updated.split('\n').length;
  if (totalLines > TOOL_LIMITS.maxDiffLines) {
    throw errTooLarge(
      `مجموع خطوط دو متن نباید از ${TOOL_LIMITS.maxDiffLines} بیشتر باشد.`,
      `The two texts together must not exceed ${TOOL_LIMITS.maxDiffLines} lines.`,
    );
  }

  return { original, updated, ignoreCase, ignoreWhitespace };
}

const OP_MARK: Record<DiffRow['op'], string> = {
  equal: ' ',
  add: '+',
  remove: '-',
  change: '~',
};

/** Unified-ish plain-text rendering, used both inline and in the attachment. */
export function renderDiffText(result: DiffResult, limit?: number): string {
  const rows = limit === undefined ? result.rows : result.rows.slice(0, limit);
  const out: string[] = [];
  for (const row of rows) {
    const mark = OP_MARK[row.op];
    if (row.op === 'change') {
      out.push(`- ${String(row.oldLine ?? '').padStart(4)} │ ${row.oldText ?? ''}`);
      out.push(`+ ${String(row.newLine ?? '').padStart(4)} │ ${row.newText ?? ''}`);
      continue;
    }
    const line = row.op === 'add' ? row.newLine : row.oldLine;
    const text = row.op === 'add' ? row.newText : row.oldText;
    out.push(`${mark} ${String(line ?? '').padStart(4)} │ ${text ?? ''}`);
  }
  return out.join('\n');
}

/** Only changed regions plus a little context — what a reviewer wants to see. */
export function significantRows(rows: DiffRow[], context = 1): DiffRow[] {
  const keep = new Set<number>();
  rows.forEach((row, index) => {
    if (row.op === 'equal') return;
    for (let i = Math.max(0, index - context); i <= Math.min(rows.length - 1, index + context); i += 1) {
      keep.add(i);
    }
  });
  return rows.filter((_, index) => keep.has(index));
}

export const diffTool = defineTool({
  id: 'diff_check',
  category: 'programming',
  icon: '🔍',
  quick: true,
  needsInput: true,
  title: { fa: 'مقایسه‌گر متن و کد (Diff)', en: 'Diff Checker' },
  description: {
    fa: 'دو متن یا دو قطعه کد را خط‌به‌خط مقایسه می‌کند و خطوط اضافه‌شده، حذف‌شده، تغییریافته و بدون‌تغییر را به‌همراه آمار و درصد شباهت نشان می‌دهد. خروجی بزرگ به‌صورت فایل ارسال می‌شود.',
    en: 'Compares two texts or code snippets line by line and reports added, removed, changed and unchanged lines with statistics and a similarity score. Large output is delivered as a file.',
  },
  usage: {
    fa:
      'متن اول، سپس یک خط <code>---</code>، سپس متن دوم:\n' +
      '<code>const a = 1;\n---\nconst a = 2;</code>\n' +
      'خط اول اختیاری برای تنظیمات: <code>flags: ignorecase ignorewhitespace</code>',
    en:
      'First text, then a <code>---</code> line, then the second text:\n' +
      '<code>const a = 1;\n---\nconst a = 2;</code>\n' +
      'Optional first line for options: <code>flags: ignorecase ignorewhitespace</code>',
  },
  example: {
    fa: 'ورودی:\nhello\n---\nhello world\n\nخروجی: ۱ تغییر • شباهت ۰٪',
    en: 'Input:\nhello\n---\nhello world\n\nOutput: 1 change • 0% similarity',
  },
  limitations: {
    fa: 'حداکثر ۶۰۰۰ کاراکتر برای هر طرف و ۱۲۰۰ خط در مجموع. مقایسه در سطح خط انجام می‌شود، نه در سطح کلمه یا کاراکتر.',
    en: 'Max 6000 characters per side and 1200 lines in total. Comparison is line-level, not word- or character-level.',
  },
  run: (input, ctx) => {
    const fa = ctx.lang === 'fa';
    const parsed = parseDiffInput(input);
    const result = diffLines(parsed.original, parsed.updated, {
      ignoreCase: parsed.ignoreCase,
      ignoreWhitespace: parsed.ignoreWhitespace,
    });
    const { stats } = result;

    const identical = stats.added === 0 && stats.removed === 0 && stats.changed === 0;
    const summary = fa
      ? `${identical ? '✅ <b>دو متن یکسان هستند</b>' : '📝 <b>تفاوت پیدا شد</b>'}\n${DIVIDER}\n` +
        `➕ اضافه‌شده: <b>${stats.added}</b>\n➖ حذف‌شده: <b>${stats.removed}</b>\n` +
        `♻️ تغییریافته: <b>${stats.changed}</b>\n⚪️ بدون تغییر: <b>${stats.unchanged}</b>\n` +
        `📈 شباهت: <b>${stats.similarity}٪</b>`
      : `${identical ? '✅ <b>The two texts are identical</b>' : '📝 <b>Differences found</b>'}\n${DIVIDER}\n` +
        `➕ Added: <b>${stats.added}</b>\n➖ Removed: <b>${stats.removed}</b>\n` +
        `♻️ Changed: <b>${stats.changed}</b>\n⚪️ Unchanged: <b>${stats.unchanged}</b>\n` +
        `📈 Similarity: <b>${stats.similarity}%</b>`;

    const flagsNote =
      parsed.ignoreCase || parsed.ignoreWhitespace
        ? `\n<i>${fa ? 'تنظیمات:' : 'Options:'} ${[
            parsed.ignoreCase ? (fa ? 'بی‌تفاوت به بزرگی/کوچکی' : 'case-insensitive') : '',
            parsed.ignoreWhitespace ? (fa ? 'نادیده‌گرفتن فاصله‌ها' : 'whitespace-insensitive') : '',
          ]
            .filter(Boolean)
            .join(' • ')}</i>`
        : '';

    const degradedNote = result.degraded
      ? `\n<i>⚠️ ${fa ? 'به دلیل حجم ورودی، مقایسه‌ی تقریبی (بلوکی) انجام شد.' : 'Because of the input size, an approximate block diff was used.'}</i>`
      : '';

    if (identical) {
      return { html: summary + flagsNote, toast: fa ? 'یکسان ✅' : 'Identical ✅' };
    }

    const focus = significantRows(result.rows, 1);
    const inline = renderDiffText({ ...result, rows: focus }, TOOL_LIMITS.maxInlineDiffRows);
    const truncatedInline = focus.length > TOOL_LIMITS.maxInlineDiffRows;
    const fullReport =
      `${fa ? 'گزارش تفاوت' : 'Diff report'}\n` +
      `+ added: ${stats.added} | - removed: ${stats.removed} | ~ changed: ${stats.changed} | = unchanged: ${stats.unchanged} | similarity: ${stats.similarity}%\n` +
      `${'─'.repeat(50)}\n${renderDiffText(result)}\n`;

    const needsFile = truncatedInline || fullReport.length > TOOL_LIMITS.fileDeliveryThreshold;

    return {
      html:
        summary +
        flagsNote +
        degradedNote +
        `\n${DIVIDER}\n${fa ? '🔬 <b>خطوط متفاوت</b>' : '🔬 <b>Differing lines</b>'}\n` +
        codeBlock(truncate(inline, 1600), 'diff') +
        (needsFile
          ? fa
            ? '\n📎 گزارش کامل به‌صورت فایل پیوست ارسال شد.'
            : '\n📎 The full report was sent as an attachment.'
          : ''),
      ...(needsFile
        ? {
            attachment: {
              name: 'diff-report.txt',
              content: fullReport,
              caption: { fa: '📎 گزارش کامل تفاوت‌ها', en: '📎 Full diff report' },
            },
          }
        : {}),
    };
  },
});

// ─── 8. Duplicate line remover ────────────────────────────────────────────

export interface DedupeOptions {
  caseSensitive: boolean;
  removeEmpty: boolean;
  trim: boolean;
  /** Keep only the lines that occurred more than once instead of removing them. */
  onlyDuplicates: boolean;
  sort: boolean;
}

export interface DedupeResult {
  lines: string[];
  original: number;
  unique: number;
  removed: number;
  /** The five most repeated lines, for the summary. */
  top: { text: string; count: number }[];
}

/** Keeps the first occurrence of each line, preserving the original order. */
export function dedupeLines(input: string, options: DedupeOptions): DedupeResult {
  const rawLines = input.split(/\r?\n/);
  if (rawLines.length > TOOL_LIMITS.maxLines) {
    throw errTooLarge(
      `حداکثر ${TOOL_LIMITS.maxLines} خط پشتیبانی می‌شود.`,
      `At most ${TOOL_LIMITS.maxLines} lines are supported.`,
    );
  }

  const counts = new Map<string, number>();
  const seen = new Set<string>();
  const kept: string[] = [];
  let original = 0;

  for (const raw of rawLines) {
    const line = options.trim ? raw.trim() : raw;
    if (options.removeEmpty && line.trim() === '') continue;
    original += 1;
    const key = options.caseSensitive ? line : line.toLowerCase();
    counts.set(key, (counts.get(key) ?? 0) + 1);
    if (seen.has(key)) continue;
    seen.add(key);
    kept.push(line);
  }

  let lines = kept;
  if (options.onlyDuplicates) {
    lines = kept.filter((line) => (counts.get(options.caseSensitive ? line : line.toLowerCase()) ?? 0) > 1);
  }
  if (options.sort) lines = [...lines].sort((a, b) => a.localeCompare(b));

  const top = [...counts.entries()]
    .filter(([, count]) => count > 1)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([text, count]) => ({ text, count }));

  return { lines, original, unique: kept.length, removed: original - kept.length, top };
}

export const duplicateLineTool = defineTool({
  id: 'dedupe_lines',
  category: 'utilities',
  icon: '🧹',
  needsInput: true,
  title: { fa: 'حذف خطوط تکراری', en: 'Duplicate Line Remover' },
  description: {
    fa: 'خطوط تکراری را حذف می‌کند و ترتیب اولین ظهور هر خط را حفظ می‌کند. حذف خطوط خالی، حساسیت به بزرگی/کوچکی حروف، مرتب‌سازی و نمایش فقط موارد تکراری قابل انتخاب است و آمار کامل ارائه می‌شود.',
    en: 'Removes duplicate lines while preserving the order of first occurrence. Optional blank-line removal, case sensitivity, sorting and duplicates-only mode, with full statistics.',
  },
  usage: {
    fa:
      'فهرست خطوط را ارسال کنید. خط اول اختیاری برای تنظیمات:\n' +
      '<code>flags: casesensitive keepempty sort onlydup notrim</code>\n' +
      'پیش‌فرض: بدون حساسیت به بزرگی/کوچکی، حذف خطوط خالی، حفظ ترتیب.',
    en:
      'Send the list of lines. Optional first line for options:\n' +
      '<code>flags: casesensitive keepempty sort onlydup notrim</code>\n' +
      'Defaults: case-insensitive, blank lines removed, original order kept.',
  },
  example: {
    fa: 'ورودی:\na\nb\na\n\nخروجی:\na\nb\n(۳ خط → ۲ یکتا، ۱ حذف)',
    en: 'Input:\na\nb\na\n\nOutput:\na\nb\n(3 lines → 2 unique, 1 removed)',
  },
  limitations: {
    fa: 'حداکثر ۳۰۰۰ خط و ۸۰۰۰ کاراکتر. مقایسه بر اساس کل خط انجام می‌شود، نه بخشی از آن.',
    en: 'Max 3000 lines and 8000 characters. Lines are compared in full, not partially.',
  },
  run: (input, ctx) => {
    const fa = ctx.lang === 'fa';
    let body = input;
    const options: DedupeOptions = {
      caseSensitive: false,
      removeEmpty: true,
      trim: true,
      onlyDuplicates: false,
      sort: false,
    };

    const lines = input.split('\n');
    const firstLine = (lines[0] ?? '').trim().toLowerCase();
    if (/^(flags?|options?)\s*[:=]/.test(firstLine)) {
      options.caseSensitive = /\bcasesensitive\b|\bcs\b/.test(firstLine);
      options.removeEmpty = !/\bkeepempty\b/.test(firstLine);
      options.trim = !/\bnotrim\b/.test(firstLine);
      options.onlyDuplicates = /\bonlydup(licates)?\b/.test(firstLine);
      options.sort = /\bsort\b/.test(firstLine);
      body = lines.slice(1).join('\n');
    }

    if (!body.trim()) {
      throw errInvalidInput('فهرستی از خطوط ارسال کنید.', 'Send a list of lines.');
    }

    const result = dedupeLines(body, options);
    const output = result.lines.join('\n');

    const topRows = result.top.length
      ? `\n${DIVIDER}\n${fa ? '🔁 <b>پرتکرارترین خطوط</b>' : '🔁 <b>Most repeated lines</b>'}\n` +
        result.top
          .map((entry) => `• <code>${escapeHtml(truncate(entry.text || '(empty)', 60))}</code> × ${entry.count}`)
          .join('\n')
      : '';

    const summary = fa
      ? `🧹 <b>نتیجه</b>\n${DIVIDER}\n📄 خطوط اولیه: <b>${result.original}</b>\n✨ یکتا: <b>${result.unique}</b>\n🗑 حذف‌شده: <b>${result.removed}</b>`
      : `🧹 <b>Result</b>\n${DIVIDER}\n📄 Original lines: <b>${result.original}</b>\n✨ Unique: <b>${result.unique}</b>\n🗑 Removed: <b>${result.removed}</b>`;

    const needsFile = output.length > TOOL_LIMITS.fileDeliveryThreshold;
    return {
      html:
        summary +
        topRows +
        `\n${DIVIDER}\n${fa ? '📋 <b>خروجی</b>' : '📋 <b>Output</b>'}\n` +
        codeBlock(needsFile ? `${output.slice(0, 900)}\n…` : output || '—') +
        (needsFile ? (fa ? '\n📎 خروجی کامل به‌صورت فایل ارسال شد.' : '\n📎 The full output was sent as a file.') : ''),
      ...(needsFile
        ? {
            attachment: {
              name: 'unique-lines.txt',
              content: output,
              caption: { fa: '📎 خطوط یکتا', en: '📎 Unique lines' },
            },
          }
        : {}),
    };
  },
});

// ─── 10. Text transformer ─────────────────────────────────────────────────

/** The 9 naming conventions plus the whitespace operations. */
export function transformText(input: string): Record<string, string> {
  const cases = toCases(input);
  return {
    ...cases,
    'Remove spaces': input.replace(/\s+/g, ''),
    'Normalize whitespace': input.replace(/[ \t]+/g, ' ').replace(/ ?\n ?/g, '\n').trim(),
    'Reverse': [...input].reverse().join(''),
    'Slugify': input
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9\u0600-\u06ff]+/g, '-')
      .replace(/^-+|-+$/g, ''),
  };
}

export const textTransformTool = defineTool({
  id: 'text_transform',
  category: 'utilities',
  icon: '✍️',
  quick: true,
  needsInput: true,
  title: { fa: 'تبدیل‌گر متن', en: 'Text Transformer' },
  description: {
    fa: 'متن را همزمان به ۹ حالت نام‌گذاری (camelCase، PascalCase، snake_case، kebab-case، CONSTANT_CASE، dot.case، Title Case، UPPERCASE، lowercase) و همچنین حذف فاصله‌ها، یکسان‌سازی فاصله‌ها، معکوس‌سازی و slug تبدیل می‌کند.',
    en: 'Converts text into all 9 naming conventions (camelCase, PascalCase, snake_case, kebab-case, CONSTANT_CASE, dot.case, Title Case, UPPERCASE, lowercase) plus space removal, whitespace normalisation, reversal and slugification.',
  },
  usage: {
    fa: 'متن یا نام متغیر را ارسال کنید. برای گرفتن یک حالت خاص، خط اول را بگذارید <code>mode: camel</code> (یا snake، kebab، constant، dot، pascal، title، upper، lower، slug، nospace، normalize).',
    en: 'Send text or an identifier. To get a single variant, make the first line <code>mode: camel</code> (or snake, kebab, constant, dot, pascal, title, upper, lower, slug, nospace, normalize).',
  },
  example: {
    fa: 'ورودی: hello dev world\nخروجی: helloDevWorld • hello_dev_world • hello-dev-world …',
    en: 'Input: hello dev world\nOutput: helloDevWorld • hello_dev_world • hello-dev-world …',
  },
  limitations: {
    fa: 'حداکثر ۸۰۰۰ کاراکتر. مرز کلمات بر اساس فاصله، خط تیره، زیرخط، نقطه و تغییر بزرگی حروف تشخیص داده می‌شود؛ برای متن‌های طولانی روایی مناسب نیست.',
    en: 'Max 8000 characters. Word boundaries come from spaces, dashes, underscores, dots and case changes; not intended for long prose.',
  },
  run: (input, ctx) => {
    const fa = ctx.lang === 'fa';
    const MODE_KEYS: Record<string, string> = {
      upper: 'UPPERCASE', lower: 'lowercase', title: 'Title Case', camel: 'camelCase',
      pascal: 'PascalCase', snake: 'snake_case', kebab: 'kebab-case',
      constant: 'CONSTANT_CASE', dot: 'dot.case', nospace: 'Remove spaces',
      normalize: 'Normalize whitespace', reverse: 'Reverse', slug: 'Slugify',
    };

    let body = input;
    let mode: string | null = null;
    const lines = input.split('\n');
    const directive = /^(?:mode|action)\s*[:=]\s*([a-z]+)$/i.exec((lines[0] ?? '').trim());
    if (directive && MODE_KEYS[(directive[1] ?? '').toLowerCase()]) {
      mode = MODE_KEYS[(directive[1] ?? '').toLowerCase()] as string;
      body = lines.slice(1).join('\n');
    }
    if (!body.trim()) {
      throw errInvalidInput('متنی برای تبدیل ارسال نشده است.', 'No text was provided.');
    }

    const variants = transformText(body);
    if (mode) {
      return { html: `<b>${escapeHtml(mode)}</b>\n${codeBlock(variants[mode] ?? '')}` };
    }
    const rows = Object.entries(variants)
      .map(([name, value]) => `<b>${escapeHtml(name)}</b>\n${codeBlock(truncate(value, 300))}`)
      .join('');
    return {
      html:
        `${fa ? '✍️ <b>تبدیل‌های متن</b>' : '✍️ <b>Text variants</b>'}\n${DIVIDER}\n` +
        rows +
        `${DIVIDER}\n${fa ? `🔤 ${[...body].length} کاراکتر` : `🔤 ${[...body].length} characters`}`,
    };
  },
});
