import type { InlineKeyboardMarkup } from '../types/telegram.js';
import type { BotContext } from './context.js';
import type { ToolCategory } from '../tools/types.js';
import { t } from '../localization/index.js';
import {
  CATEGORIES,
  countByCategory,
  getTool,
  paginate,
  quickTools,
  toolsByCategory,
} from '../tools/registry.js';
import * as P from './pages.js';
import * as UI from './ui.js';
import { dailySeries, getUser, globalStats, userDistinctTools, userTopTools } from '../db/queries.js';

export interface Screen {
  text: string;
  keyboard: InlineKeyboardMarkup;
  /** Optional toast for callback answers. */
  toast?: string;
}

export function homeScreen(ctx: BotContext): Screen {
  return { text: P.homePage(ctx.lang), keyboard: UI.homeKeyboard(ctx.lang) };
}

export function toolboxScreen(ctx: BotContext): Screen {
  const counts: Record<string, number> = {};
  for (const category of CATEGORIES) counts[category.id] = countByCategory(category.id);
  return { text: P.toolboxPage(ctx.lang), keyboard: UI.toolboxKeyboard(ctx.lang, counts) };
}

export function categoryScreen(ctx: BotContext, category: ToolCategory, page: number): Screen {
  const pageData = paginate(toolsByCategory(category), page);
  return {
    text: P.categoryPage(ctx.lang, category, pageData),
    keyboard: UI.toolListKeyboard(ctx.lang, pageData, category, UI.CB.toolbox),
  };
}

export function quickScreen(ctx: BotContext, page: number): Screen {
  const pageData = paginate(quickTools(), page);
  return {
    text: P.quickPage(ctx.lang, pageData),
    keyboard: UI.toolListKeyboard(ctx.lang, pageData, 'quick', UI.CB.home),
  };
}

export function toolScreen(ctx: BotContext, toolId: string): Screen | null {
  const tool = getTool(toolId);
  if (!tool) return null;
  return {
    text: P.toolPage(ctx.lang, tool),
    keyboard: UI.toolPageKeyboard(ctx.lang, tool, UI.CB.category(tool.category, 1)),
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
