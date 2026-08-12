import { fa } from './fa.js';
import { en } from './en.js';

export type Lang = 'fa' | 'en';
export type Dict = Record<keyof typeof fa, string>;

const DICTS: Record<Lang, Dict> = { fa, en };

export const SUPPORTED_LANGS: Lang[] = ['fa', 'en'];

export function isLang(value: unknown): value is Lang {
  return value === 'fa' || value === 'en';
}

export const DEFAULT_LANG: Lang = 'fa';

/**
 * Initial language for a brand-new user, derived from Telegram's language_code.
 * Persian locales → fa, English locales → en, everything else → fa (product default).
 * The user can always override this from Settings.
 */
export function detectLang(languageCode?: string): Lang {
  if (!languageCode) return DEFAULT_LANG;
  const code = languageCode.toLowerCase();
  if (code.startsWith('fa') || code.startsWith('pe')) return 'fa';
  if (code.startsWith('en')) return 'en';
  return DEFAULT_LANG;
}

export function t(lang: Lang, key: keyof Dict, vars?: Record<string, string | number>): string {
  const dict = DICTS[lang] ?? fa;
  let value: string = dict[key] ?? fa[key] ?? String(key);
  if (vars) {
    for (const [k, v] of Object.entries(vars)) {
      value = value.replaceAll(`{${k}}`, String(v));
    }
  }
  return value;
}

/** Picks the localized member of a bilingual record. */
export function pick(lang: Lang, value: { fa: string; en: string }): string {
  return lang === 'fa' ? value.fa : value.en;
}

export { fa, en };
