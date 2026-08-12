/**
 * Phase 3 — file-based tools: hash comparison of two uploads and image
 * metadata inspection.
 *
 * Both reuse the Phase 2 machinery (`security/fingerprint.ts`,
 * `security/metadata.ts`) rather than re-implementing hashing or EXIF
 * parsing. File bytes are processed in memory and discarded immediately; only
 * hashes and derived facts are ever kept, and only for the length of one
 * comparison.
 */
import { defineTool } from '../types.js';
import { codeBlock, DIVIDER, escapeHtml, formatBytes } from '../../utils/text.js';
import { errInvalidInput } from '../../utils/errors.js';
import { TOOL_FILE_LIMITS } from '../../config/index.js';
import { fingerprint } from '../../security/fingerprint.js';
import { extractMetadata } from '../../security/metadata.js';

// ─── 11. File hash comparison ─────────────────────────────────────────────

/** Reads the pixel dimensions of the common image formats. */
export function imageDimensions(data: Uint8Array): { width: number; height: number } | null {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);

  // PNG: IHDR is always the first chunk, at a fixed offset.
  if (data.length > 24 && data[0] === 0x89 && data[1] === 0x50 && data[2] === 0x4e && data[3] === 0x47) {
    return { width: view.getUint32(16), height: view.getUint32(20) };
  }

  // GIF: little-endian width/height in the logical screen descriptor.
  if (data.length > 10 && data[0] === 0x47 && data[1] === 0x49 && data[2] === 0x46) {
    return { width: view.getUint16(6, true), height: view.getUint16(8, true) };
  }

  // BMP.
  if (data.length > 26 && data[0] === 0x42 && data[1] === 0x4d) {
    return { width: view.getInt32(18, true), height: Math.abs(view.getInt32(22, true)) };
  }

  // WebP (VP8 / VP8L / VP8X).
  if (
    data.length > 30 &&
    data[0] === 0x52 && data[1] === 0x49 && data[2] === 0x46 && data[3] === 0x46 &&
    data[8] === 0x57 && data[9] === 0x45 && data[10] === 0x42 && data[11] === 0x50
  ) {
    const chunk = String.fromCharCode(data[12] ?? 0, data[13] ?? 0, data[14] ?? 0, data[15] ?? 0);
    if (chunk === 'VP8X') {
      const w = 1 + ((data[24] ?? 0) | ((data[25] ?? 0) << 8) | ((data[26] ?? 0) << 16));
      const h = 1 + ((data[27] ?? 0) | ((data[28] ?? 0) << 8) | ((data[29] ?? 0) << 16));
      return { width: w, height: h };
    }
    if (chunk === 'VP8 ') {
      return { width: view.getUint16(26, true) & 0x3fff, height: view.getUint16(28, true) & 0x3fff };
    }
    if (chunk === 'VP8L') {
      const bits = view.getUint32(21, true);
      return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
    }
  }

  // JPEG: walk the segment chain to the SOFn frame header.
  if (data.length > 4 && data[0] === 0xff && data[1] === 0xd8) {
    let offset = 2;
    while (offset + 9 < data.length) {
      if (data[offset] !== 0xff) {
        offset += 1;
        continue;
      }
      const marker = data[offset + 1] ?? 0;
      // SOF0–SOF15, excluding the DHT/JPG/DAC markers that share the range.
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { height: view.getUint16(offset + 5), width: view.getUint16(offset + 7) };
      }
      const length = view.getUint16(offset + 2);
      if (length < 2) break;
      offset += 2 + length;
    }
  }

  return null;
}

export const fileHashCompareTool = defineTool({
  id: 'file_hash_compare',
  category: 'security',
  icon: '🧾',
  needsInput: true,
  title: { fa: 'مقایسه‌ی هش دو فایل', en: 'File Hash Comparison' },
  description: {
    fa: 'دو فایل را یکی پس از دیگری می‌گیرد، برای هرکدام MD5، SHA-1 و SHA-256 محاسبه می‌کند و می‌گوید یکسان‌اند یا نه. برای بررسی سلامت دانلود و تشخیص دستکاری فایل مناسب است.',
    en: 'Takes two files one after the other, computes MD5, SHA-1 and SHA-256 for each, and reports whether they match. Useful for verifying downloads and detecting tampering.',
  },
  usage: {
    fa: 'فایل اول را به‌صورت <b>Document</b> بفرستید، سپس فایل دوم را. نتیجه پس از رسیدن فایل دوم نمایش داده می‌شود.',
    en: 'Send the first file as a <b>Document</b>, then the second one. The verdict appears after the second file arrives.',
  },
  example: {
    fa: 'ورودی: دو فایل ZIP\nخروجی: MATCH ✅ یا NOT MATCH ❌ به‌همراه هر سه هش',
    en: 'Input: two ZIP files\nOutput: MATCH ✅ or NOT MATCH ❌ together with all three hashes',
  },
  limitations: {
    fa: `حداکثر حجم هر فایل ${formatBytes(TOOL_FILE_LIMITS.maxFileBytes)} و محدودیت ۲۰ مگابایتی Bot API. فایل شما ذخیره نمی‌شود؛ فقط هش فایل اول تا رسیدن فایل دوم (حداکثر ۱۵ دقیقه) نگه داشته می‌شود. MD5 و SHA-1 فقط برای مقایسه‌اند و برای تصمیم امنیتی معتبر نیستند.`,
    en: `Each file may be at most ${formatBytes(TOOL_FILE_LIMITS.maxFileBytes)}, within the Bot API's 20 MB ceiling. Your file is never stored; only the first file's hashes are kept until the second arrives (15 minutes maximum). MD5 and SHA-1 are for comparison only, never for security decisions.`,
  },
  file: {
    maxBytes: TOOL_FILE_LIMITS.maxFileBytes,
    pair: true,
    prompt: {
      fa: '📎 فایل <b>اول</b> را به‌صورت Document ارسال کنید.',
      en: '📎 Send the <b>first</b> file as a Document.',
    },
    run: async (file, ctx) => {
      const fa = ctx.lang === 'fa';
      const print = await fingerprint(file.data, { fileName: file.name, mimeType: file.mime });

      if (!ctx.previous) {
        return {
          html:
            `${fa ? '📥 <b>فایل اول دریافت شد</b>' : '📥 <b>First file received</b>'}\n` +
            `📄 <code>${escapeHtml(file.name)}</code> • ${print.sizeLabel}\n` +
            `${DIVIDER}\n${fa ? '⏳ حالا فایل <b>دوم</b> را بفرستید تا مقایسه انجام شود.' : '⏳ Now send the <b>second</b> file to compare.'}`,
          awaiting: {
            name: file.name,
            size: print.size,
            md5: print.md5,
            sha1: print.sha1,
            sha256: print.sha256,
          },
          toast: fa ? 'فایل اول ثبت شد' : 'First file recorded',
        };
      }

      const first = ctx.previous;
      const match = String(first['sha256']) === print.sha256;
      const row = (label: string, a: string, b: string): string =>
        `<b>${label}</b>\n  A: <code>${escapeHtml(a)}</code>\n  B: <code>${escapeHtml(b)}</code>\n  ${a === b ? '✅' : '❌'}`;

      return {
        html:
          (match
            ? `${fa ? '✅ <b>MATCH — دو فایل کاملاً یکسان هستند</b>' : '✅ <b>MATCH — the two files are identical</b>'}`
            : `${fa ? '❌ <b>NOT MATCH — دو فایل متفاوت‌اند</b>' : '❌ <b>NOT MATCH — the files differ</b>'}`) +
          `\n${DIVIDER}\n` +
          `📄 A: <code>${escapeHtml(String(first['name']))}</code> • ${formatBytes(Number(first['size']))}\n` +
          `📄 B: <code>${escapeHtml(file.name)}</code> • ${print.sizeLabel}\n` +
          `${Number(first['size']) === print.size ? '' : `<i>${fa ? '📏 حجم دو فایل هم متفاوت است.' : '📏 The file sizes differ too.'}</i>\n`}` +
          `${DIVIDER}\n` +
          row('SHA-256', String(first['sha256']), print.sha256) +
          '\n' +
          row('SHA-1', String(first['sha1']), print.sha1) +
          '\n' +
          row('MD5', String(first['md5']), print.md5) +
          `\n${DIVIDER}\n<i>${
            fa
              ? 'حکم بر پایه‌ی SHA-256 صادر می‌شود؛ MD5 و SHA-1 فقط برای اطلاع نمایش داده می‌شوند.'
              : 'The verdict is based on SHA-256; MD5 and SHA-1 are shown for information only.'
          }</i>`,
        toast: match ? (fa ? 'یکسان ✅' : 'Match ✅') : fa ? 'متفاوت ❌' : 'No match ❌',
      };
    },
  },
  run: () => {
    // Reached only if the router ever calls the text path for a file tool.
    throw errInvalidInput(
      'این ابزار به فایل نیاز دارد؛ لطفاً یک Document ارسال کنید.',
      'This tool needs a file; please send a Document.',
    );
  },
});

// ─── 12. Image metadata ───────────────────────────────────────────────────

const IMAGE_MIME_PREFIXES = ['image/'] as const;

export const imageMetadataTool = defineTool({
  id: 'image_metadata',
  category: 'utilities',
  icon: '🖼',
  needsInput: true,
  title: { fa: 'بازرس متادیتای تصویر', en: 'Image Metadata Inspector' },
  description: {
    fa: 'نوع واقعی، حجم، ابعاد و قالب تصویر را می‌خواند و متادیتای EXIF شامل تاریخ عکس‌برداری، مدل دوربین، نرم‌افزار، شماره سریال و مختصات GPS را استخراج می‌کند و درباره‌ی داده‌های حریم‌خصوصی هشدار می‌دهد.',
    en: 'Reads the true type, size, dimensions and format of an image and extracts EXIF metadata — capture date, camera model, software, serial numbers and GPS coordinates — warning about anything that leaks privacy.',
  },
  usage: {
    fa: 'تصویر را به‌صورت <b>Document</b> (نه Photo) ارسال کنید.\n<i>نکته: اگر تصویر را به‌صورت Photo بفرستید، تلگرام خودش متادیتا را حذف می‌کند و چیزی برای نمایش نمی‌ماند.</i>',
    en: 'Send the image as a <b>Document</b>, not as a Photo.\n<i>Note: sending it as a Photo makes Telegram strip the metadata, leaving nothing to show.</i>',
  },
  example: {
    fa: 'ورودی: عکس JPEG از دوربین\nخروجی: 4032×3024 • Apple iPhone 13 • 2024-05-02 • ⚠️ مختصات GPS پیدا شد',
    en: 'Input: a JPEG straight from a camera\nOutput: 4032×3024 • Apple iPhone 13 • 2024-05-02 • ⚠️ GPS coordinates found',
  },
  limitations: {
    fa: `حداکثر ${formatBytes(TOOL_FILE_LIMITS.maxFileBytes)}. استخراج EXIF برای JPEG، TIFF و PNG انجام می‌شود؛ ابعاد برای JPEG، PNG، GIF، BMP و WebP خوانده می‌شود. فایل شما ذخیره نمی‌شود.`,
    en: `Max ${formatBytes(TOOL_FILE_LIMITS.maxFileBytes)}. EXIF extraction covers JPEG, TIFF and PNG; dimensions are read for JPEG, PNG, GIF, BMP and WebP. Your file is never stored.`,
  },
  file: {
    maxBytes: TOOL_FILE_LIMITS.maxFileBytes,
    accept: IMAGE_MIME_PREFIXES,
    prompt: {
      fa: '🖼 تصویر را به‌صورت <b>Document</b> ارسال کنید (نه Photo، وگرنه تلگرام متادیتا را حذف می‌کند).',
      en: '🖼 Send the image as a <b>Document</b> (not a Photo — Telegram strips metadata from photos).',
    },
    run: async (file, ctx) => {
      const fa = ctx.lang === 'fa';
      const print = await fingerprint(file.data, { fileName: file.name, mimeType: file.mime });
      const detectedMime = print.detected?.mime ?? file.mime;

      if (!detectedMime.startsWith('image/')) {
        throw errInvalidInput(
          `محتوای فایل تصویر نیست (نوع تشخیص‌داده‌شده: ${print.detected?.label ?? 'ناشناخته'}).`,
          `The file content is not an image (detected type: ${print.detected?.label ?? 'unknown'}).`,
        );
      }

      const dimensions = imageDimensions(file.data);
      const metadata = extractMetadata(file.data, detectedMime);

      const basics = [
        `• <b>${fa ? 'نام' : 'Name'}</b>: <code>${escapeHtml(file.name)}</code>`,
        `• <b>${fa ? 'نوع واقعی' : 'Detected type'}</b>: ${escapeHtml(print.detected?.label ?? '—')} (${escapeHtml(detectedMime)})`,
        file.mime && file.mime !== detectedMime
          ? `• <b>${fa ? 'نوع اعلام‌شده' : 'Declared type'}</b>: ${escapeHtml(file.mime)} ⚠️`
          : '',
        `• <b>${fa ? 'حجم' : 'Size'}</b>: ${print.sizeLabel}`,
        dimensions
          ? `• <b>${fa ? 'ابعاد' : 'Dimensions'}</b>: ${dimensions.width} × ${dimensions.height} px (${(
              (dimensions.width * dimensions.height) /
              1_000_000
            ).toFixed(1)} MP)`
          : `• <b>${fa ? 'ابعاد' : 'Dimensions'}</b>: ${fa ? 'قابل خواندن نبود' : 'could not be read'}`,
        `• <b>SHA-256</b>: <code>${escapeHtml(print.sha256.slice(0, 32))}…</code>`,
      ]
        .filter(Boolean)
        .join('\n');

      const sensitive = metadata.items.filter((item) => item.sensitive);
      const ordinary = metadata.items.filter((item) => !item.sensitive);

      const renderItems = (items: typeof metadata.items): string =>
        items
          .slice(0, 20)
          .map((item) => `• <b>${escapeHtml(fa ? item.label.fa : item.label.en)}</b>: <code>${escapeHtml(String(item.value).slice(0, 90))}</code>`)
          .join('\n');

      const gpsBlock = metadata.gps
        ? `\n${DIVIDER}\n${fa ? '📍 <b>مختصات GPS پیدا شد</b>' : '📍 <b>GPS coordinates found</b>'}\n` +
          codeBlock(
            `${metadata.gps.latitude.toFixed(6)}, ${metadata.gps.longitude.toFixed(6)}` +
              (metadata.gps.altitude !== undefined ? `  (alt ${metadata.gps.altitude.toFixed(1)} m)` : ''),
          ) +
          `🗺 <a href="https://www.openstreetmap.org/?mlat=${metadata.gps.latitude}&mlon=${metadata.gps.longitude}#map=16/${metadata.gps.latitude}/${metadata.gps.longitude}">${
            fa ? 'نمایش روی نقشه' : 'View on map'
          }</a>\n` +
          `<b>⚠️ ${
            fa
              ? 'این تصویر محل دقیق عکس‌برداری را فاش می‌کند. پیش از انتشار عمومی، متادیتا را حذف کنید.'
              : 'This image reveals exactly where it was taken. Strip the metadata before publishing it.'
          }</b>`
        : '';

      const privacyNote = sensitive.length
        ? `\n${DIVIDER}\n${fa ? '🔒 <b>هشدار حریم خصوصی</b>' : '🔒 <b>Privacy warning</b>'}\n` +
          (fa
            ? `${sensitive.length} قلم داده‌ی حساس در این تصویر هست. با ابزارهایی مثل <code>exiftool -all= image.jpg</code> یا با ارسال تصویر به‌صورت Photo در تلگرام می‌توانید آن‌ها را پاک کنید.`
            : `This image carries ${sensitive.length} sensitive item(s). Remove them with a tool such as <code>exiftool -all= image.jpg</code>, or by sending the image as a Telegram Photo.`)
        : `\n${DIVIDER}\n${
            fa
              ? '✅ داده‌ی حساسی در متادیتا پیدا نشد.'
              : '✅ No sensitive metadata was found.'
          }`;

      return {
        html:
          `${fa ? '🖼 <b>مشخصات تصویر</b>' : '🖼 <b>Image properties</b>'}\n${basics}\n` +
          (sensitive.length
            ? `${DIVIDER}\n${fa ? '⚠️ <b>متادیتای حساس</b>' : '⚠️ <b>Sensitive metadata</b>'}\n${renderItems(sensitive)}\n`
            : '') +
          (ordinary.length
            ? `${DIVIDER}\n${fa ? 'ℹ️ <b>سایر متادیتا</b>' : 'ℹ️ <b>Other metadata</b>'}\n${renderItems(ordinary)}`
            : `${DIVIDER}\n<i>${fa ? 'هیچ متادیتای EXIF در این فایل نبود.' : 'This file contains no EXIF metadata.'}</i>`) +
          gpsBlock +
          privacyNote +
          `\n<i>🔐 ${
            fa
              ? 'فایل شما فقط در حافظه پردازش شد و ذخیره نشده است.'
              : 'Your file was processed in memory only and has not been stored.'
          }</i>`,
        ...(metadata.gps ? { toast: fa ? '⚠️ مختصات GPS پیدا شد' : '⚠️ GPS coordinates found' } : {}),
      };
    },
  },
  run: () => {
    throw errInvalidInput(
      'این ابزار به فایل نیاز دارد؛ لطفاً تصویر را به‌صورت Document ارسال کنید.',
      'This tool needs a file; please send the image as a Document.',
    );
  },
});

/** Exported for the registry's file-tool assertions and for tests. */
export const FILE_TOOL_IDS = [fileHashCompareTool.id, imageMetadataTool.id] as const;

