/**
 * Phase 3 — date/time conversion and timezone conversion.
 *
 * Timezone maths is delegated to `Intl.DateTimeFormat` with a real IANA zone,
 * which is the only way to get DST right without shipping a tz database. The
 * Workers runtime ships full ICU, so every IANA identifier resolves.
 */
import { defineTool } from '../types.js';
import { codeBlock, DIVIDER, escapeHtml, isoUtc, mono } from '../../utils/text.js';
import { errInvalidInput } from '../../utils/errors.js';
import { convertTimestamp } from '../programming/misc.js';

/** Zones offered as shortcuts; any other valid IANA name is accepted too. */
export const COMMON_ZONES = [
  'UTC',
  'Europe/Berlin',
  'Europe/London',
  'Asia/Tehran',
  'Asia/Dubai',
  'Asia/Kolkata',
  'Asia/Tokyo',
  'America/New_York',
  'America/Los_Angeles',
  'Australia/Sydney',
] as const;

/** Short aliases people actually type. */
const ZONE_ALIASES: Record<string, string> = {
  utc: 'UTC',
  gmt: 'UTC',
  z: 'UTC',
  berlin: 'Europe/Berlin',
  frankfurt: 'Europe/Berlin',
  london: 'Europe/London',
  tehran: 'Asia/Tehran',
  iran: 'Asia/Tehran',
  dubai: 'Asia/Dubai',
  tokyo: 'Asia/Tokyo',
  ny: 'America/New_York',
  nyc: 'America/New_York',
  newyork: 'America/New_York',
  la: 'America/Los_Angeles',
  sydney: 'Australia/Sydney',
};

/**
 * Validates a zone by asking Intl to use it; unknown zones throw RangeError.
 *
 * Bare abbreviations are refused even when ICU happens to accept them as
 * legacy links: "CST" is US Central, China Standard *and* Cuba Standard time,
 * so silently picking one would give a confidently wrong answer.
 */
export function resolveZone(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) throw errInvalidInput('منطقه‌ی زمانی وارد نشده است.', 'No timezone was provided.');

  const alias = ZONE_ALIASES[trimmed.toLowerCase().replace(/[\s_-]/g, '')];
  const candidate = alias ?? trimmed;

  const isUtc = /^(utc|gmt)$/i.test(candidate);
  const isIana = candidate.includes('/');
  if (!isUtc && !isIana) {
    throw errInvalidInput(
      `«${trimmed}» یک مخفف مبهم است (مثلاً CST هم مرکزی آمریکا و هم چین را نشان می‌دهد). از شناسه‌ی کامل IANA استفاده کنید؛ مثل Europe/Berlin یا Asia/Tehran.`,
      `"${trimmed}" is an ambiguous abbreviation (CST, for example, means both US Central and China Standard time). Use a full IANA identifier such as Europe/Berlin or Asia/Tehran.`,
    );
  }

  try {
    new Intl.DateTimeFormat('en-US', { timeZone: candidate }).format(0);
    return candidate;
  } catch {
    throw errInvalidInput(
      `منطقه‌ی زمانی «${trimmed}» شناخته نشد. از قالب IANA استفاده کنید؛ مثل Europe/Berlin یا Asia/Tehran.`,
      `Unknown timezone "${trimmed}". Use an IANA name such as Europe/Berlin or Asia/Tehran.`,
    );
  }
}

export interface ZonedParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

/**
 * Formatter cache.
 *
 * Constructing an `Intl.DateTimeFormat` is expensive — it loads locale data
 * every time. The cron tool calls `partsInZone` thousands of times while
 * scanning for the next run, so building one formatter per zone instead of
 * one per call turns a multi-second search into a few milliseconds.
 */
const FORMATTER_CACHE = new Map<string, Intl.DateTimeFormat>();

function zoneFormatter(zone: string): Intl.DateTimeFormat {
  let cached = FORMATTER_CACHE.get(zone);
  if (!cached) {
    cached = new Intl.DateTimeFormat('en-US', {
      timeZone: zone,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
      hour12: false,
    });
    // Bounded: a single request only ever touches a handful of zones.
    if (FORMATTER_CACHE.size > 40) FORMATTER_CACHE.clear();
    FORMATTER_CACHE.set(zone, cached);
  }
  return cached;
}

/** Wall-clock fields of an instant in a given zone. */
export function partsInZone(ms: number, zone: string): ZonedParts {
  const formatter = zoneFormatter(zone);
  const map: Record<string, string> = {};
  for (const part of formatter.formatToParts(new Date(ms))) {
    if (part.type !== 'literal') map[part.type] = part.value;
  }
  return {
    year: Number(map['year']),
    month: Number(map['month']),
    day: Number(map['day']),
    // Intl renders midnight as "24" in some locales/zones; normalise it.
    hour: Number(map['hour']) % 24,
    minute: Number(map['minute']),
    second: Number(map['second']),
  };
}

/** Offset of a zone at a given instant, in minutes east of UTC. */
export function offsetMinutes(ms: number, zone: string): number {
  const p = partsInZone(ms, zone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return Math.round((asUtc - Math.floor(ms / 1000) * 1000) / 60_000);
}

export function formatOffset(minutes: number): string {
  const sign = minutes < 0 ? '-' : '+';
  const abs = Math.abs(minutes);
  return `UTC${sign}${String(Math.floor(abs / 60)).padStart(2, '0')}:${String(abs % 60).padStart(2, '0')}`;
}

/** Short zone name at that instant (CET / CEST …) — how DST becomes visible. */
export function zoneAbbreviation(ms: number, zone: string): string {
  try {
    const formatter = new Intl.DateTimeFormat('en-US', { timeZone: zone, timeZoneName: 'short' });
    return formatter.formatToParts(new Date(ms)).find((p) => p.type === 'timeZoneName')?.value ?? '';
  } catch {
    return '';
  }
}

/**
 * True when the zone observes DST somewhere in the surrounding year and the
 * given instant falls inside it. Determined by comparing the offset with the
 * minimum offset seen across the year — no tz database needed.
 */
export function dstState(ms: number, zone: string): { observes: boolean; active: boolean } {
  const year = new Date(ms).getUTCFullYear();
  let min = Infinity;
  let max = -Infinity;
  for (let month = 0; month < 12; month += 1) {
    const probe = Date.UTC(year, month, 15, 12, 0, 0);
    const offset = offsetMinutes(probe, zone);
    min = Math.min(min, offset);
    max = Math.max(max, offset);
  }
  const current = offsetMinutes(ms, zone);
  return { observes: max !== min, active: max !== min && current === max };
}

/** Renders an instant as a wall-clock string in a zone. */
export function formatInZone(ms: number, zone: string): string {
  const p = partsInZone(ms, zone);
  const pad = (n: number, w = 2): string => String(n).padStart(w, '0');
  return `${pad(p.year, 4)}-${pad(p.month)}-${pad(p.day)} ${pad(p.hour)}:${pad(p.minute)}:${pad(p.second)}`;
}

const WEEKDAYS_EN = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const WEEKDAYS_FA = ['یکشنبه', 'دوشنبه', 'سه‌شنبه', 'چهارشنبه', 'پنج‌شنبه', 'جمعه', 'شنبه'];

// ─── 5. Date & time converter ─────────────────────────────────────────────

export interface TimestampDetection {
  ms: number;
  /** How the input was understood. */
  kind: 'seconds' | 'milliseconds' | 'iso' | 'date' | 'now';
}

/**
 * Detects 10-digit (seconds) vs 13-digit (milliseconds) epochs explicitly —
 * misreading one for the other is the classic bug this tool exists to avoid.
 */
export function detectTimestamp(raw: string): TimestampDetection {
  const text = raw.trim();
  const lower = text.toLowerCase();
  if (lower === 'now' || lower === 'اکنون') return { ms: Date.now(), kind: 'now' };

  const numeric = /^-?\d+$/.exec(text.replace(/[_,\s]/g, ''));
  if (numeric) {
    const digits = text.replace(/[_,\s-]/g, '');
    const value = Number(text.replace(/[_,\s]/g, ''));
    if (digits.length >= 12) return { ms: value, kind: 'milliseconds' };
    if (digits.length >= 1) return { ms: value * 1000, kind: 'seconds' };
  }

  const { date } = convertTimestamp(text);
  return { ms: date.getTime(), kind: /^\d{4}-\d{2}-\d{2}T/.test(text) ? 'iso' : 'date' };
}

export const dateTimeTool = defineTool({
  id: 'datetime_convert',
  category: 'utilities',
  icon: '📅',
  quick: true,
  needsInput: true,
  title: { fa: 'مبدل تاریخ و زمان', en: 'Date & Time Converter' },
  description: {
    fa: 'بین Unix timestamp و تاریخ خوانا در هر دو جهت تبدیل می‌کند، ثانیه و میلی‌ثانیه (۱۰ و ۱۳ رقمی) را خودکار تشخیص می‌دهد و خروجی را به‌صورت ISO 8601، UTC، RFC و زمان محلی یک منطقه نشان می‌دهد.',
    en: 'Converts between Unix timestamps and human dates in both directions, auto-detects 10-digit (seconds) and 13-digit (millisecond) epochs, and prints ISO 8601, UTC, RFC and local-zone views.',
  },
  usage: {
    fa:
      'یکی از این‌ها را بفرستید:\n' +
      '• <code>1700000000</code> یا <code>1700000000000</code>\n' +
      '• <code>2024-01-01T12:30:00Z</code>\n' +
      '• <code>now</code>\n' +
      'برای دیدن زمان محلی، منطقه را بعد از <code>@</code> بیفزایید: <code>1700000000 @ Europe/Berlin</code>',
    en:
      'Send one of:\n' +
      '• <code>1700000000</code> or <code>1700000000000</code>\n' +
      '• <code>2024-01-01T12:30:00Z</code>\n' +
      '• <code>now</code>\n' +
      'Append a zone after <code>@</code> for the local view: <code>1700000000 @ Europe/Berlin</code>',
  },
  example: {
    fa: 'ورودی: 1700000000 @ Asia/Tehran\nخروجی: 2023-11-14 22:13:20 UTC • 2023-11-15 01:43:20 (Asia/Tehran)',
    en: 'Input: 1700000000 @ Asia/Tehran\nOutput: 2023-11-14 22:13:20 UTC • 2023-11-15 01:43:20 (Asia/Tehran)',
  },
  limitations: {
    fa: 'تاریخ‌های خارج از بازه‌ی ۱۹۷۰ تا ۹۹۹۹ پشتیبانی نمی‌شوند. تقویم خروجی میلادی است.',
    en: 'Dates outside 1970–9999 are not supported. Output uses the Gregorian calendar.',
  },
  run: (input, ctx) => {
    const fa = ctx.lang === 'fa';
    const [rawValue = '', rawZone] = input.split('@').map((part) => part.trim());
    const zone = rawZone ? resolveZone(rawZone) : null;

    const detected = detectTimestamp(rawValue);
    if (!Number.isFinite(detected.ms) || Math.abs(detected.ms) > 253_402_300_799_999) {
      throw errInvalidInput(
        'تاریخ خارج از بازه‌ی پشتیبانی‌شده است.',
        'The date is outside the supported range.',
      );
    }
    const date = new Date(detected.ms);
    const epochSec = Math.floor(detected.ms / 1000);

    const kindLabel: Record<TimestampDetection['kind'], { fa: string; en: string }> = {
      seconds: { fa: 'Unix (ثانیه، ۱۰ رقمی)', en: 'Unix seconds (10-digit)' },
      milliseconds: { fa: 'Unix (میلی‌ثانیه، ۱۳ رقمی)', en: 'Unix milliseconds (13-digit)' },
      iso: { fa: 'رشته‌ی ISO 8601', en: 'ISO 8601 string' },
      date: { fa: 'تاریخ متنی', en: 'Date string' },
      now: { fa: 'زمان جاری', en: 'Current time' },
    };

    const weekday = fa ? WEEKDAYS_FA[date.getUTCDay()] : WEEKDAYS_EN[date.getUTCDay()];
    const dayOfYear = Math.floor((detected.ms - Date.UTC(date.getUTCFullYear(), 0, 0)) / 86_400_000);

    const zoneBlock = zone
      ? `\n${fa ? `🌍 <b>${escapeHtml(zone)}</b>` : `🌍 <b>${escapeHtml(zone)}</b>`}\n` +
        codeBlock(`${formatInZone(detected.ms, zone)}  ${zoneAbbreviation(detected.ms, zone)} (${formatOffset(offsetMinutes(detected.ms, zone))})`)
      : '';

    return {
      html:
        `${fa ? '🔎 <b>ورودی تشخیص داده شد</b>' : '🔎 <b>Input detected as</b>'}: ${escapeHtml(
          fa ? kindLabel[detected.kind].fa : kindLabel[detected.kind].en,
        )}\n${DIVIDER}\n` +
        `${fa ? '🕒 <b>UTC</b>' : '🕒 <b>UTC</b>'}\n${codeBlock(isoUtc(detected.ms))}` +
        `<b>ISO 8601</b>\n${codeBlock(date.toISOString())}` +
        `<b>RFC 2822</b>\n${codeBlock(date.toUTCString())}` +
        `${fa ? '<b>ثانیه</b>' : '<b>Seconds</b>'}\n${codeBlock(String(epochSec))}` +
        `${fa ? '<b>میلی‌ثانیه</b>' : '<b>Milliseconds</b>'}\n${codeBlock(String(detected.ms))}` +
        zoneBlock +
        `${DIVIDER}\n📆 ${escapeHtml(weekday ?? '')} • ${fa ? 'روز' : 'day'} ${dayOfYear} ${fa ? 'از سال' : 'of year'}`,
    };
  },
});

// ─── 6. Timezone converter ────────────────────────────────────────────────

/**
 * Converts a wall-clock time in one zone to the same instant in another.
 * Two passes are needed because the offset itself depends on the instant —
 * that is exactly what makes DST transitions correct here.
 */
export function wallClockToInstant(parts: ZonedParts, zone: string): number {
  const naive = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  let guess = naive - offsetMinutes(naive, zone) * 60_000;
  guess = naive - offsetMinutes(guess, zone) * 60_000;
  return guess;
}

const TIME_RE =
  /^(\d{4})-(\d{2})-(\d{2})(?:[T\s](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/;

export function parseWallClock(raw: string): ZonedParts | null {
  const match = TIME_RE.exec(raw.trim());
  if (!match) return null;
  const parts: ZonedParts = {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
    hour: Number(match[4] ?? '0'),
    minute: Number(match[5] ?? '0'),
    second: Number(match[6] ?? '0'),
  };
  if (parts.month < 1 || parts.month > 12 || parts.day < 1 || parts.day > 31 || parts.hour > 23 || parts.minute > 59 || parts.second > 59) {
    throw errInvalidInput('اجزای تاریخ/ساعت خارج از بازه‌ی معتبر هستند.', 'The date/time fields are out of range.');
  }
  return parts;
}

export const timezoneTool = defineTool({
  id: 'timezone_convert',
  category: 'utilities',
  icon: '🌍',
  needsInput: true,
  title: { fa: 'مبدل منطقه‌ی زمانی', en: 'Timezone Converter' },
  description: {
    fa: 'یک زمان را از یک منطقه‌ی زمانی IANA به منطقه‌های دیگر تبدیل می‌کند، اختلاف ساعت را نشان می‌دهد و وضعیت ساعت تابستانی (DST) هر منطقه را در همان لحظه مشخص می‌کند.',
    en: 'Converts a time from one IANA timezone to others, shows the offset difference and reports whether daylight saving time is active in each zone at that instant.',
  },
  usage: {
    fa:
      'قالب: <code>&lt;زمان&gt; &lt;منطقه‌ی مبدأ&gt; to &lt;منطقه‌ی مقصد&gt;</code>\n' +
      'نمونه‌ها:\n' +
      '• <code>2024-07-01 14:30 Europe/Berlin to Asia/Tehran</code>\n' +
      '• <code>now Asia/Tehran to America/New_York</code>\n' +
      '• <code>now Europe/Berlin</code> — مقایسه با همه‌ی مناطق پرکاربرد',
    en:
      'Format: <code>&lt;time&gt; &lt;source zone&gt; to &lt;target zone&gt;</code>\n' +
      'Examples:\n' +
      '• <code>2024-07-01 14:30 Europe/Berlin to Asia/Tehran</code>\n' +
      '• <code>now Asia/Tehran to America/New_York</code>\n' +
      '• <code>now Europe/Berlin</code> — compare against every common zone',
  },
  example: {
    fa: 'ورودی: 2024-07-01 14:30 Europe/Berlin to Asia/Tehran\nخروجی: 2024-07-01 17:00 (Asia/Tehran، +۱:۳۰ اختلاف)',
    en: 'Input: 2024-07-01 14:30 Europe/Berlin to Asia/Tehran\nOutput: 2024-07-01 17:00 (Asia/Tehran, +1:30 difference)',
  },
  limitations: {
    fa: 'فقط شناسه‌های IANA (مثل Europe/Berlin) پذیرفته می‌شوند؛ مخفف‌هایی مثل CET یا PST مبهم‌اند و پشتیبانی نمی‌شوند. در ساعت‌های تکراری یا حذف‌شده‌ی گذار DST، نزدیک‌ترین لحظه‌ی معتبر گزارش می‌شود.',
    en: 'Only IANA identifiers (e.g. Europe/Berlin) are accepted; abbreviations such as CET or PST are ambiguous and unsupported. During a DST gap or overlap, the nearest valid instant is reported.',
  },
  run: (input, ctx) => {
    const fa = ctx.lang === 'fa';
    const text = input.trim().replace(/\s+/g, ' ');

    const toSplit = / (?:to|→|>) /i.exec(text);
    const left = toSplit ? text.slice(0, toSplit.index).trim() : text;
    const targetRaw = toSplit ? text.slice(toSplit.index + toSplit[0].length).trim() : '';

    // The last whitespace-separated token of the left side is the source zone.
    const leftTokens = left.split(' ');
    if (leftTokens.length < 2 && !/^now$/i.test(left)) {
      throw errInvalidInput(
        'قالب ورودی: <code>&lt;زمان&gt; &lt;منطقه‌ی مبدأ&gt; to &lt;منطقه‌ی مقصد&gt;</code>',
        'Expected: <code>&lt;time&gt; &lt;source zone&gt; to &lt;target zone&gt;</code>',
      );
    }
    const sourceZone = resolveZone(leftTokens[leftTokens.length - 1] as string);
    const timeText = leftTokens.slice(0, -1).join(' ').trim() || 'now';

    let instant: number;
    if (/^now$/i.test(timeText) || timeText === 'اکنون') {
      instant = Date.now();
    } else if (/^-?\d{9,14}$/.test(timeText)) {
      instant = detectTimestamp(timeText).ms;
    } else {
      const parts = parseWallClock(timeText);
      if (!parts) {
        throw errInvalidInput(
          'زمان را به شکل <code>YYYY-MM-DD HH:MM</code> یا کلمه‌ی <code>now</code> بنویسید.',
          'Write the time as <code>YYYY-MM-DD HH:MM</code> or the word <code>now</code>.',
        );
      }
      instant = wallClockToInstant(parts, sourceZone);
    }

    const describe = (zone: string): string => {
      const dst = dstState(instant, zone);
      const abbr = zoneAbbreviation(instant, zone);
      const flag = dst.observes ? (dst.active ? (fa ? ' • ☀️ ساعت تابستانی فعال' : ' • ☀️ DST active') : (fa ? ' • 🕐 زمان استاندارد' : ' • 🕐 standard time')) : '';
      return `${formatInZone(instant, zone)}  ${abbr} (${formatOffset(offsetMinutes(instant, zone))})${flag}`;
    };

    const sourceLine = `${fa ? '🛫 <b>مبدأ</b>' : '🛫 <b>Source</b>'} — ${escapeHtml(sourceZone)}\n${codeBlock(describe(sourceZone))}`;

    if (targetRaw) {
      const targetZone = resolveZone(targetRaw);
      const diff = offsetMinutes(instant, targetZone) - offsetMinutes(instant, sourceZone);
      const sign = diff >= 0 ? '+' : '−';
      const abs = Math.abs(diff);
      return {
        html:
          sourceLine +
          `${fa ? '🛬 <b>مقصد</b>' : '🛬 <b>Target</b>'} — ${escapeHtml(targetZone)}\n${codeBlock(describe(targetZone))}` +
          `${DIVIDER}\n${fa ? '↔️ اختلاف' : '↔️ Difference'}: ${sign}${Math.floor(abs / 60)}:${String(abs % 60).padStart(2, '0')}\n` +
          `🕒 ${fa ? 'لحظه‌ی مشترک (UTC)' : 'Shared instant (UTC)'}: ${mono(isoUtc(instant))}`,
      };
    }

    const rows = COMMON_ZONES.filter((zone) => zone !== sourceZone)
      .map((zone) => `• <b>${escapeHtml(zone)}</b>\n  <code>${escapeHtml(describe(zone))}</code>`)
      .join('\n');

    return {
      html:
        sourceLine +
        `${DIVIDER}\n${fa ? '🌐 <b>مناطق پرکاربرد</b>' : '🌐 <b>Common zones</b>'}\n${rows}`,
    };
  },
});
