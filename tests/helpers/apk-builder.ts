/**
 * Builds synthetic APKs (ZIP + binary AndroidManifest.xml) in memory.
 *
 * Real APKs cannot be committed to the repository, and downloading one during
 * a test run makes the suite depend on the network. Encoding AXML here means
 * the manifest parser is exercised against bytes produced independently of it,
 * from the documented chunk format — the parser is never handed a structure it
 * generated itself.
 */
import { deflateRawSync } from 'node:zlib';

const ANDROID_NS = 'http://schemas.android.com/apk/res/android';

export interface ManifestSpec {
  package: string;
  versionName?: string;
  versionCode?: string;
  minSdk?: string;
  targetSdk?: string;
  label?: string;
  debuggable?: boolean;
  allowBackup?: boolean;
  permissions?: string[];
  customPermissions?: string[];
  activities?: ComponentSpec[];
  services?: ComponentSpec[];
  receivers?: ComponentSpec[];
  providers?: ComponentSpec[];
}

export interface ComponentSpec {
  name: string;
  exported?: boolean;
  permission?: string;
  /** Intent filter actions. */
  actions?: string[];
  categories?: string[];
  /** `scheme://host` deep links. */
  data?: { scheme?: string; host?: string }[];
}

// ─── AXML string pool ─────────────────────────────────────────────────────

class Pool {
  readonly strings: string[] = [];
  index(value: string): number {
    const existing = this.strings.indexOf(value);
    if (existing >= 0) return existing;
    this.strings.push(value);
    return this.strings.length - 1;
  }
}

const u16 = (value: number): number[] => [value & 0xff, (value >> 8) & 0xff];
const u32 = (value: number): number[] => [
  value & 0xff,
  (value >> 8) & 0xff,
  (value >> 16) & 0xff,
  (value >> 24) & 0xff,
];

/** UTF-16LE string pool chunk (type 0x0001). */
function buildStringPool(pool: Pool): number[] {
  const offsets: number[] = [];
  const data: number[] = [];

  for (const value of pool.strings) {
    offsets.push(data.length);
    data.push(...u16(value.length));
    for (const char of value) {
      const code = char.charCodeAt(0);
      data.push(code & 0xff, (code >> 8) & 0xff);
    }
    data.push(0, 0); // NUL terminator
  }
  while (data.length % 4 !== 0) data.push(0);

  const headerSize = 28;
  const stringsStart = headerSize + offsets.length * 4;
  const chunkSize = stringsStart + data.length;

  return [
    ...u16(0x0001), ...u16(headerSize), ...u32(chunkSize),
    ...u32(pool.strings.length),
    ...u32(0),               // style count
    ...u32(0),               // flags: UTF-16
    ...u32(stringsStart),
    ...u32(0),               // styles start
    ...offsets.flatMap((offset) => u32(offset)),
    ...data,
  ];
}

interface Attr {
  name: string;
  value: string;
  /** Android-namespaced attributes carry the resource namespace. */
  android?: boolean;
  /** Encode as an int rather than a string. */
  intValue?: number;
  boolValue?: boolean;
}

interface Node {
  name: string;
  attrs: Attr[];
  children: Node[];
}

const el = (name: string, attrs: Attr[] = [], children: Node[] = []): Node => ({ name, attrs, children });

function encodeNode(node: Node, pool: Pool, nsIndex: number, out: number[], lineNo = 1): void {
  const nameIndex = pool.index(node.name);

  const attrBytes: number[] = [];
  for (const attr of node.attrs) {
    const attrNameIndex = pool.index(attr.name);
    const namespaceIndex = attr.android ? nsIndex : -1;

    let typedType: number;
    let typedData: number;
    let rawIndex: number;

    if (attr.boolValue !== undefined) {
      typedType = 0x12; // TYPE_INT_BOOLEAN
      typedData = attr.boolValue ? 0xffffffff : 0;
      rawIndex = -1;
    } else if (attr.intValue !== undefined) {
      typedType = 0x10; // TYPE_INT_DEC
      typedData = attr.intValue;
      rawIndex = -1;
    } else {
      typedType = 0x03; // TYPE_STRING
      rawIndex = pool.index(attr.value);
      typedData = rawIndex;
    }

    attrBytes.push(
      ...u32(namespaceIndex >>> 0),
      ...u32(attrNameIndex),
      ...u32(rawIndex >>> 0),
      ...u16(8),            // size of the Res_value struct
      0,                    // reserved
      typedType,
      ...u32(typedData >>> 0),
    );
  }

  const headerSize = 16;
  const bodySize = 20 + attrBytes.length;
  out.push(
    ...u16(0x0102), ...u16(headerSize), ...u32(headerSize + bodySize),
    ...u32(lineNo),
    ...u32(0xffffffff),      // comment
    ...u32(0xffffffff),      // namespace (none on the element itself)
    ...u32(nameIndex),
    ...u16(20),              // attribute start
    ...u16(20),              // attribute size
    ...u16(node.attrs.length),
    ...u16(0), ...u16(0), ...u16(0), // id/class/style index
    ...attrBytes,
  );

  for (const child of node.children) encodeNode(child, pool, nsIndex, out, lineNo + 1);

  out.push(
    ...u16(0x0103), ...u16(16), ...u32(24),
    ...u32(lineNo),
    ...u32(0xffffffff),
    ...u32(0xffffffff),
    ...u32(nameIndex),
  );
}

function componentNode(tag: string, spec: ComponentSpec): Node {
  const attrs: Attr[] = [{ name: 'name', value: spec.name, android: true }];
  if (spec.exported !== undefined) attrs.push({ name: 'exported', value: '', android: true, boolValue: spec.exported });
  if (spec.permission) attrs.push({ name: 'permission', value: spec.permission, android: true });

  const children: Node[] = [];
  if (spec.actions?.length || spec.categories?.length || spec.data?.length) {
    const filterChildren: Node[] = [];
    for (const action of spec.actions ?? []) {
      filterChildren.push(el('action', [{ name: 'name', value: action, android: true }]));
    }
    for (const category of spec.categories ?? []) {
      filterChildren.push(el('category', [{ name: 'name', value: category, android: true }]));
    }
    for (const data of spec.data ?? []) {
      const dataAttrs: Attr[] = [];
      if (data.scheme) dataAttrs.push({ name: 'scheme', value: data.scheme, android: true });
      if (data.host) dataAttrs.push({ name: 'host', value: data.host, android: true });
      filterChildren.push(el('data', dataAttrs));
    }
    children.push(el('intent-filter', [], filterChildren));
  }
  return el(tag, attrs, children);
}

/** Produces a binary AndroidManifest.xml equivalent to the given spec. */
export function buildAxml(spec: ManifestSpec): Uint8Array {
  const pool = new Pool();
  const nsIndex = pool.index(ANDROID_NS);

  const manifestAttrs: Attr[] = [
    { name: 'package', value: spec.package },
    { name: 'versionCode', value: spec.versionCode ?? '1', android: true, intValue: Number(spec.versionCode ?? 1) },
    { name: 'versionName', value: spec.versionName ?? '1.0', android: true },
  ];

  const children: Node[] = [];

  if (spec.minSdk || spec.targetSdk) {
    const sdkAttrs: Attr[] = [];
    if (spec.minSdk) sdkAttrs.push({ name: 'minSdkVersion', value: spec.minSdk, android: true, intValue: Number(spec.minSdk) });
    if (spec.targetSdk) sdkAttrs.push({ name: 'targetSdkVersion', value: spec.targetSdk, android: true, intValue: Number(spec.targetSdk) });
    children.push(el('uses-sdk', sdkAttrs));
  }

  for (const permission of spec.permissions ?? []) {
    children.push(el('uses-permission', [{ name: 'name', value: permission, android: true }]));
  }
  for (const permission of spec.customPermissions ?? []) {
    children.push(el('permission', [{ name: 'name', value: permission, android: true }]));
  }

  const appAttrs: Attr[] = [];
  if (spec.label) appAttrs.push({ name: 'label', value: spec.label, android: true });
  if (spec.debuggable !== undefined) appAttrs.push({ name: 'debuggable', value: '', android: true, boolValue: spec.debuggable });
  if (spec.allowBackup !== undefined) appAttrs.push({ name: 'allowBackup', value: '', android: true, boolValue: spec.allowBackup });

  const appChildren: Node[] = [
    ...(spec.activities ?? []).map((component) => componentNode('activity', component)),
    ...(spec.services ?? []).map((component) => componentNode('service', component)),
    ...(spec.receivers ?? []).map((component) => componentNode('receiver', component)),
    ...(spec.providers ?? []).map((component) => componentNode('provider', component)),
  ];
  children.push(el('application', appAttrs, appChildren));

  const root = el('manifest', manifestAttrs, children);

  // Encode the body first so the pool contains every string it references.
  const body: number[] = [];
  encodeNode(root, pool, nsIndex, body);

  const nsStart = [
    ...u16(0x0100), ...u16(16), ...u32(24),
    ...u32(1), ...u32(0xffffffff),
    ...u32(pool.index('android')), ...u32(nsIndex),
  ];
  const nsEnd = [
    ...u16(0x0101), ...u16(16), ...u32(24),
    ...u32(1), ...u32(0xffffffff),
    ...u32(pool.index('android')), ...u32(nsIndex),
  ];

  const poolChunk = buildStringPool(pool);
  const total = 8 + poolChunk.length + nsStart.length + body.length + nsEnd.length;
  const bytes = [...u16(0x0003), ...u16(8), ...u32(total), ...poolChunk, ...nsStart, ...body, ...nsEnd];
  return new Uint8Array(bytes);
}

// ─── ZIP container ────────────────────────────────────────────────────────

interface ZipFileSpec {
  name: string;
  data: Uint8Array;
  /** Store uncompressed instead of deflating. */
  store?: boolean;
}

const crcTable = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let value = i;
    for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    table[i] = value >>> 0;
  }
  return table;
})();

function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of data) crc = (crcTable[(crc ^ byte) & 0xff] as number) ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

/** Assembles a real ZIP archive from the given entries. */
export function buildZip(files: ZipFileSpec[]): Uint8Array {
  const local: number[] = [];
  const central: number[] = [];
  const encoder = new TextEncoder();

  for (const file of files) {
    const nameBytes = encoder.encode(file.name);
    const raw = file.data;
    const compressed = file.store ? raw : new Uint8Array(deflateRawSync(Buffer.from(raw)));
    const method = file.store ? 0 : 8;
    const offset = local.length;
    const crc = crc32(raw);

    local.push(
      ...u32(0x04034b50), ...u16(20), ...u16(0), ...u16(method),
      ...u16(0), ...u16(0),
      ...u32(crc), ...u32(compressed.length), ...u32(raw.length),
      ...u16(nameBytes.length), ...u16(0),
      ...nameBytes, ...compressed,
    );

    central.push(
      ...u32(0x02014b50), ...u16(20), ...u16(20), ...u16(0), ...u16(method),
      ...u16(0), ...u16(0),
      ...u32(crc), ...u32(compressed.length), ...u32(raw.length),
      ...u16(nameBytes.length), ...u16(0), ...u16(0),
      ...u16(0), ...u16(0), ...u32(0),
      ...u32(offset),
      ...nameBytes,
    );
  }

  const cdOffset = local.length;
  const eocd = [
    ...u32(0x06054b50), ...u16(0), ...u16(0),
    ...u16(files.length), ...u16(files.length),
    ...u32(central.length), ...u32(cdOffset),
    ...u16(0),
  ];

  return new Uint8Array([...local, ...central, ...eocd]);
}

export interface ApkSpec extends ManifestSpec {
  /** Extra files placed in the archive (e.g. `classes.dex` content). */
  extraFiles?: ZipFileSpec[];
  /** Adds a v1 signature block so the APK does not look unsigned. */
  signed?: boolean;
  /** Strings embedded in a fake `classes.dex`, for behavioural rule tests. */
  dexStrings?: string[];
  nativeLibs?: string[];
}

/** Builds a complete, parseable APK. */
export function buildApk(spec: ApkSpec): Uint8Array {
  const files: ZipFileSpec[] = [{ name: 'AndroidManifest.xml', data: buildAxml(spec) }];

  const dexBody = ['dex\n035\0', ...(spec.dexStrings ?? [])].join('\n');
  files.push({ name: 'classes.dex', data: new TextEncoder().encode(dexBody) });

  if (spec.signed) {
    files.push({ name: 'META-INF/MANIFEST.MF', data: new TextEncoder().encode('Manifest-Version: 1.0\n') });
    files.push({ name: 'META-INF/CERT.RSA', data: new Uint8Array([0x30, 0x82, 0x01, 0x00]) });
    files.push({ name: 'META-INF/CERT.SF', data: new TextEncoder().encode('Signature-Version: 1.0\n') });
  }

  for (const lib of spec.nativeLibs ?? []) {
    files.push({ name: lib, data: new Uint8Array([0x7f, 0x45, 0x4c, 0x46, 2, 1, 1, 0]) });
  }
  files.push(...(spec.extraFiles ?? []));

  return buildZip(files);
}

/** A believable, low-risk app used as the baseline in tests. */
export const BENIGN_APK: ApkSpec = {
  package: 'com.example.notes',
  versionName: '2.1.0',
  versionCode: '21',
  minSdk: '24',
  targetSdk: '34',
  label: 'Notes',
  signed: true,
  allowBackup: false,
  permissions: ['android.permission.INTERNET'],
  activities: [
    {
      name: '.MainActivity',
      actions: ['android.intent.action.MAIN'],
      categories: ['android.intent.category.LAUNCHER'],
    },
  ],
};
