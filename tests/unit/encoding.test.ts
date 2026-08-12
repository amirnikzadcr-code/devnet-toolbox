import { describe, expect, it } from 'vitest';
import {
  base64Decode,
  base64Encode,
  base64UrlEncode,
  base64UrlToStandard,
  bytesToHex,
  hexToBytes,
  utf8Length,
} from '../../src/utils/encoding.js';
import { ToolError } from '../../src/utils/errors.js';

describe('base64', () => {
  it('round-trips ASCII', () => {
    expect(base64Encode('Hello, World!')).toBe('SGVsbG8sIFdvcmxkIQ==');
    expect(base64Decode('SGVsbG8sIFdvcmxkIQ==')).toBe('Hello, World!');
  });

  it('round-trips multi-byte UTF-8 (Persian + emoji)', () => {
    const source = 'سلام دنیا 🌍';
    const encoded = base64Encode(source);
    expect(base64Decode(encoded)).toBe(source);
  });

  it('handles empty string', () => {
    expect(base64Encode('')).toBe('');
    expect(base64Decode('')).toBe('');
  });

  it('rejects invalid base64 with a ToolError', () => {
    expect(() => base64Decode('!!!not-base64!!!')).toThrowError(ToolError);
  });

  it('normalises base64url alphabet and padding', () => {
    expect(base64UrlToStandard('SGVsbG8-V29ybGR_IQ')).toBe('SGVsbG8+V29ybGR/IQ==');
    expect(base64UrlToStandard('QQ')).toBe('QQ==');
    expect(base64UrlToStandard('QUJD')).toBe('QUJD');
  });

  it('produces url-safe output without padding', () => {
    const out = base64UrlEncode('any carnal pleasure?');
    expect(out).not.toContain('=');
    expect(out).not.toContain('+');
    expect(out).not.toContain('/');
  });
});

describe('hex helpers', () => {
  it('converts bytes to hex and back', () => {
    const bytes = new Uint8Array([0, 1, 15, 16, 255]);
    const hex = bytesToHex(bytes);
    expect(hex).toBe('00010f10ff');
    expect([...hexToBytes(hex)]).toEqual([...bytes]);
  });

  it('rejects odd-length hex', () => {
    expect(() => hexToBytes('abc')).toThrowError(ToolError);
  });
});

describe('utf8Length', () => {
  it('counts bytes not code units', () => {
    expect(utf8Length('abc')).toBe(3);
    expect(utf8Length('سلام')).toBe(8);
    expect(utf8Length('🌍')).toBe(4);
  });
});
