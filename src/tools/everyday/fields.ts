/**
 * Shared input parsing for 🧰 Everyday Tools.
 *
 * Almost every calculator in this section takes a handful of named values
 * ("bill: 120", "tip: 15"). Rather than each tool inventing its own parser,
 * they all share this one so error messages, number handling and limits stay
 * identical across the section.
 *
 * Design notes:
 *  - Persian/Arabic-Indic digits are normalised, because users type on Persian
 *    keyboards and `Number('۱۲۰')` is NaN.
 *  - Thousands separators (`,` and `٬`) are stripped; a decimal comma is only
 *    treated as a decimal point when there is no dot in the number.
 *  - Every parse is bounded: no expression evaluation, no unbounded loops.
 */
import { errInvalidInput } from '../../utils/errors.js';
import { TOOL_LIMITS } from '../../config/index.js';

/** Persian (۰-۹) and Arabic-Indic (٠-٩) digits → ASCII. */
export function normalizeDigits(input: string): string {
  let out = '';
  for (const ch of input) {
    const code = ch.codePointAt(0) ?? 0;
    if (code >= 0x06f0 && code <= 0x06f9) out += String(code - 0x06f0);
    else if (code >= 0x0660 && code <= 0x0669) out += String(code - 0x0660);
    else out += ch;
  }
  return out;
}

/**
 * Parses a number the way a human writes it: `1,234.5`, `۱۲۳۴٫۵`, `1 234`,
 * `12%` (percent sign is stripped by the caller, not here).
 */
export function parseNumber(raw: string, label: string): number {
  const cleaned = normalizeDigits(raw)
    .replace(/[\s\u00a0_]/g, '')
    .replace(/[٬،]/g, ',')
    .replace(/٫/g, '.');
  // A comma is a decimal separator only when no dot is present and it is
  // followed by 1-2 digits ("12,5"); otherwise it is a thousands separator.
  const normalised = !cleaned.includes('.') && /^-?\d+,\d{1,2}$/.test(cleaned)
    ? cleaned.replace(',', '.')
    : cleaned.replace(/,/g, '');
  if (normalised === '' || !/^-?\d*\.?\d+(?:[eE][+-]?\d+)?$/.test(normalised)) {
    throw errInvalidInput(`مقدار «${label}» عدد معتبری نیست.`, `"${label}" is not a valid number.`);
  }
  const value = Number(normalised);
  if (!Number.isFinite(value)) {
    throw errInvalidInput(`مقدار «${label}» عدد معتبری نیست.`, `"${label}" is not a valid number.`);
  }
  if (Math.abs(value) > 1e15) {
    throw errInvalidInput(
      `مقدار «${label}» بیش از حد بزرگ است (حداکثر 1e15).`,
      `"${label}" is too large (max 1e15).`,
    );
  }
  return value;
}

export type Fields = Map<string, string>;

/**
 * Parses `key: value` lines (or `key = value`). Unknown keys are kept so the
 * caller can reject them explicitly — silently ignoring a typo'd key would
 * make a calculator quietly compute the wrong thing.
 */
export function parseFields(input: string): Fields {
  const text = normalizeDigits(input).trim();
  if (!text) throw errInvalidInput('ورودی خالی است.', 'Input is empty.');
  if (text.length > TOOL_LIMITS.maxStructuredChars) {
    throw errInvalidInput(
      `حجم ورودی بیش از حد مجاز است (حداکثر ${TOOL_LIMITS.maxStructuredChars} کاراکتر).`,
      `Input exceeds the limit (max ${TOOL_LIMITS.maxStructuredChars} characters).`,
    );
  }
  const fields: Fields = new Map();
  const lines = text.split('\n').slice(0, 40);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const match = /^([\p{L}\p{N} _\-/]{1,40}?)\s*[:=]\s*(.{0,200})$/u.exec(trimmed);
    if (!match) continue;
    const key = (match[1] ?? '').trim().toLowerCase().replace(/[\s_-]+/g, '');
    const value = (match[2] ?? '').trim();
    if (key && !fields.has(key)) fields.set(key, value);
  }
  return fields;
}

/** Reads the first present alias, e.g. `pick(f, ['bill','amount'])`. */
export function pick(fields: Fields, aliases: readonly string[]): string | undefined {
  for (const alias of aliases) {
    const value = fields.get(alias.toLowerCase().replace(/[\s_-]+/g, ''));
    if (value !== undefined && value !== '') return value;
  }
  return undefined;
}

export interface NumberOptions {
  min?: number;
  max?: number;
  /** Used in the error message; defaults to the first alias. */
  label?: string;
  /** Returned when the field is absent. Omit to make the field required. */
  fallback?: number;
}

export function numberField(fields: Fields, aliases: readonly string[], options: NumberOptions = {}): number {
  const label = options.label ?? aliases[0] ?? 'value';
  const raw = pick(fields, aliases);
  if (raw === undefined) {
    if (options.fallback !== undefined) return options.fallback;
    throw errInvalidInput(
      `فیلد «${label}» الزامی است.`,
      `Field "${label}" is required.`,
    );
  }
  // Tolerate a trailing unit or percent sign: "15%", "120 usd", "80 kg".
  const stripped = raw.replace(/[%٪]/g, ' ').trim().split(/\s+/)[0] ?? raw;
  const value = parseNumber(stripped, label);
  if (options.min !== undefined && value < options.min) {
    throw errInvalidInput(
      `مقدار «${label}» نباید کمتر از ${options.min} باشد.`,
      `"${label}" must not be less than ${options.min}.`,
    );
  }
  if (options.max !== undefined && value > options.max) {
    throw errInvalidInput(
      `مقدار «${label}» نباید بیشتر از ${options.max} باشد.`,
      `"${label}" must not exceed ${options.max}.`,
    );
  }
  return value;
}

export function textField(fields: Fields, aliases: readonly string[], fallback = ''): string {
  return pick(fields, aliases) ?? fallback;
}

/** Formats a number for display: thousands separators, sensible precision. */
export function fmt(value: number, decimals = 2): string {
  if (!Number.isFinite(value)) return '—';
  const abs = Math.abs(value);
  // Keep small values readable instead of collapsing them to "0.00".
  const places = abs !== 0 && abs < 0.01 ? 6 : decimals;
  const fixed = value.toFixed(places);
  const trimmed = fixed.includes('.') ? fixed.replace(/\.?0+$/, '') : fixed;
  const [intPart = '0', decPart] = trimmed.split('.');
  const grouped = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return decPart ? `${grouped}.${decPart}` : grouped;
}

/** Percentage helper with a fixed number of decimals and a sign. */
export function pct(value: number, decimals = 2): string {
  const sign = value > 0 ? '+' : '';
  return `${sign}${fmt(value, decimals)}%`;
}
