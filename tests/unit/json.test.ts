import { describe, expect, it } from 'vitest';
import { parseJsonSafe, jsonFormat, jsonMinify, jsonValidate } from '../../src/tools/programming/json.js';
import { ToolError } from '../../src/utils/errors.js';
import type { ToolRunContext } from '../../src/tools/types.js';

const ctx: ToolRunContext = { lang: 'fa', userId: 1 };

describe('parseJsonSafe', () => {
  it('parses valid objects and arrays', () => {
    expect(parseJsonSafe('{"a":1}')).toEqual({ a: 1 });
    expect(parseJsonSafe('[1,2,3]')).toEqual([1, 2, 3]);
  });

  it('throws a localized ToolError on malformed JSON', () => {
    try {
      parseJsonSafe('{a:1}');
      throw new Error('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(ToolError);
      const toolError = error as ToolError;
      expect(toolError.fa.length).toBeGreaterThan(0);
      expect(toolError.en.length).toBeGreaterThan(0);
      expect(toolError.fa).not.toContain('undefined');
    }
  });

  it('rejects truncated JSON', () => {
    expect(() => parseJsonSafe('{"a": ')).toThrowError(ToolError);
  });
});

describe('json_format tool', () => {
  it('pretty-prints nested structures', async () => {
    const result = await jsonFormat.run('{"b":2,"a":{"c":[1,2]}}', ctx);
    // Output is HTML-escaped for Telegram, so quotes appear as &quot;
    expect(result.html).toContain('&quot;a&quot;');
    expect(result.html).toContain('&quot;c&quot;');
    expect(result.html).toContain('<pre>');
  });

  it('escapes HTML-dangerous payloads', async () => {
    const result = await jsonFormat.run('{"x":"<script>alert(1)</script>"}', ctx);
    expect(result.html).not.toContain('<script>');
    expect(result.html).toContain('&lt;script&gt;');
  });

  it('surfaces a friendly error for invalid input', () => {
    expect(() => jsonFormat.run('nope', ctx)).toThrowError(ToolError);
  });
});

describe('json_minify tool', () => {
  it('removes all insignificant whitespace', async () => {
    const result = await jsonMinify.run('{\n  "a" :  1 ,\n  "b" : [1, 2]\n}', ctx);
    expect(result.html).toContain('{&quot;a&quot;:1,&quot;b&quot;:[1,2]}');
    expect(result.html).toMatch(/31 B/);
  });
});

describe('json_validate tool', () => {
  it('reports success for valid JSON', async () => {
    const result = await jsonValidate.run('{"ok":true}', ctx);
    expect(result.html).toMatch(/✅/);
  });

  it('reports a readable failure for invalid JSON without throwing', async () => {
    const result = await jsonValidate.run('{"ok":}', ctx);
    expect(result.html).toMatch(/❌/);
    expect(result.html).toContain('<pre>');
  });
});

describe('json tool metadata', () => {
  it('every JSON tool documents itself bilingually', () => {
    for (const tool of [jsonFormat, jsonMinify, jsonValidate]) {
      expect(tool.title.fa).toBeTruthy();
      expect(tool.title.en).toBeTruthy();
      expect(tool.description.fa.length).toBeGreaterThan(20);
      expect(tool.example.fa).toBeTruthy();
      expect(tool.limitations.fa).toBeTruthy();
    }
  });
});
