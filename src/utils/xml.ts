/**
 * Dependency-free XML tokenizer, validator, pretty-printer and minifier.
 *
 * This is deliberately a *non-resolving* parser: entities are never expanded
 * beyond the five predefined ones, and `<!DOCTYPE ... [ ... ]>` internal
 * subsets are rejected. That kills XXE / billion-laughs by construction.
 */

const MAX_DEPTH = 100;

export class XmlError extends Error {
  readonly line: number;
  readonly column: number;
  constructor(message: string, line: number, column: number) {
    super(message);
    this.name = 'XmlError';
    this.line = line;
    this.column = column;
  }
}

export type XmlNode =
  | { type: 'element'; name: string; attrs: [string, string][]; children: XmlNode[]; selfClosing: boolean }
  | { type: 'text'; value: string }
  | { type: 'comment'; value: string }
  | { type: 'cdata'; value: string }
  | { type: 'pi'; value: string }
  | { type: 'doctype'; value: string };

export interface XmlDocument {
  nodes: XmlNode[];
  /** Number of elements, for the stats block. */
  elements: number;
  maxDepth: number;
}

const NAME_START = /[A-Za-z_:]/;
const NAME_CHAR = /[A-Za-z0-9_:.-]/;

export function parseXml(src: string): XmlDocument {
  let pos = 0;
  let elements = 0;
  let maxDepth = 0;

  const at = (offset = 0): string | undefined => src[pos + offset];

  const where = (index: number): { line: number; column: number } => {
    const upTo = src.slice(0, index);
    const line = upTo.split('\n').length;
    const column = index - upTo.lastIndexOf('\n');
    return { line, column };
  };

  const fail = (message: string, index = pos): never => {
    const { line, column } = where(index);
    throw new XmlError(message, line, column);
  };

  const readName = (): string => {
    const start = pos;
    if (!NAME_START.test(at() ?? '')) fail('Expected an element or attribute name.');
    while (pos < src.length && NAME_CHAR.test(at() as string)) pos += 1;
    return src.slice(start, pos);
  };

  const skipSpace = (): void => {
    while (pos < src.length && /\s/.test(at() as string)) pos += 1;
  };

  const parseNodes = (depth: number): XmlNode[] => {
    if (depth > MAX_DEPTH) fail('XML nested too deeply.');
    maxDepth = Math.max(maxDepth, depth);
    const nodes: XmlNode[] = [];

    while (pos < src.length) {
      if (at() === '<') {
        // Closing tag → let the caller handle it.
        if (at(1) === '/') return nodes;

        if (src.startsWith('<!--', pos)) {
          const end = src.indexOf('-->', pos + 4);
          if (end === -1) fail('Unterminated comment (<!-- without -->).');
          nodes.push({ type: 'comment', value: src.slice(pos + 4, end) });
          pos = end + 3;
          continue;
        }
        if (src.startsWith('<![CDATA[', pos)) {
          const end = src.indexOf(']]>', pos + 9);
          if (end === -1) fail('Unterminated CDATA section.');
          nodes.push({ type: 'cdata', value: src.slice(pos + 9, end) });
          pos = end + 3;
          continue;
        }
        if (src.startsWith('<?', pos)) {
          const end = src.indexOf('?>', pos + 2);
          if (end === -1) fail('Unterminated processing instruction (<? without ?>).');
          nodes.push({ type: 'pi', value: src.slice(pos + 2, end).trim() });
          pos = end + 2;
          continue;
        }
        if (src.startsWith('<!DOCTYPE', pos) || src.startsWith('<!doctype', pos)) {
          const end = src.indexOf('>', pos);
          const body = src.slice(pos, end === -1 ? src.length : end);
          if (body.includes('[')) {
            fail('DOCTYPE internal subsets are rejected for security (XXE risk).');
          }
          if (end === -1) fail('Unterminated DOCTYPE declaration.');
          nodes.push({ type: 'doctype', value: src.slice(pos + 2, end) });
          pos = end + 1;
          continue;
        }

        const tagStart = pos;
        pos += 1;
        const name = readName();
        const attrs: [string, string][] = [];
        const seen = new Set<string>();

        for (;;) {
          skipSpace();
          const ch = at();
          if (ch === undefined) fail('Unterminated start tag.', tagStart);
          if (ch === '/' && at(1) === '>') {
            pos += 2;
            elements += 1;
            nodes.push({ type: 'element', name, attrs, children: [], selfClosing: true });
            break;
          }
          if (ch === '>') {
            pos += 1;
            elements += 1;
            const children = parseNodes(depth + 1);
            if (!src.startsWith('</', pos)) {
              fail(`Missing closing tag for <${name}>.`, tagStart);
            }
            pos += 2;
            const closeName = readName();
            skipSpace();
            if (at() !== '>') fail(`Malformed closing tag </${closeName}>.`);
            pos += 1;
            if (closeName !== name) {
              fail(`Closing tag </${closeName}> does not match <${name}>.`, tagStart);
            }
            nodes.push({ type: 'element', name, attrs, children, selfClosing: false });
            break;
          }
          // Attribute
          const attrName = readName();
          if (seen.has(attrName)) fail(`Duplicate attribute "${attrName}" on <${name}>.`);
          seen.add(attrName);
          skipSpace();
          if (at() !== '=') fail(`Attribute "${attrName}" is missing a value.`);
          pos += 1;
          skipSpace();
          const quote = at();
          if (quote !== '"' && quote !== "'") fail(`Attribute "${attrName}" value must be quoted.`);
          pos += 1;
          const valueStart = pos;
          while (pos < src.length && at() !== quote) pos += 1;
          if (pos >= src.length) fail(`Unterminated value for attribute "${attrName}".`);
          attrs.push([attrName, src.slice(valueStart, pos)]);
          pos += 1;
        }
        continue;
      }

      // Text run
      const start = pos;
      while (pos < src.length && at() !== '<') pos += 1;
      const raw = src.slice(start, pos);
      if (raw.trim() !== '') nodes.push({ type: 'text', value: raw });
      else if (raw !== '' && nodes.length === 0 && depth > 0) {
        // whitespace-only inside an element: dropped by the pretty printer
      }
    }
    return nodes;
  };

  const nodes = parseNodes(0);
  if (pos < src.length) {
    const rest = src.slice(pos, pos + 20);
    fail(`Unexpected closing tag or trailing content: ${rest}`);
  }
  const roots = nodes.filter((n) => n.type === 'element');
  if (roots.length === 0) throw new XmlError('No root element found.', 1, 1);
  if (roots.length > 1) throw new XmlError('An XML document must have exactly one root element.', 1, 1);
  return { nodes, elements, maxDepth };
}

function escapeText(value: string): string {
  return value.replace(/&(?!(?:#\d+|#x[0-9a-fA-F]+|amp|lt|gt|quot|apos);)/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escapeAttr(value: string): string {
  return escapeText(value).replace(/"/g, '&quot;');
}

function renderNode(node: XmlNode, indent: string, depth: number, pretty: boolean): string {
  const pad = pretty ? indent.repeat(depth) : '';
  const nl = pretty ? '\n' : '';
  switch (node.type) {
    case 'text':
      return pretty ? `${pad}${escapeText(node.value.trim())}` : escapeText(node.value.trim());
    case 'comment':
      return `${pad}<!--${node.value}-->`;
    case 'cdata':
      return `${pad}<![CDATA[${node.value}]]>`;
    case 'pi':
      return `${pad}<?${node.value}?>`;
    case 'doctype':
      return `${pad}<${node.value}>`;
    case 'element': {
      const attrs = node.attrs.map(([k, v]) => ` ${k}="${escapeAttr(v)}"`).join('');
      if (node.selfClosing || node.children.length === 0) {
        return `${pad}<${node.name}${attrs}/>`;
      }
      const onlyText = node.children.length === 1 && node.children[0]?.type === 'text';
      if (onlyText) {
        const text = escapeText((node.children[0] as { value: string }).value.trim());
        return `${pad}<${node.name}${attrs}>${text}</${node.name}>`;
      }
      const inner = node.children.map((child) => renderNode(child, indent, depth + 1, pretty)).join(nl);
      return `${pad}<${node.name}${attrs}>${nl}${inner}${nl}${pad}</${node.name}>`;
    }
  }
}

export function formatXml(doc: XmlDocument, indentSize = 2): string {
  return doc.nodes.map((node) => renderNode(node, ' '.repeat(indentSize), 0, true)).join('\n');
}

export function minifyXml(doc: XmlDocument): string {
  return doc.nodes.map((node) => renderNode(node, '', 0, false)).join('');
}

/** Human-readable outline of the document tree (first N elements). */
export function xmlOutline(doc: XmlDocument, limit = 40): string[] {
  const out: string[] = [];
  const walk = (nodes: XmlNode[], depth: number): void => {
    for (const node of nodes) {
      if (out.length >= limit) return;
      if (node.type !== 'element') continue;
      const attrCount = node.attrs.length;
      out.push(`${'  '.repeat(depth)}└ ${node.name}${attrCount ? ` (${attrCount} attr)` : ''}`);
      walk(node.children, depth + 1);
    }
  };
  walk(doc.nodes, 0);
  return out;
}
