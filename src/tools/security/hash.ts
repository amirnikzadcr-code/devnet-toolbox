import { defineTool } from '../types.js';
import { codeBlock, DIVIDER } from '../../utils/text.js';
import { digestHex, md5 } from '../../utils/hash.js';
import { base64Encode } from '../../utils/encoding.js';

const WEAK_NOTE = {
  fa: '\n⚠️ MD5 و SHA-1 از نظر رمزنگاری شکسته‌اند و فقط برای بررسی یکپارچگی داده‌های غیرحساس مناسب‌اند.',
  en: '\n⚠️ MD5 and SHA-1 are cryptographically broken; use them only for non-security checksums.',
};

export const hashAllTool = defineTool({
  id: 'hash_all',
  category: 'security',
  icon: '#️⃣',
  quick: true,
  needsInput: true,
  title: { fa: 'تولید هش (چندالگوریتمی)', en: 'Hash Generator' },
  description: {
    fa: 'هش متن ورودی را هم‌زمان با MD5، SHA-1، SHA-256، SHA-384 و SHA-512 محاسبه می‌کند. الگوریتم‌های SHA از WebCrypto بومی و MD5 از پیاده‌سازی داخلی استفاده می‌کنند.',
    en: 'Computes MD5, SHA-1, SHA-256, SHA-384 and SHA-512 digests of the input at once, using native WebCrypto for SHA family.',
  },
  usage: { fa: 'متن موردنظر را ارسال کنید.', en: 'Send the text to hash.' },
  example: {
    fa: 'ورودی: abc\nSHA-256: ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    en: 'Input: abc\nSHA-256: ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
  },
  limitations: {
    fa: 'هش کردن فایل پشتیبانی نمی‌شود (فقط متن). MD5 و SHA-1 برای امنیت مناسب نیستند.',
    en: 'Text only (no file hashing). MD5/SHA-1 are unsuitable for security purposes.',
  },
  run: async (input, ctx) => {
    const [sha1, sha256, sha384, sha512] = await Promise.all([
      digestHex('SHA-1', input),
      digestHex('SHA-256', input),
      digestHex('SHA-384', input),
      digestHex('SHA-512', input),
    ]);
    const fa = ctx.lang === 'fa';
    return {
      html:
        `<b>MD5</b>\n${codeBlock(md5(input))}` +
        `<b>SHA-1</b>\n${codeBlock(sha1)}` +
        `<b>SHA-256</b>\n${codeBlock(sha256)}` +
        `<b>SHA-384</b>\n${codeBlock(sha384)}` +
        `<b>SHA-512</b>\n${codeBlock(sha512)}` +
        `${DIVIDER}${fa ? WEAK_NOTE.fa : WEAK_NOTE.en}`,
    };
  },
});

function singleHash(
  id: string,
  algo: 'MD5' | 'SHA-1' | 'SHA-256',
  icon: string,
  desc: { fa: string; en: string },
  quick = false,
) {
  return defineTool({
    id,
    category: 'security',
    icon,
    quick,
    needsInput: true,
    title: { fa: `هش ${algo}`, en: `${algo} Hash` },
    description: desc,
    usage: { fa: 'متن موردنظر را ارسال کنید.', en: 'Send the text to hash.' },
    example:
      algo === 'SHA-256'
        ? {
            fa: 'ورودی: abc\nخروجی: ba7816bf…f20015ad (64 کاراکتر hex)',
            en: 'Input: abc\nOutput: ba7816bf…f20015ad (64 hex chars)',
          }
        : algo === 'SHA-1'
          ? {
              fa: 'ورودی: abc\nخروجی: a9993e364706816aba3e25717850c26c9cd0d89d',
              en: 'Input: abc\nOutput: a9993e364706816aba3e25717850c26c9cd0d89d',
            }
          : {
              fa: 'ورودی: abc\nخروجی: 900150983cd24fb0d6963f7d28e17f72',
              en: 'Input: abc\nOutput: 900150983cd24fb0d6963f7d28e17f72',
            },
    limitations:
      algo === 'SHA-256'
        ? { fa: 'فقط متن (نه فایل). حداکثر ۸۰۰۰ کاراکتر.', en: 'Text only (no files). Max 8000 characters.' }
        : {
            fa: 'این الگوریتم از نظر رمزنگاری شکسته است و نباید برای امنیت استفاده شود.',
            en: 'This algorithm is cryptographically broken and must not be used for security.',
          },
    run: async (input, ctx) => {
      const hex = algo === 'MD5' ? md5(input) : await digestHex(algo, input);
      const fa = ctx.lang === 'fa';
      const b64 = base64Encode(hex);
      return {
        html:
          `<b>${algo} (hex)</b>\n${codeBlock(hex)}` +
          `<b>${algo} (base64 of hex)</b>\n${codeBlock(b64)}` +
          `${DIVIDER}\n${fa ? 'طول' : 'Length'}: ${hex.length} hex chars` +
          (algo === 'SHA-256' ? '' : fa ? WEAK_NOTE.fa : WEAK_NOTE.en),
      };
    },
  });
}

export const sha256Tool = singleHash(
  'sha256',
  'SHA-256',
  '🔒',
  {
    fa: 'هش SHA-256 ورودی را با WebCrypto بومی Cloudflare محاسبه می‌کند؛ استاندارد پیشنهادی برای امضا، checksum و ذخیره‌سازی امن اثر انگشت داده.',
    en: 'Computes a SHA-256 digest using native WebCrypto — the recommended standard for signatures, checksums and data fingerprints.',
  },
  true,
);

export const sha1Tool = singleHash('sha1', 'SHA-1', '🔓', {
  fa: 'هش SHA-1 ورودی را محاسبه می‌کند. صرفاً برای سازگاری با سیستم‌های قدیمی (مانند Git object id) ارائه شده است.',
  en: 'Computes a SHA-1 digest, provided only for legacy compatibility (e.g. Git object ids).',
});

export const md5Tool = singleHash('md5', 'MD5', '🧮', {
  fa: 'هش MD5 ورودی را محاسبه می‌کند. مناسب برای مقایسه‌ی checksum فایل‌های غیرحساس و سیستم‌های قدیمی.',
  en: 'Computes an MD5 digest, suitable for non-sensitive checksum comparison and legacy systems.',
});
