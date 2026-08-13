/**
 * 💱 Everyday Tools → Currency converter (live rates only).
 *
 * Hard rule for this file: **no hard-coded or invented rates, ever**. If the
 * upstream providers are unreachable the tool fails loudly with an explanation
 * instead of showing a stale or made-up number — a wrong exchange rate is worse
 * than no exchange rate.
 *
 * Two independent public providers are tried in order, both key-less:
 *   1. api.frankfurter.dev — ECB reference rates, ~30 currencies, daily.
 *   2. open.er-api.com     — broader coverage (160+), daily, exposes its own
 *                            "last update" timestamp.
 * Whichever answers first is used, and the response always names the provider
 * and the timestamp so the user can judge how fresh the number is.
 *
 * Results are cached in KV for a few minutes. Failures are never cached.
 */
import { defineTool, type ToolRunContext } from '../types.js';
import { DIVIDER, escapeHtml, mono } from '../../utils/text.js';
import { errInvalidInput, errNetwork } from '../../utils/errors.js';
import { cached, fetchJson } from '../../services/http.js';
import { STATE_TTL } from '../../config/index.js';
import { fmt, normalizeDigits, parseNumber } from './fields.js';

/** Common symbols and local names mapped to ISO-4217 codes. */
const ALIASES: Record<string, string> = {
  $: 'USD', us$: 'USD', dollar: 'USD', dollars: 'USD', usd: 'USD', دلار: 'USD',
  '€': 'EUR', euro: 'EUR', euros: 'EUR', یورو: 'EUR',
  '£': 'GBP', pound: 'GBP', sterling: 'GBP', پوند: 'GBP',
  '¥': 'JPY', yen: 'JPY', ین: 'JPY',
  '₺': 'TRY', lira: 'TRY', لیر: 'TRY', 'لیره': 'TRY',
  '₽': 'RUB', ruble: 'RUB', روبل: 'RUB',
  '﷼': 'IRR', rial: 'IRR', ریال: 'IRR', تومان: 'IRT', toman: 'IRT',
  '₹': 'INR', rupee: 'INR', روپیه: 'INR',
  'د.إ': 'AED', dirham: 'AED', درهم: 'AED',
  franc: 'CHF', فرانک: 'CHF', yuan: 'CNY', یوان: 'CNY', won: 'KRW', وون: 'KRW',
};

/**
 * `IRT` (Iranian toman) is not an ISO code — it is 10 rials. Users constantly
 * type it, so it is translated to IRR and scaled, with the conversion spelled
 * out in the result rather than silently applied.
 */
const TOMAN_PER_RIAL = 10;

export interface RateQuote {
  from: string;
  to: string;
  rate: number;
  /** ISO date or timestamp reported by the provider. */
  asOf: string;
  provider: string;
  providerUrl: string;
}

interface FrankfurterResponse {
  amount?: number;
  base?: string;
  date?: string;
  rates?: Record<string, number>;
}

interface ErApiResponse {
  result?: string;
  provider?: string;
  base_code?: string;
  time_last_update_utc?: string;
  rates?: Record<string, number>;
}

/** Normalises whatever the user typed into an ISO-4217-looking code. */
export function normalizeCurrency(raw: string): string {
  const cleaned = normalizeDigits(raw).trim().toLowerCase().replace(/[.\s]/g, '');
  const alias = ALIASES[cleaned];
  if (alias) return alias;
  const upper = cleaned.toUpperCase();
  if (!/^[A-Z]{3}$/.test(upper)) {
    throw errInvalidInput(
      `کد ارز «${raw}» معتبر نیست. از کد سه‌حرفی ISO مثل USD یا EUR استفاده کنید.`,
      `"${raw}" is not a valid currency. Use a 3-letter ISO code such as USD or EUR.`,
    );
  }
  return upper;
}

async function fromFrankfurter(from: string, to: string): Promise<RateQuote | null> {
  try {
    const { data } = await fetchJson<FrankfurterResponse>(
      `https://api.frankfurter.dev/v1/latest?base=${encodeURIComponent(from)}&symbols=${encodeURIComponent(to)}`,
      { timeoutMs: 6000 },
    );
    const rate = data.rates?.[to];
    if (typeof rate !== 'number' || !Number.isFinite(rate) || rate <= 0) return null;
    return {
      from,
      to,
      rate,
      asOf: data.date ?? '',
      provider: 'Frankfurter (ECB reference rates)',
      providerUrl: 'https://frankfurter.dev',
    };
  } catch {
    return null;
  }
}

async function fromErApi(from: string, to: string): Promise<RateQuote | null> {
  try {
    const { data } = await fetchJson<ErApiResponse>(
      `https://open.er-api.com/v6/latest/${encodeURIComponent(from)}`,
      { timeoutMs: 6000, maxBytes: 64 * 1024 },
    );
    if (data.result !== 'success') return null;
    const rate = data.rates?.[to];
    if (typeof rate !== 'number' || !Number.isFinite(rate) || rate <= 0) return null;
    return {
      from,
      to,
      rate,
      asOf: data.time_last_update_utc ?? '',
      provider: 'ExchangeRate-API (open access endpoint)',
      providerUrl: data.provider ?? 'https://www.exchangerate-api.com',
    };
  } catch {
    return null;
  }
}

/**
 * Fetches one live rate. Throws `errNetwork` when every provider fails: the
 * caller must never substitute a fallback number.
 */
export async function fetchRate(from: string, to: string, kv?: KVNamespace): Promise<RateQuote> {
  if (from === to) {
    return { from, to, rate: 1, asOf: '', provider: 'identity', providerUrl: '' };
  }
  const quote = await cached<RateQuote | null>(
    kv,
    `fx:${from}:${to}`,
    STATE_TTL.networkCacheSec,
    async () => (await fromFrankfurter(from, to)) ?? (await fromErApi(from, to)),
    // Only a real quote is worth caching; a null means both providers failed.
    (value) => value !== null && value.rate > 0,
  );
  if (!quote) {
    throw errNetwork(
      'در حال حاضر امکان دریافت نرخ زندهٔ ارز وجود ندارد (سرویس‌های نرخ در دسترس نیستند یا این جفت‌ارز را پوشش نمی‌دهند). ' +
        'این ابزار عمداً هیچ نرخ ذخیره‌شده یا تخمینی نشان نمی‌دهد؛ لطفاً کمی بعد دوباره تلاش کنید.',
      'Live exchange rates are unavailable right now (the rate providers are unreachable or do not cover this pair). ' +
        'This tool deliberately never shows a cached guess or an estimated rate — please try again shortly.',
    );
  }
  return quote;
}

/** Parses `100 usd to eur`, `usd eur 100`, `50 EUR IRR`. */
export function parseConversionRequest(input: string): { amount: number; from: string; to: string } {
  const text = normalizeDigits(input).trim().replace(/\s+/g, ' ');
  if (!text) throw errInvalidInput('ورودی خالی است.', 'Input is empty.');
  if (text.length > 100) {
    throw errInvalidInput('ورودی بیش از حد طولانی است.', 'Input is too long.');
  }
  // `\b` is ASCII-only in JS regexes, so Persian keywords are matched with
  // explicit whitespace boundaries instead of word boundaries.
  const cleaned = text
    .replace(/\b(to|in|into|equals?)\b/gi, ' ')
    .replace(/(^|\s)(به|معادل|برابر)(\s|$)/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const parts = cleaned.split(' ').filter(Boolean);
  const numeric: string[] = [];
  const words: string[] = [];
  for (const part of parts) {
    if (/[0-9]/.test(part) && !/^[A-Za-z]{3}$/.test(part)) numeric.push(part);
    else words.push(part);
  }
  if (words.length < 2) {
    throw errInvalidInput(
      'دو کد ارز لازم است؛ مثلاً <code>100 USD to EUR</code>.',
      'Two currency codes are required, e.g. <code>100 USD to EUR</code>.',
    );
  }
  const amount = numeric.length > 0 ? parseNumber(numeric[0] as string, 'amount') : 1;
  if (amount <= 0) {
    throw errInvalidInput('مبلغ باید بزرگ‌تر از صفر باشد.', 'Amount must be greater than zero.');
  }
  if (amount > 1e12) {
    throw errInvalidInput('مبلغ بیش از حد بزرگ است.', 'Amount is too large.');
  }
  return {
    amount,
    from: normalizeCurrency(words[0] as string),
    to: normalizeCurrency(words[1] as string),
  };
}

/** Maps the pseudo-code IRT (toman) onto IRR for the API call. */
function resolveIsoCode(code: string): { iso: string; scale: number; note: boolean } {
  return code === 'IRT' ? { iso: 'IRR', scale: TOMAN_PER_RIAL, note: true } : { iso: code, scale: 1, note: false };
}

export const currencyTool = defineTool({
  id: 'currency_convert',
  category: 'everyday',
  group: 'calculators',
  icon: '💱',
  quick: true,
  network: true,
  needsInput: true,
  title: { fa: 'تبدیل ارز', en: 'Currency Converter' },
  description: {
    fa: 'تبدیل ارز با نرخ زندهٔ سرویس‌های عمومی (Frankfurter/ECB و ExchangeRate-API). نرخ جاری، مبلغ تبدیل‌شده، زمان آخرین به‌روزرسانی و نام منبع نمایش داده می‌شود.',
    en: 'Converts currencies using live rates from public providers (Frankfurter/ECB and ExchangeRate-API). Shows the current rate, the converted amount, the last-updated time and the source.',
  },
  usage: {
    fa: 'مثلاً <code>100 USD to EUR</code> یا <code>250 EUR TRY</code>. بدون مبلغ، نرخ یک واحد نمایش داده می‌شود: <code>USD EUR</code>.',
    en: 'e.g. <code>100 USD to EUR</code> or <code>250 EUR TRY</code>. Without an amount the rate for one unit is shown: <code>USD EUR</code>.',
  },
  example: { fa: 'ورودی: 100 USD to EUR', en: 'Input: 100 USD to EUR' },
  limitations: {
    fa:
      'نرخ‌ها مرجع روزانه هستند و نرخ لحظه‌ای بازار یا نرخ صرافی نیستند؛ کارمزد و اسپرد در آن‌ها لحاظ نشده است. ' +
      'اگر سرویس‌ها در دسترس نباشند خطا داده می‌شود و هیچ نرخ تخمینی نمایش داده نمی‌شود. ' +
      'برای ریال ایران فقط نرخ رسمی منتشرشده توسط منبع در دسترس است (نه نرخ بازار آزاد). نتایج تا ۵ دقیقه کش می‌شوند.',
    en:
      'Rates are daily reference rates, not live market or bureau-de-change rates, and exclude fees and spreads. ' +
      'If the providers are unreachable the tool errors out instead of showing an estimate. ' +
      'For the Iranian rial only the official published rate is available (not the open-market rate). Results are cached for up to 5 minutes.',
  },
  run: async (input: string, ctx: ToolRunContext) => {
    const fa = ctx.lang === 'fa';
    const request = parseConversionRequest(input);
    const src = resolveIsoCode(request.from);
    const dst = resolveIsoCode(request.to);

    const quote = await fetchRate(src.iso, dst.iso, ctx.cache);
    // IRT → IRR scaling is applied here, after the live rate, so the number the
    // provider gave is never modified silently.
    const effectiveRate = (quote.rate * src.scale) / dst.scale;
    const converted = request.amount * effectiveRate;
    const inverse = effectiveRate === 0 ? 0 : 1 / effectiveRate;

    const asOf = quote.asOf || (fa ? 'نامشخص' : 'unknown');
    const rows = fa
      ? [
          `💱 <b>${fmt(request.amount, 4)} ${escapeHtml(request.from)}</b> = <b>${fmt(converted, 4)} ${escapeHtml(request.to)}</b>`,
          DIVIDER,
          `📈 نرخ جاری: ${mono(`1 ${request.from} = ${fmt(effectiveRate, 6)} ${request.to}`)}`,
          `🔄 نرخ معکوس: ${mono(`1 ${request.to} = ${fmt(inverse, 6)} ${request.from}`)}`,
          `🕒 آخرین به‌روزرسانی: ${escapeHtml(asOf)}`,
          `🌐 منبع: ${escapeHtml(quote.provider)}`,
          src.note || dst.note ? `ℹ️ تومان = ۱۰ ریال؛ محاسبه بر پایهٔ نرخ رسمی ریال (IRR) انجام شد.` : '',
          `⚠️ نرخ مرجع روزانه است و کارمزد/اسپرد صرافی را شامل نمی‌شود.`,
        ]
      : [
          `💱 <b>${fmt(request.amount, 4)} ${escapeHtml(request.from)}</b> = <b>${fmt(converted, 4)} ${escapeHtml(request.to)}</b>`,
          DIVIDER,
          `📈 Current rate: ${mono(`1 ${request.from} = ${fmt(effectiveRate, 6)} ${request.to}`)}`,
          `🔄 Inverse: ${mono(`1 ${request.to} = ${fmt(inverse, 6)} ${request.from}`)}`,
          `🕒 Last updated: ${escapeHtml(asOf)}`,
          `🌐 Source: ${escapeHtml(quote.provider)}`,
          src.note || dst.note ? `ℹ️ 1 toman = 10 rials; computed from the official IRR rate.` : '',
          `⚠️ Daily reference rate — excludes bureau fees and spreads.`,
        ];

    return {
      html: rows.filter(Boolean).join('\n'),
      toast: `${fmt(converted, 2)} ${request.to}`,
    };
  },
});

export const currencyTools = [currencyTool];
