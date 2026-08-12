import { bytesToHex } from './encoding.js';

export const CHARSETS = {
  lower: 'abcdefghijklmnopqrstuvwxyz',
  upper: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
  digits: '0123456789',
  symbols: '!@#$%^&*()-_=+[]{};:,.?',
  hex: '0123456789abcdef',
  /** Excludes look-alike characters: 0/O, 1/l/I. */
  unambiguous: 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789',
} as const;

/** Cryptographically secure random integer in [0, max). Rejection sampling → unbiased. */
export function secureRandomInt(max: number): number {
  if (max <= 0) throw new RangeError('max must be > 0');
  const limit = Math.floor(0xffffffff / max) * max;
  const buf = new Uint32Array(1);
  let value = 0;
  do {
    crypto.getRandomValues(buf);
    value = buf[0] ?? 0;
  } while (value >= limit);
  return value % max;
}

export function randomFromCharset(length: number, charset: string): string {
  if (!charset) throw new RangeError('charset must not be empty');
  let out = '';
  for (let i = 0; i < length; i += 1) out += charset[secureRandomInt(charset.length)] ?? '';
  return out;
}

export function randomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return bytes;
}

export function randomHex(byteLength: number): string {
  return bytesToHex(randomBytes(byteLength));
}

/** RFC 4122 v4 UUID via WebCrypto. */
export function uuidV4(): string {
  return crypto.randomUUID();
}

/** RFC 4122 v7 UUID — time-ordered, useful as a sortable database key. */
export function uuidV7(): string {
  const bytes = randomBytes(16);
  const ts = BigInt(Date.now());
  bytes[0] = Number((ts >> 40n) & 0xffn);
  bytes[1] = Number((ts >> 32n) & 0xffn);
  bytes[2] = Number((ts >> 24n) & 0xffn);
  bytes[3] = Number((ts >> 16n) & 0xffn);
  bytes[4] = Number((ts >> 8n) & 0xffn);
  bytes[5] = Number(ts & 0xffn);
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x70;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = bytesToHex(bytes);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** Shannon-entropy estimate in bits for a password of `length` from `poolSize`. */
export function entropyBits(length: number, poolSize: number): number {
  if (poolSize <= 1 || length <= 0) return 0;
  return Math.round(length * Math.log2(poolSize) * 10) / 10;
}

export function strengthLabel(bits: number): { fa: string; en: string; bar: string } {
  const levels: { min: number; fa: string; en: string; bar: string }[] = [
    { min: 128, fa: 'بسیار قوی', en: 'Excellent', bar: '🟩🟩🟩🟩🟩' },
    { min: 96, fa: 'قوی', en: 'Strong', bar: '🟩🟩🟩🟩⬜' },
    { min: 72, fa: 'مناسب', en: 'Good', bar: '🟩🟩🟩⬜⬜' },
    { min: 48, fa: 'متوسط', en: 'Fair', bar: '🟨🟨⬜⬜⬜' },
    { min: 0, fa: 'ضعیف', en: 'Weak', bar: '🟥⬜⬜⬜⬜' },
  ];
  const found = levels.find((l) => bits >= l.min);
  return found ?? { fa: 'ضعیف', en: 'Weak', bar: '🟥⬜⬜⬜⬜' };
}
