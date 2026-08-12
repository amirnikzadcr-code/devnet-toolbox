import { describe, expect, it } from 'vitest';
import { formatXml, minifyXml, parseXml, XmlError, xmlOutline } from '../../src/utils/xml.js';

const parse = (source: string): ReturnType<typeof parseXml> => parseXml(source);

describe('parseXml — valid documents', () => {
  it('parses a simple tree and counts elements', () => {
    const doc = parse('<root><a>1</a><b>2</b></root>');
    expect(doc.elements).toBe(3);
    expect(doc.maxDepth).toBeGreaterThanOrEqual(2);
  });

  it('parses attributes', () => {
    const doc = parse('<item id="1" name="x"/>');
    const element = doc.nodes.find((n) => n.type === 'element');
    expect(element && element.type === 'element' ? element.attrs : []).toEqual([
      ['id', '1'],
      ['name', 'x'],
    ]);
  });

  it('accepts self-closing tags, comments, CDATA and processing instructions', () => {
    const doc = parse('<?xml version="1.0"?><!-- note --><r><![CDATA[<raw>]]><e/></r>');
    expect(doc.elements).toBe(2);
  });

  it('keeps entity references intact instead of expanding them', () => {
    // By design this parser never resolves an entity: references survive
    // verbatim through parse → format, which is what makes XXE impossible.
    const source = '<r>a &lt; b &amp; c &gt; d &quot;q&quot; &apos;s&apos;</r>';
    const doc = parse(source);
    const root = doc.nodes.find((n) => n.type === 'element');
    const text = root && root.type === 'element' ? root.children[0] : undefined;
    const value = text && text.type === 'text' ? text.value : '';
    expect(value).toContain('&lt;');
    expect(value).toContain('&amp;');
    // Round-tripping must not double-escape the ampersands.
    expect(formatXml(doc)).not.toContain('&amp;lt;');
  });

  it('accepts namespaced element and attribute names', () => {
    expect(() => parse('<ns:root xmlns:ns="urn:x"><ns:child/></ns:root>')).not.toThrow();
  });
});

describe('parseXml — rejected documents', () => {
  const rejects = (source: string): void => {
    expect(() => parse(source)).toThrowError(XmlError);
  };

  it('rejects a mismatched closing tag', () => {
    rejects('<a><b></a></b>');
  });

  it('rejects an unclosed tag', () => {
    rejects('<a><b></a>');
  });

  it('rejects more than one root element', () => {
    rejects('<a/><b/>');
  });

  it('rejects an unquoted attribute value', () => {
    rejects('<a id=1/>');
  });

  it('rejects a duplicate attribute', () => {
    rejects('<a id="1" id="2"/>');
  });

  it('rejects empty input', () => {
    rejects('');
  });

  it('reports a line and column with the error', () => {
    try {
      parse('<a>\n<b>\n</a>');
      throw new Error('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(XmlError);
      expect((error as XmlError).line).toBeGreaterThan(0);
      expect((error as XmlError).column).toBeGreaterThan(0);
    }
  });
});

describe('parseXml — XXE and entity-expansion defences', () => {
  it('rejects a DOCTYPE carrying an internal subset', () => {
    expect(() =>
      parse('<!DOCTYPE foo [<!ENTITY xxe SYSTEM "file:///etc/passwd">]><foo>&xxe;</foo>'),
    ).toThrowError(XmlError);
  });

  it('rejects the billion-laughs shape', () => {
    const bomb =
      '<!DOCTYPE lolz [<!ENTITY lol "lol"><!ENTITY lol2 "&lol;&lol;&lol;">]><lolz>&lol2;</lolz>';
    expect(() => parse(bomb)).toThrowError(XmlError);
  });

  it('never expands a custom entity reference', () => {
    const doc = parse('<r>&custom;</r>');
    const root = doc.nodes.find((n) => n.type === 'element');
    const text = root && root.type === 'element' ? root.children[0] : undefined;
    // The reference survives verbatim; it is not resolved to anything.
    expect(text && text.type === 'text' ? text.value : '').toContain('&custom;');
  });

  it('refuses a document nested past the depth cap', () => {
    const deep = '<a>'.repeat(150) + '</a>'.repeat(150);
    expect(() => parse(deep)).toThrowError(XmlError);
  });
});

describe('formatXml / minifyXml', () => {
  it('pretty-prints with the requested indentation', () => {
    const formatted = formatXml(parse('<a><b x="1"/><c>t</c></a>'), 2);
    expect(formatted).toContain('\n  <b x="1"/>');
    expect(formatted).toContain('<c>t</c>');
  });

  it('produces output that parses back to the same shape', () => {
    const source = '<root><a id="1"><b>text</b></a><c/></root>';
    const doc = parse(source);
    expect(parse(formatXml(doc)).elements).toBe(doc.elements);
    expect(parse(minifyXml(doc)).elements).toBe(doc.elements);
  });

  it('minifies away insignificant whitespace', () => {
    const minified = minifyXml(parse('<a>\n  <b>  </b>\n  <c>keep</c>\n</a>'));
    expect(minified).not.toContain('\n');
    expect(minified).toContain('<c>keep</c>');
  });

  it('re-escapes special characters on output', () => {
    const formatted = formatXml(parse('<a>x &lt; y &amp; z</a>'));
    expect(formatted).toContain('&lt;');
    expect(formatted).toContain('&amp;');
    expect(formatted).not.toMatch(/x < y/);
  });
});

describe('xmlOutline', () => {
  it('lists the element tree with attribute counts', () => {
    const outline = xmlOutline(parse('<root><child a="1" b="2"/></root>'));
    expect(outline[0]).toContain('root');
    expect(outline[1]).toContain('child');
    expect(outline[1]).toContain('2 attr');
  });

  it('respects the entry limit', () => {
    const many = `<r>${'<e/>'.repeat(100)}</r>`;
    expect(xmlOutline(parse(many), 10)).toHaveLength(10);
  });
});
