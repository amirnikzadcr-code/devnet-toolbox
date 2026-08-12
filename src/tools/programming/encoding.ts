import { defineTool } from '../types.js';
import { codeBlock, DIVIDER, formatBytes, mono } from '../../utils/text.js';
import { base64Decode, base64Encode, utf8Length } from '../../utils/encoding.js';
import { errInvalidInput } from '../../utils/errors.js';

export const base64EncodeTool = defineTool({
  id: 'base64_encode',
  category: 'programming',
  icon: '🔡',
  quick: true,
  needsInput: true,
  title: { fa: 'کدگذاری Base64', en: 'Base64 Encode' },
  description: {
    fa: 'هر متن یونیکد (از جمله فارسی و اموجی) را با UTF-8 به Base64 استاندارد و نسخه URL-safe تبدیل می‌کند.',
    en: 'Encodes any Unicode text (Persian, emoji included) to standard and URL-safe Base64 using UTF-8.',
  },
  usage: { fa: 'متن موردنظر را ارسال کنید.', en: 'Send the text to encode.' },
  example: { fa: 'ورودی: DevNet\nخروجی: RGV2TmV0', en: 'Input: DevNet\nOutput: RGV2TmV0' },
  limitations: {
    fa: 'حداکثر ۸۰۰۰ کاراکتر. برای فایل باینری مناسب نیست.',
    en: 'Max 8000 characters. Not intended for binary files.',
  },
  run: (input, ctx) => {
    const standard = base64Encode(input);
    const urlSafe = standard.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    const fa = ctx.lang === 'fa';
    return {
      html:
        `${fa ? '🔹 <b>استاندارد</b>' : '🔹 <b>Standard</b>'}\n${codeBlock(standard)}\n` +
        `${fa ? '🔹 <b>URL-safe</b>' : '🔹 <b>URL-safe</b>'}\n${codeBlock(urlSafe)}\n` +
        `${DIVIDER}\n📦 ${formatBytes(utf8Length(input))} → ${formatBytes(standard.length)}`,
    };
  },
});

export const base64DecodeTool = defineTool({
  id: 'base64_decode',
  category: 'programming',
  icon: '🔠',
  quick: true,
  needsInput: true,
  title: { fa: 'رمزگشایی Base64', en: 'Base64 Decode' },
  description: {
    fa: 'رشته‌ی Base64 استاندارد یا URL-safe را به متن UTF-8 برمی‌گرداند و padding را خودکار اصلاح می‌کند.',
    en: 'Decodes standard or URL-safe Base64 back to UTF-8 text, fixing padding automatically.',
  },
  usage: { fa: 'رشته‌ی Base64 را ارسال کنید.', en: 'Send the Base64 string.' },
  example: { fa: 'ورودی: RGV2TmV0\nخروجی: DevNet', en: 'Input: RGV2TmV0\nOutput: DevNet' },
  limitations: {
    fa: 'اگر داده باینری باشد، نمایش متنی ممکن است ناخوانا شود.',
    en: 'Binary payloads may render as unreadable text.',
  },
  run: (input, ctx) => {
    const decoded = base64Decode(input);
    if (!decoded) {
      throw errInvalidInput('نتیجه‌ی رمزگشایی خالی است.', 'Decoded result is empty.');
    }
    const fa = ctx.lang === 'fa';
    return {
      html: `${codeBlock(decoded)}\n${DIVIDER}\n📦 ${fa ? 'حجم خروجی' : 'Output size'}: ${formatBytes(utf8Length(decoded))}`,
    };
  },
});

export const urlEncodeTool = defineTool({
  id: 'url_encode',
  category: 'programming',
  icon: '🔗',
  needsInput: true,
  title: { fa: 'کدگذاری URL', en: 'URL Encode' },
  description: {
    fa: 'متن را به شکل امن برای استفاده در URL کدگذاری می‌کند؛ هر دو حالت encodeURIComponent و encodeURI نمایش داده می‌شود.',
    en: 'Percent-encodes text for safe use in URLs; shows both encodeURIComponent and encodeURI variants.',
  },
  usage: { fa: 'متن یا آدرس را ارسال کنید.', en: 'Send text or a URL.' },
  example: {
    fa: 'ورودی: a b&c=1\nخروجی: a%20b%26c%3D1',
    en: 'Input: a b&c=1\nOutput: a%20b%26c%3D1',
  },
  limitations: { fa: 'حداکثر ۸۰۰۰ کاراکتر.', en: 'Max 8000 characters.' },
  run: (input, ctx) => {
    const fa = ctx.lang === 'fa';
    return {
      html:
        `${fa ? '🔹 <b>Component</b> (توصیه‌شده)' : '🔹 <b>Component</b> (recommended)'}\n${codeBlock(encodeURIComponent(input))}\n` +
        `🔹 <b>Full URI</b>\n${codeBlock(encodeURI(input))}`,
    };
  },
});

export const urlDecodeTool = defineTool({
  id: 'url_decode',
  category: 'programming',
  icon: '🔓',
  needsInput: true,
  title: { fa: 'رمزگشایی URL', en: 'URL Decode' },
  description: {
    fa: 'رشته‌ی percent-encoded را به متن اصلی برمی‌گرداند و در صورت خرابی توالی‌ها خطای روشن می‌دهد.',
    en: 'Decodes percent-encoded strings back to plain text with a clear error on malformed sequences.',
  },
  usage: { fa: 'رشته‌ی کدشده را ارسال کنید.', en: 'Send the encoded string.' },
  example: { fa: 'ورودی: a%20b\nخروجی: a b', en: 'Input: a%20b\nOutput: a b' },
  limitations: {
    fa: 'توالی‌های ناقص مانند %E0 باعث خطا می‌شوند.',
    en: 'Malformed sequences such as %E0 raise an error.',
  },
  run: (input) => {
    let decoded: string;
    try {
      decoded = decodeURIComponent(input.replace(/\+/g, ' '));
    } catch {
      throw errInvalidInput(
        'رشته‌ی کدشده معتبر نیست (توالی درصدی ناقص).',
        'Malformed percent-encoded sequence.',
      );
    }
    return { html: codeBlock(decoded) };
  },
});

export const htmlEntityTool = defineTool({
  id: 'html_entities',
  category: 'programming',
  icon: '🏷',
  needsInput: true,
  title: { fa: 'تبدیل موجودیت HTML', en: 'HTML Entity Encode/Decode' },
  description: {
    fa: 'کاراکترهای خاص HTML را به موجودیت تبدیل می‌کند و برعکس؛ برای جلوگیری از XSS هنگام درج متن در صفحه مفید است.',
    en: 'Converts special HTML characters to entities and back — useful to prevent XSS when injecting text.',
  },
  usage: {
    fa: 'متن را ارسال کنید. هر دو جهت (encode و decode) نمایش داده می‌شود.',
    en: 'Send text; both encode and decode results are shown.',
  },
  example: {
    fa: 'ورودی: <b>hi</b>\nخروجی: &amp;lt;b&amp;gt;hi&amp;lt;/b&amp;gt;',
    en: 'Input: <b>hi</b>\nOutput: &amp;lt;b&amp;gt;hi&amp;lt;/b&amp;gt;',
  },
  limitations: {
    fa: 'فقط موجودیت‌های رایج نام‌دار و عددی پشتیبانی می‌شوند.',
    en: 'Only common named and numeric entities are supported.',
  },
  run: (input, ctx) => {
    const encoded = input
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
    const named: Record<string, string> = {
      amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', copy: '©', reg: '®',
    };
    const decoded = input
      .replace(/&#x([0-9a-f]+);/gi, (_m, h: string) => String.fromCodePoint(Number.parseInt(h, 16)))
      .replace(/&#(\d+);/g, (_m, d: string) => String.fromCodePoint(Number(d)))
      .replace(/&([a-z]+);/gi, (m, name: string) => named[name.toLowerCase()] ?? m);
    const fa = ctx.lang === 'fa';
    return {
      html:
        `${fa ? '🔹 <b>کدگذاری‌شده</b>' : '🔹 <b>Encoded</b>'}\n${codeBlock(encoded)}\n` +
        `${fa ? '🔹 <b>رمزگشایی‌شده</b>' : '🔹 <b>Decoded</b>'}\n${codeBlock(decoded)}\n` +
        `${DIVIDER}\n${mono(`${input.length} chars`)}`,
    };
  },
});
