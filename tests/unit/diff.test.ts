import { describe, expect, it } from 'vitest';
import { diffLines } from '../../src/utils/diff.js';

describe('diffLines — basics', () => {
  it('reports identical inputs as fully unchanged', () => {
    const result = diffLines('a\nb\nc', 'a\nb\nc');
    expect(result.stats).toMatchObject({ added: 0, removed: 0, changed: 0, unchanged: 3 });
    expect(result.stats.similarity).toBe(100);
  });

  it('detects a pure addition', () => {
    const result = diffLines('a\nb', 'a\nb\nc');
    expect(result.stats.added).toBe(1);
    expect(result.stats.removed).toBe(0);
    expect(result.stats.unchanged).toBe(2);
  });

  it('detects a pure removal', () => {
    const result = diffLines('a\nb\nc', 'a\nc');
    expect(result.stats.removed).toBe(1);
    expect(result.stats.added).toBe(0);
  });

  it('coalesces a remove+add pair into a single change row', () => {
    const result = diffLines('const a = 1;', 'const a = 2;');
    expect(result.stats.changed).toBe(1);
    expect(result.stats.added).toBe(0);
    expect(result.stats.removed).toBe(0);
    const row = result.rows[0];
    expect(row?.op).toBe('change');
    expect(row?.oldText).toBe('const a = 1;');
    expect(row?.newText).toBe('const a = 2;');
  });

  it('carries 1-based line numbers on every row', () => {
    const result = diffLines('a\nb\nc', 'a\nx\nc');
    const change = result.rows.find((r) => r.op === 'change');
    expect(change?.oldLine).toBe(2);
    expect(change?.newLine).toBe(2);
  });

  it('handles an empty original', () => {
    const result = diffLines('', 'a\nb');
    expect(result.stats.added + result.stats.changed).toBeGreaterThan(0);
  });

  it('handles both sides empty', () => {
    const result = diffLines('', '');
    expect(result.stats.similarity).toBe(100);
    expect(result.degraded).toBe(false);
  });

  it('treats CRLF and LF line endings alike', () => {
    const result = diffLines('a\r\nb', 'a\nb');
    expect(result.stats.unchanged).toBe(2);
  });
});

describe('diffLines — options', () => {
  it('ignores case when asked', () => {
    expect(diffLines('Hello', 'hello').stats.changed).toBe(1);
    expect(diffLines('Hello', 'hello', { ignoreCase: true }).stats.unchanged).toBe(1);
  });

  it('ignores whitespace differences when asked', () => {
    expect(diffLines('a   b', 'a b').stats.changed).toBe(1);
    expect(diffLines('a   b', 'a b', { ignoreWhitespace: true }).stats.unchanged).toBe(1);
  });

  it('still reports the original text, not the normalised key', () => {
    const result = diffLines('  A  ', 'a', { ignoreCase: true, ignoreWhitespace: true });
    expect(result.rows[0]?.oldText).toBe('  A  ');
    expect(result.rows[0]?.newText).toBe('a');
  });
});

describe('diffLines — statistics', () => {
  it('computes similarity from the unchanged share', () => {
    const result = diffLines('a\nb\nc\nd', 'a\nb\nc\nX');
    expect(result.stats.similarity).toBeGreaterThan(50);
    expect(result.stats.similarity).toBeLessThan(100);
  });

  it('reports 0% similarity for entirely different inputs', () => {
    const result = diffLines('a\nb', 'x\ny');
    expect(result.stats.unchanged).toBe(0);
    expect(result.stats.similarity).toBe(0);
  });
});

describe('diffLines — large-input guard', () => {
  it('falls back to a block diff instead of stalling', () => {
    // 2100 × 2100 lines exceeds MAX_CELLS, forcing the degraded path.
    const a = Array.from({ length: 2100 }, (_, i) => `line ${i}`).join('\n');
    const b = `${a}\nextra`;
    const started = Date.now();
    const result = diffLines(a, b);
    expect(result.degraded).toBe(true);
    expect(Date.now() - started).toBeLessThan(3000);
    expect(result.stats.added).toBe(1);
  });

  it('keeps the fast path for realistic inputs', () => {
    const a = Array.from({ length: 200 }, (_, i) => `line ${i}`).join('\n');
    const b = a.replace('line 100', 'line one hundred');
    const result = diffLines(a, b);
    expect(result.degraded).toBe(false);
    expect(result.stats.changed).toBe(1);
  });
});
