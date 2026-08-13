import { describe, expect, it } from 'vitest';

import { getTool } from '../../src/tools/registry.js';
import { ToolError } from '../../src/utils/errors.js';
import { fmt, numberField, parseFields, parseNumber, normalizeDigits } from '../../src/tools/everyday/fields.js';
import { countText } from '../../src/tools/utilities/index.js';
import type { ToolRunContext } from '../../src/tools/types.js';

/**
 * Phase 4 · Stage A — 📐 Calculators.
 *
 * Every tool is exercised through the registry (the same path the router uses)
 * with the five cases the spec asks for: valid, invalid, empty, edge and large.
 */

const fa: ToolRunContext = { lang: 'fa', userId: 1 };
const en: ToolRunContext = { lang: 'en', userId: 1 };

/** Runs a registered tool and returns its HTML, failing loudly if it is absent. */
async function run(id: string, input: string, ctx: ToolRunContext = en): Promise<string> {
  const tool = getTool(id);
  expect(tool, `tool ${id} must be registered`).toBeDefined();
  const result = await (tool as NonNullable<typeof tool>).run(input, ctx);
  return result.html;
}

async function expectFails(id: string, input: string): Promise<void> {
  const tool = getTool(id);
  expect(tool, id).toBeDefined();
  // Wrapped in a thunk: most calculators throw synchronously, which would
  // escape `rejects` if the call were evaluated as an argument.
  await expect(
    (async () => (tool as NonNullable<typeof tool>).run(input, en))(),
    `${id} <- ${JSON.stringify(input)}`,
  ).rejects.toThrowError(ToolError);
}

// ─── Shared field parser ───────────────────────────────────────────────────
describe('everyday/fields', () => {
  it('normalises Persian and Arabic-Indic digits', () => {
    expect(normalizeDigits('۱۲۳۴۵')).toBe('12345');
    expect(normalizeDigits('٤٥٦')).toBe('456');
    expect(normalizeDigits('abc')).toBe('abc');
  });

  it('parses human number formats', () => {
    expect(parseNumber('1,234.5', 'x')).toBe(1234.5);
    expect(parseNumber('12,5', 'x')).toBe(12.5); // decimal comma
    expect(parseNumber('1 234', 'x')).toBe(1234);
    expect(parseNumber('۱۲٫۵', 'x')).toBe(12.5);
    expect(parseNumber('-3', 'x')).toBe(-3);
  });

  it('rejects junk, empty values and absurd magnitudes', () => {
    for (const bad of ['', 'abc', '1.2.3', '--5', '1e999', '9'.repeat(20)]) {
      expect(() => parseNumber(bad, 'x'), bad).toThrowError(ToolError);
    }
  });

  it('reads key: value lines with aliases and defaults', () => {
    const fields = parseFields('Bill: 120\ntip = 15\n# comment\nPEOPLE : 3');
    expect(numberField(fields, ['bill'])).toBe(120);
    expect(numberField(fields, ['tip'])).toBe(15);
    expect(numberField(fields, ['people'])).toBe(3);
    expect(numberField(fields, ['missing'], { fallback: 7 })).toBe(7);
    expect(() => numberField(fields, ['missing'])).toThrowError(ToolError);
  });

  it('enforces min/max bounds per field', () => {
    const fields = parseFields('rate: 250');
    expect(() => numberField(fields, ['rate'], { max: 100 })).toThrowError(ToolError);
    expect(() => numberField(parseFields('rate: -5'), ['rate'], { min: 0 })).toThrowError(ToolError);
  });

  it('rejects empty input and over-long input', () => {
    expect(() => parseFields('   ')).toThrowError(ToolError);
    expect(() => parseFields('a: 1\n'.repeat(5000))).toThrowError(ToolError);
  });

  it('formats numbers with thousands separators and trimmed zeros', () => {
    expect(fmt(1234.5)).toBe('1,234.5');
    expect(fmt(1000)).toBe('1,000');
    expect(fmt(0.000123)).toBe('0.000123');
  });
});

// ─── 1. Percentage ─────────────────────────────────────────────────────────
describe('percent_calc', () => {
  it('computes percentage of a number', async () => {
    expect(await run('percent_calc', '15% of 200')).toContain('30');
  });

  it('computes percent change, increase and decrease', async () => {
    expect(await run('percent_calc', '120 to 150')).toContain('25');
    expect(await run('percent_calc', '200 + 15%')).toContain('230');
    expect(await run('percent_calc', '200 - 15%')).toContain('170');
  });

  it('finds the original value and the percentage difference', async () => {
    expect(await run('percent_calc', '30 is 15% of what')).toContain('200');
    expect(await run('percent_calc', 'diff 40 60')).toContain('40');
  });

  it('accepts Persian digits', async () => {
    expect(await run('percent_calc', '۱۵% of ۲۰۰', fa)).toContain('30');
  });

  it('rejects empty, malformed and zero-baseline input', async () => {
    await expectFails('percent_calc', '');
    await expectFails('percent_calc', 'hello world');
    await expectFails('percent_calc', '0 to 100');
  });
});

// ─── 3. Calculator (extended in Phase 4, not duplicated) ───────────────────
describe('calculator (Phase 4 extensions)', () => {
  it('keeps its Phase 1 behaviour', async () => {
    expect(await run('calculator', '(2+3)*4')).toContain('20');
  });

  it('supports two-argument functions', async () => {
    expect(await run('calculator', 'root(27,3)')).toContain('3');
    expect(await run('calculator', 'logb(1024,2)')).toContain('10');
    expect(await run('calculator', 'max(3,9)')).toContain('9');
  });

  it('supports factorial, new constants and unicode operators', async () => {
    expect(await run('calculator', 'fact(10)')).toContain('3628800');
    expect(await run('calculator', '√16')).toContain('4');
    expect(await run('calculator', '10÷2')).toContain('5');
    expect(await run('calculator', '3×3')).toContain('9');
  });

  it('rejects the edge cases the extensions introduce', async () => {
    await expectFails('calculator', 'fact(200)'); // overflow guard
    await expectFails('calculator', 'root(8,0)'); // zero degree
    await expectFails('calculator', 'min(3)'); // missing argument
    await expectFails('calculator', '1,2'); // comma outside a call
    await expectFails('calculator', '9'.repeat(250)); // length cap
  });
});

// ─── 4. BMI ────────────────────────────────────────────────────────────────
describe('bmi_calc', () => {
  it('computes metric BMI and names the band', async () => {
    const html = await run('bmi_calc', 'weight: 70\nheight: 175');
    expect(html).toMatch(/22\.9/);
  });

  it('supports imperial units', async () => {
    const html = await run('bmi_calc', 'weight: 154 lb\nheight: 69 in');
    expect(html).toMatch(/2[23]\./);
  });

  it('rejects impossible bodies and empty input', async () => {
    await expectFails('bmi_calc', '');
    await expectFails('bmi_calc', 'weight: 70');
    await expectFails('bmi_calc', 'weight: 70\nheight: 5'); // below the 50cm floor
    await expectFails('bmi_calc', 'weight: 9000\nheight: 175');
  });
});

// ─── 5. Construction & 8. Area/Volume ──────────────────────────────────────
describe('geometry_calc', () => {
  it('handles 2-D shapes', async () => {
    expect(await run('geometry_calc', 'shape: rectangle\nwidth: 4\nheight: 3')).toContain('12');
    expect(await run('geometry_calc', 'shape: circle\nradius: 5')).toContain('78.5');
    expect(await run('geometry_calc', 'shape: triangle\nbase: 6\nheight: 4')).toContain('12');
  });

  it('handles 3-D shapes', async () => {
    expect(await run('geometry_calc', 'shape: cube\nside: 3')).toContain('27');
    expect(await run('geometry_calc', 'shape: sphere\nradius: 3')).toContain('113');
    expect(await run('geometry_calc', 'shape: cylinder\nradius: 2\nheight: 5')).toContain('62.8');
    expect(await run('geometry_calc', 'shape: cone\nradius: 3\nheight: 4')).toContain('37.6');
  });

  it('rejects unknown shapes, missing dimensions and out-of-range values', async () => {
    await expectFails('geometry_calc', '');
    await expectFails('geometry_calc', 'shape: dodecahedron\nside: 2');
    await expectFails('geometry_calc', 'shape: rectangle\nwidth: 4');
    await expectFails('geometry_calc', 'shape: square\nside: -2');
    await expectFails('geometry_calc', 'shape: square\nside: 1e9');
  });
});

describe('construction_calc', () => {
  it('computes concrete volume including wastage', async () => {
    const html = await run('construction_calc', 'mode: concrete\nlength: 5\nwidth: 4\nthickness: 0.15\nwaste: 10');
    expect(html).toContain('3.3');
  });

  it('states its assumptions and lets rates be overridden', async () => {
    const standard = await run('construction_calc', 'mode: brick\nlength: 10\nheight: 3');
    expect(standard.toLowerCase()).toMatch(/assumption|formula/);
    const custom = await run('construction_calc', 'mode: brick\nlength: 10\nheight: 3\nbricks per m2: 100');
    expect(custom).not.toBe(standard);
  });

  it('supports every documented mode', async () => {
    for (const mode of ['area', 'volume', 'concrete', 'wall', 'brick', 'tile', 'paint']) {
      const html = await run('construction_calc', `mode: ${mode}\nlength: 5\nwidth: 4\nheight: 3\nthickness: 0.2`);
      expect(html.length, mode).toBeGreaterThan(20);
    }
  });

  it('rejects unknown modes, empty input and negative dimensions', async () => {
    await expectFails('construction_calc', '');
    await expectFails('construction_calc', 'mode: teleport\nlength: 2');
    await expectFails('construction_calc', 'mode: area\nlength: -5\nwidth: 4');
  });
});

// ─── 6/7. Fuel & electricity ───────────────────────────────────────────────
describe('fuel_calc', () => {
  it('computes litres and cost', async () => {
    const html = await run('fuel_calc', 'distance: 450\nconsumption: 7.5\nprice: 1.85');
    expect(html).toContain('33.75');
  });

  it('rejects empty input, zero consumption and negative distance', async () => {
    await expectFails('fuel_calc', '');
    await expectFails('fuel_calc', 'distance: 450\nconsumption: 0\nprice: 2');
    await expectFails('fuel_calc', 'distance: -10\nconsumption: 7\nprice: 2');
  });
});

describe('electricity_calc', () => {
  it('derives current from power and voltage', async () => {
    expect(await run('electricity_calc', 'power: 1500\nvoltage: 220')).toMatch(/6\.8/);
  });

  it('computes energy and cost when hours and tariff are given', async () => {
    const html = await run('electricity_calc', 'power: 1000\nvoltage: 230\nhours: 10\nprice: 0.3');
    expect(html).toMatch(/10/);
  });

  it('rejects empty input and a zero voltage', async () => {
    await expectFails('electricity_calc', '');
    await expectFails('electricity_calc', 'power: 1500\nvoltage: 0');
  });
});

// ─── 10-14. Money ──────────────────────────────────────────────────────────
describe('tip_calc', () => {
  it('splits a bill', async () => {
    const html = await run('tip_calc', 'bill: 480\ntip: 15\npeople: 3');
    expect(html).toContain('552');
    expect(html).toContain('184');
  });

  it('handles a zero tip and rejects invalid party sizes', async () => {
    expect(await run('tip_calc', 'bill: 100\ntip: 0\npeople: 1')).toContain('100');
    await expectFails('tip_calc', '');
    await expectFails('tip_calc', 'bill: 100\ntip: 10\npeople: 0');
    await expectFails('tip_calc', 'bill: 100\ntip: 10\npeople: 5000');
  });
});

describe('installment_calc', () => {
  it('amortises a fixed-rate loan', async () => {
    const html = await run('installment_calc', 'principal: 100000\nrate: 18\nmonths: 36');
    expect(html).toMatch(/3,6\d\d/);
  });

  it('handles a 0% loan as a plain division', async () => {
    expect(await run('installment_calc', 'principal: 1200\nrate: 0\nmonths: 12')).toContain('100');
  });

  it('rejects empty input and out-of-range terms', async () => {
    await expectFails('installment_calc', '');
    await expectFails('installment_calc', 'principal: 1000\nrate: 5\nmonths: 0');
    await expectFails('installment_calc', 'principal: 1000\nrate: 5\nmonths: 10000');
  });
});

describe('compound_calc', () => {
  it('compounds annually', async () => {
    expect(await run('compound_calc', 'principal: 10000\nrate: 12\nyears: 5')).toMatch(/1[78],\d\d\d/);
  });

  it('rejects empty input and impossible durations', async () => {
    await expectFails('compound_calc', '');
    await expectFails('compound_calc', 'principal: 100\nrate: 5\nyears: 500');
  });
});

describe('profit_calc', () => {
  it('reports profit and margin', async () => {
    const html = await run('profit_calc', 'buy: 100\nsell: 130\nquantity: 10');
    expect(html).toContain('300');
  });

  it('reports a loss with a negative sign', async () => {
    expect(await run('profit_calc', 'buy: 100\nsell: 80\nquantity: 1')).toContain('-20');
  });

  it('rejects empty input and a zero buy price', async () => {
    await expectFails('profit_calc', '');
    await expectFails('profit_calc', 'buy: 0\nsell: 10\nquantity: 1');
  });
});

describe('tax_calc', () => {
  it('uses the caller-supplied rate and never a hard-coded one', async () => {
    const nine = await run('tax_calc', 'amount: 1000\nrate: 9');
    expect(nine).toContain('90');
    expect(nine).toContain('1,090');
    const twenty = await run('tax_calc', 'amount: 1000\nrate: 20');
    expect(twenty).toContain('200');
  });

  it('rejects empty input and impossible rates', async () => {
    await expectFails('tax_calc', '');
    await expectFails('tax_calc', 'amount: 1000\nrate: 150');
    await expectFails('tax_calc', 'amount: 1000');
  });
});

// ─── 15. Word & character counter (extended in Phase 4) ────────────────────
describe('countText / text_counter', () => {
  it('counts English text', () => {
    const stats = countText('Hello world. This is a test.\n\nSecond paragraph here.');
    expect(stats.words).toBe(9);
    expect(stats.sentences).toBe(3);
    expect(stats.paragraphs).toBe(2);
    expect(stats.lines).toBe(3);
    expect(stats.charactersNoSpaces).toBeLessThan(stats.characters);
  });

  it('counts Persian text with Persian punctuation', () => {
    const stats = countText('سلام دنیا. این یک آزمایش است؟ بله!');
    expect(stats.words).toBe(7);
    expect(stats.sentences).toBe(3);
  });

  it('handles empty input and whitespace-only input', () => {
    const empty = countText('');
    expect(empty.words).toBe(0);
    expect(empty.characters).toBe(0);
    expect(empty.sentences).toBe(0);
    const blank = countText('   \n  \n');
    expect(blank.words).toBe(0);
  });

  it('stays linear on large input', () => {
    const big = 'word '.repeat(20000);
    const stats = countText(big);
    expect(stats.words).toBe(20000);
  });

  it('is reachable through the registry', async () => {
    expect(await run('text_counter', 'one two three')).toMatch(/3/);
  });
});
