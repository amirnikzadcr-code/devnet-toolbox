/**
 * Phase 3 — number base conversion and the programmer's calculator.
 *
 * Everything runs on `BigInt`, so 64-bit masks, two's-complement negatives and
 * shifts behave the way they do in a debugger rather than the way they do in
 * IEEE-754 doubles.
 */
import { defineTool } from '../types.js';
import { codeBlock, DIVIDER, escapeHtml, mono } from '../../utils/text.js';
import { errInvalidInput } from '../../utils/errors.js';
import { TOOL_LIMITS } from '../../config/index.js';

const BASES: Record<string, number> = {
  bin: 2, b: 2, binary: 2, '2': 2,
  oct: 8, o: 8, octal: 8, '8': 8,
  dec: 10, d: 10, decimal: 10, '10': 10,
  hex: 16, h: 16, hexadecimal: 16, '16': 16,
};

const BASE_NAME: Record<number, string> = { 2: 'Binary', 8: 'Octal', 10: 'Decimal', 16: 'Hex' };
const BASE_PREFIX: Record<number, string> = { 2: '0b', 8: '0o', 10: '', 16: '0x' };

export interface ParsedNumber {
  value: bigint;
  base: number;
  /** Digits as written by the user, without prefix or separators. */
  digits: string;
}

const DIGITS_FOR: Record<number, RegExp> = {
  2: /^[01]+$/,
  8: /^[0-7]+$/,
  10: /^\d+$/,
  16: /^[0-9a-f]+$/i,
};

/**
 * Parses a number written with an explicit prefix (`0x1f`), an explicit base
 * suffix (`1f hex`), or plain digits whose base is supplied by the caller.
 */
export function parseNumber(raw: string, explicitBase?: number): ParsedNumber {
  let text = raw.trim().toLowerCase().replace(/[_\s,']/g, '');
  if (!text) throw errInvalidInput('عددی وارد نشده است.', 'No number was provided.');

  let negative = false;
  if (text.startsWith('-')) {
    negative = true;
    text = text.slice(1);
  } else if (text.startsWith('+')) {
    text = text.slice(1);
  }

  let base = explicitBase;
  const prefixed = /^0([bxo])(.+)$/.exec(text);
  if (prefixed) {
    const marker = prefixed[1] as string;
    base = marker === 'b' ? 2 : marker === 'o' ? 8 : 16;
    text = prefixed[2] as string;
  }
  if (base === undefined) {
    // No prefix and no declared base: hex letters imply hex, otherwise decimal.
    base = /^[0-9]+$/.test(text) ? 10 : 16;
  }

  const pattern = DIGITS_FOR[base];
  if (!pattern || !pattern.test(text)) {
    throw errInvalidInput(
      `«${raw.trim()}» یک عدد معتبر در مبنای ${base} نیست. ارقام مجاز: ${
        base === 2 ? '0-1' : base === 8 ? '0-7' : base === 10 ? '0-9' : '0-9 و a-f'
      }`,
      `"${raw.trim()}" is not a valid base-${base} number. Allowed digits: ${
        base === 2 ? '0-1' : base === 8 ? '0-7' : base === 10 ? '0-9' : '0-9 and a-f'
      }`,
    );
  }
  if (text.length > 200) {
    throw errInvalidInput('عدد بیش از حد طولانی است.', 'The number is too long.');
  }

  let value = 0n;
  const bigBase = BigInt(base);
  for (const ch of text) {
    value = value * bigBase + BigInt(Number.parseInt(ch, base));
  }
  if (value >= 1n << BigInt(TOOL_LIMITS.maxIntegerBits)) {
    throw errInvalidInput(
      `عدد بزرگ‌تر از ${TOOL_LIMITS.maxIntegerBits} بیت است.`,
      `The number exceeds ${TOOL_LIMITS.maxIntegerBits} bits.`,
    );
  }
  return { value: negative ? -value : value, base, digits: text };
}

export function resolveBase(token: string): number | undefined {
  return BASES[token.trim().toLowerCase()];
}

/** Groups binary digits in nibbles so long words stay readable. */
export function groupBinary(bits: string): string {
  const padded = bits.padStart(Math.ceil(bits.length / 4) * 4, '0');
  return (padded.match(/.{1,4}/g) ?? []).join(' ');
}

export interface BaseRepresentations {
  binary: string;
  octal: string;
  decimal: string;
  hex: string;
  bits: number;
  bytes: number;
  /** Two's-complement 32/64-bit views, for negative values. */
  twos32?: string;
  twos64?: string;
}

export function representations(value: bigint): BaseRepresentations {
  const abs = value < 0n ? -value : value;
  const sign = value < 0n ? '-' : '';
  const bits = abs === 0n ? 1 : abs.toString(2).length;
  const result: BaseRepresentations = {
    binary: `${sign}${abs.toString(2)}`,
    octal: `${sign}${abs.toString(8)}`,
    decimal: value.toString(10),
    hex: `${sign}${abs.toString(16).toUpperCase()}`,
    bits,
    bytes: Math.ceil(bits / 8),
  };
  if (value < 0n) {
    // BigInt bitwise ops use infinite two's-complement sign extension, so
    // masking is all that is needed to get the 32/64-bit register view.
    const mask32 = (1n << 32n) - 1n;
    const mask64 = (1n << 64n) - 1n;
    result.twos32 = (value & mask32).toString(16).toUpperCase().padStart(8, '0');
    result.twos64 = (value & mask64).toString(16).toUpperCase().padStart(16, '0');
  }
  return result;
}

export const baseConverterTool = defineTool({
  id: 'base_convert',
  category: 'programming',
  icon: '🔢',
  quick: true,
  needsInput: true,
  title: { fa: 'مبدل مبنای عدد', en: 'Number Base Converter' },
  description: {
    fa: 'عدد را همزمان در مبناهای دودویی، هشت‌هشتی، ده‌دهی و شانزده‌شانزدهی نشان می‌دهد؛ پیشوندهای 0x/0b/0o را می‌شناسد، ارقام نامعتبر را با پیام روشن رد می‌کند و نمایش مکمل دو را برای اعداد منفی می‌دهد.',
    en: 'Shows a number in binary, octal, decimal and hexadecimal at once. Understands 0x/0b/0o prefixes, rejects invalid digits with a clear message and adds the two\'s-complement view for negatives.',
  },
  usage: {
    fa:
      'یکی از این شکل‌ها را بفرستید:\n' +
      '• <code>255</code> یا <code>0xFF</code> یا <code>0b1010</code>\n' +
      '• <code>FF hex</code> — تعیین صریح مبنای ورودی\n' +
      '• <code>255 dec to bin</code> — تبدیل هدفمند',
    en:
      'Send any of these forms:\n' +
      '• <code>255</code>, <code>0xFF</code> or <code>0b1010</code>\n' +
      '• <code>FF hex</code> — declare the input base\n' +
      '• <code>255 dec to bin</code> — targeted conversion',
  },
  example: {
    fa: 'ورودی: 0xFF\nخروجی: Binary 1111 1111 • Octal 377 • Decimal 255 • Hex FF',
    en: 'Input: 0xFF\nOutput: Binary 1111 1111 • Octal 377 • Decimal 255 • Hex FF',
  },
  limitations: {
    fa: 'فقط اعداد صحیح تا ۱۲۸ بیت. اعداد اعشاری و ممیز شناور پشتیبانی نمی‌شوند.',
    en: 'Integers up to 128 bits only. Fractional and floating-point values are not supported.',
  },
  run: (input, ctx) => {
    const fa = ctx.lang === 'fa';
    const tokens = input.trim().split(/\s+/).filter(Boolean);
    if (tokens.length === 0) {
      throw errInvalidInput('عددی وارد نشده است.', 'No number was provided.');
    }

    // Grammar: <number> [<from-base>] [to <target-base>]
    let target: number | undefined;
    const toIndex = tokens.findIndex((tok) => tok.toLowerCase() === 'to' || tok === '→');
    if (toIndex !== -1) {
      const targetToken = tokens[toIndex + 1] ?? '';
      target = resolveBase(targetToken);
      if (target === undefined) {
        throw errInvalidInput(
          `مبنای مقصد «${targetToken}» شناخته نشد. مقادیر مجاز: bin، oct، dec، hex`,
          `Unknown target base "${targetToken}". Allowed: bin, oct, dec, hex`,
        );
      }
      tokens.splice(toIndex, 2);
    }

    let fromBase: number | undefined;
    if (tokens.length > 1) {
      const candidate = resolveBase(tokens[tokens.length - 1] as string);
      if (candidate !== undefined) {
        fromBase = candidate;
        tokens.pop();
      }
    }
    if (tokens.length !== 1) {
      throw errInvalidInput(
        'قالب ورودی شناخته نشد. نمونه‌ها: <code>0xFF</code> • <code>1010 bin</code> • <code>255 dec to hex</code>',
        'Unrecognised input. Examples: <code>0xFF</code> • <code>1010 bin</code> • <code>255 dec to hex</code>',
      );
    }

    const parsed = parseNumber(tokens[0] as string, fromBase);
    const rep = representations(parsed.value);

    if (target !== undefined) {
      const single =
        target === 2 ? rep.binary : target === 8 ? rep.octal : target === 10 ? rep.decimal : rep.hex;
      return {
        html:
          `${fa ? '🔢 <b>تبدیل مبنا</b>' : '🔢 <b>Base conversion</b>'}\n` +
          `${escapeHtml(BASE_NAME[parsed.base] ?? '')} → ${escapeHtml(BASE_NAME[target] ?? '')}\n` +
          codeBlock(`${BASE_PREFIX[target] ?? ''}${single}`) +
          `${DIVIDER}\n${fa ? `📏 ${rep.bits} بیت • ${rep.bytes} بایت` : `📏 ${rep.bits} bits • ${rep.bytes} bytes`}`,
      };
    }

    const rows = [
      `<b>Binary</b>\n${codeBlock(groupBinary(rep.binary.replace('-', '')) === '' ? '0' : `${rep.binary.startsWith('-') ? '-' : ''}${groupBinary(rep.binary.replace('-', ''))}`)}`,
      `<b>Octal</b>\n${codeBlock(rep.octal)}`,
      `<b>Decimal</b>\n${codeBlock(rep.decimal)}`,
      `<b>Hex</b>\n${codeBlock(rep.hex)}`,
    ].join('');

    const twos =
      rep.twos32 && rep.twos64
        ? `\n${fa ? '🔁 <b>مکمل دو</b>' : '🔁 <b>Two\'s complement</b>'}\n` +
          `• 32-bit: ${mono(`0x${rep.twos32}`)}\n• 64-bit: ${mono(`0x${rep.twos64}`)}`
        : '';

    return {
      html:
        `${fa ? `🔢 <b>ورودی در مبنای ${parsed.base}</b>` : `🔢 <b>Input read as base ${parsed.base}</b>`}\n` +
        rows +
        `${DIVIDER}\n${fa ? `📏 ${rep.bits} بیت • ${rep.bytes} بایت` : `📏 ${rep.bits} bits • ${rep.bytes} bytes`}` +
        twos,
    };
  },
});

// ─── Programmer calculator ────────────────────────────────────────────────

export type BitOp = 'and' | 'or' | 'xor' | 'not' | 'shl' | 'shr' | 'mod' | 'add' | 'sub' | 'mul' | 'div';

const OP_ALIASES: Record<string, BitOp> = {
  and: 'and', '&': 'and',
  or: 'or', '|': 'or',
  xor: 'xor', '^': 'xor',
  not: 'not', '~': 'not',
  shl: 'shl', '<<': 'shl', lsh: 'shl',
  shr: 'shr', '>>': 'shr', rsh: 'shr',
  mod: 'mod', '%': 'mod',
  add: 'add', '+': 'add',
  sub: 'sub', '-': 'sub',
  mul: 'mul', '*': 'mul',
  div: 'div', '/': 'div',
};

const SYMBOL: Record<BitOp, string> = {
  and: '&', or: '|', xor: '^', not: '~', shl: '<<', shr: '>>',
  mod: '%', add: '+', sub: '-', mul: '*', div: '/',
};

export interface BitwiseResult {
  op: BitOp;
  left: bigint;
  right?: bigint;
  value: bigint;
  /** Width used for NOT and for the masked view. */
  width: number;
}

const WIDTHS = [8, 16, 32, 64] as const;

export function applyBitOp(op: BitOp, left: bigint, right: bigint | undefined, width = 64): BitwiseResult {
  if (op !== 'not' && right === undefined) {
    throw errInvalidInput('این عملگر به دو عملوند نیاز دارد.', 'This operator needs two operands.');
  }
  const mask = (1n << BigInt(width)) - 1n;
  let value: bigint;

  switch (op) {
    case 'and': value = left & (right as bigint); break;
    case 'or': value = left | (right as bigint); break;
    case 'xor': value = left ^ (right as bigint); break;
    case 'not': value = ~left & mask; break;
    case 'shl': {
      const shift = right as bigint;
      if (shift < 0n || shift > BigInt(width)) {
        throw errInvalidInput(
          `مقدار شیفت باید بین 0 و ${width} باشد.`,
          `The shift amount must be between 0 and ${width}.`,
        );
      }
      value = (left << shift) & mask;
      break;
    }
    case 'shr': {
      const shift = right as bigint;
      if (shift < 0n || shift > BigInt(width)) {
        throw errInvalidInput(
          `مقدار شیفت باید بین 0 و ${width} باشد.`,
          `The shift amount must be between 0 and ${width}.`,
        );
      }
      value = left >> shift;
      break;
    }
    case 'mod':
      if ((right as bigint) === 0n) {
        throw errInvalidInput('باقی‌مانده بر صفر تعریف نشده است.', 'Modulo by zero is undefined.');
      }
      value = left % (right as bigint);
      break;
    case 'div':
      if ((right as bigint) === 0n) {
        throw errInvalidInput('تقسیم بر صفر تعریف نشده است.', 'Division by zero is undefined.');
      }
      value = left / (right as bigint);
      break;
    case 'add': value = left + (right as bigint); break;
    case 'sub': value = left - (right as bigint); break;
    case 'mul': value = left * (right as bigint); break;
  }

  return { op, left, value, width, ...(right !== undefined ? { right } : {}) };
}

export const programmerCalcTool = defineTool({
  id: 'prog_calc',
  category: 'programming',
  icon: '🧮',
  needsInput: true,
  title: { fa: 'ماشین‌حساب برنامه‌نویس', en: 'Programmer Calculator' },
  description: {
    fa: 'عملیات بیتی و صحیح روی اعداد در هر مبنایی: AND، OR، XOR، NOT، شیفت چپ/راست، باقی‌مانده و چهار عمل اصلی. نتیجه همزمان در چهار مبنا نمایش داده می‌شود.',
    en: 'Bitwise and integer maths in any base: AND, OR, XOR, NOT, left/right shift, modulo and the four basic operations. The result is shown in all four bases at once.',
  },
  usage: {
    fa:
      'عبارت را با فاصله بنویسید:\n' +
      '<code>0xFF AND 0x0F</code> • <code>12 XOR 10</code> • <code>1 SHL 8</code> • <code>NOT 0b1010</code> • <code>17 MOD 5</code>\n' +
      'برای تعیین عرض کلمه، در انتها <code>:8</code>، <code>:16</code>، <code>:32</code> یا <code>:64</code> بیفزایید.',
    en:
      'Write the expression with spaces:\n' +
      '<code>0xFF AND 0x0F</code> • <code>12 XOR 10</code> • <code>1 SHL 8</code> • <code>NOT 0b1010</code> • <code>17 MOD 5</code>\n' +
      'Append <code>:8</code>, <code>:16</code>, <code>:32</code> or <code>:64</code> to pick the word width.',
  },
  example: {
    fa: 'ورودی: 0xFF AND 0x0F\nخروجی: 0x0F • 15 • 0b1111',
    en: 'Input: 0xFF AND 0x0F\nOutput: 0x0F • 15 • 0b1111',
  },
  limitations: {
    fa: 'فقط یک عملگر در هر عبارت و فقط اعداد صحیح. عرض پیش‌فرض کلمه ۶۴ بیت است و NOT/شیفت با همان عرض ماسک می‌شوند.',
    en: 'One operator per expression, integers only. The default word width is 64 bits; NOT and shifts are masked to that width.',
  },
  run: (input, ctx) => {
    const fa = ctx.lang === 'fa';
    let text = input.trim();
    let width = 64;

    const widthMatch = /:(\d{1,2})\s*$/.exec(text);
    if (widthMatch) {
      const requested = Number(widthMatch[1]);
      if (!(WIDTHS as readonly number[]).includes(requested)) {
        throw errInvalidInput(
          'عرض کلمه باید یکی از 8، 16، 32 یا 64 باشد.',
          'The word width must be 8, 16, 32 or 64.',
        );
      }
      width = requested;
      text = text.slice(0, widthMatch.index).trim();
    }

    // Insert spaces around symbolic operators so `0xFF&0x0F` parses too.
    const spaced = text.replace(/(<<|>>|[&|^~%+*/])/g, ' $1 ').replace(/\s+/g, ' ').trim();
    const tokens = spaced.split(' ').filter(Boolean);

    let result: BitwiseResult;
    if (tokens.length === 2 && (OP_ALIASES[(tokens[0] as string).toLowerCase()] === 'not')) {
      const operand = parseNumber(tokens[1] as string);
      result = applyBitOp('not', operand.value, undefined, width);
    } else if (tokens.length === 3) {
      const op = OP_ALIASES[(tokens[1] as string).toLowerCase()];
      if (!op) {
        throw errInvalidInput(
          `عملگر «${tokens[1]}» شناخته نشد. عملگرهای مجاز: AND، OR، XOR، NOT، SHL، SHR، MOD، + − × ÷`,
          `Unknown operator "${tokens[1]}". Allowed: AND, OR, XOR, NOT, SHL, SHR, MOD, + − × ÷`,
        );
      }
      if (op === 'not') {
        throw errInvalidInput('NOT فقط یک عملوند می‌گیرد: <code>NOT 0b1010</code>', 'NOT takes a single operand: <code>NOT 0b1010</code>');
      }
      const left = parseNumber(tokens[0] as string);
      const right = parseNumber(tokens[2] as string);
      result = applyBitOp(op, left.value, right.value, width);
    } else {
      throw errInvalidInput(
        'عبارت باید به شکل <code>A OP B</code> یا <code>NOT A</code> باشد.',
        'The expression must be <code>A OP B</code> or <code>NOT A</code>.',
      );
    }

    const rep = representations(result.value);
    const expression =
      result.right === undefined
        ? `~${result.left.toString(10)}`
        : `${result.left.toString(10)} ${SYMBOL[result.op]} ${result.right.toString(10)}`;

    return {
      html:
        `${fa ? '🧮 <b>عبارت</b>' : '🧮 <b>Expression</b>'}\n${codeBlock(`${expression}   (${width}-bit)`)}` +
        `<b>Decimal</b>\n${codeBlock(rep.decimal)}` +
        `<b>Hex</b>\n${codeBlock(`0x${rep.hex.replace('-', '')}`)}` +
        `<b>Binary</b>\n${codeBlock(groupBinary(rep.binary.replace('-', '')))}` +
        `<b>Octal</b>\n${codeBlock(`0o${rep.octal.replace('-', '')}`)}` +
        `${DIVIDER}\n${fa ? `📏 ${rep.bits} بیت معنادار` : `📏 ${rep.bits} significant bits`}`,
    };
  },
});
