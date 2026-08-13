import type { InlineKeyboardMarkup } from '../types/telegram.js';
import type { BotContext } from './context.js';
import type { EverydayGroup, ToolCategory } from '../tools/types.js';
import { t } from '../localization/index.js';
import {
  ALL_TOOLS,
  CATEGORIES,
  countByCategory,
  getTool,
  paginate,
  quickTools,
  toolsByCategory,
  toolsByGroup,
} from '../tools/registry.js';
import * as P from './pages.js';
import * as UI from './ui.js';
import { dailySeries, getUser, globalStats, userDistinctTools, userTopTools } from '../db/queries.js';
import { isFavorite, pruneFavorites } from '../db/favorites.js';

export interface Screen {
  text: string;
  keyboard: InlineKeyboardMarkup;
  /** Optional toast for callback answers. */
  toast?: string;
}

export function homeScreen(ctx: BotContext): Screen {
  return { text: P.homePage(ctx.lang), keyboard: UI.homeKeyboard(ctx.lang, ctx.env.APP_URL) };
}

export function toolboxScreen(ctx: BotContext): Screen {
  const counts: Record<string, number> = {};
  for (const category of CATEGORIES) counts[category.id] = countByCategory(category.id);
  return { text: P.toolboxPage(ctx.lang), keyboard: UI.toolboxKeyboard(ctx.lang, counts) };
}

export function categoryScreen(ctx: BotContext, category: ToolCategory, page: number): Screen {
  // 🧰 Everyday Tools is large enough that a flat list would be unusable, so
  // it opens on its sub-sections instead. Every other category is unchanged.
  if (category === 'everyday') {
    return { text: P.everydayPage(ctx.lang), keyboard: UI.everydayKeyboard(ctx.lang) };
  }
  const pageData = paginate(toolsByCategory(category), page);
  return {
    text: P.categoryPage(ctx.lang, category, pageData),
    keyboard: UI.toolListKeyboard(ctx.lang, pageData, category, UI.CB.toolbox),
  };
}

export function everydayGroupScreen(ctx: BotContext, group: EverydayGroup, page: number): Screen {
  const pageData = paginate(toolsByGroup(group), page);
  return {
    text: P.everydayGroupPage(ctx.lang, group, pageData),
    keyboard: UI.toolListKeyboard(
      ctx.lang,
      pageData,
      group,
      UI.CB.category('everyday', 1),
      (target) => UI.CB.group(group, target),
    ),
  };
}

/**
 * ⭐ My Favorites. Stale ids (a tool removed in a later release) are pruned on
 * read so the list can never show a button that leads nowhere.
 */
export async function favoritesScreen(ctx: BotContext, page: number): Promise<Screen> {
  const validIds = new Set(ALL_TOOLS.map((tool) => tool.id));
  const ids = await pruneFavorites(ctx.env.DB, ctx.user.id, validIds);
  const tools = ids.map((id) => getTool(id)).filter((tool): tool is NonNullable<typeof tool> => tool !== undefined);
  const pageData = paginate(tools, page);
  return {
    text: P.favoritesPage(ctx.lang, pageData),
    keyboard: UI.favoritesKeyboard(ctx.lang, pageData),
  };
}

export function quickScreen(ctx: BotContext, page: number): Screen {
  const pageData = paginate(quickTools(), page);
  return {
    text: P.quickPage(ctx.lang, pageData),
    keyboard: UI.toolListKeyboard(ctx.lang, pageData, 'quick', UI.CB.home),
  };
}

/** Where the ◀️ Back button on a tool page should return to. */
function toolBackTarget(tool: { category: ToolCategory; group?: EverydayGroup }): string {
  return tool.category === 'everyday' && tool.group
    ? UI.CB.group(tool.group, 1)
    : UI.CB.category(tool.category, 1);
}

export function toolScreen(ctx: BotContext, toolId: string): Screen | null {
  const tool = getTool(toolId);
  if (!tool) return null;
  return {
    text: P.toolPage(ctx.lang, tool),
    keyboard: UI.toolPageKeyboard(ctx.lang, tool, toolBackTarget(tool)),
  };
}

/**
 * Same as `toolScreen` but with the ⭐ button resolved against D1. Kept
 * separate because the synchronous version is used on hot paths (and in tests)
 * where a database round-trip would be wasteful.
 */
export async function toolScreenWithFavorite(ctx: BotContext, toolId: string): Promise<Screen | null> {
  const tool = getTool(toolId);
  if (!tool) return null;
  const starred = await isFavorite(ctx.env.DB, ctx.user.id, tool.id);
  return {
    text: P.toolPage(ctx.lang, tool),
    keyboard: UI.toolPageKeyboard(ctx.lang, tool, toolBackTarget(tool), starred),
  };
}

export async function profileScreen(ctx: BotContext): Promise<Screen> {
  const [user, distinct, top] = await Promise.all([
    getUser(ctx.env.DB, ctx.user.id),
    userDistinctTools(ctx.env.DB, ctx.user.id),
    userTopTools(ctx.env.DB, ctx.user.id, 1),
  ]);
  if (!user) {
    return { text: P.errorPage(ctx.lang, t(ctx.lang, 'err_generic')), keyboard: UI.simpleKeyboard(ctx.lang) };
  }
  return {
    text: P.profilePage(ctx.lang, { ...user, lang: ctx.lang }, distinct, top[0] ?? null),
    keyboard: UI.profileKeyboard(ctx.lang),
  };
}

export async function myToolsScreen(ctx: BotContext): Promise<Screen> {
  const rows = await userTopTools(ctx.env.DB, ctx.user.id, 10);
  return { text: P.myToolsPage(ctx.lang, rows), keyboard: UI.simpleKeyboard(ctx.lang, UI.CB.profile) };
}

export async function statsScreen(ctx: BotContext): Promise<Screen> {
  const [stats, series, user] = await Promise.all([
    globalStats(ctx.env.DB),
    dailySeries(ctx.env.DB, 7),
    getUser(ctx.env.DB, ctx.user.id),
  ]);
  return {
    text: P.statsPage(ctx.lang, stats, series, user?.tool_runs ?? 0),
    keyboard: UI.statsKeyboard(ctx.lang),
  };
}

export function settingsScreen(ctx: BotContext): Screen {
  return { text: P.settingsPage(ctx.lang), keyboard: UI.settingsKeyboard(ctx.lang) };
}

export function helpScreen(ctx: BotContext): Screen {
  return { text: P.helpPage(ctx.lang), keyboard: UI.simpleKeyboard(ctx.lang) };
}

export function aboutScreen(ctx: BotContext): Screen {
  return {
    text: P.aboutPage(ctx.lang, ctx.env.ENVIRONMENT ?? 'production', ctx.env.REPO_URL),
    keyboard: UI.aboutKeyboard(ctx.lang, ctx.env.REPO_URL),
  };
}
