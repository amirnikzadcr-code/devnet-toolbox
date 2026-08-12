import { describe, expect, it } from 'vitest';
import { digestHex, hmacHex, md5 } from '../../src/utils/hash.js';

describe('digestHex', () => {
  it('matches the SHA-256 test vector for "abc"', async () => {
    await expect(digestHex('SHA-256', 'abc')).resolves.toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });

  it('matches the SHA-256 test vector for the empty string', async () => {
    await expect(digestHex('SHA-256', '')).resolves.toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    );
  });

  it('matches the SHA-1 test vector for "abc"', async () => {
    await expect(digestHex('SHA-1', 'abc')).resolves.toBe('a9993e364706816aba3e25717850c26c9cd0d89d');
  });

  it('matches the SHA-512 test vector for "abc"', async () => {
    await expect(digestHex('SHA-512', 'abc')).resolves.toBe(
      'ddaf35a193617abacc417349ae20413112e6fa4e89a97ea20a9eeee64b55d39a' +
        '2192992a274fc1a836ba3c23a3feebbd454d4423643ce80e2a9ac94fa54ca49f',
    );
  });

  it('handles UTF-8 input deterministically', async () => {
    const a = await digestHex('SHA-256', 'سلام');
    const b = await digestHex('SHA-256', 'سلام');
    expect(a).toBe(b);
    expect(a).toHaveLength(64);
  });
});

describe('md5 (pure TypeScript implementation)', () => {
  it('matches RFC 1321 test vectors', () => {
    expect(md5('')).toBe('d41d8cd98f00b204e9800998ecf8427e');
    expect(md5('a')).toBe('0cc175b9c0f1b6a831c399e269772661');
    expect(md5('abc')).toBe('900150983cd24fb0d6963f7d28e17f72');
    expect(md5('message digest')).toBe('f96b697d7cb7938d525a2f31aaf161d0');
    expect(md5('abcdefghijklmnopqrstuvwxyz')).toBe('c3fcd3d76192e4007dfb496cca67e13b');
    expect(md5('12345678901234567890123456789012345678901234567890123456789012345678901234567890')).toBe(
      '57edf4a22be3c955ac49da2e2107b67a',
    );
  });

  it('handles multi-byte characters', () => {
    expect(md5('سلام')).toHaveLength(32);
    expect(md5('🌍')).toBe(md5('🌍'));
  });

  it('crosses the 56-byte padding boundary correctly', () => {
    expect(md5('a'.repeat(55))).toBe('ef1772b6dff9a122358552954ad0df65');
    expect(md5('a'.repeat(56))).toBe('3b0c8ac703f828b04c6c197006d17218');
    expect(md5('a'.repeat(64))).toBe('014842d480b571495a4a0363793f7367');
  });
});

describe('hmacHex', () => {
  it('matches RFC 4231 test case 1 (HMAC-SHA-256)', async () => {
    await expect(hmacHex('SHA-256', 'key', 'The quick brown fox jumps over the lazy dog')).resolves.toBe(
      'f7bc83f430538424b13298e6aa6fb143ef4d59a14946175997479dbc2d1a3cd8',
    );
  });

  it('produces a different digest for a different key', async () => {
    const a = await hmacHex('SHA-256', 'key1', 'msg');
    const b = await hmacHex('SHA-256', 'key2', 'msg');
    expect(a).not.toBe(b);
  });
});
