import { describe, expect, it } from 'vitest';
import { DIVIDER, chunk, codeBlock, escapeHtml, formatBytes, isoUtc, mono, normalizeInput, truncate } from '../../src/utils/text.js';
import { formatCss, formatHtml, formatJs, markdownToHtml, minifyCss } from '../../src/utils/format.js';

describe('escapeHtml', () => {
  it('escapes every Telegram-significant character', () => {
    expect(escapeHtml('<b>')).toBe('&lt;b&gt;');
    expect(escapeHtml('a & b')).toBe('a &amp; b');
    expect(escapeHtml('"quoted"')).toBe('&quot;quoted&quot;');
  });

  it('escapes ampersands first so entities are not double-broken', () => {
    expect(escapeHtml('&lt;')).toBe('&amp;lt;');
  });

  it('neutralises script injection attempts', () => {
    const payload = '<script>alert("xss")</script>';
    const escaped = escapeHtml(payload);
    expect(escaped).not.toContain('<script');
    expect(escaped).not.toContain('</script>');
  });

  it('leaves plain text untouched', () => {
    expect(escapeHtml('سلام dev 123')).toBe('سلام dev 123');
  });
});

describe('codeBlock & mono', () => {
  it('wraps content in a pre block with escaped content', () => {
    expect(codeBlock('<x>')).toBe('<pre>&lt;x&gt;</pre>');
  });

  it('adds a language class when requested', () => {
    expect(codeBlock('{}', 'json')).toContain('class="language-json"');
  });

  it('mono escapes too', () => {
    expect(mono('a<b')).toBe('<code>a&lt;b</code>');
  });
});

describe('truncate', () => {
  it('leaves short input alone', () => {
    expect(truncate('hello', 100)).toBe('hello');
  });

  it('never exceeds the requested maximum', () => {
    const out = truncate('a'.repeat(500), 100);
    expect(out.length).toBeLessThanOrEqual(100);
    expect(out).toContain('truncated');
  });

  it('handles the exact boundary', () => {
    expect(truncate('abcde', 5)).toBe('abcde');
  });
});

describe('normalizeInput', () => {
  it('trims and strips zero-width characters', () => {
    expect(normalizeInput('  he\u200bllo  ')).toBe('hello');
    expect(normalizeInput('a\ufeffb')).toBe('ab');
  });

  it('returns an empty string for whitespace-only input', () => {
    expect(normalizeInput('   \n ')).toBe('');
  });
});

describe('chunk', () => {
  it('returns a single chunk when the text fits', () => {
    expect(chunk('short', 100)).toEqual(['short']);
  });

  it('splits long text into bounded pieces covering all content', () => {
    const text = 'x'.repeat(10_000);
    const parts = chunk(text, 3800);
    expect(parts.length).toBeGreaterThan(1);
    for (const part of parts) expect(part.length).toBeLessThanOrEqual(3800);
    expect(parts.join('')).toHaveLength(10_000);
  });
});

describe('formatBytes', () => {
  it('formats across magnitudes', () => {
    expect(formatBytes(0)).toMatch(/0/);
    expect(formatBytes(512)).toContain('B');
    expect(formatBytes(1024)).toMatch(/1(\.0)? KB/);
    expect(formatBytes(1024 ** 2)).toMatch(/MB/);
  });
});

describe('isoUtc', () => {
  it('renders a UTC ISO string', () => {
    expect(isoUtc(1700000000000)).toContain('2023-11-14');
  });
});

describe('DIVIDER', () => {
  it('is a non-empty visual separator', () => {
    expect(DIVIDER.length).toBeGreaterThan(3);
  });
});

describe('formatHtml', () => {
  it('indents nested elements', () => {
    const out = formatHtml('<div><p>hi</p></div>');
    expect(out.split('\n').length).toBeGreaterThan(1);
    expect(out).toContain('<p>');
  });

  it('does not lose text content', () => {
    expect(formatHtml('<div>hello</div>')).toContain('hello');
  });

  it('handles void elements without breaking indentation', () => {
    const out = formatHtml('<div><br><img src="x"></div>');
    expect(out).toContain('<br');
    expect(out).toContain('<img');
  });

  it('handles empty input', () => {
    expect(formatHtml('')).toBe('');
  });
});

describe('formatCss / minifyCss', () => {
  it('expands rules onto separate lines', () => {
    const out = formatCss('a{color:red;background:blue}');
    expect(out).toContain('color: red;');
    expect(out.split('\n').length).toBeGreaterThan(2);
  });

  it('minify removes comments and whitespace', () => {
    const out = minifyCss('/* c */ a { color : red ; }');
    expect(out).not.toContain('/*');
    expect(out).not.toMatch(/\s{2,}/);
    expect(out).toContain('color:red');
  });

  it('is roughly idempotent for already-formatted css', () => {
    const once = formatCss('a{color:red}');
    expect(formatCss(once)).toContain('color: red;');
  });
});

describe('formatJs', () => {
  it('indents block bodies', () => {
    const out = formatJs('function a(){return 1;}');
    expect(out).toContain('return 1;');
    expect(out.split('\n').length).toBeGreaterThan(1);
  });

  it('does not mangle string literals containing braces', () => {
    const out = formatJs('const s = "{a}";');
    expect(out).toContain('"{a}"');
  });
});

describe('markdownToHtml', () => {
  it('converts basic inline formatting', () => {
    // Emits standard HTML (<strong>/<em>), not Telegram's restricted subset.
    expect(markdownToHtml('**bold**')).toMatch(/<(b|strong)>bold<\/(b|strong)>/);
    expect(markdownToHtml('*italic*')).toMatch(/<(i|em)>italic<\/(i|em)>/);
    expect(markdownToHtml('`code`')).toContain('<code>code</code>');
  });

  it('escapes raw HTML in the source (no XSS passthrough)', () => {
    const out = markdownToHtml('<script>alert(1)</script>');
    expect(out).not.toContain('<script>');
    expect(out).toContain('&lt;script&gt;');
  });

  it('renders safe links only', () => {
    expect(markdownToHtml('[x](https://example.com)')).toContain('href="https://example.com"');
    const bad = markdownToHtml('[x](javascript:alert(1))');
    expect(bad).not.toContain('href="javascript:');
  });

  it('handles headings and lists without crashing', () => {
    const out = markdownToHtml('# Title\n\n- one\n- two');
    expect(out).toContain('Title');
    expect(out).toContain('one');
  });

  it('handles empty input', () => {
    expect(markdownToHtml('')).toBe('');
  });
});
