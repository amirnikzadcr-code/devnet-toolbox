import { describe, expect, it } from 'vitest';
import {
  CHARSETS,
  entropyBits,
  randomBytes,
  randomFromCharset,
  randomHex,
  secureRandomInt,
  strengthLabel,
  uuidV4,
  uuidV7,
} from '../../src/utils/random.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-9a-f][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

describe('secureRandomInt', () => {
  it('always stays inside [0, max)', () => {
    for (let i = 0; i < 500; i += 1) {
      const value = secureRandomInt(10);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(10);
      expect(Number.isInteger(value)).toBe(true);
    }
  });

  it('covers the whole range over many draws (no dead buckets)', () => {
    const seen = new Set<number>();
    for (let i = 0; i < 2000; i += 1) seen.add(secureRandomInt(8));
    expect(seen.size).toBe(8);
  });

  it('rejects a non-positive max', () => {
    expect(() => secureRandomInt(0)).toThrowError(RangeError);
    expect(() => secureRandomInt(-3)).toThrowError(RangeError);
  });
});

describe('randomFromCharset', () => {
  it('produces the requested length using only charset characters', () => {
    const out = randomFromCharset(64, CHARSETS.unambiguous);
    expect(out).toHaveLength(64);
    for (const ch of out) expect(CHARSETS.unambiguous).toContain(ch);
  });

  it('never emits look-alike characters from the unambiguous set', () => {
    const out = randomFromCharset(500, CHARSETS.unambiguous);
    expect(out).not.toMatch(/[0O1lI]/);
  });

  it('rejects an empty charset', () => {
    expect(() => randomFromCharset(4, '')).toThrowError(RangeError);
  });

  it('returns an empty string for zero length', () => {
    expect(randomFromCharset(0, CHARSETS.lower)).toBe('');
  });
});

describe('randomBytes / randomHex', () => {
  it('returns the requested byte length', () => {
    expect(randomBytes(32)).toHaveLength(32);
    expect(randomHex(32)).toHaveLength(64);
    expect(randomHex(16)).toMatch(/^[0-9a-f]{32}$/);
  });

  it('does not repeat across calls', () => {
    const values = new Set(Array.from({ length: 50 }, () => randomHex(16)));
    expect(values.size).toBe(50);
  });
});

describe('UUID generation', () => {
  it('generates valid v4 UUIDs', () => {
    for (let i = 0; i < 20; i += 1) {
      const id = uuidV4();
      expect(id).toMatch(UUID_RE);
      expect(id[14]).toBe('4');
    }
  });

  it('generates valid v7 UUIDs with the version and variant nibbles set', () => {
    const id = uuidV7();
    expect(id).toMatch(UUID_RE);
    expect(id[14]).toBe('7');
    expect('89ab').toContain(id[19]);
  });

  it('generates time-ordered v7 UUIDs', () => {
    const first = uuidV7();
    const second = uuidV7();
    // Compare the 48-bit timestamp prefix; monotonic non-decreasing.
    const prefix = (u: string): string => u.replace(/-/g, '').slice(0, 12);
    expect(prefix(second) >= prefix(first)).toBe(true);
  });

  it('never repeats', () => {
    const ids = new Set(Array.from({ length: 200 }, () => uuidV4()));
    expect(ids.size).toBe(200);
  });
});

describe('entropyBits & strengthLabel', () => {
  it('computes known entropy values', () => {
    expect(entropyBits(16, 2)).toBe(16);
    expect(entropyBits(10, 64)).toBe(60);
    expect(entropyBits(0, 62)).toBe(0);
    expect(entropyBits(10, 1)).toBe(0);
  });

  it('maps entropy onto human-readable strength', () => {
    expect(strengthLabel(200).en).toBe('Excellent');
    expect(strengthLabel(100).en).toBe('Strong');
    expect(strengthLabel(80).en).toBe('Good');
    expect(strengthLabel(50).en).toBe('Fair');
    expect(strengthLabel(10).en).toBe('Weak');
  });

  it('always returns a bilingual label with a bar', () => {
    for (const bits of [0, 30, 60, 90, 130]) {
      const label = strengthLabel(bits);
      expect(label.fa).toBeTruthy();
      expect(label.en).toBeTruthy();
      expect([...label.bar]).toHaveLength(5);
    }
  });
});
