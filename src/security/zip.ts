/**
 * Minimal ZIP central-directory reader.
 *
 * An APK is a ZIP file, so reading `AndroidManifest.xml` means parsing ZIP
 * structures. Only what is needed is implemented: locate the End Of Central
 * Directory record, walk the central directory, and inflate STORE/DEFLATE
 * entries using the runtime's `DecompressionStream` (available in Workers).
 *
 * Deliberately defensive: every offset is bounds-checked, entry counts and
 * inflated sizes are capped, so a malformed or zip-bomb archive cannot hang
 * or OOM the Worker.
 */
import { errInvalidInput, errTooLarge } from '../utils/errors.js';

export interface ZipEntry {
  name: string;
  compressedSize: number;
  uncompressedSize: number;
  compressionMethod: number;
  localHeaderOffset: number;
  crc32: number;
  /** DOS timestamp converted to epoch ms, or null when absent/invalid. */
  modifiedAt: number | null;
}

/** Safety caps — an APK with more entries than this is not worth analysing. */
const MAX_ENTRIES = 20_000;
const MAX_INFLATED_BYTES = 12 * 1024 * 1024;
const EOCD_SIG = 0x06054b50;
const CD_SIG = 0x02014b50;
const EOCD64_LOCATOR_SIG = 0x07064b50;
const EOCD64_SIG = 0x06064b50;

const badZip = () =>
  errInvalidInput(
    'فایل یک آرشیو ZIP/APK معتبر نیست یا ساختار آن آسیب دیده است.',
    'The file is not a valid ZIP/APK archive, or its structure is damaged.',
  );

export class ZipReader {
  readonly #data: Uint8Array;
  readonly #view: DataView;
  #entries: ZipEntry[] | null = null;

  constructor(data: Uint8Array) {
    this.#data = data;
    this.#view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  }

  #u16(offset: number): number {
    if (offset + 2 > this.#data.length) throw badZip();
    return this.#view.getUint16(offset, true);
  }

  #u32(offset: number): number {
    if (offset + 4 > this.#data.length) throw badZip();
    return this.#view.getUint32(offset, true);
  }

  #u64(offset: number): number {
    if (offset + 8 > this.#data.length) throw badZip();
    const value = this.#view.getBigUint64(offset, true);
    if (value > BigInt(Number.MAX_SAFE_INTEGER)) throw badZip();
    return Number(value);
  }

  /** Scans backwards for the EOCD signature (the comment field is variable). */
  #findEocd(): number {
    const data = this.#data;
    const minSize = 22;
    if (data.length < minSize) throw badZip();
    const searchStart = Math.max(0, data.length - 66_000);
    for (let i = data.length - minSize; i >= searchStart; i -= 1) {
      if (this.#view.getUint32(i, true) === EOCD_SIG) return i;
    }
    throw badZip();
  }

  /** Reads the central directory once and caches it. */
  entries(): ZipEntry[] {
    if (this.#entries) return this.#entries;

    const eocd = this.#findEocd();
    let entryCount = this.#u16(eocd + 10);
    let cdOffset = this.#u32(eocd + 16);

    // ZIP64: the 32-bit fields are saturated, real values live in the ZIP64 EOCD.
    if (cdOffset === 0xffffffff || entryCount === 0xffff) {
      const locator = eocd - 20;
      if (locator >= 0 && this.#u32(locator) === EOCD64_LOCATOR_SIG) {
        const eocd64 = this.#u64(locator + 8);
        if (eocd64 >= 0 && eocd64 + 56 <= this.#data.length && this.#u32(eocd64) === EOCD64_SIG) {
          entryCount = this.#u64(eocd64 + 32);
          cdOffset = this.#u64(eocd64 + 48);
        }
      }
    }

    if (cdOffset >= this.#data.length) throw badZip();
    if (entryCount > MAX_ENTRIES) {
      throw errTooLarge(
        `تعداد فایل‌های داخل آرشیو بیش از حد مجاز است (${MAX_ENTRIES}).`,
        `Archive contains more entries than allowed (${MAX_ENTRIES}).`,
      );
    }

    const entries: ZipEntry[] = [];
    let offset = cdOffset;
    const decoder = new TextDecoder('utf-8', { fatal: false, ignoreBOM: false });

    for (let i = 0; i < entryCount; i += 1) {
      if (offset + 46 > this.#data.length) break;
      if (this.#u32(offset) !== CD_SIG) break;

      const compressionMethod = this.#u16(offset + 10);
      const dosTime = this.#u16(offset + 12);
      const dosDate = this.#u16(offset + 14);
      const crc32 = this.#u32(offset + 16);
      let compressedSize = this.#u32(offset + 20);
      let uncompressedSize = this.#u32(offset + 24);
      const nameLength = this.#u16(offset + 28);
      const extraLength = this.#u16(offset + 30);
      const commentLength = this.#u16(offset + 32);
      let localHeaderOffset = this.#u32(offset + 42);

      const nameStart = offset + 46;
      if (nameStart + nameLength > this.#data.length) break;
      const name = decoder.decode(this.#data.subarray(nameStart, nameStart + nameLength));

      // ZIP64 extra field (header id 0x0001) overrides saturated 32-bit sizes.
      if (uncompressedSize === 0xffffffff || compressedSize === 0xffffffff || localHeaderOffset === 0xffffffff) {
        let extra = nameStart + nameLength;
        const extraEnd = extra + extraLength;
        while (extra + 4 <= extraEnd && extra + 4 <= this.#data.length) {
          const headerId = this.#u16(extra);
          const dataSize = this.#u16(extra + 2);
          let cursor = extra + 4;
          if (headerId === 0x0001) {
            if (uncompressedSize === 0xffffffff && cursor + 8 <= extraEnd) {
              uncompressedSize = this.#u64(cursor);
              cursor += 8;
            }
            if (compressedSize === 0xffffffff && cursor + 8 <= extraEnd) {
              compressedSize = this.#u64(cursor);
              cursor += 8;
            }
            if (localHeaderOffset === 0xffffffff && cursor + 8 <= extraEnd) {
              localHeaderOffset = this.#u64(cursor);
            }
            break;
          }
          extra += 4 + dataSize;
        }
      }

      entries.push({
        name,
        compressedSize,
        uncompressedSize,
        compressionMethod,
        localHeaderOffset,
        crc32,
        modifiedAt: dosToEpoch(dosDate, dosTime),
      });

      offset = nameStart + nameLength + extraLength + commentLength;
    }

    if (entries.length === 0) throw badZip();
    this.#entries = entries;
    return entries;
  }

  has(name: string): boolean {
    return this.entries().some((entry) => entry.name === name);
  }

  find(name: string): ZipEntry | undefined {
    return this.entries().find((entry) => entry.name === name);
  }

  /** Total uncompressed size of all entries (zip-bomb ratio check). */
  totalUncompressed(): number {
    return this.entries().reduce((sum, entry) => sum + entry.uncompressedSize, 0);
  }

  /**
   * Extracts and decompresses one entry.
   * Only STORE (0) and DEFLATE (8) are supported — the only methods Android
   * accepts inside an APK.
   */
  async read(name: string, maxBytes = MAX_INFLATED_BYTES): Promise<Uint8Array | null> {
    const entry = this.find(name);
    if (!entry) return null;
    if (entry.uncompressedSize > maxBytes) {
      throw errTooLarge(
        `حجم «${name}» پس از بازگشایی بیش از حد مجاز است.`,
        `Entry "${name}" exceeds the inflated-size limit.`,
      );
    }

    const local = entry.localHeaderOffset;
    if (local + 30 > this.#data.length || this.#u32(local) !== 0x04034b50) throw badZip();
    const nameLength = this.#u16(local + 26);
    const extraLength = this.#u16(local + 28);
    const dataStart = local + 30 + nameLength + extraLength;
    if (dataStart > this.#data.length) throw badZip();

    const end =
      entry.compressedSize > 0
        ? Math.min(this.#data.length, dataStart + entry.compressedSize)
        : this.#data.length;
    const raw = this.#data.subarray(dataStart, end);

    if (entry.compressionMethod === 0) return raw.subarray(0, Math.min(raw.length, maxBytes));
    if (entry.compressionMethod !== 8) {
      throw errInvalidInput(
        `روش فشرده‌سازی «${name}» پشتیبانی نمی‌شود.`,
        `Unsupported compression method for "${name}".`,
      );
    }
    return inflateRaw(raw, maxBytes);
  }
}

/** DEFLATE (raw, no zlib header) using the platform stream API. */
export async function inflateRaw(data: Uint8Array, maxBytes = MAX_INFLATED_BYTES): Promise<Uint8Array> {
  const stream = new DecompressionStream('deflate-raw');
  const writer = stream.writable.getWriter();
  void writer.write(data as unknown as BufferSource).catch(() => undefined);
  void writer.close().catch(() => undefined);

  const reader = stream.readable.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    const chunk = value as Uint8Array;
    total += chunk.length;
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw errTooLarge(
        'حجم داده پس از بازگشایی از حد مجاز فراتر رفت.',
        'Inflated data exceeded the allowed size.',
      );
    }
    chunks.push(chunk);
  }

  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

/** Converts a DOS date/time pair into epoch milliseconds (UTC-naive). */
function dosToEpoch(date: number, time: number): number | null {
  if (date === 0) return null;
  const year = ((date >> 9) & 0x7f) + 1980;
  const month = (date >> 5) & 0x0f;
  const day = date & 0x1f;
  const hour = (time >> 11) & 0x1f;
  const minute = (time >> 5) & 0x3f;
  const second = (time & 0x1f) * 2;
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return Date.UTC(year, month - 1, day, hour, minute, second);
}
