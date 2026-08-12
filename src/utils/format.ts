/**
 * Dependency-free formatters (HTML / CSS / JS) and a small Markdown renderer.
 * These are intentionally lightweight: Workers have a CPU budget and we avoid
 * pulling in prettier (~mega-bytes) for a chat-sized payload.
 */

/** Pretty-print HTML with 2-space indentation. */
export function formatHtml(input: string, indentSize = 2): string {
  const indentUnit = ' '.repeat(indentSize);
  const voidTags = new Set([
    'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input',
    'link', 'meta', 'param', 'source', 'track', 'wbr',
  ]);
  const tokens = input
    .replace(/\r\n?/g, '\n')
    .replace(/>\s+</g, '><')
    .split(/(<[^>]*>)/g)
    .map((tok) => tok.trim())
    .filter(Boolean);

  const lines: string[] = [];
  let depth = 0;
  let preserve = 0;

  for (const token of tokens) {
    const isTag = token.startsWith('<');
    const isClosing = /^<\//.test(token);
    const isSelfClosing = /\/>$/.test(token);
    const isDeclaration = /^<[!?]/.test(token);
    const tagName = isTag ? (/^<\/?\s*([a-z0-9-]+)/i.exec(token)?.[1] ?? '').toLowerCase() : '';
    const isVoid = voidTags.has(tagName);
    const preserveTag = tagName === 'pre' || tagName === 'textarea';

    if (isClosing && depth > 0) depth -= 1;
    lines.push(indentUnit.repeat(preserve > 0 ? Math.max(depth, 0) : depth) + token);
    if (isTag && !isClosing && !isSelfClosing && !isDeclaration && !isVoid) depth += 1;
    if (preserveTag) preserve = isClosing ? Math.max(0, preserve - 1) : preserve + 1;
  }
  return lines.join('\n');
}

/** Pretty-print CSS with 2-space indentation. */
export function formatCss(input: string, indentSize = 2): string {
  const indentUnit = ' '.repeat(indentSize);
  const compact = input
    .replace(/\r\n?/g, '\n')
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/\n/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();

  const lines: string[] = [];
  let depth = 0;
  let buffer = '';
  let parens = 0;
  let quote: string | null = null;

  const push = (line: string): void => {
    const trimmed = line.trim();
    if (trimmed) lines.push(`${indentUnit.repeat(depth)}${trimmed}`);
  };

  /** Adds a single space after the property colon, but never inside url()/data: values. */
  const prettyDeclaration = (decl: string): string => {
    const idx = decl.indexOf(':');
    if (idx < 0) return decl;
    const prop = decl.slice(0, idx).trim();
    const value = decl.slice(idx + 1).trim();
    if (!prop || /[({]/.test(prop)) return decl;
    return `${prop}: ${value}`;
  };

  for (let i = 0; i < compact.length; i += 1) {
    const ch = compact[i] as string;

    if (quote) {
      buffer += ch;
      if (ch === quote && compact[i - 1] !== '\\') quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      buffer += ch;
      continue;
    }
    if (ch === '(') parens += 1;
    if (ch === ')') parens = Math.max(0, parens - 1);

    if (ch === '{' && parens === 0) {
      push(`${buffer.trim()} {`);
      buffer = '';
      depth += 1;
    } else if (ch === '}' && parens === 0) {
      const pending = buffer.trim();
      if (pending) push(`${prettyDeclaration(pending)};`);
      buffer = '';
      depth = Math.max(0, depth - 1);
      push('}');
    } else if (ch === ';' && parens === 0) {
      const pending = buffer.trim();
      if (pending) push(`${prettyDeclaration(pending)};`);
      buffer = '';
    } else {
      buffer += ch;
    }
  }
  const tail = buffer.trim();
  if (tail) push(tail);

  return lines.join('\n').trim();
}

/** Minify CSS (safe subset: comments + redundant whitespace). */
export function minifyCss(input: string): string {
  return input
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\s+/g, ' ')
    .replace(/\s*([{}:;,>~+])\s*/g, '$1')
    .replace(/;}/g, '}')
    .trim();
}

/**
 * Pretty-print JavaScript / JSON-like code.
 * String, template-literal and comment aware so braces inside strings do not
 * break indentation.
 */
export function formatJs(input: string, indentSize = 2): string {
  const indentUnit = ' '.repeat(indentSize);
  const src = input.replace(/\r\n?/g, '\n');
  let out = '';
  let depth = 0;
  let inString: string | null = null;
  let inLineComment = false;
  let inBlockComment = false;

  const pushNewline = (): void => {
    out = `${out.replace(/[ \t]+$/, '')}\n${indentUnit.repeat(Math.max(0, depth))}`;
  };

  for (let i = 0; i < src.length; i += 1) {
    const ch = src[i] as string;
    const next = src[i + 1] ?? '';
    const prev = src[i - 1] ?? '';

    if (inLineComment) {
      out += ch;
      if (ch === '\n') {
        inLineComment = false;
        out += indentUnit.repeat(Math.max(0, depth));
      }
      continue;
    }
    if (inBlockComment) {
      out += ch;
      if (ch === '*' && next === '/') {
        out += '/';
        i += 1;
        inBlockComment = false;
      }
      continue;
    }
    if (inString) {
      out += ch;
      if (ch === inString && prev !== '\\') inString = null;
      continue;
    }
    if (ch === '/' && next === '/') {
      out += '//';
      i += 1;
      inLineComment = true;
      continue;
    }
    if (ch === '/' && next === '*') {
      out += '/*';
      i += 1;
      inBlockComment = true;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      inString = ch;
      out += ch;
      continue;
    }
    if (ch === '{' || ch === '[' || ch === '(') {
      const closer = ch === '{' ? '}' : ch === '[' ? ']' : ')';
      // keep empty pairs inline
      let j = i + 1;
      while (j < src.length && /\s/.test(src[j] as string)) j += 1;
      if (src[j] === closer) {
        out += ch + closer;
        i = j;
        continue;
      }
      out += ch;
      if (ch !== '(') {
        depth += 1;
        pushNewline();
      }
      continue;
    }
    if (ch === '}' || ch === ']') {
      depth = Math.max(0, depth - 1);
      pushNewline();
      out += ch;
      continue;
    }
    if (ch === ')') {
      out += ch;
      continue;
    }
    if (ch === ';') {
      out += ';';
      pushNewline();
      continue;
    }
    if (ch === ',') {
      out += ',';
      // newline after comma only inside object/array context
      pushNewline();
      continue;
    }
    if (ch === '\n') {
      if (!/\n\s*$/.test(out)) pushNewline();
      continue;
    }
    if (/\s/.test(ch)) {
      if (!/[\s([{]$/.test(out)) out += ' ';
      continue;
    }
    out += ch;
  }

  return out
    .split('\n')
    .map((line) => line.replace(/\s+$/, ''))
    .filter((line, idx, arr) => !(line.trim() === '' && (arr[idx - 1] ?? '').trim() === ''))
    .join('\n')
    .trim();
}

/** Minimal, XSS-safe Markdown → HTML renderer (CommonMark subset). */
export function markdownToHtml(md: string): string {
  const escapeHtmlChars = (s: string): string =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  const codeBlocks: string[] = [];
  let src = md.replace(/\r\n?/g, '\n');

  // fenced code
  src = src.replace(/```([a-z0-9+#-]*)\n([\s\S]*?)```/gi, (_m, lang: string, code: string) => {
    const cls = lang ? ` class="language-${escapeHtmlChars(lang)}"` : '';
    codeBlocks.push(`<pre><code${cls}>${escapeHtmlChars(code.replace(/\n$/, ''))}</code></pre>`);
    return `\uE000CB${codeBlocks.length - 1}\uE000`;
  });

  const inlineCode: string[] = [];
  src = src.replace(/`([^`\n]+)`/g, (_m, code: string) => {
    inlineCode.push(`<code>${escapeHtmlChars(code)}</code>`);
    return `\uE000IC${inlineCode.length - 1}\uE000`;
  });

  src = escapeHtmlChars(src);

  const lines = src.split('\n');
  const out: string[] = [];
  let listType: 'ul' | 'ol' | null = null;
  let inQuote = false;
  let paragraph: string[] = [];

  const flushParagraph = (): void => {
    if (paragraph.length) {
      out.push(`<p>${paragraph.join(' ')}</p>`);
      paragraph = [];
    }
  };
  const closeList = (): void => {
    if (listType) {
      out.push(`</${listType}>`);
      listType = null;
    }
  };
  const closeQuote = (): void => {
    if (inQuote) {
      out.push('</blockquote>');
      inQuote = false;
    }
  };

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();

    if (!line.trim()) {
      flushParagraph();
      closeList();
      closeQuote();
      continue;
    }
    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      flushParagraph();
      closeList();
      closeQuote();
      const level = (heading[1] ?? '#').length;
      out.push(`<h${level}>${inline(heading[2] ?? '')}</h${level}>`);
      continue;
    }
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(line.trim())) {
      flushParagraph();
      closeList();
      closeQuote();
      out.push('<hr>');
      continue;
    }
    const quote = /^&gt;\s?(.*)$/.exec(line);
    if (quote) {
      flushParagraph();
      closeList();
      if (!inQuote) {
        out.push('<blockquote>');
        inQuote = true;
      }
      out.push(`<p>${inline(quote[1] ?? '')}</p>`);
      continue;
    }
    const ul = /^\s*[-*+]\s+(.*)$/.exec(line);
    const ol = /^\s*\d+\.\s+(.*)$/.exec(line);
    if (ul || ol) {
      flushParagraph();
      const wanted: 'ul' | 'ol' = ul ? 'ul' : 'ol';
      if (listType !== wanted) {
        closeList();
        out.push(`<${wanted}>`);
        listType = wanted;
      }
      out.push(`<li>${inline((ul?.[1] ?? ol?.[1]) ?? '')}</li>`);
      continue;
    }
    if (line.startsWith('\uE000CB')) {
      flushParagraph();
      closeList();
      closeQuote();
      out.push(line);
      continue;
    }
    paragraph.push(inline(line.trim()));
  }
  flushParagraph();
  closeList();
  closeQuote();

  let html = out.join('\n');
  html = html.replace(/\uE000IC(\d+)\uE000/g, (_m, i: string) => inlineCode[Number(i)] ?? '');
  html = html.replace(/\uE000CB(\d+)\uE000/g, (_m, i: string) => codeBlocks[Number(i)] ?? '');
  return html;

  function inline(text: string): string {
    return text
      .replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (_m, alt: string, src2: string) =>
        isSafeUrl(src2) ? `<img src="${src2}" alt="${alt}">` : alt,
      )
      .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_m, label: string, href: string) =>
        isSafeUrl(href) ? `<a href="${href}">${label}</a>` : label,
      )
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/__([^_]+)__/g, '<strong>$1</strong>')
      .replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>')
      .replace(/(^|[^_])_([^_\n]+)_/g, '$1<em>$2</em>')
      .replace(/~~([^~]+)~~/g, '<del>$1</del>');
  }

  function isSafeUrl(url: string): boolean {
    return /^(https?:\/\/|mailto:|\/|#|\.)/i.test(url);
  }
}
