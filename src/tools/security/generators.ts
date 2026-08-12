import { defineTool } from '../types.js';
import { codeBlock, DIVIDER, mono } from '../../utils/text.js';
import { LIMITS } from '../../config/index.js';
import {
  CHARSETS,
  entropyBits,
  randomFromCharset,
  randomHex,
  strengthLabel,
  uuidV4,
  uuidV7,
} from '../../utils/random.js';
import { base64UrlEncode } from '../../utils/encoding.js';
import { parsePositiveInt } from '../../utils/validate.js';
import { errInvalidInput } from '../../utils/errors.js';

export const uuidTool = defineTool({
  id: 'uuid_gen',
  category: 'security',
  icon: '🆔',
  quick: true,
  needsInput: false,
  title: { fa: 'تولید UUID', en: 'UUID Generator' },
  description: {
    fa: 'شناسه‌های یکتا تولید می‌کند: UUID v4 (کاملاً تصادفی، RFC 4122) و UUID v7 (زمان‌مرتب، مناسب کلید اصلی پایگاه داده).',
    en: 'Generates unique identifiers: UUID v4 (fully random, RFC 4122) and UUID v7 (time-ordered, ideal as a database primary key).',
  },
  usage: {
    fa: 'بدون ورودی اجرا کنید یا تعداد دلخواه (۱ تا ۲۰) را بفرستید؛ مثلاً «5».',
    en: 'Run without input, or send a count (1–20), e.g. “5”.',
  },
  example: {
    fa: 'خروجی: 9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d',
    en: 'Output: 9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d',
  },
  limitations: { fa: 'حداکثر ۲۰ شناسه در هر اجرا.', en: 'Max 20 identifiers per run.' },
  run: (input, ctx) => {
    const count = input.trim() ? parsePositiveInt(input, 1, 1, LIMITS.maxBulkCount) : 1;
    const v4 = Array.from({ length: count }, () => uuidV4()).join('\n');
    const v7 = Array.from({ length: count }, () => uuidV7()).join('\n');
    const fa = ctx.lang === 'fa';
    return {
      html:
        `<b>UUID v4</b> ${fa ? '— تصادفی' : '— random'}\n${codeBlock(v4)}` +
        `<b>UUID v7</b> ${fa ? '— زمان‌مرتب' : '— time-ordered'}\n${codeBlock(v7)}` +
        `${DIVIDER}\n🎲 ${fa ? 'آنتروپی v4' : 'v4 entropy'}: 122 bits`,
    };
  },
});

export const passwordTool = defineTool({
  id: 'password_gen',
  category: 'security',
  icon: '🔑',
  quick: true,
  needsInput: false,
  title: { fa: 'تولید رمز عبور', en: 'Password Generator' },
  description: {
    fa: 'رمز عبور قوی با استفاده از مولد تصادفی امن رمزنگاری (crypto.getRandomValues) و نمونه‌برداری بدون سوگیری تولید می‌کند و آنتروپی آن را به بیت گزارش می‌دهد.',
    en: 'Generates strong passwords with a cryptographically secure RNG (crypto.getRandomValues) using unbiased sampling, and reports entropy in bits.',
  },
  usage: {
    fa: 'بدون ورودی → ۳ رمز ۲۰ کاراکتری.\nبا ورودی: <code>طول [flags]</code>\npflags: <code>a</code> حروف، <code>A</code> بزرگ، <code>0</code> عدد، <code>!</code> نماد، <code>u</code> بدون کاراکتر مشابه.\nنمونه: <code>32 aA0!</code>',
    en: 'No input → three 20-char passwords.\nWith input: <code>length [flags]</code>\nflags: <code>a</code> lower, <code>A</code> upper, <code>0</code> digits, <code>!</code> symbols, <code>u</code> unambiguous.\nExample: <code>32 aA0!</code>',
  },
  example: {
    fa: 'ورودی: 24 aA0!\nخروجی: 3 رمز ۲۴ کاراکتری + آنتروپی',
    en: 'Input: 24 aA0!\nOutput: three 24-char passwords + entropy',
  },
  limitations: {
    fa: `طول بین ${LIMITS.minGeneratedLength} تا ${LIMITS.maxGeneratedLength}. رمزها ذخیره یا لاگ نمی‌شوند.`,
    en: `Length between ${LIMITS.minGeneratedLength} and ${LIMITS.maxGeneratedLength}. Passwords are never stored or logged.`,
  },
  run: (input, ctx) => {
    const fa = ctx.lang === 'fa';
    const parts = input.trim().split(/\s+/).filter(Boolean);
    const length = parts[0] ? parsePositiveInt(parts[0], 20, LIMITS.minGeneratedLength, LIMITS.maxGeneratedLength) : 20;
    const flags = parts[1] ?? 'aA0!';
    let charset = '';
    if (flags.includes('u')) charset = CHARSETS.unambiguous;
    else {
      if (flags.includes('a')) charset += CHARSETS.lower;
      if (flags.includes('A')) charset += CHARSETS.upper;
      if (flags.includes('0')) charset += CHARSETS.digits;
      if (flags.includes('!')) charset += CHARSETS.symbols;
    }
    if (!charset) charset = CHARSETS.lower + CHARSETS.upper + CHARSETS.digits + CHARSETS.symbols;

    const passwords = Array.from({ length: 3 }, () => randomFromCharset(length, charset));
    const bits = entropyBits(length, charset.length);
    const strength = strengthLabel(bits);
    return {
      html:
        `${codeBlock(passwords.join('\n'))}` +
        `${DIVIDER}\n` +
        (fa
          ? `📏 طول: <b>${length}</b> • مجموعه نویسه: <b>${charset.length}</b>\n🎲 آنتروپی: <b>${bits}</b> بیت\n💪 قدرت: <b>${strength.fa}</b> ${strength.bar}\n🔒 رمزها فقط در حافظه تولید شده و ذخیره نمی‌شوند.`
          : `📏 Length: <b>${length}</b> • Pool: <b>${charset.length}</b>\n🎲 Entropy: <b>${bits}</b> bits\n💪 Strength: <b>${strength.en}</b> ${strength.bar}\n🔒 Generated in memory only, never stored.`),
    };
  },
});

export const randomStringTool = defineTool({
  id: 'random_string',
  category: 'programming',
  icon: '🎲',
  needsInput: false,
  title: { fa: 'تولید رشته تصادفی', en: 'Random String Generator' },
  description: {
    fa: 'رشته‌ی تصادفی امن در قالب‌های مختلف (حروف و اعداد، hex، Base64URL و بدون کاراکتر مشابه) تولید می‌کند.',
    en: 'Generates secure random strings in several formats: alphanumeric, hex, Base64URL and unambiguous.',
  },
  usage: {
    fa: 'بدون ورودی → طول ۳۲. یا طول دلخواه را بفرستید؛ مثلاً «16».',
    en: 'No input → length 32. Or send a length, e.g. “16”.',
  },
  example: { fa: 'ورودی: 16\nخروجی: 4 رشته با طول ۱۶', en: 'Input: 16\nOutput: four 16-char strings' },
  limitations: { fa: `طول ${LIMITS.minGeneratedLength} تا ${LIMITS.maxGeneratedLength}.`, en: `Length ${LIMITS.minGeneratedLength}–${LIMITS.maxGeneratedLength}.` },
  run: (input, ctx) => {
    const length = input.trim()
      ? parsePositiveInt(input, 32, LIMITS.minGeneratedLength, LIMITS.maxGeneratedLength)
      : 32;
    const fa = ctx.lang === 'fa';
    const alnum = randomFromCharset(length, CHARSETS.lower + CHARSETS.upper + CHARSETS.digits);
    const hex = randomHex(Math.ceil(length / 2)).slice(0, length);
    const b64 = base64UrlEncode(randomFromCharset(length, CHARSETS.lower + CHARSETS.digits)).slice(0, length);
    const clean = randomFromCharset(length, CHARSETS.unambiguous);
    return {
      html:
        `<b>${fa ? 'حروف و اعداد' : 'Alphanumeric'}</b>\n${codeBlock(alnum)}` +
        `<b>Hex</b>\n${codeBlock(hex)}` +
        `<b>Base64URL</b>\n${codeBlock(b64)}` +
        `<b>${fa ? 'بدون کاراکتر مشابه' : 'Unambiguous'}</b>\n${codeBlock(clean)}` +
        `${DIVIDER}\n📏 ${fa ? 'طول' : 'Length'}: ${length}`,
    };
  },
});

export const secretTool = defineTool({
  id: 'secret_gen',
  category: 'security',
  icon: '🗝',
  needsInput: false,
  title: { fa: 'تولید Secret و Token', en: 'Secure Secret / Token Generator' },
  description: {
    fa: 'مقادیر آماده‌ی محیط تولید می‌کند: کلید ۲۵۶ بیتی hex، توکن Base64URL، کلید سبک API و UUID — همگی با CSPRNG.',
    en: 'Produces ready-to-use environment values: a 256-bit hex key, a Base64URL token, a short API key and a UUID — all from a CSPRNG.',
  },
  usage: {
    fa: 'بدون ورودی اجرا کنید یا تعداد بایت (۱۶ تا ۶۴) را بفرستید.',
    en: 'Run without input or send a byte length (16–64).',
  },
  example: {
    fa: 'خروجی: SECRET_KEY=7f3a… (۶۴ کاراکتر hex)',
    en: 'Output: SECRET_KEY=7f3a… (64 hex chars)',
  },
  limitations: {
    fa: 'مقادیر تولیدشده ذخیره نمی‌شوند؛ بلافاصله در جای امن نگه‌داری کنید.',
    en: 'Generated values are never stored — save them somewhere safe immediately.',
  },
  run: (input, ctx) => {
    const bytes = input.trim() ? parsePositiveInt(input, 32, 16, 64) : 32;
    const fa = ctx.lang === 'fa';
    const env = [
      `SECRET_KEY=${randomHex(bytes)}`,
      `WEBHOOK_SECRET=${base64UrlEncode(randomFromCharset(bytes, CHARSETS.lower + CHARSETS.upper + CHARSETS.digits))}`,
      `API_KEY=sk_${randomFromCharset(32, CHARSETS.lower + CHARSETS.digits)}`,
      `SESSION_ID=${uuidV4()}`,
    ].join('\n');
    return {
      html:
        `${codeBlock(env, 'bash')}${DIVIDER}\n` +
        (fa
          ? `🔐 ${bytes * 8} بیت آنتروپی • تولیدشده با CSPRNG\n⚠️ این مقادیر در هیچ‌جا ذخیره نشدند.`
          : `🔐 ${bytes * 8} bits of entropy • CSPRNG generated\n⚠️ These values were not stored anywhere.`),
    };
  },
});

export const hmacTool = defineTool({
  id: 'hmac_gen',
  category: 'security',
  icon: '✍️',
  needsInput: true,
  title: { fa: 'تولید HMAC', en: 'HMAC Generator' },
  description: {
    fa: 'کد احراز اصالت پیام (HMAC) را با SHA-256 محاسبه می‌کند؛ برای امضای Webhook و تأیید یکپارچگی پیام کاربرد دارد.',
    en: 'Computes an HMAC-SHA-256 message authentication code — used for signing webhooks and verifying message integrity.',
  },
  usage: {
    fa: 'خط اول: کلید\nخط‌های بعد: پیام\nنمونه:\nmysecret\nhello world',
    en: 'Line 1: key\nRemaining lines: message\nExample:\nmysecret\nhello world',
  },
  example: {
    fa: 'ورودی:\nkey\nThe quick brown fox\nخروجی: HMAC-SHA-256 به‌صورت hex',
    en: 'Input:\nkey\nThe quick brown fox\nOutput: hex HMAC-SHA-256',
  },
  limitations: {
    fa: 'فقط SHA-256. کلید ارسالی ذخیره نمی‌شود اما از ارسال کلیدهای تولیدی خودداری کنید.',
    en: 'SHA-256 only. The key is not stored, but avoid sending production keys.',
  },
  run: async (input, ctx) => {
    const [key = '', ...rest] = input.split('\n');
    const message = rest.join('\n');
    if (!key.trim() || !message) {
      throw errInvalidInput(
        'خط اول باید کلید و خطوط بعدی پیام باشد.',
        'First line must be the key, following lines the message.',
      );
    }
    const { hmacHex } = await import('../../utils/hash.js');
    const hex = await hmacHex('SHA-256', key, message);
    const fa = ctx.lang === 'fa';
    return {
      html:
        `<b>HMAC-SHA-256</b>\n${codeBlock(hex)}${DIVIDER}\n` +
        `${fa ? 'طول پیام' : 'Message length'}: ${mono(String(message.length))}`,
    };
  },
});
