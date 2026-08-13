/**
 * Sanitiser for tool HTML rendered inside the Mini App.
 *
 * The Mini App injects tool output with `dangerouslySetInnerHTML`, so this
 * function is the boundary that stops a tool which echoes user input from
 * turning into stored/self XSS. Every payload below is a real technique.
 */
import { describe, expect, it } from 'vitest';
import { sanitizeHtml } from '../../app-worker/src/sanitize.js';

describe('sanitizeHtml — allowed subset survives', () => {
  it('keeps the Telegram formatting tags tools actually emit', () => {
    const input = '<b>bold</b> <i>it</i> <u>u</u> <s>s</s> <code>x</code><br><pre>block</pre>';
    const out = sanitizeHtml(input);
    expect(out).toContain('<b>bold</b>');
    expect(out).toContain('<i>it</i>');
    expect(out).toContain('<code>x</code>');
    expect(out).toContain('<br>');
    expect(out).toContain('<pre>block</pre>');
  });

  it('keeps http/https links', () => {
    const out = sanitizeHtml('<a href="https://example.com">go</a>');
    expect(out).toBe('<a href="https://example.com">go</a>');
  });

  it('preserves Persian text and emoji untouched', () => {
    const out = sanitizeHtml('<b>نتیجه:</b> ۱۲۳ ✅');
    expect(out).toBe('<b>نتیجه:</b> ۱۲۳ ✅');
  });

  it('balances an unclosed tag rather than leaking it', () => {
    expect(sanitizeHtml('<b>oops')).toBe('<b>oops</b>');
  });

  it('drops a stray closing tag', () => {
    expect(sanitizeHtml('hello</b>')).toBe('hello');
  });
});

describe('sanitizeHtml — XSS payloads', () => {
  const payloads: [string, string][] = [
    ['inline script', '<script>alert(1)</script>'],
    ['img onerror', '<img src=x onerror=alert(1)>'],
    ['svg onload', '<svg onload=alert(1)>'],
    ['iframe', '<iframe src="https://evil.test"></iframe>'],
    ['body onload', '<body onload=alert(1)>'],
    ['style block', '<style>*{display:none}</style>'],
    ['form injection', '<form action="https://evil.test"><input name="x">'],
    ['object embed', '<object data="javascript:alert(1)"></object>'],
    ['meta refresh', '<meta http-equiv="refresh" content="0;url=https://evil.test">'],
    ['link stylesheet', '<link rel="stylesheet" href="https://evil.test/x.css">'],
    ['base tag', '<base href="https://evil.test/">'],
    ['details ontoggle', '<details open ontoggle=alert(1)>'],
    ['math mtext', '<math><mtext><script>alert(1)</script></mtext></math>'],
    ['textarea escape', '</textarea><script>alert(1)</script>'],
  ];

  for (const [name, payload] of payloads) {
    it(`neutralises ${name}`, () => {
      const out = sanitizeHtml(payload);
      // The contract is that no *live* element survives. A payload's text may
      // still appear (escaped), which is correct and visible-but-inert; the
      // failure mode we care about is a real tag reaching the DOM.
      expect(out).not.toMatch(/<\s*(script|img|svg|iframe|style|form|object|meta|link|base|details|math|body)\b/i);
      // No attribute may survive on any element the sanitiser emits: every
      // remaining "<tag" must be an allow-listed tag with no event handler.
      for (const match of out.matchAll(/<([a-z]+)([^>]*)>/gi)) {
        expect(match[2] ?? '').not.toMatch(/\bon[a-z]+\s*=/i);
      }
    });
  }

  it('renders a dangerous payload as inert escaped text, not markup', () => {
    const out = sanitizeHtml('<img src=x onerror=alert(1)>');
    // Angle brackets are entity-encoded, so the browser prints it rather than
    // parsing it into an element that could fire onerror.
    expect(out).toBe('&lt;img src=x onerror=alert(1)&gt;');
    expect(out).not.toContain('<img');
  });

  it('strips event handlers from otherwise-allowed tags', () => {
    const out = sanitizeHtml('<b onclick="alert(1)">x</b>');
    expect(out).toBe('<b>x</b>');
    expect(out).not.toContain('onclick');
  });

  it('rejects javascript: URLs', () => {
    const out = sanitizeHtml('<a href="javascript:alert(1)">x</a>');
    expect(out).toBe('<a>x</a>');
    expect(out).not.toContain('javascript');
  });

  it('rejects data: URLs', () => {
    const out = sanitizeHtml('<a href="data:text/html,<script>alert(1)</script>">x</a>');
    expect(out).not.toContain('data:');
  });

  it('rejects javascript: obfuscated with control characters and spacing', () => {
    const out = sanitizeHtml('<a href="java\tscript:alert(1)">x</a>');
    expect(out).not.toMatch(/href="java/i);
  });

  it('rejects vbscript: URLs', () => {
    const out = sanitizeHtml('<a href="vbscript:msgbox(1)">x</a>');
    expect(out).not.toContain('vbscript');
  });

  it('escapes a nested script inside an allowed tag', () => {
    const out = sanitizeHtml('<b><script>alert(1)</script></b>');
    expect(out).not.toMatch(/<script/i);
    expect(out).toContain('&lt;script&gt;');
  });

  it('escapes raw angle brackets from user input', () => {
    const out = sanitizeHtml('5 < 10 && 10 > 5');
    expect(out).toContain('&lt;');
    expect(out).toContain('&gt;');
    expect(out).toContain('&amp;');
  });

  it('drops HTML comments (conditional-comment vector)', () => {
    const out = sanitizeHtml('<!--[if IE]><script>alert(1)</script><![endif]-->ok');
    expect(out).not.toMatch(/<script/i);
    expect(out).toContain('ok');
  });

  it('only keeps a safe class attribute', () => {
    expect(sanitizeHtml('<code class="lang-js">x</code>')).toBe('<code class="lang-js">x</code>');
    expect(sanitizeHtml('<code class="a b\\"onload=x">y</code>')).not.toContain('onload');
  });
});

describe('sanitizeHtml — robustness', () => {
  it('handles empty input', () => {
    expect(sanitizeHtml('')).toBe('');
  });

  it('handles an unterminated tag without hanging', () => {
    const out = sanitizeHtml('<b attr="unterminated');
    expect(out).not.toContain('<b ');
  });

  it('truncates beyond the length cap', () => {
    const out = sanitizeHtml('a'.repeat(70_000), 1000);
    expect(out.length).toBeLessThanOrEqual(1000);
  });

  it('bounds pathological nesting instead of exhausting memory', () => {
    const out = sanitizeHtml('<b>'.repeat(500) + 'deep');
    expect(out).toContain('deep');
    // The guard stops adding new open tags long before 500.
    expect((out.match(/<b>/g) ?? []).length).toBeLessThanOrEqual(32);
  });

  it('completes a large realistic document quickly', () => {
    const doc = '<b>row</b> <code>value</code><br>'.repeat(2000);
    const started = Date.now();
    const out = sanitizeHtml(doc);
    expect(Date.now() - started).toBeLessThan(1000);
    expect(out).toContain('<b>row</b>');
  });
});
