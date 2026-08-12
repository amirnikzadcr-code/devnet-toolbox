import { describe, expect, it } from 'vitest';
import { decodeJwt } from '../../src/tools/programming/jwt.js';
import { ToolError } from '../../src/utils/errors.js';

// Well-known jwt.io sample token (HS256, no sensitive data).
const SAMPLE =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.' +
  'eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.' +
  'SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c';

describe('decodeJwt', () => {
  it('decodes header and payload of a valid token', () => {
    const decoded = decodeJwt(SAMPLE);
    expect(decoded.header['alg']).toBe('HS256');
    expect(decoded.header['typ']).toBe('JWT');
    expect(decoded.payload['sub']).toBe('1234567890');
    expect(decoded.payload['name']).toBe('John Doe');
    expect(decoded.payload['iat']).toBe(1516239022);
  });

  it('reports signature presence but never claims verification', () => {
    const decoded = decodeJwt(SAMPLE);
    expect(decoded.signaturePresent).toBe(true);
    expect(decoded.signatureLength).toBe(43);
    expect(Object.keys(decoded)).not.toContain('verified');
    expect(Object.keys(decoded)).not.toContain('signature');
  });

  it('rejects tokens with the wrong number of segments', () => {
    expect(() => decodeJwt('a.b.c.d')).toThrowError(ToolError);
    expect(() => decodeJwt('not-a-token')).toThrowError(ToolError);
  });

  it('strips a Bearer prefix before decoding', () => {
    const decoded = decodeJwt(`Bearer ${SAMPLE}`);
    expect(decoded.payload['sub']).toBe('1234567890');
  });

  it('rejects a token whose payload is not JSON', () => {
    expect(() => decodeJwt('eyJhbGciOiJIUzI1NiJ9.bm90LWpzb24.sig')).toThrowError(ToolError);
  });

  it('rejects an empty token', () => {
    expect(() => decodeJwt('')).toThrowError(ToolError);
  });

  it('handles tokens with url-safe base64 characters', () => {
    const decoded = decodeJwt(SAMPLE);
    expect(typeof decoded.payload).toBe('object');
  });
});
