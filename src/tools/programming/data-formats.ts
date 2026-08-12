/**
 * Phase 3 — structured-data tools: YAML ↔ JSON, XML formatter, CSV ↔ JSON.
 *
 * All three share one shape: the first line is an optional mode directive,
 * the rest is the document. Parsing is done by the dependency-free helpers in
 * `src/utils/{yaml,xml}.ts`, so no third-party parser is pulled into the
 * Worker bundle and no entity/anchor expansion can be abused.
 */
import { defineTool } from '../types.js';
import { codeBlock, DIVIDER, escapeHtml, formatBytes, mono } from '../../utils/text.js';
import { errInvalidInput, errTooLarge } from '../../utils/errors.js';
import { utf8Length } from '../../utils/encoding.js';
import { TOOL_LIMITS } from '../../config/index.js';
import { minifyYaml, parseYamlOrThrow, stringifyYaml } from '../../utils/yaml.js';
import { formatXml, minifyXml, parseXml, XmlError, xmlOutline } from '../../utils/xml.js';
import { parseJsonSafe } from './json.js';

// ─── Shared directive parsing ─────────────────────────────────────────────

/**
 * Tools accept an optional first-line directive (`mode: minify`) so a single
 * Telegram message can carry both the action and the payload. Anything that
 * is not a known directive is treated as part of the document — a YAML file
 * legitimately starts with `key: value`.
 */
export function splitDirective(input: string, allowed: readonly string[]): { mode: string | null; body: string } {
  const newline = input.indexOf('\n');
  const firstLine = (newline === -1 ? input : input.slice(0, newline)).trim();
  const match = /^(?:mode|action)\s*[:=]\s*([a-z-]+)$/i.exec(firstLine);
  const bare = /^([a-z-]+)$/i.exec(firstLine);
  const candidate = (match?.[1] ?? bare?.[1] ?? '').toLowerCase();
  if (candidate && allowed.includes(candidate)) {
    return { mode: candidate, body: newline === -1 ? '' : input.slice(newline + 1) };
  }
  return { mode: null, body: input };
}

function assertSize(body: string, max = TOOL_LIMITS.maxStructuredChars): string {
  const trimmed = body.trim();
  if (!trimmed) {
    throw errInvalidInput('سندی برای پردازش ارسال نشده است.', 'No document was provided.');
  }
  if (trimmed.length > max) {
    throw errTooLarge(
      `حجم سند بیش از حد مجاز است (حداکثر ${max} کاراکتر).`,
      `The document exceeds the ${max}-character limit.`,
    );
  }
  return trimmed;
}

/** Renders a result body plus an attachment when the payload is long. */
function deliver(
  fa: boolean,
  header: string,
  payload: string,
  fileName: string,
  footer: string,
  language?: string,
): { html: string; attachment?: { name: string; content: string; caption: { fa: string; en: string } } } {
  if (payload.length <= TOOL_LIMITS.fileDeliveryThreshold) {
    return { html: `${header}\n${codeBlock(payload, language)}${footer}` };
  }
  const preview = `${payload.slice(0, 900)}\n…`;
  return {
    html:
      `${header}\n${codeBlock(preview, language)}` +
      `${fa ? '\n📎 خروجی کامل به‌صورت فایل پیوست ارسال شد.' : '\n📎 The full output was sent as an attachment.'}` +
      footer,
    attachment: {
      name: fileName,
      content: payload,
      caption: { fa: '📎 خروجی کامل', en: '📎 Full output' },
    },
  };
}

// ─── 1. YAML ↔ JSON ───────────────────────────────────────────────────────

/** Detects the input format so the conversion can be bidirectional. */
export function looksLikeJson(source: string): boolean {
  const trimmed = source.trim();
  return trimmed.startsWith('{') || trimmed.startsWith('[');
}

export type YamlJsonMode = 'auto' | 'to-json' | 'to-yaml' | 'validate' | 'format' | 'minify';

export interface YamlJsonOutcome {
  /** What the tool actually did, after `auto` was resolved. */
  action: 'to-json' | 'to-yaml' | 'validate' | 'format' | 'minify';
  source: 'yaml' | 'json';
  output: string;
  /** Extension for the attachment, when one is needed. */
  extension: 'json' | 'yaml' | 'yml';
}

export function convertYamlJson(body: string, mode: YamlJsonMode): YamlJsonOutcome {
  const source: 'yaml' | 'json' = looksLikeJson(body) ? 'json' : 'yaml';
  const value = source === 'json' ? parseJsonSafe(body) : parseYamlOrThrow(body);

  const action: YamlJsonOutcome['action'] =
    mode === 'auto' ? (source === 'json' ? 'to-yaml' : 'to-json') : mode;

  switch (action) {
    case 'to-json':
      return { action, source, output: JSON.stringify(value, null, 2), extension: 'json' };
    case 'to-yaml':
      return { action, source, output: stringifyYaml(value), extension: 'yaml' };
    case 'validate':
      return { action, source, output: JSON.stringify(value, null, 2), extension: 'json' };
    case 'format':
      return source === 'json'
        ? { action, source, output: JSON.stringify(value, null, 2), extension: 'json' }
        : { action, source, output: stringifyYaml(value), extension: 'yaml' };
    case 'minify':
      return source === 'json'
        ? { action, source, output: JSON.stringify(value), extension: 'json' }
        : { action, source, output: minifyYaml(body), extension: 'yaml' };
  }
}

export const yamlJsonTool = defineTool({
  id: 'yaml_json',
  category: 'programming',
  icon: '🧬',
  quick: true,
  needsInput: true,
  title: { fa: 'مبدل YAML ↔ JSON', en: 'YAML ↔ JSON Converter' },
  description: {
    fa: 'YAML را به JSON و JSON را به YAML تبدیل می‌کند؛ سند را اعتبارسنجی می‌کند، مرتب (Format) یا فشرده (Minify) می‌سازد و خطا را همراه شماره‌ی خط توضیح می‌دهد.',
    en: 'Converts YAML to JSON and JSON to YAML, validates the document, formats or minifies it, and reports errors with the exact line number.',
  },
  usage: {
    fa:
      'سند را ارسال کنید؛ جهت تبدیل خودکار تشخیص داده می‌شود.\n' +
      'برای انتخاب دستی، خط اول را یکی از این‌ها بگذارید:\n' +
      '<code>mode: to-json</code> • <code>mode: to-yaml</code> • <code>mode: validate</code> • <code>mode: format</code> • <code>mode: minify</code>',
    en:
      'Send the document; the direction is detected automatically.\n' +
      'To choose it manually, make the first line one of:\n' +
      '<code>mode: to-json</code> • <code>mode: to-yaml</code> • <code>mode: validate</code> • <code>mode: format</code> • <code>mode: minify</code>',
  },
  example: {
    fa: 'ورودی:\nname: app\nport: 8080\n\nخروجی:\n{\n  "name": "app",\n  "port": 8080\n}',
    en: 'Input:\nname: app\nport: 8080\n\nOutput:\n{\n  "name": "app",\n  "port": 8080\n}',
  },
  limitations: {
    fa: 'حداکثر ۸۰۰۰ کاراکتر و ۲۰۰۰ خط. لنگر (anchor/alias)، تگ سفارشی، چند-داکیومنت و تورفتگی با Tab پشتیبانی نمی‌شود.',
    en: 'Max 8000 characters and 2000 lines. Anchors/aliases, custom tags, multi-document files and tab indentation are not supported.',
  },
  run: (input, ctx) => {
    const fa = ctx.lang === 'fa';
    const { mode, body } = splitDirective(input, ['auto', 'to-json', 'to-yaml', 'validate', 'format', 'minify']);
    const document = assertSize(body);
    const outcome = convertYamlJson(document, (mode ?? 'auto') as YamlJsonMode);

    const actionLabel: Record<YamlJsonOutcome['action'], { fa: string; en: string }> = {
      'to-json': { fa: 'YAML → JSON', en: 'YAML → JSON' },
      'to-yaml': { fa: 'JSON → YAML', en: 'JSON → YAML' },
      validate: { fa: 'اعتبارسنجی', en: 'Validation' },
      format: { fa: 'قالب‌بندی', en: 'Format' },
      minify: { fa: 'فشرده‌سازی', en: 'Minify' },
    };

    const header = `${fa ? '✅ <b>ورودی معتبر است</b>' : '✅ <b>Input is valid</b>'} • ${
      outcome.source === 'json' ? 'JSON' : 'YAML'
    } → ${escapeHtml(fa ? actionLabel[outcome.action].fa : actionLabel[outcome.action].en)}`;

    const footer =
      `${DIVIDER}\n` +
      (fa
        ? `📦 ورودی: ${formatBytes(utf8Length(document))} → خروجی: ${formatBytes(utf8Length(outcome.output))}\n📐 خطوط: ${document.split('\n').length} → ${outcome.output.split('\n').length}`
        : `📦 In: ${formatBytes(utf8Length(document))} → Out: ${formatBytes(utf8Length(outcome.output))}\n📐 Lines: ${document.split('\n').length} → ${outcome.output.split('\n').length}`);

    const delivered = deliver(
      fa,
      header,
      outcome.output,
      `converted.${outcome.extension}`,
      footer,
      outcome.extension === 'json' ? 'json' : 'yaml',
    );
    return {
      html: delivered.html,
      ...(delivered.attachment ? { attachment: delivered.attachment } : {}),
      toast: fa ? 'تبدیل انجام شد ✅' : 'Converted ✅',
    };
  },
});

// ─── 2. XML formatter ─────────────────────────────────────────────────────

export const xmlFormatterTool = defineTool({
  id: 'xml_format',
  category: 'programming',
  icon: '📗',
  needsInput: true,
  title: { fa: 'قالب‌بندی و اعتبارسنجی XML', en: 'XML Formatter & Validator' },
  description: {
    fa: 'سند XML را اعتبارسنجی می‌کند، با تورفتگی خوانا مرتب می‌کند یا فشرده می‌سازد و ساختار درختی آن را نشان می‌دهد.',
    en: 'Validates an XML document, pretty-prints or minifies it, and shows the element tree.',
  },
  usage: {
    fa: 'سند XML را ارسال کنید. خط اول اختیاری: <code>mode: format</code> • <code>mode: minify</code> • <code>mode: validate</code> • <code>mode: tree</code>',
    en: 'Send the XML document. Optional first line: <code>mode: format</code> • <code>mode: minify</code> • <code>mode: validate</code> • <code>mode: tree</code>',
  },
  example: {
    fa: 'ورودی: <code>&lt;a&gt;&lt;b x="1"/&gt;&lt;/a&gt;</code>\nخروجی:\n&lt;a&gt;\n  &lt;b x="1"/&gt;\n&lt;/a&gt;',
    en: 'Input: <code>&lt;a&gt;&lt;b x="1"/&gt;&lt;/a&gt;</code>\nOutput:\n&lt;a&gt;\n  &lt;b x="1"/&gt;\n&lt;/a&gt;',
  },
  limitations: {
    fa: 'حداکثر ۸۰۰۰ کاراکتر و عمق ۱۰۰. به دلایل امنیتی DOCTYPE با internal subset رد می‌شود و هیچ entity خارجی گسترش نمی‌یابد (محافظت در برابر XXE و Billion Laughs).',
    en: 'Max 8000 characters, depth 100. For security, a DOCTYPE with an internal subset is rejected and no external entity is ever expanded (XXE / billion-laughs protection).',
  },
  run: (input, ctx) => {
    const fa = ctx.lang === 'fa';
    const { mode, body } = splitDirective(input, ['format', 'minify', 'validate', 'tree', 'pretty']);
    const document = assertSize(body);

    let doc;
    try {
      doc = parseXml(document);
    } catch (error) {
      if (error instanceof XmlError) {
        throw errInvalidInput(
          `XML معتبر نیست.\nخط ${error.line}، ستون ${error.column}: ${error.message}`,
          `Invalid XML.\nLine ${error.line}, column ${error.column}: ${error.message}`,
        );
      }
      throw errInvalidInput('XML معتبر نیست.', 'Invalid XML.');
    }

    const action = mode === 'pretty' ? 'format' : (mode ?? 'format');
    const stats =
      `${DIVIDER}\n` +
      (fa
        ? `🧩 عناصر: ${doc.elements} • عمق: ${doc.maxDepth}\n📦 ورودی: ${formatBytes(utf8Length(document))}`
        : `🧩 Elements: ${doc.elements} • Depth: ${doc.maxDepth}\n📦 Input: ${formatBytes(utf8Length(document))}`);

    if (action === 'validate') {
      return {
        html: `${fa ? '✅ <b>XML معتبر است</b>' : '✅ <b>Valid XML</b>'}\n${stats}`,
        toast: fa ? 'معتبر ✅' : 'Valid ✅',
      };
    }
    if (action === 'tree') {
      const outline = xmlOutline(doc, 40);
      return {
        html:
          `${fa ? '🌳 <b>ساختار سند</b>' : '🌳 <b>Document tree</b>'}\n` +
          codeBlock(outline.join('\n') || '—') +
          stats,
      };
    }

    const output = action === 'minify' ? minifyXml(doc) : formatXml(doc);
    const header = fa
      ? `✅ <b>${action === 'minify' ? 'فشرده شد' : 'قالب‌بندی شد'}</b>`
      : `✅ <b>${action === 'minify' ? 'Minified' : 'Formatted'}</b>`;
    const footer =
      `${stats}\n` +
      (fa
        ? `📤 خروجی: ${formatBytes(utf8Length(output))}`
        : `📤 Output: ${formatBytes(utf8Length(output))}`);

    const delivered = deliver(fa, header, output, 'document.xml', footer, 'xml');
    return {
      html: delivered.html,
      ...(delivered.attachment ? { attachment: delivered.attachment } : {}),
    };
  },
});

// ─── 3. CSV ↔ JSON ────────────────────────────────────────────────────────

export interface CsvTable {
  header: string[];
  rows: string[][];
  /** True when the first line was treated as a header. */
  hasHeader: boolean;
  delimiter: string;
}

/** Picks the delimiter by counting candidates outside quoted fields. */
export function detectDelimiter(sample: string): string {
  const candidates = [',', ';', '\t', '|'];
  let best = ',';
  let bestScore = -1;
  for (const delimiter of candidates) {
    let count = 0;
    let inQuotes = false;
    for (let i = 0; i < sample.length; i += 1) {
      const ch = sample[i];
      if (ch === '"') {
        inQuotes = !inQuotes;
        continue;
      }
      if (!inQuotes && ch === delimiter) count += 1;
    }
    if (count > bestScore) {
      bestScore = count;
      best = delimiter;
    }
  }
  return best;
}

/** RFC 4180 parser: quoted fields, escaped quotes and embedded newlines. */
export function parseCsv(source: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < source.length; i += 1) {
    const ch = source[i] as string;
    if (inQuotes) {
      if (ch === '"') {
        if (source[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"' && field === '') {
      inQuotes = true;
      continue;
    }
    if (ch === delimiter) {
      row.push(field);
      field = '';
      continue;
    }
    if (ch === '\r') continue;
    if (ch === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
      if (rows.length > TOOL_LIMITS.maxCsvRows) {
        throw errTooLarge(
          `حداکثر ${TOOL_LIMITS.maxCsvRows} سطر پشتیبانی می‌شود.`,
          `At most ${TOOL_LIMITS.maxCsvRows} rows are supported.`,
        );
      }
      continue;
    }
    field += ch;
  }
  if (inQuotes) {
    throw errInvalidInput(
      'یک فیلد نقل‌قولی بسته نشده است (") — ساختار CSV ناقص است.',
      'An opened quoted field is never closed (") — the CSV is malformed.',
    );
  }
  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => !(r.length === 1 && r[0] === ''));
}

/** A first line is a header when every cell is non-empty, unique and non-numeric. */
export function looksLikeHeader(cells: string[]): boolean {
  if (cells.length === 0) return false;
  const trimmed = cells.map((c) => c.trim());
  if (trimmed.some((c) => c === '')) return false;
  if (new Set(trimmed.map((c) => c.toLowerCase())).size !== trimmed.length) return false;
  return trimmed.every((c) => Number.isNaN(Number(c)));
}

export function csvToTable(source: string): CsvTable {
  const delimiter = detectDelimiter(source.split('\n').slice(0, 5).join('\n'));
  const grid = parseCsv(source, delimiter);
  if (grid.length === 0) {
    throw errInvalidInput('هیچ سطری در CSV پیدا نشد.', 'The CSV contains no rows.');
  }
  const first = grid[0] as string[];
  if (first.length > TOOL_LIMITS.maxCsvColumns) {
    throw errTooLarge(
      `حداکثر ${TOOL_LIMITS.maxCsvColumns} ستون پشتیبانی می‌شود.`,
      `At most ${TOOL_LIMITS.maxCsvColumns} columns are supported.`,
    );
  }
  const hasHeader = looksLikeHeader(first);
  const header = hasHeader
    ? first.map((c) => c.trim())
    : first.map((_, i) => `column_${i + 1}`);
  const rows = hasHeader ? grid.slice(1) : grid;
  return { header, rows, hasHeader, delimiter };
}

export function tableToJson(table: CsvTable): Record<string, string>[] {
  return table.rows.map((row) => {
    const obj: Record<string, string> = {};
    table.header.forEach((key, i) => {
      obj[key] = row[i] ?? '';
    });
    return obj;
  });
}

/** Escapes a cell only when necessary, keeping the output diff-friendly. */
function csvCell(value: unknown, delimiter: string): string {
  const str =
    value === null || value === undefined
      ? ''
      : typeof value === 'object'
        ? JSON.stringify(value)
        : String(value);
  return /["\n\r]|^\s|\s$/.test(str) || str.includes(delimiter) ? `"${str.replace(/"/g, '""')}"` : str;
}

export function jsonToCsv(value: unknown, delimiter = ','): string {
  const list = Array.isArray(value) ? value : [value];
  if (list.length === 0) return '';
  const keys: string[] = [];
  for (const item of list) {
    if (item === null || typeof item !== 'object' || Array.isArray(item)) {
      throw errInvalidInput(
        'برای تبدیل به CSV، ورودی باید آرایه‌ای از اشیاء تخت باشد.',
        'CSV conversion requires an array of flat objects.',
      );
    }
    for (const key of Object.keys(item as Record<string, unknown>)) {
      if (!keys.includes(key)) keys.push(key);
    }
  }
  if (keys.length > TOOL_LIMITS.maxCsvColumns) {
    throw errTooLarge(
      `حداکثر ${TOOL_LIMITS.maxCsvColumns} ستون پشتیبانی می‌شود.`,
      `At most ${TOOL_LIMITS.maxCsvColumns} columns are supported.`,
    );
  }
  const lines = [keys.map((k) => csvCell(k, delimiter)).join(delimiter)];
  for (const item of list) {
    const record = item as Record<string, unknown>;
    lines.push(keys.map((k) => csvCell(record[k], delimiter)).join(delimiter));
  }
  return lines.join('\n');
}

export const csvJsonTool = defineTool({
  id: 'csv_json',
  category: 'utilities',
  icon: '📊',
  needsInput: true,
  title: { fa: 'مبدل CSV ↔ JSON', en: 'CSV ↔ JSON Converter' },
  description: {
    fa: 'CSV را به JSON و JSON را به CSV تبدیل می‌کند. جداکننده و سطر عنوان را خودکار تشخیص می‌دهد، فیلدهای نقل‌قولی و چندخطی را درست می‌خواند و خروجی بزرگ را به‌صورت فایل می‌فرستد.',
    en: 'Converts CSV to JSON and JSON to CSV. Detects the delimiter and the header row automatically, handles quoted and multi-line fields, and delivers large output as a file.',
  },
  usage: {
    fa: 'داده را ارسال کنید؛ جهت تبدیل خودکار تشخیص داده می‌شود. خط اول اختیاری: <code>mode: to-json</code> • <code>mode: to-csv</code> • <code>mode: validate</code>',
    en: 'Send the data; the direction is detected automatically. Optional first line: <code>mode: to-json</code> • <code>mode: to-csv</code> • <code>mode: validate</code>',
  },
  example: {
    fa: 'ورودی:\nname,age\nali,30\n\nخروجی:\n[{"name":"ali","age":"30"}]',
    en: 'Input:\nname,age\nada,36\n\nOutput:\n[{"name":"ada","age":"36"}]',
  },
  limitations: {
    fa: 'حداکثر ۸۰۰۰ کاراکتر، ۲۰۰۰ سطر و ۶۰ ستون. تبدیل JSON→CSV فقط برای آرایه‌ای از اشیاء تخت کار می‌کند و همه‌ی مقادیر CSV به‌صورت رشته خوانده می‌شوند.',
    en: 'Max 8000 characters, 2000 rows, 60 columns. JSON→CSV requires an array of flat objects, and every CSV value is read as a string.',
  },
  run: (input, ctx) => {
    const fa = ctx.lang === 'fa';
    const { mode, body } = splitDirective(input, ['to-json', 'to-csv', 'validate']);
    const document = assertSize(body);
    const isJson = looksLikeJson(document);
    const action = mode ?? (isJson ? 'to-csv' : 'to-json');

    if (action === 'to-csv' || (action === 'validate' && isJson)) {
      const value = parseJsonSafe(document);
      const csv = jsonToCsv(value);
      const rowCount = Math.max(0, csv.split('\n').length - 1);
      const header = fa ? '✅ <b>JSON → CSV</b>' : '✅ <b>JSON → CSV</b>';
      const footer =
        `${DIVIDER}\n` +
        (fa
          ? `📊 ${rowCount} سطر • ${(csv.split('\n')[0] ?? '').split(',').length} ستون\n📦 خروجی: ${formatBytes(utf8Length(csv))}`
          : `📊 ${rowCount} rows • ${(csv.split('\n')[0] ?? '').split(',').length} columns\n📦 Output: ${formatBytes(utf8Length(csv))}`);
      const delivered = deliver(fa, header, csv, 'data.csv', footer);
      return {
        html: delivered.html,
        ...(delivered.attachment ? { attachment: delivered.attachment } : {}),
      };
    }

    const table = csvToTable(document);
    if (action === 'validate') {
      return {
        html:
          `${fa ? '✅ <b>CSV معتبر است</b>' : '✅ <b>Valid CSV</b>'}\n${DIVIDER}\n` +
          (fa
            ? `🔖 جداکننده: ${mono(table.delimiter === '\t' ? 'TAB' : table.delimiter)}\n🏷 سطر عنوان: ${table.hasHeader ? 'دارد' : 'ندارد (ستون‌ها خودکار نام‌گذاری شدند)'}\n📊 ${table.rows.length} سطر • ${table.header.length} ستون`
            : `🔖 Delimiter: ${mono(table.delimiter === '\t' ? 'TAB' : table.delimiter)}\n🏷 Header row: ${table.hasHeader ? 'yes' : 'no (columns auto-named)'}\n📊 ${table.rows.length} rows • ${table.header.length} columns`),
      };
    }

    const json = JSON.stringify(tableToJson(table), null, 2);
    const header =
      `${fa ? '✅ <b>CSV → JSON</b>' : '✅ <b>CSV → JSON</b>'} • ` +
      (fa
        ? `جداکننده ${mono(table.delimiter === '\t' ? 'TAB' : table.delimiter)}`
        : `delimiter ${mono(table.delimiter === '\t' ? 'TAB' : table.delimiter)}`);
    const footer =
      `${DIVIDER}\n` +
      (fa
        ? `🏷 سطر عنوان: ${table.hasHeader ? 'تشخیص داده شد' : 'یافت نشد — ستون‌ها column_N نام گرفتند'}\n📊 ${table.rows.length} سطر • ${table.header.length} ستون\n📦 خروجی: ${formatBytes(utf8Length(json))}`
        : `🏷 Header row: ${table.hasHeader ? 'detected' : 'not found — columns named column_N'}\n📊 ${table.rows.length} rows • ${table.header.length} columns\n📦 Output: ${formatBytes(utf8Length(json))}`);

    const delivered = deliver(fa, header, json, 'data.json', footer, 'json');
    return {
      html: delivered.html,
      ...(delivered.attachment ? { attachment: delivered.attachment } : {}),
    };
  },
});
