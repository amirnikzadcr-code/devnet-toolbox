import type { InlineKeyboardButton, InlineKeyboardMarkup } from '../types/telegram.js';
import type { ToolDefinition } from '../tools/types.js';
import type { Lang } from '../localization/index.js';
import { t } from '../localization/index.js';
import { CATEGORIES, populatedGroups, toolsByGroup, type Page } from '../tools/registry.js';
import { DIVIDER } from '../utils/text.js';

/**
 * Callback-data grammar (Telegram hard-limits this to 64 bytes):
 *   home | tb | quick | prof | mytools | stats | set | help | about | cancel | noop
 *   sec | sech:<page> | secd | secr:<scanType> | secv:<full|iocs|score>
 *   cat:<category>:<page>
 *   grp:<everydayGroup>:<page>       (Phase 4 sub-sections)
 *   fav | fav:<page> | favt:<toolId> (Phase 4 favourites)
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
  /** ⭐ My Favorites list (Phase 4). */
  favorites: 'fav',
  category: (id: string, page = 1): string => `cat:${id}:${page}`,
  /** A sub-section of 🧰 Everyday Tools (Phase 4). */
  group: (id: string, page = 1): string => `grp:${id}:${page}`,
  favPage: (page = 1): string => `fav:${page}`,
  /** Toggle the ⭐ state of one tool. */
  favToggle: (id: string): string => `favt:${id}`,
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

/** Opens the Mini App. Telegram only accepts https URLs here. */
const webApp = (text: string, url: string): InlineKeyboardButton => ({ text, web_app: { url } });

/**
 * @param appUrl When set, a Mini App launch button is prepended. Every existing
 *   button is preserved: the app is an additional entry point, not a
 *   replacement for the inline flows.
 */
export function homeKeyboard(lang: Lang, appUrl?: string): InlineKeyboardMarkup {
  return kb([
    appUrl ? [webApp(t(lang, 'btn_miniapp'), appUrl)] : [],
    [btn(t(lang, 'btn_toolbox'), CB.toolbox), btn(t(lang, 'btn_quick'), CB.quick)],
    // Phase 2: the security section gets a full-width row of its own — it is a
    // distinct workflow (uploads, reports), not just another tool category.
    [btn(t(lang, 'btn_security'), CB.security)],
    [btn(t(lang, 'btn_favorites'), CB.favorites), btn(t(lang, 'btn_profile'), CB.profile)],
    [btn(t(lang, 'btn_stats'), CB.stats)],
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
  rows.push([btn(t(lang, 'btn_quick'), CB.quick), btn(t(lang, 'btn_favorites'), CB.favorites)]);
  rows.push(navRow(lang, CB.home));
  return kb(rows);
}

/** Two tools per row keeps buttons readable on narrow screens. */
export function toolListKeyboard(
  lang: Lang,
  page: Page<ToolDefinition>,
  categoryId: string,
  backTo: string,
  /** Overrides how page buttons are built; used by Everyday sub-sections. */
  pageCallback: (page: number) => string = (target) => CB.category(categoryId, target),
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
      page.page > 1 ? btn(t(lang, 'btn_prev'), pageCallback(page.page - 1)) : btn('·', CB.noop),
      btn(`${page.page}/${page.pages}`, CB.noop),
      page.page < page.pages ? btn(t(lang, 'btn_next'), pageCallback(page.page + 1)) : btn('·', CB.noop),
    ]);
  }
  rows.push(navRow(lang, backTo));
  return kb(rows);
}

/**
 * 🧰 Everyday Tools opens on its sub-sections rather than a flat list: with
 * dozens of tools in one category, paging through them is far worse than
 * picking 📐 Calculators or 🧠 Productivity first.
 */
export function everydayKeyboard(lang: Lang): InlineKeyboardMarkup {
  const rows = populatedGroups().map((group) => [
    btn(
      `${group.icon} ${lang === 'fa' ? group.title.fa : group.title.en} · ${toolsByGroup(group.id).length}`,
      CB.group(group.id, 1),
    ),
  ]);
  rows.push([btn(t(lang, 'btn_favorites'), CB.favorites)]);
  rows.push(navRow(lang, CB.toolbox));
  return kb(rows);
}

/**
 * `isFavorite` drives the star button's label so one tap always does the
 * opposite of the current state. It is optional: callers that have no D1
 * handle (unit tests, error paths) simply omit the button.
 */
export function toolPageKeyboard(
  lang: Lang,
  tool: ToolDefinition,
  backTo: string,
  isFavorite?: boolean,
): InlineKeyboardMarkup {
  const rows: InlineKeyboardButton[][] = [[btn(t(lang, 'btn_run'), CB.run(tool.id))]];
  if (isFavorite !== undefined) {
    rows.push([btn(t(lang, isFavorite ? 'btn_fav_remove' : 'btn_fav_add'), CB.favToggle(tool.id))]);
  }
  rows.push(navRow(lang, backTo));
  return kb(rows);
}

/** ⭐ My Favorites list. Same two-per-row layout as any other tool list. */
export function favoritesKeyboard(lang: Lang, page: Page<ToolDefinition>): InlineKeyboardMarkup {
  const rows: InlineKeyboardButton[][] = [];
  for (let i = 0; i < page.items.length; i += 2) {
    rows.push(
      page.items
        .slice(i, i + 2)
        .map((tool) => btn(`${tool.icon} ${lang === 'fa' ? tool.title.fa : tool.title.en}`, CB.tool(tool.id))),
    );
  }
  if (page.pages > 1) {
    rows.push([
      page.page > 1 ? btn(t(lang, 'btn_prev'), CB.favPage(page.page - 1)) : btn('·', CB.noop),
      btn(`${page.page}/${page.pages}`, CB.noop),
      page.page < page.pages ? btn(t(lang, 'btn_next'), CB.favPage(page.page + 1)) : btn('·', CB.noop),
    ]);
  }
  if (page.total === 0) rows.push([btn(t(lang, 'btn_toolbox'), CB.toolbox)]);
  rows.push(navRow(lang, CB.home));
  return kb(rows);
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
