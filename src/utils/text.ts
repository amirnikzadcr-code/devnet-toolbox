import { LIMITS } from '../config/index.js';

/** Escape text for Telegram parse_mode=HTML. */
export function escapeHtml(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Wrap content in a copy-friendly <pre> block. */
export function codeBlock(content: string, language?: string): string {
  const safe = escapeHtml(truncate(content, LIMITS.maxOutputChars));
  return language
    ? `<pre><code class="language-${language}">${safe}</code></pre>`
    : `<pre>${safe}</pre>`;
}

/** Inline monospace, copy-friendly on tap. */
export function mono(content: string): string {
  return `<code>${escapeHtml(content)}</code>`;
}

export function truncate(input: string, max: number): string {
  if (input.length <= max) return input;
  return `${input.slice(0, Math.max(0, max - 20))}\n… [truncated]`;
}

/** Divider used to create visual hierarchy in messages. */
export const DIVIDER = '━━━━━━━━━━━━━━━';

/** Normalizes user input: strips zero-width chars & trims. */
export function normalizeInput(raw: string): string {
  return raw.replace(/[\u200B-\u200D\uFEFF]/g, '').trim();
}

/** Splits a long body into Telegram-sized chunks (defensive; we usually truncate). */
export function chunk(text: string, size = 3800): string[] {
  if (text.length <= size) return [text];
  const parts: string[] = [];
  for (let i = 0; i < text.length; i += size) parts.push(text.slice(i, i + size));
  return parts;
}

/** Human-readable byte size. */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const suffix = units[unit] ?? 'B';
  return `${value % 1 === 0 ? value : value.toFixed(2)} ${suffix}`;
}

/** ISO-ish UTC timestamp, stable across runtimes. */
export function isoUtc(ms: number): string {
  return new Date(ms).toISOString().replace('T', ' ').replace(/\.\d+Z$/, ' UTC');
}

/**
 * Coerce an untrusted JSON field to a string.
 *
 * Upstream APIs change shape without notice — certspotter's `issuer` turned
 * from a string into an object, which crashed a tool in production. Any field
 * read from a third-party response should pass through here before string
 * methods are called on it.
 */
export function asString(value: unknown, fallback = ''): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return fallback;
}
