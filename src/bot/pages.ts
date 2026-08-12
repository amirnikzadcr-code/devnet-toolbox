import type { Lang } from '../localization/index.js';
import type { ToolDefinition } from '../tools/types.js';
import type { UserRow, GlobalStats, ToolUsageRow, DailyPoint } from '../db/queries.js';
import { t, pick } from '../localization/index.js';
import { APP, LIMITS, RATE_LIMIT } from '../config/index.js';
import { CATEGORIES, TOTAL_TOOLS, categoryMeta, getTool, type Page } from '../tools/registry.js';
import { DIVIDER, escapeHtml, mono } from '../utils/text.js';
import type { ToolCategory } from '../tools/types.js';

const faDigits = (value: number | string): string => String(value);

function formatDate(unixSec: number): string {
  const iso = new Date(unixSec * 1000).toISOString();
  return `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC`;
}

function relative(lang: Lang, unixSec: number): string {
  const diff = Math.max(0, Math.floor(Date.now() / 1000) - unixSec);
  const fa = lang === 'fa';
  if (diff < 60) return fa ? 'همین حالا' : 'just now';
  if (diff < 3600) return fa ? `${Math.floor(diff / 60)} دقیقه پیش` : `${Math.floor(diff / 60)}m ago`;
  if (diff < 86_400) return fa ? `${Math.floor(diff / 3600)} ساعت پیش` : `${Math.floor(diff / 3600)}h ago`;
  return fa ? `${Math.floor(diff / 86_400)} روز پیش` : `${Math.floor(diff / 86_400)}d ago`;
}

export function homePage(lang: Lang): string {
  return [
    t(lang, 'home_title'),
    t(lang, 'home_tagline'),
    DIVIDER,
    t(lang, 'home_body', { count: TOTAL_TOOLS }),
    '',
    t(lang, 'home_hint'),
  ].join('\n');
}

export function toolboxPage(lang: Lang): string {
  const lines = CATEGORIES.map(
    (category) => `${category.icon} <b>${pick(lang, category.title)}</b>\n<i>${pick(lang, category.description)}</i>`,
  );
  return [t(lang, 'toolbox_title'), DIVIDER, t(lang, 'toolbox_body', { count: TOTAL_TOOLS }), '', lines.join('\n\n')].join('\n');
}

export function categoryPage(lang: Lang, category: ToolCategory, page: Page<ToolDefinition>): string {
  const meta = categoryMeta(category);
  const header = meta ? `${meta.icon} <b>${pick(lang, meta.title)}</b>` : t(lang, 'toolbox_title');
  const list = page.items
    .map((tool) => `${tool.icon} <b>${pick(lang, tool.title)}</b>\n   <i>${escapeHtml(shorten(pick(lang, tool.description)))}</i>`)
    .join('\n');
  return [
    header,
    DIVIDER,
    meta ? `<i>${pick(lang, meta.description)}</i>\n` : '',
    list,
    '',
    t(lang, 'category_body', { count: page.total, page: page.page, pages: page.pages }),
  ]
    .filter(Boolean)
    .join('\n');
}

export function quickPage(lang: Lang, page: Page<ToolDefinition>): string {
  const list = page.items.map((tool) => `${tool.icon} <b>${pick(lang, tool.title)}</b>`).join('\n');
  const body =
    lang === 'fa'
      ? 'پرکاربردترین ابزارها، یک کلیک دورتر.'
      : 'The most frequently used tools, one tap away.';
  return [t(lang, 'cat_quick'), DIVIDER, `<i>${body}</i>`, '', list, '', t(lang, 'category_body', { count: page.total, page: page.page, pages: page.pages })].join('\n');
}

function shorten(text: string, max = 90): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}

export function toolPage(lang: Lang, tool: ToolDefinition): string {
  const meta = categoryMeta(tool.category);
  const rows = [
    `${tool.icon} <b>${pick(lang, tool.title)}</b>`,
    meta ? `<i>${meta.icon} ${pick(lang, meta.title)}${tool.network ? (lang === 'fa' ? ' • نیازمند شبکه' : ' • network') : ''}</i>` : '',
    DIVIDER,
    `${t(lang, 'tool_desc_label')}\n${pick(lang, tool.description)}`,
    '',
    `${t(lang, 'tool_usage_label')}\n${pick(lang, tool.usage)}`,
    '',
    `${t(lang, 'tool_example_label')}\n<pre>${escapeHtml(pick(lang, tool.example))}</pre>`,
    `${t(lang, 'tool_limits_label')}\n<i>${pick(lang, tool.limitations)}</i>`,
    DIVIDER,
    tool.needsInput ? t(lang, 'tool_prompt') : t(lang, 'tool_no_input'),
  ];
  return rows.filter(Boolean).join('\n');
}

export function waitingPage(lang: Lang, tool: ToolDefinition): string {
  return [
    `${tool.icon} <b>${pick(lang, tool.title)}</b>`,
    DIVIDER,
    t(lang, 'tool_waiting', { tool: pick(lang, tool.title) }),
    '',
    `${t(lang, 'tool_usage_label')}\n${pick(lang, tool.usage)}`,
  ].join('\n');
}

export function resultPage(lang: Lang, tool: ToolDefinition, html: string): string {
  return [t(lang, 'tool_result_title', { tool: pick(lang, tool.title) }), '', html].join('\n');
}

export function profilePage(
  lang: Lang,
  user: UserRow,
  distinct: number,
  favourite: ToolUsageRow | null,
): string {
  const favTool = favourite ? getTool(favourite.tool_id) : null;
  const favLabel = favTool
    ? `${favTool.icon} ${pick(lang, favTool.title)} (${favourite?.uses ?? 0}×)`
    : t(lang, 'profile_none');
  const fullName = [user.first_name, user.last_name].filter(Boolean).join(' ') || t(lang, 'profile_none');
  const rows = [
    `${t(lang, 'profile_name')}: <b>${escapeHtml(fullName)}</b>`,
    `${t(lang, 'profile_username')}: ${user.username ? mono(`@${user.username}`) : t(lang, 'profile_none')}`,
    `${t(lang, 'profile_id')}: ${mono(String(user.user_id))}`,
    `${t(lang, 'profile_lang')}: ${user.lang === 'fa' ? '🇮🇷 فارسی' : '🇬🇧 English'}`,
    DIVIDER,
    `${t(lang, 'profile_joined')}: ${mono(formatDate(user.first_seen))}`,
    `${t(lang, 'profile_last_seen')}: ${relative(lang, user.last_seen)}`,
    DIVIDER,
    `${t(lang, 'profile_requests')}: <b>${faDigits(user.requests)}</b>`,
    `${t(lang, 'profile_tool_runs')}: <b>${faDigits(user.tool_runs)}</b>`,
    `${t(lang, 'profile_distinct')}: <b>${faDigits(distinct)}</b> / ${TOTAL_TOOLS}`,
    `${t(lang, 'profile_favorite')}: ${favLabel}`,
  ];
  return [t(lang, 'profile_title'), DIVIDER, rows.join('\n')].join('\n');
}

export function myToolsPage(lang: Lang, rows: ToolUsageRow[]): string {
  if (rows.length === 0) {
    return [t(lang, 'my_tools_title'), DIVIDER, t(lang, 'my_tools_empty')].join('\n');
  }
  const max = Math.max(...rows.map((row) => row.uses), 1);
  const body = rows
    .map((row, index) => {
      const tool = getTool(row.tool_id);
      const label = tool ? `${tool.icon} ${pick(lang, tool.title)}` : escapeHtml(row.tool_id);
      const bar = '█'.repeat(Math.max(1, Math.round((row.uses / max) * 10))).padEnd(10, '░');
      return `${index + 1}. ${label}\n   <code>${bar}</code> ${row.uses}×`;
    })
    .join('\n');
  return [t(lang, 'my_tools_title'), DIVIDER, body].join('\n');
}

export function statsPage(lang: Lang, stats: GlobalStats, series: DailyPoint[], userRuns: number): string {
  if (stats.requests === 0 && stats.toolRuns === 0) {
    return [t(lang, 'stats_title'), DIVIDER, t(lang, 'stats_empty')].join('\n');
  }
  const top = stats.top
    .map((row, index) => {
      const tool = getTool(row.tool_id);
      const label = tool ? `${tool.icon} ${pick(lang, tool.title)}` : escapeHtml(row.tool_id);
      const medal = ['🥇', '🥈', '🥉'][index] ?? `${index + 1}.`;
      return `${medal} ${label} — <b>${row.uses}</b>`;
    })
    .join('\n');
  const maxDay = Math.max(...series.map((point) => point.uses), 1);
  const chart = series
    .map((point) => `<code>${point.day.slice(5)}</code> ${'▇'.repeat(Math.max(1, Math.round((point.uses / maxDay) * 12)))} ${point.uses}`)
    .join('\n');
  const share = stats.toolRuns > 0 ? Math.round((userRuns / stats.toolRuns) * 100) : 0;
  return [
    t(lang, 'stats_title'),
    DIVIDER,
    `${t(lang, 'stats_total_requests')}: <b>${stats.requests}</b>`,
    `${t(lang, 'stats_total_runs')}: <b>${stats.toolRuns}</b>`,
    `${t(lang, 'stats_total_users')}: <b>${stats.users}</b>`,
    `${t(lang, 'stats_distinct_tools')}: <b>${stats.distinctTools}</b> / ${TOTAL_TOOLS}`,
    `${t(lang, 'stats_today')}: <b>${stats.today}</b>`,
    `${t(lang, 'stats_your_share')}: <b>${userRuns}</b> (${share}%)`,
    top ? `\n${t(lang, 'stats_top')}\n${top}` : '',
    chart ? `\n📈 ${lang === 'fa' ? '<b>روند روزانه</b>' : '<b>Daily trend</b>'}\n${chart}` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

export function settingsPage(lang: Lang): string {
  return [
    t(lang, 'settings_title'),
    DIVIDER,
    t(lang, 'settings_body'),
    '',
    t(lang, 'settings_lang_title'),
    t(lang, 'settings_lang_body'),
    '',
    `${t(lang, 'settings_current')}: <b>${lang === 'fa' ? '🇮🇷 فارسی' : '🇬🇧 English'}</b>`,
  ].join('\n');
}

export function helpPage(lang: Lang): string {
  return [
    t(lang, 'help_title'),
    DIVIDER,
    t(lang, 'help_body', {
      maxInput: LIMITS.maxInputChars,
      toolRate: RATE_LIMIT.tool.max,
      netRate: RATE_LIMIT.network.max,
      netDaily: RATE_LIMIT.networkDaily.max,
      timeout: LIMITS.networkTimeoutMs / 1000,
    }),
  ].join('\n');
}

export function aboutPage(lang: Lang, env: string, repoUrl?: string): string {
  return [
    t(lang, 'about_title'),
    DIVIDER,
    t(lang, 'about_body', { version: APP.version, count: TOTAL_TOOLS, env }),
    repoUrl ? `\n🔗 <a href="${escapeHtml(repoUrl)}">${escapeHtml(repoUrl)}</a>` : '',
    '',
    t(lang, 'about_credits'),
  ]
    .filter(Boolean)
    .join('\n');
}

export function errorPage(lang: Lang, message: string): string {
  return [t(lang, 'err_title'), DIVIDER, message].join('\n');
}
