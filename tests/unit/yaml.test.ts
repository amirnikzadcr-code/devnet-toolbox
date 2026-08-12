import { describe, expect, it } from 'vitest';
import { minifyYaml, parseYaml, parseYamlOrThrow, stringifyYaml, YamlError } from '../../src/utils/yaml.js';
import { ToolError } from '../../src/utils/errors.js';

describe('parseYaml — block mappings', () => {
  it('parses scalars with type coercion', () => {
    expect(parseYaml('name: app\nport: 8080\ndebug: true\nratio: 1.5\nempty: null')).toEqual({
      name: 'app',
      port: 8080,
      debug: true,
      ratio: 1.5,
      empty: null,
    });
  });

  it('parses nested mappings', () => {
    expect(parseYaml('server:\n  host: localhost\n  port: 80')).toEqual({
      server: { host: 'localhost', port: 80 },
    });
  });

  it('parses block sequences', () => {
    expect(parseYaml('items:\n  - a\n  - b\n  - c')).toEqual({ items: ['a', 'b', 'c'] });
  });

  it('parses a sequence of mappings', () => {
    expect(parseYaml('users:\n  - name: ada\n    age: 36\n  - name: bob\n    age: 40')).toEqual({
      users: [
        { name: 'ada', age: 36 },
        { name: 'bob', age: 40 },
      ],
    });
  });

  it('parses flow collections', () => {
    expect(parseYaml('list: [1, 2, 3]\nmap: {a: 1, b: two}')).toEqual({
      list: [1, 2, 3],
      map: { a: 1, b: 'two' },
    });
  });

  it('keeps quoted values as strings', () => {
    expect(parseYaml('version: "1.0"\nid: \'007\'')).toEqual({ version: '1.0', id: '007' });
  });

  it('handles comments and the document marker', () => {
    expect(parseYaml('---\n# a comment\nkey: value  # trailing\n')).toEqual({ key: 'value' });
  });

  it('parses literal and folded block scalars', () => {
    // Per the YAML spec, clip chomping keeps exactly one trailing newline.
    const literal = parseYaml('script: |\n  line one\n  line two') as Record<string, string>;
    expect(literal['script']).toBe('line one\nline two\n');
    const folded = parseYaml('text: >\n  line one\n  line two') as Record<string, string>;
    expect(folded['text']).toBe('line one line two\n');
  });

  it('honours the strip chomping indicator', () => {
    const stripped = parseYaml('script: |-\n  a\n  b') as Record<string, string>;
    expect(stripped['script']).toBe('a\nb');
  });

  it('returns null for an empty document', () => {
    expect(parseYaml('')).toBeNull();
    expect(parseYaml('   \n# only a comment\n')).toBeNull();
  });
});

describe('parseYaml — rejected constructs', () => {
  const rejects = (source: string): void => {
    expect(() => parseYaml(source)).toThrowError(YamlError);
  };

  it('rejects anchors and aliases', () => {
    rejects('base: &anchor\n  a: 1\nchild: *anchor');
  });

  it('rejects custom tags', () => {
    rejects('value: !!python/object apply');
  });

  it('rejects tab indentation', () => {
    rejects('root:\n\tchild: 1');
  });

  it('rejects duplicate keys', () => {
    rejects('a: 1\na: 2');
  });

  it('reports the offending line number', () => {
    try {
      parseYaml('a: 1\nb: 2\n\tc: 3');
      throw new Error('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(YamlError);
      expect((error as YamlError).line).toBeGreaterThan(1);
    }
  });

  it('rejects a document beyond the line cap', () => {
    rejects(Array.from({ length: 2100 }, (_, i) => `k${i}: ${i}`).join('\n'));
  });
});

describe('parseYamlOrThrow', () => {
  it('converts a YamlError into a bilingual ToolError with the line number', () => {
    try {
      parseYamlOrThrow('root:\n\tbad: 1');
      throw new Error('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(ToolError);
      const toolError = error as ToolError;
      expect(toolError.fa).toContain('خط');
      expect(toolError.en).toContain('Line');
    }
  });
});

describe('stringifyYaml', () => {
  it('round-trips a nested structure', () => {
    const value = { name: 'app', server: { host: 'a.io', port: 8080 }, tags: ['x', 'y'] };
    expect(parseYaml(stringifyYaml(value))).toEqual(value);
  });

  it('quotes values that would otherwise change type', () => {
    const yaml = stringifyYaml({ version: '1.0', flag: 'true', zip: '007' });
    expect(parseYaml(yaml)).toEqual({ version: '1.0', flag: 'true', zip: '007' });
  });

  it('emits empty collections inline', () => {
    expect(stringifyYaml({ a: [], b: {} })).toBe('a: []\nb: {}');
  });

  it('round-trips an array of objects', () => {
    const value = [{ id: 1, name: 'a' }, { id: 2, name: 'b' }];
    expect(parseYaml(stringifyYaml(value))).toEqual(value);
  });

  it('round-trips objects containing arrays of objects', () => {
    const value = { users: [{ name: 'ada', roles: ['admin', 'dev'] }, { name: 'bob' }] };
    expect(parseYaml(stringifyYaml(value))).toEqual(value);
  });

  it('round-trips nested arrays', () => {
    const value = { grid: [[1, 2], [3, 4]] };
    expect(parseYaml(stringifyYaml(value))).toEqual(value);
  });

  it('round-trips deep nesting', () => {
    const value = { a: { b: { c: [1, 2, { d: 'e' }] } } };
    expect(parseYaml(stringifyYaml(value))).toEqual(value);
  });
});

describe('minifyYaml', () => {
  it('drops comments and blank lines but keeps structure', () => {
    const minified = minifyYaml('# header\n\na: 1\n\n# mid\nb:\n  c: 2\n');
    expect(minified).toBe('a: 1\nb:\n  c: 2');
    expect(parseYaml(minified)).toEqual({ a: 1, b: { c: 2 } });
  });
});
