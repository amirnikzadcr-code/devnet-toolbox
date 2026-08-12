/**
 * Android binary XML (AXML) decoder.
 *
 * `AndroidManifest.xml` inside an APK is not text — it is a compiled chunk
 * format: a string pool, an optional resource-map chunk, then a stream of
 * start/end element and namespace events. This decoder walks those chunks and
 * rebuilds a small DOM.
 *
 * Reference: AOSP `ResourceTypes.h`. Only the subset needed for manifest
 * analysis is implemented, and every read is bounds-checked so a corrupt or
 * hostile manifest cannot crash the Worker.
 */
import { errInvalidInput } from '../utils/errors.js';

const CHUNK_STRING_POOL = 0x0001;
const CHUNK_XML = 0x0003;
const CHUNK_XML_START_NAMESPACE = 0x0100;
const CHUNK_XML_END_NAMESPACE = 0x0101;
const CHUNK_XML_START_ELEMENT = 0x0102;
const CHUNK_XML_END_ELEMENT = 0x0103;
const CHUNK_XML_CDATA = 0x0104;
const CHUNK_XML_RESOURCE_MAP = 0x0180;

const UTF8_FLAG = 1 << 8;

// Attribute value types (Res_value::dataType)
const TYPE_NULL = 0x00;
const TYPE_REFERENCE = 0x01;
const TYPE_ATTRIBUTE = 0x02;
const TYPE_STRING = 0x03;
const TYPE_FLOAT = 0x04;
const TYPE_DIMENSION = 0x05;
const TYPE_FRACTION = 0x06;
const TYPE_INT_DEC = 0x10;
const TYPE_INT_HEX = 0x11;
const TYPE_INT_BOOLEAN = 0x12;

export interface AxmlAttribute {
  namespace: string | null;
  name: string;
  value: string;
  /** Raw integer payload, useful for SDK levels and flags. */
  rawValue: number;
  type: number;
}

export interface AxmlElement {
  name: string;
  attributes: AxmlAttribute[];
  children: AxmlElement[];
  parent: AxmlElement | null;
}

const malformed = () =>
  errInvalidInput(
    'ساختار AndroidManifest.xml قابل خواندن نیست (فایل احتمالاً خراب یا محافظت‌شده است).',
    'AndroidManifest.xml could not be parsed (the file may be corrupt or protected).',
  );

class StringPool {
  readonly strings: string[] = [];

  constructor(data: Uint8Array, view: DataView, start: number, size: number) {
    const stringCount = view.getUint32(start + 8, true);
    const flags = view.getUint32(start + 16, true);
    const stringsStart = view.getUint32(start + 20, true);
    const isUtf8 = (flags & UTF8_FLAG) !== 0;

    if (stringCount > 200_000) throw malformed();
    const offsetsBase = start + 28;
    const dataBase = start + stringsStart;
    const chunkEnd = start + size;

    for (let i = 0; i < stringCount; i += 1) {
      const offsetPos = offsetsBase + i * 4;
      if (offsetPos + 4 > data.length) break;
      const offset = dataBase + view.getUint32(offsetPos, true);
      if (offset < 0 || offset >= chunkEnd || offset >= data.length) {
        this.strings.push('');
        continue;
      }
      this.strings.push(isUtf8 ? readUtf8(data, offset) : readUtf16(data, view, offset));
    }
  }

  at(index: number): string {
    if (index < 0 || index >= this.strings.length) return '';
    return this.strings[index] ?? '';
  }
}

/** UTF-8 pool strings are prefixed with two varint lengths (chars, then bytes). */
function readUtf8(data: Uint8Array, offset: number): string {
  let cursor = offset;
  const readLen = (): number => {
    let length = data[cursor] ?? 0;
    cursor += 1;
    if ((length & 0x80) !== 0) {
      length = ((length & 0x7f) << 8) | (data[cursor] ?? 0);
      cursor += 1;
    }
    return length;
  };
  readLen(); // character count (unused)
  const byteLength = readLen();
  const end = Math.min(data.length, cursor + byteLength);
  return new TextDecoder('utf-8', { fatal: false, ignoreBOM: false }).decode(data.subarray(cursor, end));
}

/** UTF-16 pool strings are prefixed with a (possibly 2-word) length. */
function readUtf16(data: Uint8Array, view: DataView, offset: number): string {
  let cursor = offset;
  if (cursor + 2 > data.length) return '';
  let length = view.getUint16(cursor, true);
  cursor += 2;
  if ((length & 0x8000) !== 0) {
    if (cursor + 2 > data.length) return '';
    length = ((length & 0x7fff) << 16) | view.getUint16(cursor, true);
    cursor += 2;
  }
  const end = Math.min(data.length, cursor + length * 2);
  return new TextDecoder('utf-16le', { fatal: false, ignoreBOM: false }).decode(data.subarray(cursor, end));
}

export interface AxmlDocument {
  root: AxmlElement | null;
  /** Namespace prefix → URI, as declared in the document. */
  namespaces: Map<string, string>;
  strings: string[];
}

export function parseAxml(data: Uint8Array): AxmlDocument {
  if (data.length < 8) throw malformed();
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);

  if (view.getUint16(0, true) !== CHUNK_XML) throw malformed();

  let pool: StringPool | null = null;
  const namespaces = new Map<string, string>();
  let root: AxmlElement | null = null;
  let current: AxmlElement | null = null;

  let offset = view.getUint16(2, true); // header size, start of first child chunk
  const fileEnd = Math.min(data.length, view.getUint32(4, true) || data.length);
  let guard = 0;

  while (offset + 8 <= fileEnd) {
    if (guard++ > 500_000) throw malformed();

    const chunkType = view.getUint16(offset, true);
    const headerSize = view.getUint16(offset + 2, true);
    const chunkSize = view.getUint32(offset + 4, true);
    if (chunkSize < 8 || offset + chunkSize > fileEnd) break;

    switch (chunkType) {
      case CHUNK_STRING_POOL:
        pool = new StringPool(data, view, offset, chunkSize);
        break;

      case CHUNK_XML_RESOURCE_MAP:
        break; // not needed for manifest semantics

      case CHUNK_XML_START_NAMESPACE: {
        if (!pool) break;
        const prefix = pool.at(view.getInt32(offset + headerSize, true));
        const uri = pool.at(view.getInt32(offset + headerSize + 4, true));
        if (prefix) namespaces.set(prefix, uri);
        break;
      }

      case CHUNK_XML_END_NAMESPACE:
      case CHUNK_XML_CDATA:
        break;

      case CHUNK_XML_START_ELEMENT: {
        if (!pool) throw malformed();
        const base = offset + headerSize;
        const nameIndex = view.getInt32(base + 4, true);
        const attributeStart = view.getUint16(base + 8, true);
        const attributeSize = view.getUint16(base + 10, true);
        const attributeCount = view.getUint16(base + 12, true);

        const element: AxmlElement = {
          name: pool.at(nameIndex),
          attributes: [],
          children: [],
          parent: current,
        };

        for (let i = 0; i < attributeCount; i += 1) {
          const attrOffset = base + attributeStart + i * attributeSize;
          if (attrOffset + 20 > fileEnd) break;
          const nsIndex = view.getInt32(attrOffset, true);
          const attrNameIndex = view.getInt32(attrOffset + 4, true);
          const rawValueIndex = view.getInt32(attrOffset + 8, true);
          const valueType = view.getUint8(attrOffset + 15);
          const valueData = view.getInt32(attrOffset + 16, true);

          element.attributes.push({
            namespace: nsIndex >= 0 ? pool.at(nsIndex) : null,
            name: pool.at(attrNameIndex),
            value: formatValue(pool, valueType, valueData, rawValueIndex),
            rawValue: valueData,
            type: valueType,
          });
        }

        if (current) current.children.push(element);
        else if (!root) root = element;
        current = element;
        break;
      }

      case CHUNK_XML_END_ELEMENT:
        if (current) current = current.parent;
        break;

      default:
        break;
    }

    offset += chunkSize;
  }

  if (!root) throw malformed();
  return { root, namespaces, strings: pool?.strings ?? [] };
}

function formatValue(pool: StringPool, type: number, data: number, rawIndex: number): string {
  switch (type) {
    case TYPE_NULL:
      return '';
    case TYPE_STRING:
      return pool.at(rawIndex >= 0 ? rawIndex : data);
    case TYPE_INT_BOOLEAN:
      return data === 0 ? 'false' : 'true';
    case TYPE_INT_DEC:
      return String(data);
    case TYPE_INT_HEX:
      return `0x${(data >>> 0).toString(16)}`;
    case TYPE_REFERENCE:
      return `@${(data >>> 0).toString(16)}`;
    case TYPE_ATTRIBUTE:
      return `?${(data >>> 0).toString(16)}`;
    case TYPE_FLOAT:
      return String(intBitsToFloat(data));
    case TYPE_DIMENSION:
    case TYPE_FRACTION:
      return String(data);
    default:
      return String(data);
  }
}

function intBitsToFloat(bits: number): number {
  const buffer = new ArrayBuffer(4);
  new DataView(buffer).setInt32(0, bits, true);
  return new DataView(buffer).getFloat32(0, true);
}

// ─── Small DOM helpers ────────────────────────────────────────────────────

export function findElements(root: AxmlElement, name: string): AxmlElement[] {
  const out: AxmlElement[] = [];
  const walk = (node: AxmlElement): void => {
    if (node.name === name) out.push(node);
    for (const child of node.children) walk(child);
  };
  walk(root);
  return out;
}

export function childrenNamed(element: AxmlElement, name: string): AxmlElement[] {
  return element.children.filter((child) => child.name === name);
}

/** Reads an attribute by local name, ignoring the namespace prefix. */
export function attr(element: AxmlElement, name: string): string | null {
  const found = element.attributes.find((attribute) => attribute.name === name);
  return found ? found.value : null;
}

export function attrInt(element: AxmlElement, name: string): number | null {
  const found = element.attributes.find((attribute) => attribute.name === name);
  if (!found) return null;
  if (found.type === TYPE_INT_DEC || found.type === TYPE_INT_HEX) return found.rawValue;
  const parsed = Number.parseInt(found.value, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

export function attrBool(element: AxmlElement, name: string): boolean | null {
  const found = element.attributes.find((attribute) => attribute.name === name);
  if (!found) return null;
  if (found.type === TYPE_INT_BOOLEAN) return found.rawValue !== 0;
  if (found.value === 'true') return true;
  if (found.value === 'false') return false;
  return null;
}
