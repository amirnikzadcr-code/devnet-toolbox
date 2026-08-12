/**
 * Dependency-free YAML subset parser + emitter.
 *
 * The Worker bundle must stay small and free of third-party code, so this file
 * implements the part of YAML 1.2 that developers actually paste into a bot:
 * block mappings, block sequences, flow collections, quoted/plain scalars,
 * block scalars (`|`, `>`), comments, and the `---` document marker.
 *
 * Explicitly NOT supported (and reported with a clear message instead of a
 * wrong result): anchors/aliases, tags, complex keys, multiple documents.
 */
import { errInvalidInput } from './errors.js';

/** Guard rails — YAML input is user-controlled. */
const MAX_LINES = 2000;
const MAX_DEPTH = 30;

export class YamlError extends Error {
  readonly line: number;
  constructor(message: string, line: number) {
    super(message);
    this.name = 'YamlError';
    this.line = line;
  }
}

const fail = (message: string, line: number): never => {
  throw new YamlError(message, line);
};

interface Line {
  /** Number of leading spaces. */
  indent: number;
  /** Comment-stripped, right-trimmed content. */
  content: string;
  /** 1-based source line number, for error messages. */
  num: number;
}

/** Removes an unquoted trailing `#` comment. */
function stripComment(raw: string): string {
  let quote: '"' | "'" | null = null;
  for (let i = 0; i < raw.length; i += 1) {
    const ch = raw[i] as string;
    if (quote) {
      if (ch === '\\' && quote === '"') {
        i += 1;
        continue;
      }
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (ch === '#' && (i === 0 || /\s/.test(raw[i - 1] as string))) {
      return raw.slice(0, i);
    }
  }
  return raw;
}

function tokenize(src: string): Line[] {
  const rawLines = src.split(/\r?\n/);
  if (rawLines.length > MAX_LINES) {
    fail(`YAML has too many lines (max ${MAX_LINES}).`, MAX_LINES);
  }
  const lines: Line[] = [];
  let blockScalarIndent = -1;

  for (let i = 0; i < rawLines.length; i += 1) {
    const raw = rawLines[i] as string;
    const num = i + 1;

    if (raw.includes('\t') && /^\s*\t/.test(raw)) {
      fail('Tabs cannot be used for indentation in YAML — use spaces.', num);
    }

    const indent = raw.length - raw.replace(/^ +/, '').length;

    // Inside a block scalar every line is verbatim; only indentation matters.
    if (blockScalarIndent >= 0) {
      if (raw.trim() === '' || indent >= blockScalarIndent) {
        lines.push({ indent, content: raw.slice(Math.min(indent, blockScalarIndent)), num });
        continue;
      }
      blockScalarIndent = -1;
    }

    const trimmed = stripComment(raw).replace(/\s+$/, '');
    if (trimmed.trim() === '') continue;
    if (/^---\s*$/.test(trimmed)) continue;
    if (/^\.\.\.\s*$/.test(trimmed)) break;
    if (/^%/.test(trimmed)) continue; // directives

    const content = trimmed.slice(indent);
    lines.push({ indent, content, num });

    if (/(^|\s)[|>][-+]?\d*\s*$/.test(content)) {
      blockScalarIndent = indent + 1;
    }
  }
  return lines;
}

// ─── Scalars ──────────────────────────────────────────────────────────────

function unescapeDouble(body: string, line: number): string {
  let out = '';
  for (let i = 0; i < body.length; i += 1) {
    const ch = body[i] as string;
    if (ch !== '\\') {
      out += ch;
      continue;
    }
    const next = body[i + 1];
    i += 1;
    switch (next) {
      case 'n': out += '\n'; break;
      case 't': out += '\t'; break;
      case 'r': out += '\r'; break;
      case '0': out += '\0'; break;
      case 'b': out += '\b'; break;
      case 'f': out += '\f'; break;
      case '"': out += '"'; break;
      case '\\': out += '\\'; break;
      case '/': out += '/'; break;
      case 'u': {
        const hex = body.slice(i + 1, i + 5);
        if (!/^[0-9a-fA-F]{4}$/.test(hex)) fail('Invalid \\u escape in a double-quoted string.', line);
        out += String.fromCharCode(Number.parseInt(hex, 16));
        i += 4;
        break;
      }
      default:
        fail(`Unknown escape sequence \\${next ?? ''} in a double-quoted string.`, line);
    }
  }
  return out;
}

/** Parses a plain (unquoted) YAML scalar into a JS value. */
function plainScalar(raw: string): unknown {
  const value = raw.trim();
  if (value === '' || value === '~' || value === 'null' || value === 'Null' || value === 'NULL') return null;
  if (value === 'true' || value === 'True' || value === 'TRUE' || value === 'yes' || value === 'on') return true;
  if (value === 'false' || value === 'False' || value === 'FALSE' || value === 'no' || value === 'off') return false;
  if (/^[+-]?\d+$/.test(value)) {
    const n = Number(value);
    return Number.isSafeInteger(n) ? n : value;
  }
  if (/^0x[0-9a-fA-F]+$/.test(value)) return Number.parseInt(value.slice(2), 16);
  if (/^0o[0-7]+$/.test(value)) return Number.parseInt(value.slice(2), 8);
  if (/^[+-]?(\d+\.\d*|\.\d+|\d+)([eE][+-]?\d+)?$/.test(value)) {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  if (value === '.inf' || value === '.Inf') return Infinity;
  if (value === '-.inf' || value === '-.Inf') return -Infinity;
  if (value === '.nan' || value === '.NaN') return NaN;
  return value;
}

/** Parses a scalar that may be quoted, a flow collection, or plain. */
function parseScalar(raw: string, line: number): unknown {
  const value = raw.trim();
  if (value === '') return null;
  if (value.startsWith('&') || value.startsWith('*')) {
    fail('Anchors and aliases (& / *) are not supported.', line);
  }
  if (value.startsWith('!')) {
    fail('Explicit tags (!tag) are not supported.', line);
  }
  if (value.startsWith('"')) {
    if (!value.endsWith('"') || value.length < 2) fail('Unterminated double-quoted string.', line);
    return unescapeDouble(value.slice(1, -1), line);
  }
  if (value.startsWith("'")) {
    if (!value.endsWith("'") || value.length < 2) fail('Unterminated single-quoted string.', line);
    return value.slice(1, -1).replaceAll("''", "'");
  }
  if (value.startsWith('[') || value.startsWith('{')) return parseFlow(value, line);
  return plainScalar(value);
}

// ─── Flow collections: [a, b] / {a: 1} ────────────────────────────────────

function parseFlow(src: string, line: number): unknown {
  let pos = 0;

  const skipWs = (): void => {
    while (pos < src.length && /\s/.test(src[pos] as string)) pos += 1;
  };

  const readQuoted = (quote: string): string => {
    let out = '';
    pos += 1;
    while (pos < src.length) {
      const ch = src[pos] as string;
      if (quote === '"' && ch === '\\') {
        out += ch + (src[pos + 1] ?? '');
        pos += 2;
        continue;
      }
      if (ch === quote) {
        pos += 1;
        return quote === '"' ? unescapeDouble(out, line) : out.replaceAll("''", "'");
      }
      out += ch;
      pos += 1;
    }
    return fail('Unterminated quoted string inside a flow collection.', line) as never;
  };

  const readValue = (depth: number): unknown => {
    if (depth > MAX_DEPTH) fail('Flow collection nested too deeply.', line);
    skipWs();
    const ch = src[pos];
    if (ch === undefined) return null;
    if (ch === '[') {
      pos += 1;
      const arr: unknown[] = [];
      skipWs();
      if (src[pos] === ']') {
        pos += 1;
        return arr;
      }
      for (;;) {
        arr.push(readValue(depth + 1));
        skipWs();
        const sep = src[pos];
        if (sep === ',') {
          pos += 1;
          skipWs();
          if (src[pos] === ']') {
            pos += 1;
            return arr;
          }
          continue;
        }
        if (sep === ']') {
          pos += 1;
          return arr;
        }
        return fail('Expected "," or "]" in a flow sequence.', line) as never;
      }
    }
    if (ch === '{') {
      pos += 1;
      const obj: Record<string, unknown> = {};
      skipWs();
      if (src[pos] === '}') {
        pos += 1;
        return obj;
      }
      for (;;) {
        skipWs();
        const keyChar = src[pos];
        const key =
          keyChar === '"' || keyChar === "'"
            ? String(readQuoted(keyChar))
            : (() => {
                let k = '';
                while (pos < src.length && !':,}'.includes(src[pos] as string)) {
                  k += src[pos] as string;
                  pos += 1;
                }
                return k.trim();
              })();
        skipWs();
        if (src[pos] !== ':') fail('Expected ":" in a flow mapping.', line);
        pos += 1;
        obj[key] = readValue(depth + 1);
        skipWs();
        const sep = src[pos];
        if (sep === ',') {
          pos += 1;
          skipWs();
          if (src[pos] === '}') {
            pos += 1;
            return obj;
          }
          continue;
        }
        if (sep === '}') {
          pos += 1;
          return obj;
        }
        return fail('Expected "," or "}" in a flow mapping.', line) as never;
      }
    }
    if (ch === '"' || ch === "'") return readQuoted(ch);
    let raw = '';
    while (pos < src.length && !',]}'.includes(src[pos] as string)) {
      raw += src[pos] as string;
      pos += 1;
    }
    return plainScalar(raw);
  };

  const value = readValue(0);
  skipWs();
  if (pos < src.length) fail('Unexpected trailing characters after a flow collection.', line);
  return value;
}

// ─── Block structure ──────────────────────────────────────────────────────

/** Splits `key: value`, honouring quoted keys and `://` inside plain values. */
function splitKey(content: string, line: number): { key: string; rest: string } | null {
  if (content.startsWith('"') || content.startsWith("'")) {
    const quote = content[0] as string;
    let i = 1;
    while (i < content.length) {
      const ch = content[i] as string;
      if (quote === '"' && ch === '\\') {
        i += 2;
        continue;
      }
      if (ch === quote) break;
      i += 1;
    }
    if (i >= content.length) fail('Unterminated quoted key.', line);
    const key = String(parseScalar(content.slice(0, i + 1), line));
    const rest = content.slice(i + 1).trimStart();
    if (!rest.startsWith(':')) fail('Expected ":" after a quoted key.', line);
    return { key, rest: rest.slice(1).trim() };
  }
  let depth = 0;
  for (let i = 0; i < content.length; i += 1) {
    const ch = content[i] as string;
    if (ch === '[' || ch === '{') depth += 1;
    else if (ch === ']' || ch === '}') depth -= 1;
    else if (ch === ':' && depth === 0) {
      const next = content[i + 1];
      if (next === undefined || next === ' ') {
        return { key: content.slice(0, i).trim(), rest: content.slice(i + 1).trim() };
      }
    }
  }
  return null;
}

function readBlockScalar(lines: Line[], index: number, header: string, parentIndent: number): { value: string; next: number } {
  const style = header.trimStart()[0] === '>' ? 'folded' : 'literal';
  const chomp = /[-+]/.exec(header)?.[0] ?? '';
  const body: string[] = [];
  let i = index + 1;
  while (i < lines.length) {
    const line = lines[i] as Line;
    if (line.content.trim() === '' ) {
      body.push('');
      i += 1;
      continue;
    }
    if (line.indent <= parentIndent) break;
    body.push(line.content);
    i += 1;
  }
  // Normalise the common indentation of the block.
  const nonEmpty = body.filter((l) => l.trim() !== '');
  const base = nonEmpty.length
    ? Math.min(...nonEmpty.map((l) => l.length - l.replace(/^ +/, '').length))
    : 0;
  const trimmedBody = body.map((l) => (l.trim() === '' ? '' : l.slice(base)));
  while (trimmedBody.length && trimmedBody[trimmedBody.length - 1] === '') trimmedBody.pop();

  let value: string;
  if (style === 'folded') {
    const paragraphs: string[] = [];
    let current: string[] = [];
    for (const l of trimmedBody) {
      if (l === '') {
        paragraphs.push(current.join(' '));
        current = [];
      } else current.push(l);
    }
    paragraphs.push(current.join(' '));
    value = paragraphs.join('\n');
  } else {
    value = trimmedBody.join('\n');
  }
  if (chomp !== '-') value += '\n';
  if (chomp === '-') value = value.replace(/\n+$/, '');
  return { value, next: i };
}

/**
 * Indentation of a nested block.
 *
 * YAML does not mandate a fixed indent step, so the child block owns whatever
 * indentation its first line happens to use. Assuming `parent + 1` would
 * reject the near-universal two-space style, which is what this helper fixes.
 */
function childIndent(lines: Line[], index: number, parentIndent: number): number {
  const line = lines[index];
  return line && line.indent > parentIndent ? line.indent : parentIndent + 1;
}

function parseBlock(lines: Line[], start: number, indent: number, depth: number): { value: unknown; next: number } {
  if (depth > MAX_DEPTH) fail('YAML nested too deeply.', lines[start]?.num ?? 0);
  const first = lines[start];
  if (!first) return { value: null, next: start };

  // ── Sequence
  if (first.content === '-' || first.content.startsWith('- ')) {
    const items: unknown[] = [];
    let i = start;
    while (i < lines.length) {
      const line = lines[i] as Line;
      if (line.indent < indent) break;
      // A deeper line here belongs to the previous item's nested block, which
      // that item already consumed; anything left over is malformed.
      if (line.indent > indent) fail('Unexpected indentation inside a sequence.', line.num);
      if (line.content !== '-' && !line.content.startsWith('- ')) break;

      const rest = line.content === '-' ? '' : line.content.slice(2).trim();
      if (rest === '') {
        const child = parseBlock(lines, i + 1, childIndent(lines, i + 1, indent), depth + 1);
        if (child.next === i + 1) {
          items.push(null);
          i += 1;
        } else {
          items.push(child.value);
          i = child.next;
        }
        continue;
      }
      if (/^[|>][-+]?\d*$/.test(rest)) {
        const block = readBlockScalar(lines, i, rest, line.indent);
        items.push(block.value);
        i = block.next;
        continue;
      }
      // `- key: value` starts an inline mapping owned by this item, and
      // `- - x` starts an inline nested sequence. Both are handled by
      // re-parsing the remainder as its own block at a virtual indent.
      const kv = rest.startsWith('- ') || rest === '-' ? { key: '', rest: '' } : splitKey(rest, line.num);
      if (kv) {
        const virtualIndent = line.indent + 2;
        const sub: Line[] = [{ indent: virtualIndent, content: rest, num: line.num }];
        let j = i + 1;
        while (j < lines.length && (lines[j] as Line).indent > line.indent) {
          const inner = lines[j] as Line;
          sub.push({ indent: Math.max(virtualIndent, inner.indent), content: inner.content, num: inner.num });
          j += 1;
        }
        const parsed = parseBlock(sub, 0, virtualIndent, depth + 1);
        items.push(parsed.value);
        i = j;
        continue;
      }
      items.push(parseScalar(rest, line.num));
      i += 1;
    }
    return { value: items, next: i };
  }

  // ── Mapping
  const firstKv = splitKey(first.content, first.num);
  if (!firstKv) {
    // A bare scalar document.
    return { value: parseScalar(first.content, first.num), next: start + 1 };
  }

  const map: Record<string, unknown> = {};
  let i = start;
  while (i < lines.length) {
    const line = lines[i] as Line;
    if (line.indent < indent) break;
    if (line.indent > indent) fail('Unexpected indentation — check the spaces before this key.', line.num);
    if (line.content === '-' || line.content.startsWith('- ')) break;

    const kv = splitKey(line.content, line.num);
    if (!kv) fail(`Expected "key: value" but found: ${line.content.slice(0, 40)}`, line.num);
    const { key, rest } = kv as { key: string; rest: string };
    if (key === '') fail('Empty mapping key.', line.num);
    if (Object.prototype.hasOwnProperty.call(map, key)) {
      fail(`Duplicate key "${key}".`, line.num);
    }

    if (/^[|>][-+]?\d*$/.test(rest)) {
      const block = readBlockScalar(lines, i, rest, line.indent);
      map[key] = block.value;
      i = block.next;
      continue;
    }
    if (rest === '') {
      const child = parseBlock(lines, i + 1, childIndent(lines, i + 1, indent), depth + 1);
      if (child.next === i + 1) {
        map[key] = null;
        i += 1;
      } else {
        map[key] = child.value;
        i = child.next;
      }
      continue;
    }
    map[key] = parseScalar(rest, line.num);
    i += 1;
  }
  return { value: map, next: i };
}

/** Parses a YAML document into plain JS values. Throws `YamlError`. */
export function parseYaml(src: string): unknown {
  const lines = tokenize(src);
  if (lines.length === 0) return null;
  const minIndent = Math.min(...lines.map((l) => l.indent));
  const { value, next } = parseBlock(lines, 0, minIndent, 0);
  if (next < lines.length) {
    fail('Unexpected content after the end of the document.', (lines[next] as Line).num);
  }
  return value;
}

/** Convenience wrapper that raises a localized `ToolError`. */
export function parseYamlOrThrow(src: string): unknown {
  try {
    return parseYaml(src);
  } catch (error) {
    if (error instanceof YamlError) {
      throw errInvalidInput(
        `YAML معتبر نیست.\nخط ${error.line}: ${error.message}`,
        `Invalid YAML.\nLine ${error.line}: ${error.message}`,
      );
    }
    throw errInvalidInput('YAML معتبر نیست.', 'Invalid YAML.');
  }
}

// ─── Emitter ──────────────────────────────────────────────────────────────

const PLAIN_SAFE = /^[A-Za-z0-9_][A-Za-z0-9 _./@+-]*$/;
const RESERVED = new Set([
  'true', 'false', 'null', 'yes', 'no', 'on', 'off', '~',
  'True', 'False', 'Null', 'TRUE', 'FALSE', 'NULL',
]);

function emitScalar(value: unknown): string {
  if (value === null || value === undefined) return 'null';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') {
    if (Number.isNaN(value)) return '.nan';
    if (value === Infinity) return '.inf';
    if (value === -Infinity) return '-.inf';
    return String(value);
  }
  const str = String(value);
  if (str === '') return "''";
  if (str.includes('\n')) return JSON.stringify(str);
  if (RESERVED.has(str)) return `'${str}'`;
  if (/^[+-]?[\d.]/.test(str) && !Number.isNaN(Number(str))) return `'${str}'`;
  if (!PLAIN_SAFE.test(str) || str.trim() !== str) return JSON.stringify(str);
  return str;
}

function emitKey(key: string): string {
  if (key === '') return "''";
  if (RESERVED.has(key) || !PLAIN_SAFE.test(key)) return JSON.stringify(key);
  return key;
}

/** Serialises JS values into block-style YAML. */
export function stringifyYaml(value: unknown, indentSize = 2, depth = 0): string {
  if (depth > MAX_DEPTH) throw errInvalidInput('ساختار بیش از حد تودرتو است.', 'Structure nested too deeply.');
  const pad = ' '.repeat(depth * indentSize);

  if (Array.isArray(value)) {
    if (value.length === 0) return `${pad}[]`;
    return value
      .map((item) => {
        if (item !== null && typeof item === 'object') {
          // Render the item at depth 0 and re-indent every line, so the
          // continuation lines align under the two-character "- " marker
          // rather than inheriting the nested block's own padding.
          const nested = stringifyYaml(item, indentSize, 0).split('\n');
          const [head = '', ...tail] = nested;
          const continuation = `${pad}  `;
          return [`${pad}- ${head}`, ...tail.map((line) => `${continuation}${line}`)].join('\n');
        }
        return `${pad}- ${emitScalar(item)}`;
      })
      .join('\n');
  }

  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length === 0) return `${pad}{}`;
    return entries
      .map(([key, val]) => {
        if (val !== null && typeof val === 'object') {
          const isEmpty = Array.isArray(val) ? val.length === 0 : Object.keys(val as object).length === 0;
          if (isEmpty) return `${pad}${emitKey(key)}: ${Array.isArray(val) ? '[]' : '{}'}`;
          return `${pad}${emitKey(key)}:\n${stringifyYaml(val, indentSize, depth + 1)}`;
        }
        if (typeof val === 'string' && val.includes('\n')) {
          const body = val
            .replace(/\n$/, '')
            .split('\n')
            .map((l) => `${pad}${' '.repeat(indentSize)}${l}`)
            .join('\n');
          return `${pad}${emitKey(key)}: |-\n${body}`;
        }
        return `${pad}${emitKey(key)}: ${emitScalar(val)}`;
      })
      .join('\n');
  }

  return `${pad}${emitScalar(value)}`;
}

/** Compact single-line-ish YAML: comments and blank lines removed. */
export function minifyYaml(src: string): string {
  return tokenize(src)
    .map((line) => `${' '.repeat(line.indent)}${line.content}`)
    .join('\n');
}
