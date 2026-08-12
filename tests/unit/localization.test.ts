import { describe, expect, it } from 'vitest';
import { detectLang, isLang, pick, t } from '../../src/localization/index.js';
import { fa } from '../../src/localization/fa.js';
import { en } from '../../src/localization/en.js';

describe('translation catalogues', () => {
  it('has identical key sets in both languages', () => {
    const faKeys = Object.keys(fa).sort();
    const enKeys = Object.keys(en).sort();
    expect(faKeys).toEqual(enKeys);
  });

  it('has no empty strings', () => {
    for (const [key, value] of Object.entries(fa)) expect(value.trim(), `fa.${key}`).not.toBe('');
    for (const [key, value] of Object.entries(en)) expect(value.trim(), `en.${key}`).not.toBe('');
  });

  it('keeps placeholder tokens consistent between languages', () => {
    const tokens = (s: string): string[] => (s.match(/\{\w+\}/g) ?? []).sort();
    for (const key of Object.keys(fa) as (keyof typeof fa)[]) {
      expect(tokens(en[key]), `placeholders for "${String(key)}"`).toEqual(tokens(fa[key]));
    }
  });

  it('contains no leaked secret-looking values', () => {
    const all = [...Object.values(fa), ...Object.values(en)].join('\n');
    expect(all).not.toMatch(/\d{8,10}:[A-Za-z0-9_-]{30,}/); // telegram bot token shape
    expect(all).not.toMatch(/BOT_TOKEN\s*=/);
  });
});

describe('t()', () => {
  it('returns the Persian string by default', () => {
    expect(t('fa', 'home_title')).toBe(fa.home_title);
  });

  it('returns the English string when asked', () => {
    expect(t('en', 'home_title')).toBe(en.home_title);
  });

  it('interpolates named parameters', () => {
    const key = (Object.keys(fa) as (keyof typeof fa)[]).find((k) => /\{\w+\}/.test(fa[k]));
    expect(key, 'expected at least one parameterised string').toBeDefined();
    if (key) {
      const token = /\{(\w+)\}/.exec(fa[key])?.[1] as string;
      const out = t('fa', key, { [token]: 'XYZ' });
      expect(out).toContain('XYZ');
      expect(out).not.toContain(`{${token}}`);
    }
  });

  it('leaves unknown placeholders untouched rather than printing undefined', () => {
    const key = (Object.keys(fa) as (keyof typeof fa)[]).find((k) => /\{\w+\}/.test(fa[k]));
    if (key) expect(t('fa', key)).not.toContain('undefined');
  });
});

describe('pick()', () => {
  it('selects the right side of a bilingual pair', () => {
    const pair = { fa: 'سلام', en: 'Hello' };
    expect(pick('fa', pair)).toBe('سلام');
    expect(pick('en', pair)).toBe('Hello');
  });
});

describe('isLang()', () => {
  it('accepts supported languages only', () => {
    expect(isLang('fa')).toBe(true);
    expect(isLang('en')).toBe(true);
    expect(isLang('de')).toBe(false);
    expect(isLang('')).toBe(false);
    expect(isLang(undefined)).toBe(false);
    expect(isLang(null)).toBe(false);
    expect(isLang(42)).toBe(false);
  });
});

describe('detectLang()', () => {
  it('maps Persian locales to fa', () => {
    expect(detectLang('fa')).toBe('fa');
    expect(detectLang('fa-IR')).toBe('fa');
  });

  it('maps English locales to en', () => {
    expect(detectLang('en')).toBe('en');
    expect(detectLang('en-US')).toBe('en');
  });

  it('falls back to the default language for anything else', () => {
    expect(detectLang('de-DE')).toBe('fa');
    expect(detectLang(undefined)).toBe('fa');
    expect(detectLang('')).toBe('fa');
  });
});
