import type { Env, ExecCtxLike } from '../types/env.js';
import type { TgCallbackQuery, TgMessage, TgUpdate, TgUser } from '../types/telegram.js';
import type { BotContext } from './context.js';
import type { Screen } from './screens.js';
import type { ToolCategory } from '../tools/types.js';
import type { ScanType } from '../security/types.js';
import { backgroundRunner, createTelegram } from './context.js';
import { isLang, t, type Lang } from '../localization/index.js';
import { getTool, CATEGORIES } from '../tools/registry.js';
import * as S from './screens.js';
import * as P from './pages.js';
import * as UI from './ui.js';
import { deliverAttachment, runFileTool, runTool, type RunOutcome } from './runner.js';
import { clearPending, getPending, isDuplicateUpdate, setPending, cacheLang, readCachedLang } from '../services/state.js';
import * as SF from './security-flow.js';
import { SEC } from './security-ui.js';
import { consume } from '../services/ratelimit.js';
import { getLang, setLang, touchUser, bumpCounter } from '../db/queries.js';
import { logError } from '../utils/errors.js';
import { APP } from '../config/index.js';
import { escapeHtml, mono, DIVIDER } from '../utils/text.js';

const VALID_CATEGORIES = new Set<string>(CATEGORIES.map((category) => category.id));

async function resolveLang(env: Env, user: TgUser): Promise<Lang> {
  const cached = await readCachedLang(env.STATE, user.id);
  if (isLang(cached)) return cached;
  try {
    const stored = await getLang(env.DB, user.id);
    if (stored && isLang(stored)) {
      await cacheLang(env.STATE, user.id, stored);
      return stored;
    }
  } catch (error) {
    logError('router.resolveLang', error, { userId: user.id });
  }
  return 'fa';
}

/** Entry point: never throws, always returns after best-effort handling. */
export async function handleUpdate(update: TgUpdate, env: Env, execCtx?: ExecCtxLike): Promise<void> {
  const waitUntil = backgroundRunner(execCtx);
  try {
    if (await isDuplicateUpdate(env.STATE, update.update_id)) return;

    if (update.callback_query) {
      await handleCallback(update.callback_query, env, waitUntil);
      return;
    }
    if (update.message) {
      await handleMessage(update.message, env, waitUntil);
    }
  } catch (error) {
    logError('router.handleUpdate', error, { updateId: update.update_id });
  }
}

async function buildContext(
  env: Env,
  user: TgUser,
  chatId: number,
  waitUntil: (p: Promise<unknown>) => void,
  messageId?: number,
): Promise<BotContext> {
  const lang = await resolveLang(env, user);
  return {
    env,
    tg: createTelegram(env),
    lang,
    user,
    chatId,
    ...(messageId !== undefined ? { messageId } : {}),
    waitUntil,
  };
}

async function send(ctx: BotContext, screen: Screen): Promise<void> {
  await ctx.tg.sendMessage(ctx.chatId, screen.text, screen.keyboard);
}

async function edit(ctx: BotContext, screen: Screen): Promise<void> {
  if (ctx.messageId === undefined) {
    await send(ctx, screen);
    return;
  }
  const res = await ctx.tg.editMessageText(ctx.chatId, ctx.messageId, screen.text, screen.keyboard);
  if (!res.ok && !(res.description ?? '').includes('message is not modified')) {
    await send(ctx, screen);
  }
}

// ─── Messages ─────────────────────────────────────────────────────────────

async function handleMessage(message: TgMessage, env: Env, waitUntil: (p: Promise<unknown>) => void): Promise<void> {
  const user = message.from;
  if (!user || user.is_bot) return;

  const ctx = await buildContext(env, user, message.chat.id, waitUntil);

  if (message.chat.type !== 'private') {
    await ctx.tg.sendMessage(message.chat.id, t(ctx.lang, 'err_private_only'));
    return;
  }

  waitUntil(
    touchUser(env.DB, user, ctx.lang)
      .then(() => bumpCounter(env.DB, 'requests'))
      .catch((error: unknown) => logError('router.touchUser', error, { userId: user.id })),
  );

  const budget = await consume(env.STATE, 'general', user.id);
  if (!budget.allowed) {
    await ctx.tg.sendMessage(ctx.chatId, P.errorPage(ctx.lang, t(ctx.lang, 'err_rate_limited', { seconds: budget.retryAfterSec })));
    return;
  }

  const text = (message.text ?? '').trim();

  // Only treat a message as a command when it really is one. Plenty of tool
  // inputs legitimately start with "/" — regex literals like /\d{3}/g, unix
  // paths, JSON pointers — and those must reach the pending tool instead of
  // being rejected as an unknown command.
  if (isKnownCommand(text)) {
    await handleCommand(ctx, text);
    return;
  }

  // Free text or an upload → is the bot waiting for input?
  const pending = await getPending(env.STATE, user.id);

  // Phase 2: a pending *security scan* is stored in the same slot with a
  // `sec:` prefix, so uploads and text both route through one mechanism.
  const pendingScan = pending ? SF.scanTypeFromPending(pending.toolId) : null;
  if (pending && pendingScan) {
    await clearPending(env.STATE, user.id);
    await runSecurityScanFlow(ctx, pendingScan, message);
    return;
  }

  // Phase 3: a pending *file-based tool* consumes the upload the same way,
  // reusing the one pending slot rather than adding a parallel mechanism.
  if (pending) {
    const pendingTool = getTool(pending.toolId);
    if (pendingTool?.file && (message.document || message.photo)) {
      await clearPending(env.STATE, user.id);
      await runFileToolFlow(ctx, pendingTool, message);
      return;
    }
  }

  // An upload with nothing pending: tell the user which scan to pick rather
  // than silently ignoring a file they deliberately sent.
  if (!pending && (message.document || message.photo)) {
    await ctx.tg.sendMessage(
      ctx.chatId,
      `${SF.securityScreen(ctx).text}\n\n<i>${
        ctx.lang === 'fa'
          ? 'فایل دریافت شد. ابتدا نوع بررسی را از فهرست زیر انتخاب کنید، سپس فایل را دوباره بفرستید.'
          : 'File received. Pick the type of analysis below first, then send the file again.'
      }</i>`,
      SF.securityScreen(ctx).keyboard,
    );
    return;
  }

  if (pending) {
    const tool = getTool(pending.toolId);
    if (!tool) {
      await clearPending(env.STATE, user.id);
      await ctx.tg.sendMessage(ctx.chatId, P.errorPage(ctx.lang, t(ctx.lang, 'err_unknown_tool')));
      return;
    }
    // A file tool received text: keep waiting instead of running with nothing.
    if (tool.file) {
      await ctx.tg.sendMessage(
        ctx.chatId,
        P.errorPage(ctx.lang, t(ctx.lang, 'tool_file_needed')),
        UI.waitingKeyboard(ctx.lang, tool),
      );
      return;
    }
    await clearPending(env.STATE, user.id);
    const loading = await ctx.tg.sendMessage(ctx.chatId, t(ctx.lang, 'tool_processing'));
    const outcome = await runTool(ctx, tool, text);
    const loadingId = loading.result?.message_id;
    if (loadingId) {
      await ctx.tg.editMessageText(ctx.chatId, loadingId, outcome.text, outcome.keyboard);
    } else {
      await ctx.tg.sendMessage(ctx.chatId, outcome.text, outcome.keyboard);
    }
    await sendAttachment(ctx, outcome);
    return;
  }

  // Nothing pending. An unrecognised slash command deserves a clear answer;
  // anything else gets the home page with a hint.
  if (/^\/[A-Za-z0-9_]+(@[A-Za-z0-9_]+)?(\s|$)/.test(text)) {
    await ctx.tg.sendMessage(
      ctx.chatId,
      P.errorPage(ctx.lang, t(ctx.lang, 'err_unknown_action')),
      UI.homeKeyboard(ctx.lang),
    );
    return;
  }

  await ctx.tg.sendMessage(
    ctx.chatId,
    `${P.homePage(ctx.lang)}\n\n<i>${
      ctx.lang === 'fa'
        ? 'برای اجرای یک ابزار ابتدا آن را از جعبه‌ابزار انتخاب کنید.'
        : 'Pick a tool from the toolbox first, then send your input.'
    }</i>`,
    UI.homeKeyboard(ctx.lang),
  );
}


/**
 * Runs a security scan and delivers the report.
 *
 * The report can exceed Telegram's 4096-character limit, so the first chunk
 * replaces the "analysing…" message and the rest follow as separate messages.
 * A HIGH/CRITICAL verdict also gets its own alert message (requirement 14) so
 * it cannot be missed while scrolling a long report.
 */
async function runSecurityScanFlow(ctx: BotContext, kind: ScanType, message: TgMessage): Promise<void> {
  const loading = await ctx.tg.sendMessage(
    ctx.chatId,
    message.document ? t(ctx.lang, 'sec_downloading') : t(ctx.lang, 'sec_scanning'),
  );
  const loadingId = loading.result?.message_id;

  const outcome = await SF.runSecurityScan(ctx, kind, message);

  if (loadingId) {
    const edited = await ctx.tg.editMessageText(ctx.chatId, loadingId, outcome.text, outcome.keyboard);
    if (!edited.ok) await ctx.tg.sendMessage(ctx.chatId, outcome.text, outcome.keyboard);
  } else {
    await ctx.tg.sendMessage(ctx.chatId, outcome.text, outcome.keyboard);
  }
}

/**
 * Runs a file-based tool end to end.
 *
 * The download can take a few seconds, so a placeholder message goes out
 * first and is edited in place with the result — one message per run, never a
 * burst of consecutive ones.
 */
async function runFileToolFlow(ctx: BotContext, tool: ReturnType<typeof getTool> & object, message: TgMessage): Promise<void> {
  const loading = await ctx.tg.sendMessage(ctx.chatId, t(ctx.lang, 'tool_file_downloading'));
  const loadingId = loading.result?.message_id;

  const outcome = await runFileTool(ctx, tool, message);

  if (loadingId) {
    const edited = await ctx.tg.editMessageText(ctx.chatId, loadingId, outcome.text, outcome.keyboard);
    if (!edited.ok) await ctx.tg.sendMessage(ctx.chatId, outcome.text, outcome.keyboard);
  } else {
    await ctx.tg.sendMessage(ctx.chatId, outcome.text, outcome.keyboard);
  }
  await sendAttachment(ctx, outcome);

  // A pair tool that is still waiting for its second file re-arms the slot.
  if (outcome.ok && tool.file?.pair) {
    const stored = await ctx.env.STATE.get(`pair:${tool.id}:${ctx.user.id}`);
    if (stored) {
      await setPending(ctx.env.STATE, ctx.user.id, {
        toolId: tool.id,
        messageId: ctx.messageId ?? 0,
        chatId: ctx.chatId,
        createdAt: Date.now(),
      });
    }
  }
}

/** Uploads a tool attachment when there is one; never throws. */
async function sendAttachment(ctx: BotContext, outcome: RunOutcome): Promise<void> {
  if (!outcome.attachment) return;
  try {
    const ok = await deliverAttachment(ctx, outcome.attachment);
    if (!ok) {
      await ctx.tg.sendMessage(ctx.chatId, t(ctx.lang, 'tool_attachment_failed'));
    }
  } catch (error) {
    logError('router.sendAttachment', error);
  }
}

/** Every slash command the bot answers, used to tell commands from tool input. */
const KNOWN_COMMANDS = new Set([
  '/start', '/menu', '/home', '/tools', '/toolbox', '/quick', '/profile',
  '/stats', '/settings', '/lang', '/help', '/about', '/id', '/version',
  '/cancel', '/tool', '/security', '/scan', '/scans',
]);

/**
 * True only for real bot commands: a leading slash, then a valid Telegram
 * command name (letters, digits, underscore, optional @botname), ending at a
 * space or end of string. `/\d{3}-\d{4}/g` and `/etc/hosts` are not commands.
 */
function isKnownCommand(text: string): boolean {
  const match = /^\/([A-Za-z0-9_]+)(@[A-Za-z0-9_]+)?(?:\s|$)/.exec(text);
  if (!match) return false;
  return KNOWN_COMMANDS.has(`/${(match[1] ?? '').toLowerCase()}`);
}

async function handleCommand(ctx: BotContext, text: string): Promise<void> {
  const [rawCommand = '', ...args] = text.split(/\s+/);
  const command = (rawCommand.split('@')[0] ?? '').toLowerCase();

  switch (command) {
    case '/start':
      await clearPending(ctx.env.STATE, ctx.user.id);
      await send(ctx, S.homeScreen(ctx));
      return;
    case '/menu':
    case '/home':
      await send(ctx, S.homeScreen(ctx));
      return;
    case '/tools':
    case '/toolbox':
      await send(ctx, S.toolboxScreen(ctx));
      return;
    case '/quick':
      await send(ctx, S.quickScreen(ctx, 1));
      return;
    case '/profile':
      await send(ctx, await S.profileScreen(ctx));
      return;
    case '/stats':
      await send(ctx, await S.statsScreen(ctx));
      return;
    case '/settings':
    case '/lang':
      await send(ctx, S.settingsScreen(ctx));
      return;
    case '/help':
      await send(ctx, S.helpScreen(ctx));
      return;
    case '/about':
      await send(ctx, S.aboutScreen(ctx));
      return;
    case '/id':
      await ctx.tg.sendMessage(
        ctx.chatId,
        `🆔 ${mono(String(ctx.user.id))}\n${DIVIDER}\n${escapeHtml(ctx.user.first_name)}${
          ctx.user.username ? ` • @${escapeHtml(ctx.user.username)}` : ''
        }`,
        UI.simpleKeyboard(ctx.lang),
      );
      return;
    case '/version':
      await ctx.tg.sendMessage(ctx.chatId, `${APP.emoji} <b>${APP.name}</b> v${APP.version}`, UI.simpleKeyboard(ctx.lang));
      return;
    case '/security':
    case '/scan':
      await clearPending(ctx.env.STATE, ctx.user.id);
      await send(ctx, SF.securityScreen(ctx));
      return;
    case '/scans':
      await send(ctx, await SF.historyScreen(ctx, 1));
      return;
    case '/cancel':
      await clearPending(ctx.env.STATE, ctx.user.id);
      await ctx.tg.sendMessage(ctx.chatId, t(ctx.lang, 'tool_cancelled'), UI.homeKeyboard(ctx.lang));
      return;
    case '/tool': {
      const id = (args[0] ?? '').toLowerCase();
      const screen = S.toolScreen(ctx, id);
      if (!screen) {
        await ctx.tg.sendMessage(ctx.chatId, P.errorPage(ctx.lang, t(ctx.lang, 'err_unknown_tool')), UI.homeKeyboard(ctx.lang));
        return;
      }
      await send(ctx, screen);
      return;
    }
    default:
      await ctx.tg.sendMessage(ctx.chatId, P.errorPage(ctx.lang, t(ctx.lang, 'err_unknown_action')), UI.homeKeyboard(ctx.lang));
  }
}

// ─── Callbacks ────────────────────────────────────────────────────────────

async function handleCallback(query: TgCallbackQuery, env: Env, waitUntil: (p: Promise<unknown>) => void): Promise<void> {
  const user = query.from;
  const chatId = query.message?.chat.id;
  const messageId = query.message?.message_id;
  if (!chatId || !messageId) return;

  const ctx = await buildContext(env, user, chatId, waitUntil, messageId);

  waitUntil(
    touchUser(env.DB, user, ctx.lang)
      .then(() => bumpCounter(env.DB, 'requests'))
      .catch((error: unknown) => logError('router.touchUser.cb', error, { userId: user.id })),
  );

  const data = query.data ?? '';
  if (data === UI.CB.noop) {
    await ctx.tg.answerCallbackQuery(query.id);
    return;
  }

  const budget = await consume(env.STATE, 'general', user.id);
  if (!budget.allowed) {
    await ctx.tg.answerCallbackQuery(query.id, t(ctx.lang, 'err_rate_limited', { seconds: budget.retryAfterSec }), true);
    return;
  }

  try {
    await dispatchCallback(ctx, query, data);
  } catch (error) {
    logError('router.callback', error, { data });
    await ctx.tg.answerCallbackQuery(query.id, t(ctx.lang, 'err_generic'), true);
  }
}

async function dispatchCallback(ctx: BotContext, query: TgCallbackQuery, data: string): Promise<void> {
  const ack = (text?: string, alert = false): Promise<unknown> => ctx.tg.answerCallbackQuery(query.id, text, alert);

  if (data === UI.CB.home) {
    await clearPending(ctx.env.STATE, ctx.user.id);
    await Promise.all([edit(ctx, S.homeScreen(ctx)), ack()]);
    return;
  }
  if (data === UI.CB.toolbox) {
    await Promise.all([edit(ctx, S.toolboxScreen(ctx)), ack()]);
    return;
  }
  if (data === UI.CB.quick) {
    await Promise.all([edit(ctx, S.quickScreen(ctx, 1)), ack()]);
    return;
  }
  if (data === UI.CB.profile) {
    await ack();
    await edit(ctx, await S.profileScreen(ctx));
    return;
  }
  if (data === UI.CB.myTools) {
    await ack();
    await edit(ctx, await S.myToolsScreen(ctx));
    return;
  }
  if (data === UI.CB.stats) {
    await ack();
    await edit(ctx, await S.statsScreen(ctx));
    return;
  }
  if (data === UI.CB.settings) {
    await Promise.all([edit(ctx, S.settingsScreen(ctx)), ack()]);
    return;
  }
  if (data === UI.CB.help) {
    await Promise.all([edit(ctx, S.helpScreen(ctx)), ack()]);
    return;
  }
  if (data === UI.CB.about) {
    await Promise.all([edit(ctx, S.aboutScreen(ctx)), ack()]);
    return;
  }

  // ── 🛡️ Advanced Security (Phase 2) ────────────────────────────────────
  if (data === SEC.root) {
    await clearPending(ctx.env.STATE, ctx.user.id);
    await Promise.all([edit(ctx, SF.securityScreen(ctx)), ack()]);
    return;
  }
  if (data === SEC.dashboard) {
    await ack();
    await edit(ctx, await SF.dashboardScreen(ctx));
    return;
  }
  if (data.startsWith('sech:')) {
    const page = Number.parseInt(data.slice(5), 10) || 1;
    await ack();
    await edit(ctx, await SF.historyScreen(ctx, page));
    return;
  }
  if (data.startsWith('secr:')) {
    const kind = SF.scanTypeFromPending(`sec:${data.slice(5)}`);
    if (!kind) {
      await ack(t(ctx.lang, 'err_unknown_action'), true);
      return;
    }
    // Reuses the existing pending-input mechanism: the next message (text or
    // upload) from this user is routed to the chosen scan.
    await setPending(ctx.env.STATE, ctx.user.id, {
      toolId: SF.pendingIdFor(kind),
      messageId: ctx.messageId ?? 0,
      chatId: ctx.chatId,
      createdAt: Date.now(),
    });
    await Promise.all([edit(ctx, SF.securityPromptScreen(ctx, kind)), ack(t(ctx.lang, 'toast_loading'))]);
    return;
  }
  if (data.startsWith('secv:')) {
    const part = data.slice(5);
    if (part !== 'full' && part !== 'iocs' && part !== 'score') {
      await ack(t(ctx.lang, 'err_unknown_action'), true);
      return;
    }
    await ack();
    await edit(ctx, await SF.reportViewScreen(ctx, part));
    return;
  }

  if (data.startsWith('cat:')) {
    const [, id = '', pageRaw = '1'] = data.split(':');
    const page = Number.parseInt(pageRaw, 10) || 1;
    if (id === 'quick') {
      await Promise.all([edit(ctx, S.quickScreen(ctx, page)), ack()]);
      return;
    }
    if (!VALID_CATEGORIES.has(id)) {
      await ack(t(ctx.lang, 'err_unknown_action'), true);
      return;
    }
    await Promise.all([edit(ctx, S.categoryScreen(ctx, id as ToolCategory, page)), ack()]);
    return;
  }

  if (data.startsWith('tool:')) {
    const id = data.slice(5);
    const screen = S.toolScreen(ctx, id);
    if (!screen) {
      await ack(t(ctx.lang, 'err_unknown_tool'), true);
      return;
    }
    await clearPending(ctx.env.STATE, ctx.user.id);
    await Promise.all([edit(ctx, screen), ack()]);
    return;
  }

  if (data.startsWith('run:')) {
    const id = data.slice(4);
    const tool = getTool(id);
    if (!tool) {
      await ack(t(ctx.lang, 'err_unknown_tool'), true);
      return;
    }
    if (tool.needsInput) {
      // A file tool starts with a clean slate: any half-finished pair from a
      // previous attempt would otherwise be compared against the new upload.
      if (tool.file?.pair) {
        await ctx.env.STATE.delete(`pair:${tool.id}:${ctx.user.id}`).catch(() => undefined);
      }
      await setPending(ctx.env.STATE, ctx.user.id, {
        toolId: tool.id,
        messageId: ctx.messageId ?? 0,
        chatId: ctx.chatId,
        createdAt: Date.now(),
      });
      await Promise.all([
        edit(ctx, { text: P.waitingPage(ctx.lang, tool), keyboard: UI.waitingKeyboard(ctx.lang, tool) }),
        ack(t(ctx.lang, 'toast_loading')),
      ]);
      return;
    }
    await ack(t(ctx.lang, 'toast_loading'));
    const outcome = await runTool(ctx, tool, '');
    await edit(ctx, outcome);
    await sendAttachment(ctx, outcome);
    return;
  }

  if (data.startsWith('lang:')) {
    const value = data.slice(5);
    if (!isLang(value)) {
      await ack(t(ctx.lang, 'err_unknown_action'), true);
      return;
    }
    await setLang(ctx.env.DB, ctx.user.id, value).catch((error: unknown) =>
      logError('router.setLang', error, { userId: ctx.user.id }),
    );
    await cacheLang(ctx.env.STATE, ctx.user.id, value);
    const next: BotContext = { ...ctx, lang: value };
    await Promise.all([edit(next, S.settingsScreen(next)), ack(t(value, 'settings_lang_saved'))]);
    return;
  }

  if (data === UI.CB.cancel) {
    await clearPending(ctx.env.STATE, ctx.user.id);
    await Promise.all([edit(ctx, S.homeScreen(ctx)), ack(t(ctx.lang, 'tool_cancelled'))]);
    return;
  }

  await ack(t(ctx.lang, 'err_unknown_action'), true);
}

export const BOT_COMMANDS = [
  { command: 'start', description: '🏠 Home / خانه' },
  { command: 'tools', description: '🧰 Toolbox / جعبه‌ابزار' },
  { command: 'quick', description: '⚡ Quick tools / ابزار سریع' },
  { command: 'security', description: '🛡️ Advanced Security / امنیت پیشرفته' },
  { command: 'scans', description: '📊 Scan history / تاریخچه اسکن' },
  { command: 'profile', description: '👤 Profile / پروفایل' },
  { command: 'stats', description: '📊 Statistics / آمار' },
  { command: 'settings', description: '⚙️ Settings / تنظیمات' },
  { command: 'help', description: '❓ Help / راهنما' },
  { command: 'about', description: 'ℹ️ About / درباره' },
  { command: 'cancel', description: '✖️ Cancel / انصراف' },
];
