import { bytesToHex, utf8Bytes } from './encoding.js';

export type WebCryptoAlgo = 'SHA-1' | 'SHA-256' | 'SHA-384' | 'SHA-512';

export async function digestHex(algo: WebCryptoAlgo, text: string): Promise<string> {
  const buffer = await crypto.subtle.digest(algo, utf8Bytes(text) as unknown as BufferSource);
  return bytesToHex(new Uint8Array(buffer));
}

/** Digest of raw bytes — for hashing uploaded files without a string round-trip. */
export async function digestHexBytes(algo: WebCryptoAlgo, bytes: Uint8Array): Promise<string> {
  const buffer = await crypto.subtle.digest(algo, bytes as unknown as BufferSource);
  return bytesToHex(new Uint8Array(buffer));
}

export async function hmacHex(algo: WebCryptoAlgo, key: string, text: string): Promise<string> {
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    utf8Bytes(key) as unknown as BufferSource,
    { name: 'HMAC', hash: algo },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', cryptoKey, utf8Bytes(text) as unknown as BufferSource);
  return bytesToHex(new Uint8Array(sig));
}

/**
 * MD5 — pure TypeScript implementation.
 * WebCrypto intentionally does not provide MD5; it is offered here strictly for
 * legacy checksum comparison, never for security decisions.
 */
export function md5(input: string): string {
  return md5Bytes(utf8Bytes(input));
}

/**
 * MD5 over raw bytes — used by file fingerprinting, which must hash the exact
 * uploaded binary rather than a lossy UTF-8 round-trip of it.
 */
export function md5Bytes(bytes: Uint8Array): string {
  const words = bytesToWords(bytes);
  const bitLength = bytes.length * 8;

  words[bitLength >> 5] = (words[bitLength >> 5] ?? 0) | (0x80 << bitLength % 32);
  const paddedLength = (((bitLength + 64) >>> 9) << 4) + 14;
  for (let i = words.length; i <= paddedLength + 1; i += 1) words[i] = words[i] ?? 0;
  words[paddedLength] = bitLength;
  words[paddedLength + 1] = 0;

  let a = 1732584193;
  let b = -271733879;
  let c = -1732584194;
  let d = 271733878;

  for (let i = 0; i < words.length; i += 16) {
    const olda = a;
    const oldb = b;
    const oldc = c;
    const oldd = d;
    const w = (j: number): number => words[i + j] ?? 0;

    a = ff(a, b, c, d, w(0), 7, -680876936);
    d = ff(d, a, b, c, w(1), 12, -389564586);
    c = ff(c, d, a, b, w(2), 17, 606105819);
    b = ff(b, c, d, a, w(3), 22, -1044525330);
    a = ff(a, b, c, d, w(4), 7, -176418897);
    d = ff(d, a, b, c, w(5), 12, 1200080426);
    c = ff(c, d, a, b, w(6), 17, -1473231341);
    b = ff(b, c, d, a, w(7), 22, -45705983);
    a = ff(a, b, c, d, w(8), 7, 1770035416);
    d = ff(d, a, b, c, w(9), 12, -1958414417);
    c = ff(c, d, a, b, w(10), 17, -42063);
    b = ff(b, c, d, a, w(11), 22, -1990404162);
    a = ff(a, b, c, d, w(12), 7, 1804603682);
    d = ff(d, a, b, c, w(13), 12, -40341101);
    c = ff(c, d, a, b, w(14), 17, -1502002290);
    b = ff(b, c, d, a, w(15), 22, 1236535329);

    a = gg(a, b, c, d, w(1), 5, -165796510);
    d = gg(d, a, b, c, w(6), 9, -1069501632);
    c = gg(c, d, a, b, w(11), 14, 643717713);
    b = gg(b, c, d, a, w(0), 20, -373897302);
    a = gg(a, b, c, d, w(5), 5, -701558691);
    d = gg(d, a, b, c, w(10), 9, 38016083);
    c = gg(c, d, a, b, w(15), 14, -660478335);
    b = gg(b, c, d, a, w(4), 20, -405537848);
    a = gg(a, b, c, d, w(9), 5, 568446438);
    d = gg(d, a, b, c, w(14), 9, -1019803690);
    c = gg(c, d, a, b, w(3), 14, -187363961);
    b = gg(b, c, d, a, w(8), 20, 1163531501);
    a = gg(a, b, c, d, w(13), 5, -1444681467);
    d = gg(d, a, b, c, w(2), 9, -51403784);
    c = gg(c, d, a, b, w(7), 14, 1735328473);
    b = gg(b, c, d, a, w(12), 20, -1926607734);

    a = hh(a, b, c, d, w(5), 4, -378558);
    d = hh(d, a, b, c, w(8), 11, -2022574463);
    c = hh(c, d, a, b, w(11), 16, 1839030562);
    b = hh(b, c, d, a, w(14), 23, -35309556);
    a = hh(a, b, c, d, w(1), 4, -1530992060);
    d = hh(d, a, b, c, w(4), 11, 1272893353);
    c = hh(c, d, a, b, w(7), 16, -155497632);
    b = hh(b, c, d, a, w(10), 23, -1094730640);
    a = hh(a, b, c, d, w(13), 4, 681279174);
    d = hh(d, a, b, c, w(0), 11, -358537222);
    c = hh(c, d, a, b, w(3), 16, -722521979);
    b = hh(b, c, d, a, w(6), 23, 76029189);
    a = hh(a, b, c, d, w(9), 4, -640364487);
    d = hh(d, a, b, c, w(12), 11, -421815835);
    c = hh(c, d, a, b, w(15), 16, 530742520);
    b = hh(b, c, d, a, w(2), 23, -995338651);

    a = ii(a, b, c, d, w(0), 6, -198630844);
    d = ii(d, a, b, c, w(7), 10, 1126891415);
    c = ii(c, d, a, b, w(14), 15, -1416354905);
    b = ii(b, c, d, a, w(5), 21, -57434055);
    a = ii(a, b, c, d, w(12), 6, 1700485571);
    d = ii(d, a, b, c, w(3), 10, -1894986606);
    c = ii(c, d, a, b, w(10), 15, -1051523);
    b = ii(b, c, d, a, w(1), 21, -2054922799);
    a = ii(a, b, c, d, w(8), 6, 1873313359);
    d = ii(d, a, b, c, w(15), 10, -30611744);
    c = ii(c, d, a, b, w(6), 15, -1560198380);
    b = ii(b, c, d, a, w(13), 21, 1309151649);
    a = ii(a, b, c, d, w(4), 6, -145523070);
    d = ii(d, a, b, c, w(11), 10, -1120210379);
    c = ii(c, d, a, b, w(2), 15, 718787259);
    b = ii(b, c, d, a, w(9), 21, -343485551);

    a = add32(a, olda);
    b = add32(b, oldb);
    c = add32(c, oldc);
    d = add32(d, oldd);
  }

  return wordsToHex([a, b, c, d]);
}

function bytesToWords(bytes: Uint8Array): number[] {
  const words: number[] = [];
  for (let i = 0; i < bytes.length * 8; i += 8) {
    words[i >> 5] = (words[i >> 5] ?? 0) | ((bytes[i / 8] ?? 0) << i % 32);
  }
  return words;
}

function wordsToHex(words: number[]): string {
  const hexChars = '0123456789abcdef';
  let out = '';
  for (let i = 0; i < words.length * 4; i += 1) {
    const word = words[i >> 2] ?? 0;
    const byte = (word >> ((i % 4) * 8)) & 0xff;
    out += (hexChars[(byte >> 4) & 0x0f] ?? '0') + (hexChars[byte & 0x0f] ?? '0');
  }
  return out;
}

function add32(x: number, y: number): number {
  return (x + y) & 0xffffffff;
}

function cmn(q: number, a: number, b: number, x: number, s: number, t: number): number {
  const sum = add32(add32(a, q), add32(x, t));
  return add32((sum << s) | (sum >>> (32 - s)), b);
}

function ff(a: number, b: number, c: number, d: number, x: number, s: number, t: number): number {
  return cmn((b & c) | (~b & d), a, b, x, s, t);
}
function gg(a: number, b: number, c: number, d: number, x: number, s: number, t: number): number {
  return cmn((b & d) | (c & ~d), a, b, x, s, t);
}
function hh(a: number, b: number, c: number, d: number, x: number, s: number, t: number): number {
  return cmn(b ^ c ^ d, a, b, x, s, t);
}
function ii(a: number, b: number, c: number, d: number, x: number, s: number, t: number): number {
  return cmn(c ^ (b | ~d), a, b, x, s, t);
}
