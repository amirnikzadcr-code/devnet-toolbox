/**
 * Phase 3 — Cron generator & explainer.
 *
 * Extends (does not replace) the existing `cron_helper` validator: this tool
 * adds field-by-field explanation, next-run prediction in a chosen timezone,
 * and a generator that turns "every 5 minutes" into an expression.
 */
import { defineTool } from '../types.js';
import { codeBlock, DIVIDER, escapeHtml, mono } from '../../utils/text.js';
import { errInvalidInput } from '../../utils/errors.js';
import { describeCron } from './index.js';
import { formatInZone, formatOffset, offsetMinutes, partsInZone, resolveZone } from './datetime.js';

const MONTH_NAMES = ['', 'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const MONTH_NAMES_FA = ['', 'ژانویه', 'فوریه', 'مارس', 'آوریل', 'مه', 'ژوئن', 'ژوئیه', 'اوت', 'سپتامبر', 'اکتبر', 'نوامبر', 'دسامبر'];
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const DAY_NAMES_FA = ['یکشنبه', 'دوشنبه', 'سه‌شنبه', 'چهارشنبه', 'پنج‌شنبه', 'جمعه', 'شنبه'];

/** Textual month/day names cron implementations accept. */
const NAME_TO_NUMBER: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
  sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6,
};

export interface CronField {
  raw: string;
  /** Every concrete value the field expands to, sorted. */
  values: number[];
  fa: string;
  en: string;
}

/** Expands one cron field (step, range, list or a day/month name) into concrete values. */
export function expandField(raw: string, lo: number, hi: number, label: string): number[] {
  const values = new Set<number>();
  const normalise = (token: string): number => {
    const named = NAME_TO_NUMBER[token.toLowerCase()];
    if (named !== undefined) return named;
    const n = Number(token);
    if (!Number.isInteger(n)) {
      throw errInvalidInput(
        `مقدار «${token}» در بخش ${label} عدد معتبری نیست.`,
        `"${token}" is not a valid value in the ${label} field.`,
      );
    }
    return n;
  };

  for (const part of raw.split(',')) {
    const [rangePart = '', stepPart] = part.split('/');
    const step = stepPart === undefined ? 1 : Number(stepPart);
    if (!Number.isInteger(step) || step < 1) {
      throw errInvalidInput(
        `گام «/${stepPart}» در بخش ${label} معتبر نیست.`,
        `The step "/${stepPart}" is invalid in the ${label} field.`,
      );
    }

    let start = lo;
    let end = hi;
    if (rangePart !== '*' && rangePart !== '') {
      if (rangePart.includes('-')) {
        const [a = '', b = ''] = rangePart.split('-');
        start = normalise(a);
        end = normalise(b);
      } else {
        start = normalise(rangePart);
        end = stepPart === undefined ? start : hi;
      }
    }
    if (start < lo || end > hi || start > end) {
      throw errInvalidInput(
        `مقدار ${start}-${end} در بخش ${label} خارج از بازه‌ی مجاز (${lo}-${hi}) است.`,
        `The value ${start}-${end} is out of range (${lo}-${hi}) for the ${label} field.`,
      );
    }
    for (let v = start; v <= end; v += step) values.add(v);
  }
  return [...values].sort((a, b) => a - b);
}

export interface CronBreakdown {
  fields: CronField[];
  minutes: number[];
  hours: number[];
  daysOfMonth: number[];
  months: number[];
  daysOfWeek: number[];
  /** True when both day fields are restricted — cron ORs them, which surprises people. */
  ambiguousDay: boolean;
}

export function breakdownCron(expression: string): CronBreakdown {
  const parts = expression.trim().split(/\s+/);
  if (parts.length !== 5) {
    throw errInvalidInput(
      `عبارت Cron باید دقیقاً ۵ بخش داشته باشد (دقیقه ساعت روزماه ماه روزهفته)؛ ${parts.length} بخش دریافت شد.`,
      `A cron expression must have exactly 5 fields (minute hour day-of-month month day-of-week); received ${parts.length}.`,
    );
  }
  const [min = '', hour = '', dom = '', mon = '', dow = ''] = parts;

  const minutes = expandField(min, 0, 59, 'minute');
  const hours = expandField(hour, 0, 23, 'hour');
  const daysOfMonth = expandField(dom, 1, 31, 'day-of-month');
  const months = expandField(mon, 1, 12, 'month');
  // Cron accepts both 0 and 7 for Sunday.
  const daysOfWeek = expandField(dow, 0, 7, 'day-of-week').map((d) => (d === 7 ? 0 : d));

  const list = (values: number[], names?: string[]): string =>
    values.length > 12
      ? `${values.length} value(s)`
      : values.map((v) => names?.[v] ?? String(v)).join(', ');

  const fields: CronField[] = [
    {
      raw: min, values: minutes,
      fa: min === '*' ? 'هر دقیقه' : `دقیقه‌ی ${list(minutes)}`,
      en: min === '*' ? 'every minute' : `at minute ${list(minutes)}`,
    },
    {
      raw: hour, values: hours,
      fa: hour === '*' ? 'هر ساعت' : `ساعت ${list(hours)}`,
      en: hour === '*' ? 'every hour' : `at hour ${list(hours)}`,
    },
    {
      raw: dom, values: daysOfMonth,
      fa: dom === '*' ? 'هر روز ماه' : `روز ${list(daysOfMonth)} ماه`,
      en: dom === '*' ? 'every day of the month' : `on day ${list(daysOfMonth)} of the month`,
    },
    {
      raw: mon, values: months,
      fa: mon === '*' ? 'هر ماه' : `ماه‌های ${list(months, MONTH_NAMES_FA)}`,
      en: mon === '*' ? 'every month' : `in ${list(months, MONTH_NAMES)}`,
    },
    {
      raw: dow, values: daysOfWeek,
      fa: dow === '*' ? 'هر روز هفته' : `روزهای ${list(daysOfWeek, DAY_NAMES_FA)}`,
      en: dow === '*' ? 'every day of the week' : `on ${list(daysOfWeek, DAY_NAMES)}`,
    },
  ];

  return {
    fields,
    minutes, hours, daysOfMonth, months, daysOfWeek,
    ambiguousDay: dom !== '*' && dow !== '*',
  };
}

/**
 * Next run times, evaluated in the given timezone.
 *
 * The schedule is walked minute by minute in wall-clock terms, which is how
 * cron itself behaves: a job set for 02:30 simply does not fire on the day
 * that hour is skipped by a DST jump.
 */
export function nextRuns(breakdown: CronBreakdown, zone: string, count = 5, from = Date.now()): number[] {
  const runs: number[] = [];
  const minuteMs = 60_000;
  const dayMs = 86_400_000;

  const minuteSet = new Set(breakdown.minutes);
  const hourSet = new Set(breakdown.hours);
  const monthSet = new Set(breakdown.months);
  const domSet = new Set(breakdown.daysOfMonth);
  const dowSet = new Set(breakdown.daysOfWeek);
  const domRestricted = breakdown.daysOfMonth.length !== 31;
  const dowRestricted = breakdown.daysOfWeek.length !== 7;

  /** POSIX rule: when both day fields are restricted, either one may match. */
  const dayMatches = (year: number, month: number, day: number): boolean => {
    if (!monthSet.has(month)) return false;
    const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
    const domHit = domSet.has(day);
    const dowHit = dowSet.has(weekday);
    if (domRestricted && dowRestricted) return domHit || dowHit;
    if (domRestricted) return domHit;
    if (dowRestricted) return dowHit;
    return true;
  };

  let cursor = Math.floor(from / minuteMs) * minuteMs + minuteMs;
  // Two calendar years covers the worst realistic case (e.g. 29 February in a
  // named month). Days are skipped wholesale so this stays a few thousand
  // iterations rather than a million.
  const deadline = from + 366 * 2 * dayMs;

  while (cursor < deadline && runs.length < count) {
    const p = partsInZone(cursor, zone);

    if (!dayMatches(p.year, p.month, p.day)) {
      // Jump to the next local midnight instead of walking 1440 minutes.
      const remainingMs = ((23 - p.hour) * 3600 + (59 - p.minute) * 60 + (60 - p.second)) * 1000;
      cursor += Math.max(minuteMs, remainingMs);
      continue;
    }
    if (!hourSet.has(p.hour)) {
      // Jump to the top of the next hour.
      cursor += Math.max(minuteMs, ((59 - p.minute) * 60 + (60 - p.second)) * 1000);
      continue;
    }
    if (!minuteSet.has(p.minute)) {
      cursor += minuteMs;
      continue;
    }

    runs.push(cursor);
    cursor += minuteMs;
  }
  return runs;
}

// ─── Generator ────────────────────────────────────────────────────────────

export interface CronRecipe {
  expression: string;
  fa: string;
  en: string;
}

/** Turns a plain-language schedule into a cron expression. */
export function generateCron(description: string): CronRecipe {
  const text = description.trim().toLowerCase();

  const everyNMinutes = /every\s+(\d{1,2})\s*(?:minutes?|min|m)\b|هر\s+(\d{1,2})\s*دقیقه/.exec(text);
  if (everyNMinutes) {
    const n = Number(everyNMinutes[1] ?? everyNMinutes[2]);
    if (n < 1 || n > 59) {
      throw errInvalidInput('بازه‌ی دقیقه باید بین ۱ تا ۵۹ باشد.', 'The minute interval must be between 1 and 59.');
    }
    return { expression: `*/${n} * * * *`, fa: `هر ${n} دقیقه`, en: `Every ${n} minutes` };
  }

  const everyNHours = /every\s+(\d{1,2})\s*(?:hours?|hr|h)\b|هر\s+(\d{1,2})\s*ساعت/.exec(text);
  if (everyNHours) {
    const n = Number(everyNHours[1] ?? everyNHours[2]);
    if (n < 1 || n > 23) {
      throw errInvalidInput('بازه‌ی ساعت باید بین ۱ تا ۲۳ باشد.', 'The hour interval must be between 1 and 23.');
    }
    return { expression: `0 */${n} * * *`, fa: `هر ${n} ساعت`, en: `Every ${n} hours` };
  }

  const dailyAt = /(?:daily|every\s+day|هر\s*روز)\s*(?:at|ساعت)?\s*(\d{1,2})(?::(\d{2}))?/.exec(text);
  if (dailyAt) {
    const hour = Number(dailyAt[1]);
    const minute = Number(dailyAt[2] ?? '0');
    assertClock(hour, minute);
    return {
      expression: `${minute} ${hour} * * *`,
      fa: `هر روز ساعت ${pad(hour)}:${pad(minute)}`,
      en: `Every day at ${pad(hour)}:${pad(minute)}`,
    };
  }

  const weekly = /(?:every\s+)?(sunday|monday|tuesday|wednesday|thursday|friday|saturday|یکشنبه|دوشنبه|سه‌شنبه|چهارشنبه|پنج‌شنبه|جمعه|شنبه)\s*(?:at|ساعت)?\s*(\d{1,2})?(?::(\d{2}))?/.exec(text);
  if (weekly) {
    const nameFa = DAY_NAMES_FA.indexOf(weekly[1] ?? '');
    const nameEn = DAY_NAMES.findIndex((d) => d.toLowerCase() === (weekly[1] ?? ''));
    const day = nameEn !== -1 ? nameEn : nameFa;
    const hour = Number(weekly[2] ?? '0');
    const minute = Number(weekly[3] ?? '0');
    assertClock(hour, minute);
    return {
      expression: `${minute} ${hour} * * ${day}`,
      fa: `هر ${DAY_NAMES_FA[day]} ساعت ${pad(hour)}:${pad(minute)}`,
      en: `Every ${DAY_NAMES[day]} at ${pad(hour)}:${pad(minute)}`,
    };
  }

  if (/weekdays?|روزهای\s*کاری/.test(text)) {
    const at = /(\d{1,2})(?::(\d{2}))?/.exec(text.replace(/\d+\s*(?:days?|روز)/, ''));
    const hour = Number(at?.[1] ?? '9');
    const minute = Number(at?.[2] ?? '0');
    assertClock(hour, minute);
    return {
      expression: `${minute} ${hour} * * 1-5`,
      fa: `روزهای کاری (دوشنبه تا جمعه) ساعت ${pad(hour)}:${pad(minute)}`,
      en: `Weekdays (Mon–Fri) at ${pad(hour)}:${pad(minute)}`,
    };
  }

  const monthly = /(?:monthly|every\s+month|هر\s*ماه)\s*(?:on\s*(?:day\s*)?(\d{1,2}))?\s*(?:at|ساعت)?\s*(\d{1,2})?(?::(\d{2}))?/.exec(text);
  if (monthly) {
    const day = Number(monthly[1] ?? '1');
    const hour = Number(monthly[2] ?? '0');
    const minute = Number(monthly[3] ?? '0');
    if (day < 1 || day > 31) {
      throw errInvalidInput('روز ماه باید بین ۱ تا ۳۱ باشد.', 'The day of month must be between 1 and 31.');
    }
    assertClock(hour, minute);
    return {
      expression: `${minute} ${hour} ${day} * *`,
      fa: `هر ماه، روز ${day}، ساعت ${pad(hour)}:${pad(minute)}`,
      en: `Monthly on day ${day} at ${pad(hour)}:${pad(minute)}`,
    };
  }

  if (/hourly|هر\s*ساعت/.test(text)) {
    return { expression: '0 * * * *', fa: 'هر ساعت، دقیقه‌ی ۰', en: 'Hourly at minute 0' };
  }
  if (/every\s+minute|هر\s*دقیقه/.test(text)) {
    return { expression: '* * * * *', fa: 'هر دقیقه', en: 'Every minute' };
  }

  throw errInvalidInput(
    'توصیف زمان‌بندی شناخته نشد. نمونه‌های پشتیبانی‌شده:\n' +
      '• <code>every 5 minutes</code>\n• <code>every 2 hours</code>\n• <code>daily at 3:30</code>\n' +
      '• <code>weekdays at 9</code>\n• <code>monday at 8</code>\n• <code>monthly on day 1 at 0:00</code>',
    'Unrecognised schedule description. Supported examples:\n' +
      '• <code>every 5 minutes</code>\n• <code>every 2 hours</code>\n• <code>daily at 3:30</code>\n' +
      '• <code>weekdays at 9</code>\n• <code>monday at 8</code>\n• <code>monthly on day 1 at 0:00</code>',
  );
}

const pad = (n: number): string => String(n).padStart(2, '0');

function assertClock(hour: number, minute: number): void {
  if (!Number.isInteger(hour) || hour < 0 || hour > 23 || !Number.isInteger(minute) || minute < 0 || minute > 59) {
    throw errInvalidInput('ساعت باید بین 0:00 و 23:59 باشد.', 'The time must be between 0:00 and 23:59.');
  }
}

/**
 * One-line summary of an expression.
 *
 * The Phase 1 `describeCron` has the nicer preset phrasing but only accepts
 * numeric fields, so it is used when it can and the field breakdown is joined
 * as a fallback for expressions using month/day names.
 */
function summarise(expression: string, breakdown: CronBreakdown): { fa: string; en: string } {
  try {
    return describeCron(expression);
  } catch {
    return {
      fa: breakdown.fields.map((field) => field.fa).join(' • '),
      en: breakdown.fields.map((field) => field.en).join(' • '),
    };
  }
}

export const cronBuilderTool = defineTool({
  id: 'cron_builder',
  category: 'utilities',
  icon: '⏰',
  quick: true,
  needsInput: true,
  title: { fa: 'سازنده و توضیح‌دهنده‌ی Cron', en: 'Cron Generator & Explainer' },
  description: {
    fa: 'عبارت Cron را بخش‌به‌بخش توضیح می‌دهد و پنج اجرای بعدی را در منطقه‌ی زمانی دلخواه پیش‌بینی می‌کند؛ یا از روی توصیف ساده مثل «every 5 minutes» عبارت می‌سازد.',
    en: 'Explains a cron expression field by field and predicts the next five runs in the timezone you choose; or builds an expression from a description such as "every 5 minutes".',
  },
  usage: {
    fa:
      '• توضیح: <code>*/5 * * * *</code>\n' +
      '• ساخت: <code>generate: every 5 minutes</code>\n' +
      '• منطقه‌ی زمانی: در انتها <code>@ Europe/Berlin</code> بیفزایید.',
    en:
      '• Explain: <code>*/5 * * * *</code>\n' +
      '• Generate: <code>generate: every 5 minutes</code>\n' +
      '• Timezone: append <code>@ Europe/Berlin</code>.',
  },
  example: {
    fa: 'ورودی: 0 9 * * 1-5 @ Asia/Tehran\nخروجی: روزهای کاری ساعت ۹ + پنج اجرای بعدی به وقت تهران',
    en: 'Input: 0 9 * * 1-5 @ Asia/Tehran\nOutput: weekdays at 09:00 + the next five runs in Tehran time',
  },
  limitations: {
    fa: 'فقط قالب استاندارد ۵ بخشی. میان‌برهایی مثل @daily و پسوندهای غیراستاندارد L، W و # پشتیبانی نمی‌شوند. پیش‌بینی تا دو سال آینده جست‌وجو می‌شود.',
    en: 'Standard 5-field syntax only. Shortcuts such as @daily and the non-standard L, W and # suffixes are unsupported. Prediction searches up to two years ahead.',
  },
  run: (input, ctx) => {
    const fa = ctx.lang === 'fa';
    const [main = '', zoneRaw] = input.split('@').map((part) => part.trim());
    const zone = zoneRaw ? resolveZone(zoneRaw) : 'UTC';

    const genMatch = /^(?:generate|gen|make|بساز|ساخت)\s*[:=]\s*(.+)$/i.exec(main);
    const expression = genMatch ? generateCron((genMatch[1] ?? '').trim()).expression : main;
    const recipe = genMatch ? generateCron((genMatch[1] ?? '').trim()) : null;

    const breakdown = breakdownCron(expression);
    const summary = summarise(expression, breakdown);
    const runs = nextRuns(breakdown, zone, 5);

    const fieldNames = fa
      ? ['دقیقه', 'ساعت', 'روز ماه', 'ماه', 'روز هفته']
      : ['Minute', 'Hour', 'Day of month', 'Month', 'Day of week'];

    const fieldRows = breakdown.fields
      .map((field, i) => `• <b>${fieldNames[i]}</b> ${mono(field.raw)} — ${escapeHtml(fa ? field.fa : field.en)}`)
      .join('\n');

    const runRows = runs.length
      ? runs.map((ms, i) => `${i + 1}. <code>${escapeHtml(formatInZone(ms, zone))}</code>`).join('\n')
      : fa
        ? '<i>در دو سال آینده اجرایی پیدا نشد (مثلاً ۳۰ فوریه).</i>'
        : '<i>No run found within two years (e.g. 30 February).</i>';

    const ambiguity = breakdown.ambiguousDay
      ? `\n<i>⚠️ ${
          fa
            ? 'هر دو بخش «روز ماه» و «روز هفته» مقید شده‌اند؛ طبق استاندارد POSIX کرون در صورت برقراری <b>هرکدام</b> اجرا می‌شود، نه هر دو با هم.'
            : 'Both the day-of-month and day-of-week fields are restricted; per POSIX, cron runs when <b>either</b> matches, not both.'
        }</i>`
      : '';

    return {
      html:
        (recipe
          ? `${fa ? '🪄 <b>عبارت ساخته‌شده</b>' : '🪄 <b>Generated expression</b>'} — ${escapeHtml(fa ? recipe.fa : recipe.en)}\n`
          : `${fa ? '⏰ <b>عبارت Cron</b>' : '⏰ <b>Cron expression</b>'}\n`) +
        codeBlock(expression) +
        `${fa ? '🗣 <b>توصیف</b>' : '🗣 <b>Description</b>'}\n${escapeHtml(fa ? summary.fa : summary.en)}\n` +
        `${DIVIDER}\n${fa ? '🧩 <b>بخش‌ها</b>' : '🧩 <b>Fields</b>'}\n${fieldRows}${ambiguity}\n` +
        `${DIVIDER}\n${fa ? '⏭ <b>پنج اجرای بعدی</b>' : '⏭ <b>Next five runs</b>'} — ${escapeHtml(zone)} (${formatOffset(offsetMinutes(Date.now(), zone))})\n${runRows}`,
    };
  },
});
