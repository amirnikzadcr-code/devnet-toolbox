/**
 * Metadata Privacy Scanner (requirement 8).
 *
 * Parses EXIF (JPEG/TIFF), PNG text chunks and PDF document info to surface
 * data users do not know they are sharing: GPS coordinates, device serials,
 * owner names, and the software that produced the file.
 *
 * The parser is written from scratch against the format specs — no external
 * dependency — because the Worker bundle must stay small and dependency-free.
 */
import type { Finding, Severity } from './types.js';

export interface MetadataItem {
  key: string;
  value: string;
  /** Sensitive items are flagged prominently in the report. */
  sensitive: boolean;
  label: { fa: string; en: string };
}

export interface MetadataResult {
  items: MetadataItem[];
  findings: Finding[];
  /** Populated when GPS tags are present. */
  gps?: { latitude: number; longitude: number; altitude?: number };
  format: string;
}

// ─── EXIF tag tables ──────────────────────────────────────────────────────

const IFD0_TAGS: Record<number, { key: string; fa: string; en: string; sensitive: boolean }> = {
  0x010f: { key: 'Make', fa: 'سازنده دستگاه', en: 'Device manufacturer', sensitive: true },
  0x0110: { key: 'Model', fa: 'مدل دستگاه', en: 'Device model', sensitive: true },
  0x0131: { key: 'Software', fa: 'نرم‌افزار', en: 'Software', sensitive: true },
  0x0132: { key: 'DateTime', fa: 'تاریخ تغییر', en: 'Modification date', sensitive: true },
  0x013b: { key: 'Artist', fa: 'پدیدآورنده', en: 'Artist / author', sensitive: true },
  0x8298: { key: 'Copyright', fa: 'حق نشر', en: 'Copyright', sensitive: false },
  0x010e: { key: 'ImageDescription', fa: 'توضیح تصویر', en: 'Image description', sensitive: false },
  0x0112: { key: 'Orientation', fa: 'جهت تصویر', en: 'Orientation', sensitive: false },
  0x011a: { key: 'XResolution', fa: 'وضوح افقی', en: 'X resolution', sensitive: false },
  0x011b: { key: 'YResolution', fa: 'وضوح عمودی', en: 'Y resolution', sensitive: false },
};

const EXIF_TAGS: Record<number, { key: string; fa: string; en: string; sensitive: boolean }> = {
  0x9003: { key: 'DateTimeOriginal', fa: 'تاریخ اصلی عکس‌برداری', en: 'Original capture date', sensitive: true },
  0x9004: { key: 'DateTimeDigitized', fa: 'تاریخ دیجیتالی‌سازی', en: 'Digitised date', sensitive: true },
  0xa430: { key: 'CameraOwnerName', fa: 'نام مالک دوربین', en: 'Camera owner name', sensitive: true },
  0xa431: { key: 'BodySerialNumber', fa: 'شماره سریال بدنه دوربین', en: 'Camera body serial number', sensitive: true },
  0xa433: { key: 'LensMake', fa: 'سازنده لنز', en: 'Lens manufacturer', sensitive: false },
  0xa434: { key: 'LensModel', fa: 'مدل لنز', en: 'Lens model', sensitive: false },
  0xa435: { key: 'LensSerialNumber', fa: 'شماره سریال لنز', en: 'Lens serial number', sensitive: true },
  0x829a: { key: 'ExposureTime', fa: 'زمان نوردهی', en: 'Exposure time', sensitive: false },
  0x829d: { key: 'FNumber', fa: 'عدد دیافراگم', en: 'F-number', sensitive: false },
  0x8827: { key: 'ISOSpeedRatings', fa: 'حساسیت ISO', en: 'ISO speed', sensitive: false },
  0x920a: { key: 'FocalLength', fa: 'فاصله کانونی', en: 'Focal length', sensitive: false },
  0xa002: { key: 'PixelXDimension', fa: 'عرض تصویر', en: 'Image width', sensitive: false },
  0xa003: { key: 'PixelYDimension', fa: 'ارتفاع تصویر', en: 'Image height', sensitive: false },
  0x9286: { key: 'UserComment', fa: 'یادداشت کاربر', en: 'User comment', sensitive: true },
};

const GPS_TAGS: Record<number, string> = {
  0x0000: 'GPSVersionID',
  0x0001: 'GPSLatitudeRef',
  0x0002: 'GPSLatitude',
  0x0003: 'GPSLongitudeRef',
  0x0004: 'GPSLongitude',
  0x0005: 'GPSAltitudeRef',
  0x0006: 'GPSAltitude',
  0x0007: 'GPSTimeStamp',
  0x0012: 'GPSMapDatum',
  0x001d: 'GPSDateStamp',
};

/** Bytes per EXIF component type, indexed by the type id. */
const TYPE_SIZE: Record<number, number> = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 6: 1, 7: 1, 8: 2, 9: 4, 10: 8, 11: 4, 12: 8 };

interface TiffValue {
  tag: number;
  type: number;
  value: string | number | number[];
}

/** Reads one IFD and returns its entries plus any sub-IFD pointers. */
function readIfd(
  view: DataView,
  tiffStart: number,
  ifdOffset: number,
  little: boolean,
): { entries: TiffValue[]; subIfds: Map<number, number> } {
  const entries: TiffValue[] = [];
  const subIfds = new Map<number, number>();
  const base = tiffStart + ifdOffset;
  if (base + 2 > view.byteLength) return { entries, subIfds };

  const count = view.getUint16(base, little);
  if (count > 512) return { entries, subIfds }; // corrupt or hostile

  for (let i = 0; i < count; i++) {
    const entry = base + 2 + i * 12;
    if (entry + 12 > view.byteLength) break;

    const tag = view.getUint16(entry, little);
    const type = view.getUint16(entry + 2, little);
    const componentCount = view.getUint32(entry + 4, little);
    const size = (TYPE_SIZE[type] ?? 0) * componentCount;
    if (size === 0 || componentCount > 65536) continue;

    const valueOffset = size <= 4 ? entry + 8 : tiffStart + view.getUint32(entry + 8, little);
    if (valueOffset < 0 || valueOffset + size > view.byteLength) continue;

    // Sub-IFD pointers: EXIF (0x8769) and GPS (0x8825).
    if (tag === 0x8769 || tag === 0x8825) {
      subIfds.set(tag, view.getUint32(entry + 8, little));
      continue;
    }

    entries.push({ tag, type, value: readValue(view, valueOffset, type, componentCount, little) });
  }

  return { entries, subIfds };
}

function readValue(
  view: DataView,
  offset: number,
  type: number,
  count: number,
  little: boolean,
): string | number | number[] {
  switch (type) {
    case 2: {
      // ASCII string
      let text = '';
      for (let i = 0; i < count && offset + i < view.byteLength; i++) {
        const byte = view.getUint8(offset + i);
        if (byte === 0) break;
        if (byte >= 0x20 && byte < 0x7f) text += String.fromCharCode(byte);
      }
      return text.trim();
    }
    case 1:
    case 6:
      return view.getUint8(offset);
    case 3:
      return view.getUint16(offset, little);
    case 8:
      return view.getInt16(offset, little);
    case 4:
      return view.getUint32(offset, little);
    case 9:
      return view.getInt32(offset, little);
    case 5:
    case 10: {
      // (Signed) rational: numerator/denominator pairs
      const values: number[] = [];
      for (let i = 0; i < count && offset + i * 8 + 8 <= view.byteLength; i++) {
        const numerator = type === 5 ? view.getUint32(offset + i * 8, little) : view.getInt32(offset + i * 8, little);
        const denominator =
          type === 5 ? view.getUint32(offset + i * 8 + 4, little) : view.getInt32(offset + i * 8 + 4, little);
        values.push(denominator === 0 ? 0 : numerator / denominator);
      }
      return values.length === 1 ? (values[0] as number) : values;
    }
    default:
      return '';
  }
}

/** Converts a GPS degrees/minutes/seconds triple into decimal degrees. */
function dmsToDecimal(dms: number[] | number, ref: string): number | null {
  const parts = Array.isArray(dms) ? dms : [dms];
  const degrees = parts[0] ?? 0;
  const minutes = parts[1] ?? 0;
  const seconds = parts[2] ?? 0;
  let decimal = degrees + minutes / 60 + seconds / 3600;
  if (!Number.isFinite(decimal)) return null;
  if (ref === 'S' || ref === 'W') decimal = -decimal;
  return Math.round(decimal * 1e6) / 1e6;
}

/** Locates the TIFF header inside a JPEG APP1 segment. */
function findExifStart(data: Uint8Array): number | null {
  if (data[0] !== 0xff || data[1] !== 0xd8) return null; // not JPEG
  let offset = 2;
  const limit = Math.min(data.length, 512 * 1024);

  while (offset + 4 < limit) {
    if (data[offset] !== 0xff) {
      offset++;
      continue;
    }
    const marker = data[offset + 1] as number;
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      offset += 2;
      continue;
    }
    if (marker === 0xda) break; // start of scan — no metadata past here
    const length = ((data[offset + 2] as number) << 8) | (data[offset + 3] as number);
    if (length < 2) break;

    if (marker === 0xe1) {
      const header = offset + 4;
      // "Exif\0\0"
      if (
        data[header] === 0x45 && data[header + 1] === 0x78 && data[header + 2] === 0x69 &&
        data[header + 3] === 0x66 && data[header + 4] === 0x00
      ) {
        return header + 6;
      }
    }
    offset += 2 + length;
  }
  return null;
}

const label = (fa: string, en: string) => ({ fa, en });

/** Main entry point: dispatches on container format. */
export function extractMetadata(data: Uint8Array, mime: string): MetadataResult {
  if (mime === 'image/jpeg') return extractJpeg(data);
  if (mime === 'image/png') return extractPng(data);
  if (mime === 'application/pdf') return extractPdf(data);
  if (mime === 'image/tiff') return extractTiff(data, 0);
  return { items: [], findings: [], format: mime };
}

function extractJpeg(data: Uint8Array): MetadataResult {
  const tiffStart = findExifStart(data);
  if (tiffStart === null) {
    return { items: [], findings: [], format: 'JPEG (no EXIF)' };
  }
  return extractTiff(data, tiffStart, 'JPEG/EXIF');
}

function extractTiff(data: Uint8Array, tiffStart: number, format = 'TIFF'): MetadataResult {
  const items: MetadataItem[] = [];
  const findings: Finding[] = [];

  if (tiffStart + 8 > data.length) return { items, findings, format };
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);

  const byteOrder = view.getUint16(tiffStart, false);
  const little = byteOrder === 0x4949;
  if (!little && byteOrder !== 0x4d4d) return { items, findings, format };
  if (view.getUint16(tiffStart + 2, little) !== 42) return { items, findings, format };

  const ifd0Offset = view.getUint32(tiffStart + 4, little);
  const ifd0 = readIfd(view, tiffStart, ifd0Offset, little);

  for (const entry of ifd0.entries) {
    const meta = IFD0_TAGS[entry.tag];
    if (!meta || entry.value === '' || entry.value === undefined) continue;
    items.push({
      key: meta.key,
      value: String(entry.value),
      sensitive: meta.sensitive,
      label: label(meta.fa, meta.en),
    });
  }

  const exifOffset = ifd0.subIfds.get(0x8769);
  if (exifOffset !== undefined) {
    const exif = readIfd(view, tiffStart, exifOffset, little);
    for (const entry of exif.entries) {
      const meta = EXIF_TAGS[entry.tag];
      if (!meta || entry.value === '' || entry.value === undefined) continue;
      const value = Array.isArray(entry.value) ? entry.value.join(', ') : String(entry.value);
      items.push({ key: meta.key, value, sensitive: meta.sensitive, label: label(meta.fa, meta.en) });
    }
  }

  // ── GPS
  let gps: MetadataResult['gps'];
  const gpsOffset = ifd0.subIfds.get(0x8825);
  if (gpsOffset !== undefined) {
    const gpsIfd = readIfd(view, tiffStart, gpsOffset, little);
    const byTag = new Map(gpsIfd.entries.map((entry) => [entry.tag, entry.value]));

    const latitude = dmsToDecimal(
      (byTag.get(0x0002) as number[] | number) ?? 0,
      String(byTag.get(0x0001) ?? 'N'),
    );
    const longitude = dmsToDecimal(
      (byTag.get(0x0004) as number[] | number) ?? 0,
      String(byTag.get(0x0003) ?? 'E'),
    );

    if (latitude !== null && longitude !== null && (latitude !== 0 || longitude !== 0)) {
      const altitudeRaw = byTag.get(0x0006);
      const altitude = typeof altitudeRaw === 'number' ? Math.round(altitudeRaw) : undefined;
      gps = { latitude, longitude, ...(altitude !== undefined ? { altitude } : {}) };

      items.push({
        key: 'GPSPosition',
        value: `${latitude}, ${longitude}${altitude !== undefined ? ` (${altitude} m)` : ''}`,
        sensitive: true,
        label: label('مختصات جغرافیایی', 'GPS coordinates'),
      });

      findings.push({
        id: 'privacy.gps',
        category: 'privacy',
        severity: 'high',
        confidence: 100,
        title: { fa: 'موقعیت جغرافیایی دقیق در فایل', en: 'Precise GPS location embedded in the file' },
        evidence: [`${latitude}, ${longitude}`],
        explanation: {
          fa: `این فایل مختصات دقیق محل عکس‌برداری را در خود دارد (${latitude}, ${longitude}). دقت این مختصات معمولاً در حد چند متر است، یعنی می‌تواند خانه، محل کار یا مدرسه‌ی شما را آشکار کند. بسیاری از پیام‌رسان‌ها این داده را هنگام ارسال حذف می‌کنند، اما ارسال فایل به‌صورت «سند» یا آپلود در وب‌سایت‌ها معمولاً آن را دست‌نخورده باقی می‌گذارد.`,
          en: `The file contains the exact coordinates where it was captured (${latitude}, ${longitude}). Such coordinates are typically accurate to a few metres, so they can reveal your home, workplace, or school. Many messengers strip this on send, but sharing the file "as a document" or uploading it to a website usually preserves it.`,
        },
        recommendation: {
          fa: 'پیش از اشتراک‌گذاری، متادیتا را حذف کنید و در تنظیمات دوربین گوشی، ثبت موقعیت مکانی را خاموش کنید.',
          en: 'Strip metadata before sharing, and turn off location tagging in your phone’s camera settings.',
        },
      });

      // Remaining GPS tags (datum, timestamp, altitude reference…) are listed
      // by name so the user sees the full extent of what is embedded.
      for (const [tag, name] of Object.entries(GPS_TAGS)) {
        const numericTag = Number(tag);
        if ([0x0001, 0x0002, 0x0003, 0x0004, 0x0006].includes(numericTag)) continue;
        const raw = byTag.get(numericTag);
        if (raw === undefined || raw === '') continue;
        items.push({
          key: name,
          value: Array.isArray(raw) ? raw.map((part) => Math.round(part)).join(':') : String(raw),
          sensitive: true,
          label: label(name, name),
        });
      }
    }
  }

  findings.push(...deviceFindings(items));
  return { items, findings, format, ...(gps ? { gps } : {}) };
}

function extractPng(data: Uint8Array): MetadataResult {
  const items: MetadataItem[] = [];
  const decoder = new TextDecoder('latin1', { fatal: false, ignoreBOM: false });
  let offset = 8; // skip signature
  let guard = 0;

  while (offset + 8 <= data.length && guard++ < 200) {
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    const length = view.getUint32(offset, false);
    const type = decoder.decode(data.subarray(offset + 4, offset + 8));
    if (length > data.length) break;

    if (type === 'tEXt' || type === 'iTXt') {
      const chunk = data.subarray(offset + 8, offset + 8 + Math.min(length, 4096));
      const text = decoder.decode(chunk);
      const separator = text.indexOf('\0');
      if (separator > 0) {
        const key = text.slice(0, separator);
        const value = text.slice(separator + 1).replace(/\0/g, ' ').trim();
        if (value) {
          const sensitive = /author|creator|source|comment|software|copyright|title/i.test(key);
          items.push({ key, value: value.slice(0, 200), sensitive, label: label(key, key) });
        }
      }
    }
    if (type === 'tIME') {
      const view2 = new DataView(data.buffer, data.byteOffset + offset + 8, Math.min(7, data.length - offset - 8));
      if (view2.byteLength >= 7) {
        const stamp = `${view2.getUint16(0, false)}-${String(view2.getUint8(2)).padStart(2, '0')}-${String(view2.getUint8(3)).padStart(2, '0')} ${String(view2.getUint8(4)).padStart(2, '0')}:${String(view2.getUint8(5)).padStart(2, '0')}`;
        items.push({ key: 'ModificationTime', value: stamp, sensitive: true, label: label('زمان تغییر', 'Modification time') });
      }
    }
    if (type === 'eXIf') {
      const nested = extractTiff(data.subarray(offset + 8, offset + 8 + length), 0, 'PNG/EXIF');
      return {
        items: [...items, ...nested.items],
        findings: nested.findings,
        format: 'PNG (with EXIF)',
        ...(nested.gps ? { gps: nested.gps } : {}),
      };
    }
    if (type === 'IDAT' || type === 'IEND') break;
    offset += 12 + length;
  }

  return { items, findings: deviceFindings(items), format: 'PNG' };
}

function extractPdf(data: Uint8Array): MetadataResult {
  const items: MetadataItem[] = [];
  // Document info lives in an uncompressed dictionary near the file end.
  const decoder = new TextDecoder('latin1', { fatal: false, ignoreBOM: false });
  const text = decoder.decode(data.subarray(0, Math.min(data.length, 512 * 1024)));

  const fields: { pattern: RegExp; key: string; fa: string; en: string; sensitive: boolean }[] = [
    { pattern: /\/Author\s*\(([^)]{1,200})\)/, key: 'Author', fa: 'پدیدآورنده', en: 'Author', sensitive: true },
    { pattern: /\/Creator\s*\(([^)]{1,200})\)/, key: 'Creator', fa: 'برنامه سازنده', en: 'Creator application', sensitive: true },
    { pattern: /\/Producer\s*\(([^)]{1,200})\)/, key: 'Producer', fa: 'تولیدکننده', en: 'Producer', sensitive: true },
    { pattern: /\/Title\s*\(([^)]{1,200})\)/, key: 'Title', fa: 'عنوان', en: 'Title', sensitive: false },
    { pattern: /\/Subject\s*\(([^)]{1,200})\)/, key: 'Subject', fa: 'موضوع', en: 'Subject', sensitive: false },
    { pattern: /\/Keywords\s*\(([^)]{1,200})\)/, key: 'Keywords', fa: 'کلیدواژه‌ها', en: 'Keywords', sensitive: false },
    { pattern: /\/CreationDate\s*\(([^)]{1,64})\)/, key: 'CreationDate', fa: 'تاریخ ایجاد', en: 'Creation date', sensitive: true },
    { pattern: /\/ModDate\s*\(([^)]{1,64})\)/, key: 'ModDate', fa: 'تاریخ تغییر', en: 'Modification date', sensitive: true },
  ];

  for (const field of fields) {
    const match = text.match(field.pattern);
    const value = match?.[1]?.trim();
    if (value) {
      items.push({ key: field.key, value: value.slice(0, 200), sensitive: field.sensitive, label: label(field.fa, field.en) });
    }
  }

  const findings = deviceFindings(items);
  if (/\/JavaScript|\/JS\s/.test(text)) {
    findings.push({
      id: 'privacy.pdf_javascript',
      category: 'dynamic-code',
      severity: 'medium',
      confidence: 80,
      title: { fa: 'کد جاوااسکریپت در PDF', en: 'JavaScript embedded in the PDF' },
      evidence: ['/JavaScript object present'],
      explanation: {
        fa: 'این PDF شامل کد جاوااسکریپت است. فرم‌های تعاملی به‌طور مشروع از آن استفاده می‌کنند، اما جاوااسکریپت در PDF یکی از مسیرهای شناخته‌شده‌ی سوءاستفاده از آسیب‌پذیری خواننده‌های PDF نیز هست.',
        en: 'The PDF contains JavaScript. Interactive forms use it legitimately, but PDF JavaScript is also a known route for exploiting reader vulnerabilities.',
      },
      recommendation: { fa: 'فایل را با یک خواننده‌ی به‌روز و ترجیحاً در حالت محافظت‌شده باز کنید.', en: 'Open it with an up-to-date reader, preferably in protected mode.' },
    });
  }
  if (/\/EmbeddedFile/.test(text)) {
    findings.push({
      id: 'privacy.pdf_embedded_file',
      category: 'privacy',
      severity: 'medium',
      confidence: 80,
      title: { fa: 'فایل جاسازی‌شده در PDF', en: 'File embedded in the PDF' },
      evidence: ['/EmbeddedFile object present'],
      explanation: {
        fa: 'این PDF فایل دیگری را در خود جای داده است. محتوای جاسازی‌شده در نمای معمولی سند دیده نمی‌شود.',
        en: 'The PDF carries another file inside it. Embedded content is not visible in the normal document view.',
      },
    });
  }

  return { items, findings, format: 'PDF' };
}

/** Shared findings derived from whatever items were collected. */
function deviceFindings(items: MetadataItem[]): Finding[] {
  const findings: Finding[] = [];
  const byKey = new Map(items.map((item) => [item.key, item.value]));

  const make = byKey.get('Make');
  const model = byKey.get('Model');
  if (make || model) {
    findings.push({
      id: 'privacy.device_info',
      category: 'privacy',
      severity: 'medium',
      confidence: 100,
      title: { fa: 'اطلاعات دستگاه در فایل', en: 'Device information embedded' },
      evidence: [make, model].filter((value): value is string => Boolean(value)),
      explanation: {
        fa: `فایل مشخص می‌کند با چه دستگاهی ساخته شده است (${[make, model].filter(Boolean).join(' ')}). این اطلاعات به‌تنهایی کم‌خطر است، اما در کنار چند فایل دیگر از همان دستگاه، امکان مرتبط کردن فایل‌های ناشناس به یک شخص را فراهم می‌کند.`,
        en: `The file records the device that produced it (${[make, model].filter(Boolean).join(' ')}). Harmless in isolation, but across several files it lets an analyst link anonymous uploads to one person.`,
      },
      recommendation: { fa: 'برای اشتراک‌گذاری ناشناس، متادیتا را حذف کنید.', en: 'Strip metadata before anonymous sharing.' },
    });
  }

  const serials = items.filter((item) => /SerialNumber/i.test(item.key) && item.value);
  if (serials.length > 0) {
    findings.push({
      id: 'privacy.serial',
      category: 'privacy',
      severity: 'high',
      confidence: 100,
      title: { fa: 'شماره سریال سخت‌افزار در فایل', en: 'Hardware serial number embedded' },
      evidence: serials.map((item) => `${item.key}: ${item.value}`),
      explanation: {
        fa: 'شماره سریال دوربین یا لنز در فایل ثبت شده است. این شناسه یکتاست و تمام تصاویر گرفته‌شده با آن دستگاه را به یکدیگر و در نهایت به مالک آن پیوند می‌دهد.',
        en: 'A camera or lens serial number is recorded in the file. This unique identifier links every photo taken with that device to one another, and ultimately to its owner.',
      },
      recommendation: { fa: 'این فیلد باید پیش از انتشار عمومی حتماً حذف شود.', en: 'This field must be removed before public publication.' },
    });
  }

  const author = byKey.get('Artist') ?? byKey.get('Author') ?? byKey.get('CameraOwnerName');
  if (author) {
    findings.push({
      id: 'privacy.author',
      category: 'privacy',
      severity: 'medium',
      confidence: 95,
      title: { fa: 'نام پدیدآورنده در فایل', en: 'Author name embedded' },
      evidence: [author],
      explanation: {
        fa: `نام «${author}» در فایل ذخیره شده است. اگر قصد اشتراک‌گذاری ناشناس دارید، این فیلد هویت شما را مستقیماً فاش می‌کند.`,
        en: `The name "${author}" is stored in the file. If you intend to share anonymously, this field discloses your identity directly.`,
      },
    });
  }

  const software = byKey.get('Software') ?? byKey.get('Creator') ?? byKey.get('Producer');
  if (software) {
    findings.push({
      id: 'privacy.software',
      category: 'privacy',
      severity: 'low',
      confidence: 90,
      title: { fa: 'نرم‌افزار سازنده‌ی فایل', en: 'Producing software recorded' },
      evidence: [software],
      explanation: {
        fa: `فایل با «${software}» ساخته یا ویرایش شده است. نسخه‌ی دقیق نرم‌افزار می‌تواند به مهاجم بگوید چه آسیب‌پذیری‌هایی روی سیستم شما محتمل است، و همچنین نشان می‌دهد فایل ویرایش شده است.`,
        en: `The file was created or edited with "${software}". A precise software version tells an attacker which vulnerabilities are plausible on your system, and also reveals that the file was edited.`,
      },
    });
  }

  // Match real timestamps only. A bare /Date|Time/ also catches ExposureTime
  // and GPSTimeStamp-style camera settings, so the report listed
  // "ExposureTime: 0.0133" as evidence of when the file was created.
  const TIMESTAMP_KEYS = new Set([
    'DateTime', 'DateTimeOriginal', 'DateTimeDigitized', 'ModificationTime',
    'CreationDate', 'ModDate', 'GPSDateStamp',
  ]);
  const timestamps = items.filter((item) => TIMESTAMP_KEYS.has(item.key) && item.value);
  if (timestamps.length > 0) {
    findings.push({
      id: 'privacy.timestamps',
      category: 'privacy',
      severity: 'low',
      confidence: 95,
      title: { fa: 'زمان ایجاد و ویرایش فایل', en: 'Creation and modification timestamps' },
      evidence: timestamps.slice(0, 4).map((item) => `${item.key}: ${item.value}`),
      explanation: {
        fa: 'زمان دقیق ایجاد یا ویرایش فایل ثبت شده است. این داده الگوی فعالیت روزانه و منطقه‌ی زمانی شما را آشکار می‌کند.',
        en: 'The exact creation or edit time is recorded, revealing your daily activity pattern and time zone.',
      },
    });
  }

  return findings;
}

/** Aggregate severity used for the "no metadata" happy path. */
export const cleanFileSeverity: Severity = 'safe';
