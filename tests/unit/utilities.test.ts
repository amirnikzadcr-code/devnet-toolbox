import { describe, expect, it } from 'vitest';
import { convertUnit, evaluateExpression } from '../../src/tools/utilities/index.js';
import { ToolError } from '../../src/utils/errors.js';
import { getTool } from '../../src/tools/registry.js';
import type { ToolRunContext } from '../../src/tools/types.js';

const ctx: ToolRunContext = { lang: 'fa', userId: 42 };

describe('evaluateExpression (no eval, shunting-yard)', () => {
  it('respects operator precedence', () => {
    expect(evaluateExpression('2+3*4')).toBe(14);
    expect(evaluateExpression('(2+3)*4')).toBe(20);
    expect(evaluateExpression('2^3^2')).toBe(512); // right-associative
    expect(evaluateExpression('10%3')).toBe(1);
  });

  it('handles unary minus and decimals', () => {
    expect(evaluateExpression('-5+2')).toBe(-3);
    expect(evaluateExpression('-(3*2)')).toBe(-6);
    expect(evaluateExpression('0.1+0.2')).toBeCloseTo(0.3, 10);
  });

  it('supports whitelisted functions', () => {
    expect(evaluateExpression('sqrt(16)')).toBe(4);
    expect(evaluateExpression('abs(-7)')).toBe(7);
    expect(evaluateExpression('round(2.6)')).toBe(3);
  });

  it('rejects division and modulo by zero', () => {
    expect(() => evaluateExpression('1/0')).toThrowError(ToolError);
    expect(() => evaluateExpression('1%0')).toThrowError(ToolError);
  });

  it('rejects unbalanced parentheses', () => {
    expect(() => evaluateExpression('(1+2')).toThrowError(ToolError);
    expect(() => evaluateExpression('1+2)')).toThrowError(ToolError);
  });

  it('never executes JavaScript', () => {
    for (const payload of [
      'process.exit(1)',
      'globalThis',
      'constructor',
      '(function(){return 1})()',
      'require("fs")',
      '1;console.log(1)',
      '__proto__',
    ]) {
      expect(() => evaluateExpression(payload), payload).toThrowError(ToolError);
    }
  });

  it('rejects empty and oversized expressions', () => {
    expect(() => evaluateExpression('')).toThrowError(ToolError);
    expect(() => evaluateExpression('1+'.repeat(300) + '1')).toThrowError(ToolError);
  });

  it('rejects incomplete expressions instead of returning NaN', () => {
    expect(() => evaluateExpression('1+')).toThrowError(ToolError);
    expect(() => evaluateExpression('*5')).toThrowError(ToolError);
  });
});

describe('convertUnit', () => {
  it('converts length units', () => {
    expect(convertUnit(1, 'km', 'm')).toBeCloseTo(1000, 9);
    expect(convertUnit(1, 'mi', 'km')).toBeCloseTo(1.609344, 6);
    expect(convertUnit(12, 'in', 'ft')).toBeCloseTo(1, 9);
  });

  it('converts temperatures across all three scales', () => {
    expect(convertUnit(100, 'c', 'f')).toBeCloseTo(212, 9);
    expect(convertUnit(32, 'f', 'c')).toBeCloseTo(0, 9);
    expect(convertUnit(0, 'c', 'k')).toBeCloseTo(273.15, 9);
    expect(convertUnit(300, 'k', 'f')).toBeCloseTo(80.33, 2);
  });

  it('converts data and time units', () => {
    expect(convertUnit(1, 'gb', 'mb')).toBe(1024);
    expect(convertUnit(90, 'min', 'h')).toBeCloseTo(1.5, 9);
  });

  it('is case-insensitive', () => {
    expect(convertUnit(1, 'KM', 'M')).toBeCloseTo(1000, 9);
  });

  it('rejects incompatible or unknown units', () => {
    expect(() => convertUnit(1, 'kg', 'm')).toThrowError(ToolError);
    expect(() => convertUnit(1, 'banana', 'm')).toThrowError(ToolError);
  });
});

describe('timestamp tool', () => {
  const tool = getTool('timestamp');

  it('is registered', () => {
    expect(tool).toBeDefined();
  });

  it('converts a known unix timestamp to ISO-8601 UTC', async () => {
    const result = await tool!.run('1700000000', ctx);
    expect(result.html).toContain('2023-11-14');
  });

  it('accepts millisecond precision', async () => {
    const result = await tool!.run('1700000000000', ctx);
    expect(result.html).toContain('2023-11-14');
  });

  it('parses an ISO date back to epoch seconds', async () => {
    const result = await tool!.run('2023-11-14T22:13:20Z', ctx);
    expect(result.html).toContain('1700000000');
  });

  it('rejects garbage', async () => {
    await expect(async () => tool!.run('not-a-date', ctx)).rejects.toBeInstanceOf(ToolError);
  });
});

describe('case_convert tool', () => {
  const tool = getTool('case_convert');

  it('produces the standard case variants', async () => {
    const result = await tool!.run('hello world example', ctx);
    expect(result.html).toContain('HELLO WORLD EXAMPLE');
    expect(result.html.toLowerCase()).toContain('hello_world_example');
    expect(result.html).toContain('helloWorldExample');
    expect(result.html).toContain('hello-world-example');
  });
});

describe('color_convert tool', () => {
  const tool = getTool('color_convert');

  it('converts hex to rgb', async () => {
    const result = await tool!.run('#ff0000', ctx);
    expect(result.html).toMatch(/255,\s*0,\s*0/);
  });

  it('converts rgb back to hex', async () => {
    const result = await tool!.run('rgb(0, 128, 255)', ctx);
    expect(result.html.toLowerCase()).toContain('#0080ff');
  });

  it('rejects an invalid colour', async () => {
    await expect(async () => tool!.run('#zzz', ctx)).rejects.toBeInstanceOf(ToolError);
  });
});

describe('generators produce valid output without input', () => {
  it('uuid_gen returns well-formed UUIDs', async () => {
    const result = await getTool('uuid_gen')!.run('', ctx);
    expect(result.html).toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i);
  });

  it('password_gen returns a password and an entropy estimate', async () => {
    const result = await getTool('password_gen')!.run('', ctx);
    expect(result.html).toMatch(/bit|بیت/i);
    expect(result.html.length).toBeGreaterThan(20);
  });

  it('secret_gen returns high-entropy hex/base64 material', async () => {
    const result = await getTool('secret_gen')!.run('', ctx);
    expect(result.html).toMatch(/[0-9a-f]{32,}/i);
  });

  it('two consecutive generations never match', async () => {
    const a = await getTool('secret_gen')!.run('', ctx);
    const b = await getTool('secret_gen')!.run('', ctx);
    expect(a.html).not.toBe(b.html);
  });
});
