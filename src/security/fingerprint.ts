/**
 * File Fingerprinting (requirement 4).
 *
 * Computes SHA-256 / SHA-1 / MD5, size, and detects the true file type from
 * magic bytes — then compares that against the extension and the MIME type
 * Telegram reported, because a mismatch is itself a security signal.
 */
import { digestHexBytes, md5Bytes } from '../utils/hash.js';
import { formatBytes } from '../utils/text.js';
import type { Finding } from './types.js';

export interface MagicSignature {
  /** Detected canonical type, e.g. `apk`, `png`, `pdf`. */
  type: string;
  mime: string;
  label: string;
  /** Typical extensions for this type. */
  extensions: string[];
}

interface MagicRule extends MagicSignature {
  offset: number;
  bytes: number[];
  /** Optional secondary check for container formats (ZIP → APK/DOCX/JAR). */
  refine?: (data: Uint8Array) => MagicSignature | null;
}

const ascii = (text: string): number[] => [...text].map((char) => char.charCodeAt(0));

/** Searches for an ASCII needle in the first `limit` bytes. */
export function findAscii(data: Uint8Array, needle: string, limit = data.length): boolean {
  const pattern = ascii(needle);
  const end = Math.min(data.length, limit) - pattern.length;
  outer: for (let i = 0; i <= end; i += 1) {
    for (let j = 0; j < pattern.length; j += 1) {
      if (data[i + j] !== pattern[j]) continue outer;
    }
    return true;
  }
  return false;
}

/** A ZIP container can be an APK, a JAR, an OOXML document or a plain archive. */
function refineZip(data: Uint8Array): MagicSignature | null {
  // Scan a generous window: local file headers list entry names in clear text.
  const window = Math.min(data.length, 512 * 1024);
  if (findAscii(data, 'AndroidManifest.xml', window) || findAscii(data, 'classes.dex', window)) {
    return { type: 'apk', mime: 'application/vnd.android.package-archive', label: 'Android APK', extensions: ['apk'] };
  }
  if (findAscii(data, 'word/document.xml', window)) {
    return {
      type: 'docx',
      mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      label: 'Word document',
      extensions: ['docx'],
    };
  }
  if (findAscii(data, 'xl/workbook.xml', window)) {
    return {
      type: 'xlsx',
      mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      label: 'Excel workbook',
      extensions: ['xlsx'],
    };
  }
  if (findAscii(data, 'META-INF/MANIFEST.MF', window)) {
    return { type: 'jar', mime: 'application/java-archive', label: 'Java archive', extensions: ['jar'] };
  }
  return { type: 'zip', mime: 'application/zip', label: 'ZIP archive', extensions: ['zip'] };
}

const MAGIC_RULES: MagicRule[] = [
  {
    offset: 0,
    bytes: [0x50, 0x4b, 0x03, 0x04],
    type: 'zip',
    mime: 'application/zip',
    label: 'ZIP archive',
    extensions: ['zip'],
    refine: refineZip,
  },
  { offset: 0, bytes: [0x50, 0x4b, 0x05, 0x06], type: 'zip', mime: 'application/zip', label: 'ZIP archive (empty)', extensions: ['zip'], refine: refineZip },
  { offset: 0, bytes: [0x64, 0x65, 0x78, 0x0a], type: 'dex', mime: 'application/octet-stream', label: 'Dalvik executable', extensions: ['dex'] },
  { offset: 0, bytes: [0x25, 0x50, 0x44, 0x46], type: 'pdf', mime: 'application/pdf', label: 'PDF document', extensions: ['pdf'] },
  { offset: 0, bytes: [0xff, 0xd8, 0xff], type: 'jpeg', mime: 'image/jpeg', label: 'JPEG image', extensions: ['jpg', 'jpeg'] },
  { offset: 0, bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], type: 'png', mime: 'image/png', label: 'PNG image', extensions: ['png'] },
  { offset: 0, bytes: ascii('GIF87a'), type: 'gif', mime: 'image/gif', label: 'GIF image', extensions: ['gif'] },
  { offset: 0, bytes: ascii('GIF89a'), type: 'gif', mime: 'image/gif', label: 'GIF image', extensions: ['gif'] },
  { offset: 0, bytes: [0x49, 0x49, 0x2a, 0x00], type: 'tiff', mime: 'image/tiff', label: 'TIFF image (little-endian)', extensions: ['tif', 'tiff'] },
  { offset: 0, bytes: [0x4d, 0x4d, 0x00, 0x2a], type: 'tiff', mime: 'image/tiff', label: 'TIFF image (big-endian)', extensions: ['tif', 'tiff'] },
  { offset: 0, bytes: [0x42, 0x4d], type: 'bmp', mime: 'image/bmp', label: 'BMP image', extensions: ['bmp'] },
  { offset: 8, bytes: ascii('WEBP'), type: 'webp', mime: 'image/webp', label: 'WebP image', extensions: ['webp'] },
  { offset: 0, bytes: [0x7f, 0x45, 0x4c, 0x46], type: 'elf', mime: 'application/x-executable', label: 'ELF binary', extensions: ['so', 'elf'] },
  { offset: 0, bytes: [0x4d, 0x5a], type: 'pe', mime: 'application/vnd.microsoft.portable-executable', label: 'Windows PE executable', extensions: ['exe', 'dll'] },
  { offset: 0, bytes: [0x1f, 0x8b], type: 'gzip', mime: 'application/gzip', label: 'GZIP archive', extensions: ['gz'] },
  { offset: 0, bytes: ascii('%!PS'), type: 'ps', mime: 'application/postscript', label: 'PostScript', extensions: ['ps'] },
  { offset: 0, bytes: [0x52, 0x61, 0x72, 0x21], type: 'rar', mime: 'application/vnd.rar', label: 'RAR archive', extensions: ['rar'] },
  { offset: 0, bytes: [0xfd, 0x37, 0x7a, 0x58, 0x5a], type: 'xz', mime: 'application/x-xz', label: 'XZ archive', extensions: ['xz'] },
  { offset: 0, bytes: ascii('OggS'), type: 'ogg', mime: 'audio/ogg', label: 'OGG media', extensions: ['ogg'] },
  { offset: 0, bytes: [0x49, 0x44, 0x33], type: 'mp3', mime: 'audio/mpeg', label: 'MP3 audio', extensions: ['mp3'] },
  { offset: 4, bytes: ascii('ftyp'), type: 'mp4', mime: 'video/mp4', label: 'MP4 container', extensions: ['mp4', 'm4a', 'mov'] },
];

const startsWith = (data: Uint8Array, offset: number, bytes: number[]): boolean => {
  if (data.length < offset + bytes.length) return false;
  for (let i = 0; i < bytes.length; i += 1) if (data[offset + i] !== bytes[i]) return false;
  return true;
};

/** Detects the true type from content. Returns null when nothing matches. */
export function detectMagic(data: Uint8Array): MagicSignature | null {
  for (const rule of MAGIC_RULES) {
    if (!startsWith(data, rule.offset, rule.bytes)) continue;
    if (rule.refine) {
      const refined = rule.refine(data);
      if (refined) return refined;
    }
    return { type: rule.type, mime: rule.mime, label: rule.label, extensions: rule.extensions };
  }
  // Heuristic: printable-ASCII-dominant content with no signature is text.
  const sample = data.subarray(0, Math.min(data.length, 512));
  if (sample.length > 0) {
    let printable = 0;
    for (const byte of sample) {
      if (byte === 0x09 || byte === 0x0a || byte === 0x0d || (byte >= 0x20 && byte <= 0x7e) || byte >= 0x80) printable += 1;
    }
    if (printable / sample.length > 0.95) {
      return { type: 'text', mime: 'text/plain', label: 'Plain text', extensions: ['txt', 'json', 'md', 'csv'] };
    }
  }
  return null;
}

/** First N bytes as a spaced hex string, for the evidence line. */
export function magicHex(data: Uint8Array, count = 8): string {
  return [...data.subarray(0, count)].map((byte) => byte.toString(16).padStart(2, '0')).join(' ');
}

export interface Fingerprint {
  sha256: string;
  sha1: string;
  md5: string;
  size: number;
  sizeLabel: string;
  /** Type detected from content (authoritative). */
  detected: MagicSignature | null;
  /** MIME as claimed by the uploader/Telegram. */
  claimedMime?: string;
  claimedName?: string;
  magicBytes: string;
}

export async function fingerprint(
  data: Uint8Array,
  meta: { fileName?: string; mimeType?: string } = {},
): Promise<Fingerprint> {
  const [sha256, sha1] = await Promise.all([
    digestHexBytes('SHA-256', data),
    digestHexBytes('SHA-1', data),
  ]);
  return {
    sha256,
    sha1,
    md5: md5Bytes(data),
    size: data.length,
    sizeLabel: formatBytes(data.length),
    detected: detectMagic(data),
    ...(meta.mimeType ? { claimedMime: meta.mimeType } : {}),
    ...(meta.fileName ? { claimedName: meta.fileName } : {}),
    magicBytes: magicHex(data),
  };
}

const extensionOf = (name?: string): string | null => {
  if (!name) return null;
  const match = /\.([A-Za-z0-9]{1,8})$/.exec(name.trim());
  return match?.[1] ? match[1].toLowerCase() : null;
};

/**
 * Flags disagreement between the declared identity of a file and its actual
 * content — a classic delivery trick (`invoice.pdf` that is really an APK).
 */
export function integrityFindings(print: Fingerprint): Finding[] {
  const findings: Finding[] = [];
  const detected = print.detected;
  const extension = extensionOf(print.claimedName);

  if (!detected) {
    findings.push({
      id: 'file.magic.unknown',
      category: 'integrity',
      severity: 'low',
      confidence: 60,
      title: { fa: 'نوع فایل از روی محتوا شناسایی نشد', en: 'File type not recognised from content' },
      evidence: [`magic bytes: ${print.magicBytes}`],
      explanation: {
        fa: 'هیچ امضای شناخته‌شده‌ای در ابتدای فایل پیدا نشد. این می‌تواند یک قالب نامتعارف، فایل رمزشده یا داده‌ی دستکاری‌شده باشد.',
        en: 'No known signature was found at the start of the file. This may be an uncommon format, an encrypted blob, or tampered data.',
      },
      recommendation: {
        fa: 'اگر منبع فایل نامطمئن است، آن را باز نکنید.',
        en: 'Do not open the file if its source is untrusted.',
      },
    });
    return findings;
  }

  if (extension && !detected.extensions.includes(extension)) {
    // Severity depends on *what the file really is*, not merely that the label
    // is wrong. `photo.png` holding a JPEG is a naming slip; `invoice.pdf`
    // holding an installable package is the standard malware delivery route,
    // and the two must not share a severity.
    const executableTypes = new Set(['apk', 'pe', 'elf', 'dex', 'jar', 'msi', 'dmg', 'class']);
    const documentExtensions = new Set([
      'pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'txt', 'rtf', 'csv',
      'jpg', 'jpeg', 'png', 'gif', 'mp3', 'mp4',
    ]);
    const disguisedExecutable = executableTypes.has(detected.type) && documentExtensions.has(extension);
    // Same broad family — a mislabel here is careless, not hostile.
    const sameFamily =
      (detected.type === 'jpeg' && ['png', 'gif', 'webp', 'bmp'].includes(extension)) ||
      (detected.type === 'png' && ['jpg', 'jpeg', 'gif', 'webp', 'bmp'].includes(extension)) ||
      (detected.type === 'zip' && ['apk', 'jar', 'docx', 'xlsx', 'pptx', 'epub'].includes(extension));

    findings.push({
      id: 'file.extension.mismatch',
      category: 'integrity',
      severity: disguisedExecutable ? 'high' : sameFamily ? 'low' : 'medium',
      confidence: disguisedExecutable ? 95 : 90,
      title: disguisedExecutable
        ? { fa: 'کد اجرایی که به‌شکل یک سند جا زده شده است', en: 'Executable code disguised as a document' }
        : { fa: 'پسوند فایل با محتوای واقعی هم‌خوانی ندارد', en: 'File extension does not match actual content' },
      evidence: [`extension: .${extension}`, `detected: ${detected.label} (${detected.type})`, `magic bytes: ${print.magicBytes}`],
      explanation: disguisedExecutable
        ? {
            fa: `این فایل با پسوند «.${extension}» فرستاده شده تا مانند یک سند بی‌خطر به نظر برسد، اما محتوای واقعی آن «${detected.label}» است — یعنی کد قابل نصب یا اجرا. نرم‌افزار سالم با پسوند واقعی خودش توزیع می‌شود؛ این کار دقیقاً برای فریب کاربر و عبور از فیلترهای ساده انجام می‌شود.`,
            en: `The file was sent as ".${extension}" so it would look like a harmless document, but its real content is ${detected.label} — installable or executable code. Genuine software ships with its true extension; this is precisely the technique used to deceive users and slip past simple filters.`,
          }
        : {
            fa: `فایل با پسوند «.${extension}» ارسال شده اما محتوای آن در واقع «${detected.label}» است. گاهی نتیجه‌ی نام‌گذاری اشتباه است، اما می‌تواند تلاشی برای پنهان کردن نوع واقعی فایل هم باشد.`,
            en: `The file was sent as ".${extension}" but its content is actually ${detected.label}. Sometimes this is careless naming, but it can also be an attempt to hide the real file type.`,
          },
      recommendation: disguisedExecutable
        ? {
            fa: 'این فایل را نصب یا اجرا نکنید. اگر از طریق پیام یا لینک دریافت شده، آن را حذف کنید.',
            en: 'Do not install or run this file. If it arrived via a message or link, delete it.',
          }
        : {
            fa: 'فایل را با همان نوع واقعی‌اش بررسی کنید و از منبع ارسال‌کننده مطمئن شوید.',
            en: 'Treat the file as its real type and verify the sender.',
          },
    });
  }

  if (print.claimedMime && detected.mime !== print.claimedMime && detected.type !== 'text') {
    findings.push({
      id: 'file.mime.mismatch',
      category: 'integrity',
      severity: 'low',
      confidence: 75,
      title: { fa: 'MIME اعلام‌شده با محتوا هم‌خوانی ندارد', en: 'Declared MIME type does not match content' },
      evidence: [`declared: ${print.claimedMime}`, `detected: ${detected.mime}`],
      explanation: {
        fa: 'نوع MIME که هنگام آپلود اعلام شده با نوع واقعی محتوا تفاوت دارد. گاهی طبیعی است، اما می‌تواند نشانه‌ی پنهان‌سازی هم باشد.',
        en: 'The MIME type declared at upload time differs from the detected content type. Often benign, but it can indicate deliberate concealment.',
      },
    });
  }

  if (detected.type === 'pe' || detected.type === 'elf') {
    findings.push({
      id: 'file.executable',
      category: 'integrity',
      severity: 'medium',
      confidence: 95,
      title: { fa: 'فایل یک باینری اجرایی است', en: 'File is an executable binary' },
      evidence: [detected.label],
      explanation: {
        fa: 'این فایل کد اجرایی بومی است. اجرای آن از منبع نامطمئن می‌تواند سیستم شما را در معرض خطر قرار دهد.',
        en: 'This file is native executable code. Running it from an untrusted source can compromise your system.',
      },
      recommendation: {
        fa: 'فایل‌های اجرایی را فقط از منابع رسمی دریافت و امضای دیجیتال آن‌ها را بررسی کنید.',
        en: 'Only obtain executables from official sources and verify their digital signatures.',
      },
    });
  }

  return findings;
}
