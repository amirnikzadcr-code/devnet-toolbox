import { defineTool } from '../types.js';
import { codeBlock, DIVIDER, formatBytes } from '../../utils/text.js';
import { errInvalidInput } from '../../utils/errors.js';
import { utf8Length } from '../../utils/encoding.js';
import { pick, type Lang } from '../../localization/index.js';

export function parseJsonSafe(input: string): unknown {
  try {
    return JSON.parse(input);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'parse error';
    throw errInvalidInput(
      `ورودی JSON معتبر نیست.\nجزئیات: ${message}`,
      `Invalid JSON input.\nDetails: ${message}`,
    );
  }
}

function describeShape(value: unknown): { fa: string; en: string } {
  if (Array.isArray(value)) {
    return { fa: `آرایه با ${value.length} عضو`, en: `Array with ${value.length} items` };
  }
  if (value === null) return { fa: 'null', en: 'null' };
  if (typeof value === 'object') {
    const keys = Object.keys(value as Record<string, unknown>);
    return { fa: `شیء با ${keys.length} کلید`, en: `Object with ${keys.length} keys` };
  }
  return { fa: typeof value, en: typeof value };
}

function countNodes(value: unknown, depth = 0): { nodes: number; maxDepth: number } {
  if (value === null || typeof value !== 'object') return { nodes: 1, maxDepth: depth };
  let nodes = 1;
  let maxDepth = depth;
  for (const child of Object.values(value as Record<string, unknown>)) {
    const res = countNodes(child, depth + 1);
    nodes += res.nodes;
    maxDepth = Math.max(maxDepth, res.maxDepth);
  }
  return { nodes, maxDepth };
}

const stats = (lang: Lang, raw: string, parsed: unknown, output: string): string => {
  const { nodes, maxDepth } = countNodes(parsed);
  const shape = pick(lang, describeShape(parsed));
  return lang === 'fa'
    ? `${DIVIDER}\n🧬 ساختار: ${shape}\n🔢 گره‌ها: ${nodes} • عمق: ${maxDepth}\n📦 ورودی: ${formatBytes(utf8Length(raw))} → خروجی: ${formatBytes(utf8Length(output))}`
    : `${DIVIDER}\n🧬 Shape: ${shape}\n🔢 Nodes: ${nodes} • Depth: ${maxDepth}\n📦 In: ${formatBytes(utf8Length(raw))} → Out: ${formatBytes(utf8Length(output))}`;
};

export const jsonFormat = defineTool({
  id: 'json_format',
  category: 'programming',
  icon: '🧾',
  quick: true,
  needsInput: true,
  title: { fa: 'قالب‌بندی JSON', en: 'JSON Formatter' },
  description: {
    fa: 'JSON فشرده یا نامرتب را با تورفتگی ۲ فاصله، مرتب و خوانا می‌کند و گزارش ساختاری (تعداد گره، عمق، حجم) می‌دهد.',
    en: 'Pretty-prints minified or messy JSON with 2-space indentation and reports structure (nodes, depth, size).',
  },
  usage: {
    fa: 'متن JSON را ارسال کنید. خروجی در بلوک کد و قابل کپی است.',
    en: 'Send raw JSON text. Output is a copy-friendly code block.',
  },
  example: {
    fa: 'ورودی: {"a":1,"b":[1,2]}\nخروجی:\n{\n  "a": 1,\n  "b": [\n    1,\n    2\n  ]\n}',
    en: 'Input: {"a":1,"b":[1,2]}\nOutput:\n{\n  "a": 1,\n  "b": [\n    1,\n    2\n  ]\n}',
  },
  limitations: {
    fa: 'حداکثر ۸۰۰۰ کاراکتر ورودی؛ خروجی بسیار بزرگ کوتاه می‌شود. JSON5 و کامنت پشتیبانی نمی‌شود.',
    en: 'Max 8000 input characters; very large output is truncated. JSON5/comments are not supported.',
  },
  run: (input, ctx) => {
    const parsed = parseJsonSafe(input);
    const output = JSON.stringify(parsed, null, 2);
    return { html: `${codeBlock(output, 'json')}\n${stats(ctx.lang, input, parsed, output)}` };
  },
});

export const jsonMinify = defineTool({
  id: 'json_minify',
  category: 'programming',
  icon: '🗜',
  needsInput: true,
  title: { fa: 'فشرده‌سازی JSON', en: 'JSON Minifier' },
  description: {
    fa: 'تمام فاصله‌ها و خطوط اضافی JSON را حذف می‌کند و میزان صرفه‌جویی در حجم را گزارش می‌دهد.',
    en: 'Strips all redundant whitespace from JSON and reports the size saving.',
  },
  usage: { fa: 'متن JSON را ارسال کنید.', en: 'Send raw JSON text.' },
  example: {
    fa: 'ورودی:\n{\n  "a": 1\n}\nخروجی: {"a":1}',
    en: 'Input:\n{\n  "a": 1\n}\nOutput: {"a":1}',
  },
  limitations: {
    fa: 'ترتیب کلیدها حفظ می‌شود اما کامنت‌ها پشتیبانی نمی‌شوند.',
    en: 'Key order is preserved; comments are not supported.',
  },
  run: (input, ctx) => {
    const parsed = parseJsonSafe(input);
    const output = JSON.stringify(parsed);
    const before = utf8Length(input);
    const after = utf8Length(output);
    const saved = before > 0 ? Math.round(((before - after) / before) * 1000) / 10 : 0;
    const line =
      ctx.lang === 'fa'
        ? `${DIVIDER}\n📉 ${formatBytes(before)} → ${formatBytes(after)} (${saved}% کاهش)`
        : `${DIVIDER}\n📉 ${formatBytes(before)} → ${formatBytes(after)} (${saved}% smaller)`;
    return { html: `${codeBlock(output, 'json')}\n${line}` };
  },
});

export const jsonValidate = defineTool({
  id: 'json_validate',
  category: 'programming',
  icon: '✔️',
  needsInput: true,
  title: { fa: 'اعتبارسنجی JSON', en: 'JSON Validator' },
  description: {
    fa: 'صحت نحوی JSON را بررسی می‌کند و در صورت خطا، موقعیت تقریبی و خط مشکل‌دار را نشان می‌دهد.',
    en: 'Validates JSON syntax and, on failure, points at the approximate offending line/position.',
  },
  usage: { fa: 'متن JSON را ارسال کنید.', en: 'Send raw JSON text.' },
  example: {
    fa: 'ورودی: {"a":1,}\nخروجی: ❌ خطای نحوی در نزدیکی موقعیت 7',
    en: 'Input: {"a":1,}\nOutput: ❌ Syntax error near position 7',
  },
  limitations: {
    fa: 'فقط اعتبارسنجی نحوی انجام می‌شود؛ اعتبارسنجی بر اساس JSON Schema پشتیبانی نمی‌شود.',
    en: 'Syntax validation only; JSON Schema validation is not supported.',
  },
  run: (input, ctx) => {
    const fa = ctx.lang === 'fa';
    try {
      const parsed: unknown = JSON.parse(input);
      const { nodes, maxDepth } = countNodes(parsed);
      const shape = pick(ctx.lang, describeShape(parsed));
      return {
        html: fa
          ? `✅ <b>JSON معتبر است.</b>\n${DIVIDER}\n🧬 ساختار: ${shape}\n🔢 گره‌ها: ${nodes} • عمق: ${maxDepth}\n📦 حجم: ${formatBytes(utf8Length(input))}`
          : `✅ <b>Valid JSON.</b>\n${DIVIDER}\n🧬 Shape: ${shape}\n🔢 Nodes: ${nodes} • Depth: ${maxDepth}\n📦 Size: ${formatBytes(utf8Length(input))}`,
        toast: fa ? 'JSON معتبر است ✅' : 'Valid JSON ✅',
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'parse error';
      const posMatch = /position (\d+)/i.exec(message);
      let context = '';
      if (posMatch?.[1]) {
        const pos = Number(posMatch[1]);
        const line = input.slice(0, pos).split('\n').length;
        const snippet = input.slice(Math.max(0, pos - 30), pos + 30);
        context = fa
          ? `\n📍 خط ${line} • موقعیت ${pos}\n${codeBlock(snippet)}`
          : `\n📍 Line ${line} • position ${pos}\n${codeBlock(snippet)}`;
      }
      return {
        html: fa
          ? `❌ <b>JSON نامعتبر است.</b>\n${DIVIDER}\n🧯 ${codeBlock(message)}${context}`
          : `❌ <b>Invalid JSON.</b>\n${DIVIDER}\n🧯 ${codeBlock(message)}${context}`,
        toast: fa ? 'JSON نامعتبر ❌' : 'Invalid JSON ❌',
      };
    }
  },
});
