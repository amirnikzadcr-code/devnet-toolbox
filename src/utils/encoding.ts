import { errInvalidInput } from './errors.js';

const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: false, ignoreBOM: false });

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

export function base64ToBytes(value: string): Uint8Array {
  const normalized = value.trim().replace(/\s+/g, '');
  let binary: string;
  try {
    binary = atob(normalized);
  } catch {
    throw errInvalidInput(
      'رشته‌ی Base64 معتبر نیست.',
      'The provided string is not valid Base64.',
    );
  }
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
  return out;
}

/** UTF-8 safe Base64 encode. */
export function base64Encode(text: string): string {
  return bytesToBase64(encoder.encode(text));
}

/** UTF-8 safe Base64 decode (accepts standard and URL-safe alphabets). */
export function base64Decode(value: string): string {
  return decoder.decode(base64ToBytes(base64UrlToStandard(value)));
}

export function base64UrlToStandard(value: string): string {
  const replaced = value.trim().replace(/-/g, '+').replace(/_/g, '/');
  const padding = replaced.length % 4;
  return padding === 0 ? replaced : replaced + '='.repeat(4 - padding);
}

export function base64UrlEncode(text: string): string {
  return base64Encode(text).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function bytesToHex(bytes: Uint8Array): string {
  let hex = '';
  for (const byte of bytes) hex += byte.toString(16).padStart(2, '0');
  return hex;
}

export function hexToBytes(hex: string): Uint8Array {
  const clean = hex.trim().replace(/^0x/i, '').replace(/\s+/g, '');
  if (clean.length % 2 !== 0 || !/^[0-9a-f]*$/i.test(clean)) {
    throw errInvalidInput('رشته‌ی هگز معتبر نیست.', 'Invalid hexadecimal string.');
  }
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i += 1) out[i] = Number.parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  return out;
}

export function utf8Bytes(text: string): Uint8Array {
  return encoder.encode(text);
}

export function utf8Length(text: string): number {
  return encoder.encode(text).length;
}
