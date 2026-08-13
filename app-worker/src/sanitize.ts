/**
 * HTML sanitiser for tool output.
 *
 * Tools emit Telegram-flavoured HTML: a deliberately tiny subset (<b>, <i>,
 * <code>, <pre>, <a>). The Mini App renders that string into the DOM, so it
 * must be filtered even though it is produced by our own code — a tool that
 * echoes user input (regex tester, text transform, diff) would otherwise
 * become a self-XSS vector the moment an escaping bug slips through.
 *
 * Strategy: allow-list, not deny-list. Anything not explicitly permitted is
 * escaped into visible text rather than dropped silently, so a bug shows up
 * as ugly output instead of as an exploit.
 */

/** Tags a tool is allowed to emit. Void and structural tags are excluded. */
const ALLOWED = new Set(['b', 'strong', 'i', 'em', 'u', 's', 'code', 'pre', 'a', 'br', 'blockquote', 'span']);

/** Only these attributes survive, and only on the listed tags. */
const ALLOWED_ATTRS: Record<string, Set<string>> = {
  a: new Set(['href']),
  code: new Set(['class']),
  span: new Set(['class']),
};

const SAFE_CLASS = /^[a-z0-9_-]{1,32}$/i;

/** Maximum nesting depth before further open tags are dropped. */
const MAX_DEPTH = 32;

function escapeText(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Rejects javascript:, data:, vbscript: and control-character smuggling. */
function safeHref(value: string): string | null {
  // The control characters are the point: `java<TAB>script:` and friends are
  // parsed as `javascript:` by browsers, so they must be stripped before the
  // scheme check rather than excluded from the pattern.
  // eslint-disable-next-line no-control-regex
  const cleaned = value.replace(/[\u0000-\u001f\u007f\s]/g, '').toLowerCase();
  if (cleaned.startsWith('http://') || cleaned.startsWith('https://') || cleaned.startsWith('tg://')) {
    return value.slice(0, 2048);
  }
  return null;
}

/**
 * Filters an HTML fragment down to the allowed subset.
 * Runs in linear time with a bounded input; no regex backtracking hazards.
 */
export function sanitizeHtml(input: string, maxLength = 60_000): string {
  const source = input.length > maxLength ? input.slice(0, maxLength) : input;
  let out = '';
  let index = 0;
  const openTags: string[] = [];

  while (index < source.length) {
    const lt = source.indexOf('<', index);
    if (lt === -1) {
      out += escapeText(source.slice(index));
      break;
    }
    out += escapeText(source.slice(index, lt));

    const gt = source.indexOf('>', lt);
    if (gt === -1) {
      // Unterminated tag: treat the remainder as text.
      out += escapeText(source.slice(lt));
      break;
    }

    const rawTag = source.slice(lt + 1, gt).trim();
    index = gt + 1;

    // Comments, doctypes, processing instructions: dropped entirely.
    if (rawTag.startsWith('!') || rawTag.startsWith('?')) continue;

    const isClosing = rawTag.startsWith('/');
    const body = isClosing ? rawTag.slice(1).trim() : rawTag;
    const nameMatch = /^([a-zA-Z][a-zA-Z0-9]*)/.exec(body);
    if (!nameMatch) {
      out += escapeText(source.slice(lt, gt + 1));
      continue;
    }
    const tagName = nameMatch[1] ?? '';
    const name = tagName.toLowerCase();

    if (!ALLOWED.has(name)) {
      // Not allowed → render the original markup as literal text.
      out += escapeText(source.slice(lt, gt + 1));
      continue;
    }

    if (isClosing) {
      const position = openTags.lastIndexOf(name);
      if (position === -1) continue; // stray close tag
      // Close anything left open inside it, keeping the tree balanced.
      for (let i = openTags.length - 1; i >= position; i -= 1) out += `</${openTags[i]}>`;
      openTags.splice(position);
      continue;
    }

    if (name === 'br') {
      out += '<br>';
      continue;
    }

    // Attributes.
    let attrs = '';
    const allowedForTag = ALLOWED_ATTRS[name];
    if (allowedForTag) {
      const attrRe = /([a-zA-Z-]+)\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/g;
      let match: RegExpExecArray | null;
      const rest = body.slice(tagName.length);
      while ((match = attrRe.exec(rest)) !== null) {
        const attrName = (match[1] ?? '').toLowerCase();
        if (!allowedForTag.has(attrName)) continue;
        const value = match[3] ?? match[4] ?? match[5] ?? '';
        if (attrName === 'href') {
          const href = safeHref(value);
          if (href) attrs += ` href="${escapeText(href)}"`;
        } else if (attrName === 'class' && SAFE_CLASS.test(value)) {
          attrs += ` class="${escapeText(value)}"`;
        }
      }
    }

    // Pathological nesting guard. Past the depth cap the tag is dropped but
    // parsing continues, so the user still gets their text — an earlier
    // version `break`ed here and silently truncated the rest of the result.
    if (openTags.length >= MAX_DEPTH) continue;

    out += `<${name}${attrs}>`;
    openTags.push(name);
  }

  for (let i = openTags.length - 1; i >= 0; i -= 1) out += `</${openTags[i]}>`;
  return out;
}
