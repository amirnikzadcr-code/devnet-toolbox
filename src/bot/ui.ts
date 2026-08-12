import type { InlineKeyboardButton, InlineKeyboardMarkup } from '../types/telegram.js';
import type { ToolDefinition } from '../tools/types.js';
import type { Lang } from '../localization/index.js';
import { t } from '../localization/index.js';
import { CATEGORIES, type Page } from '../tools/registry.js';
import { DIVIDER } from '../utils/text.js';

/**
 * Callback-data grammar (Telegram hard-limits this to 64 bytes):
 *   home | tb | quick | prof | mytools | stats | set | help | about | cancel | noop
 *   sec | sech:<page> | secd | secr:<scanType> | secv:<full|iocs|score>
 *   cat:<category>:<page>
 *   tool:<toolId>
 *   run:<toolId>
 *   lang:<fa|en>
 */
export const CB = {
  home: 'home',
  toolbox: 'tb',
  quick: 'quick',
  profile: 'prof',
  myTools: 'mytools',
  stats: 'stats',
  settings: 'set',
  help: 'help',
  about: 'about',
  cancel: 'cancel',
  noop: 'noop',
  /** 🛡️ Advanced Security section root (Phase 2). */
  security: 'sec',
  category: (id: string, page = 1): string => `cat:${id}:${page}`,
  tool: (id: string): string => `tool:${id}`,
  run: (id: string): string => `run:${id}`,
  lang: (lang: Lang): string => `lang:${lang}`,
} as const;

const btn = (text: string, data: string): InlineKeyboardButton => ({ text, callback_data: data });
const link = (text: string, url: string): InlineKeyboardButton => ({ text, url });

export function kb(rows: InlineKeyboardButton[][]): InlineKeyboardMarkup {
  return { inline_keyboard: rows.filter((row) => row.length > 0) };
}

export function navRow(lang: Lang, backTo?: string): InlineKeyboardButton[] {
  const row: InlineKeyboardButton[] = [];
  if (backTo) row.push(btn(t(lang, 'btn_back'), backTo));
  row.push(btn(t(lang, 'btn_home'), CB.home));
  return row;
}

export function homeKeyboard(lang: Lang): InlineKeyboardMarkup {
  return kb([
    [btn(t(lang, 'btn_toolbox'), CB.toolbox), btn(t(lang, 'btn_quick'), CB.quick)],
    // Phase 2: the security section gets a full-width row of its own — it is a
    // distinct workflow (uploads, reports), not just another tool category.
    [btn(t(lang, 'btn_security'), CB.security)],
    [btn(t(lang, 'btn_profile'), CB.profile), btn(t(lang, 'btn_stats'), CB.stats)],
    [btn(t(lang, 'btn_settings'), CB.settings), btn(t(lang, 'btn_help'), CB.help)],
    [btn(t(lang, 'btn_about'), CB.about)],
  ]);
}

export function toolboxKeyboard(lang: Lang, counts: Record<string, number>): InlineKeyboardMarkup {
  const rows = CATEGORIES.map((category) => [
    btn(
      `${category.icon} ${lang === 'fa' ? category.title.fa : category.title.en} · ${counts[category.id] ?? 0}`,
      CB.category(category.id, 1),
    ),
  ]);
  rows.push([btn(t(lang, 'btn_security'), CB.security)]);
  rows.push([btn(t(lang, 'btn_quick'), CB.quick)]);
  rows.push(navRow(lang, CB.home));
  return kb(rows);
}

/** Two tools per row keeps buttons readable on narrow screens. */
export function toolListKeyboard(
  lang: Lang,
  page: Page<ToolDefinition>,
  categoryId: string,
  backTo: string,
): InlineKeyboardMarkup {
  const rows: InlineKeyboardButton[][] = [];
  for (let i = 0; i < page.items.length; i += 2) {
    const row = page.items.slice(i, i + 2).map((tool) =>
      btn(`${tool.icon} ${lang === 'fa' ? tool.title.fa : tool.title.en}`, CB.tool(tool.id)),
    );
    rows.push(row);
  }
  if (page.pages > 1) {
    rows.push([
      page.page > 1 ? btn(t(lang, 'btn_prev'), CB.category(categoryId, page.page - 1)) : btn('·', CB.noop),
      btn(`${page.page}/${page.pages}`, CB.noop),
      page.page < page.pages ? btn(t(lang, 'btn_next'), CB.category(categoryId, page.page + 1)) : btn('·', CB.noop),
    ]);
  }
  rows.push(navRow(lang, backTo));
  return kb(rows);
}

export function toolPageKeyboard(lang: Lang, tool: ToolDefinition, backTo: string): InlineKeyboardMarkup {
  return kb([[btn(t(lang, 'btn_run'), CB.run(tool.id))], navRow(lang, backTo)]);
}

export function resultKeyboard(lang: Lang, tool: ToolDefinition): InlineKeyboardMarkup {
  return kb([
    [btn(t(lang, 'btn_again'), CB.run(tool.id)), btn(`${tool.icon} ${t(lang, 'btn_back')}`, CB.tool(tool.id))],
    [btn(t(lang, 'btn_toolbox'), CB.toolbox), btn(t(lang, 'btn_home'), CB.home)],
  ]);
}

export function waitingKeyboard(lang: Lang, tool: ToolDefinition): InlineKeyboardMarkup {
  return kb([[btn(t(lang, 'btn_cancel'), CB.tool(tool.id))], navRow(lang, CB.home)]);
}

export function profileKeyboard(lang: Lang): InlineKeyboardMarkup {
  return kb([
    [btn(t(lang, 'btn_stats'), CB.stats), btn(t(lang, 'btn_my_tools'), CB.myTools)],
    navRow(lang, CB.home),
  ]);
}

export function statsKeyboard(lang: Lang): InlineKeyboardMarkup {
  return kb([[btn(t(lang, 'btn_profile'), CB.profile)], navRow(lang, CB.home)]);
}

export function settingsKeyboard(lang: Lang): InlineKeyboardMarkup {
  return kb([
    [
      btn(`${lang === 'fa' ? '✅ ' : ''}🇮🇷 فارسی`, CB.lang('fa')),
      btn(`${lang === 'en' ? '✅ ' : ''}🇬🇧 English`, CB.lang('en')),
    ],
    navRow(lang, CB.home),
  ]);
}

export function aboutKeyboard(lang: Lang, repoUrl?: string): InlineKeyboardMarkup {
  const rows: InlineKeyboardButton[][] = [];
  if (repoUrl) rows.push([link('📦 GitHub', repoUrl)]);
  rows.push([btn(t(lang, 'btn_help'), CB.help)]);
  rows.push(navRow(lang, CB.home));
  return kb(rows);
}

export function simpleKeyboard(lang: Lang, backTo: string = CB.home): InlineKeyboardMarkup {
  return kb([navRow(lang, backTo)]);
}

export function section(title: string, body: string): string {
  return `${title}\n${DIVIDER}\n${body}`;
}
