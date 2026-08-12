import type { BotContext } from './context.js';
import type { FileToolSpec, ToolAttachment, ToolDefinition, UploadedFile } from '../tools/types.js';
import type { Screen } from './screens.js';
import type { TgMessage } from '../types/telegram.js';
import { pick, t } from '../localization/index.js';
import { LIMITS, TOOL_FILE_LIMITS, TOOL_LIMITS } from '../config/index.js';
import { errInvalidInput, errTooLarge, isToolError, logError } from '../utils/errors.js';
import { assertMaxLength, assertNotEmpty } from '../utils/validate.js';
import { formatBytes, normalizeInput, truncate } from '../utils/text.js';
import { consume, consumeNetwork } from '../services/ratelimit.js';
import { bumpCounter, recordToolRun } from '../db/queries.js';
import * as P from './pages.js';
import * as UI from './ui.js';

export interface RunOutcome extends Screen {
  ok: boolean;
  /** Document to deliver alongside the message, when the output is large. */
  attachment?: ToolAttachment;
}

/**
 * Executes a tool with full guard rails:
 * rate limit → input validation → execution → output clamp → usage accounting.
 * Raw errors never leave this function.
 */
export async function runTool(ctx: BotContext, tool: ToolDefinition, rawInput: string): Promise<RunOutcome> {
  const lang = ctx.lang;

  const toolBudget = await consume(ctx.env.STATE, 'tool', ctx.user.id);
  if (!toolBudget.allowed) {
    return {
      ok: false,
      text: P.errorPage(lang, t(lang, 'err_rate_limited', { seconds: toolBudget.retryAfterSec })),
      keyboard: UI.resultKeyboard(lang, tool),
      toast: t(lang, 'err_rate_limited', { seconds: toolBudget.retryAfterSec }),
    };
  }

  if (tool.network) {
    const netBudget = await consumeNetwork(ctx.env.STATE, ctx.user.id);
    if (!netBudget.allowed) {
      return {
        ok: false,
        text: P.errorPage(lang, t(lang, 'err_rate_limited', { seconds: netBudget.retryAfterSec })),
        keyboard: UI.resultKeyboard(lang, tool),
        toast: t(lang, 'err_rate_limited', { seconds: netBudget.retryAfterSec }),
      };
    }
  }

  try {
    let input = '';
    if (tool.needsInput) {
      input = assertMaxLength(assertNotEmpty(normalizeInput(rawInput)), LIMITS.maxInputChars);
    } else {
      input = normalizeInput(rawInput).slice(0, 200);
    }

    const result = await tool.run(input, {
      lang,
      userId: ctx.user.id,
      cache: ctx.env.STATE,
    });

    const body = truncate(result.html, LIMITS.maxOutputChars);
    ctx.waitUntil(
      recordToolRun(ctx.env.DB, ctx.user.id, tool.id).catch((error: unknown) =>
        logError('runner.recordToolRun', error, { tool: tool.id }),
      ),
    );

    return {
      ok: true,
      text: P.resultPage(lang, tool, body),
      keyboard: UI.resultKeyboard(lang, tool),
      toast: result.toast ?? t(lang, 'ok_answered'),
      ...(result.attachment ? { attachment: result.attachment } : {}),
    };
  } catch (error) {
    const message = isToolError(error) ? error.localized(lang) : t(lang, 'err_generic');
    if (!isToolError(error)) {
      logError('runner.unexpected', error, { tool: tool.id });
      ctx.waitUntil(bumpCounter(ctx.env.DB, 'errors'));
    }
    return {
      ok: false,
      text: `${P.errorPage(lang, message)}\n\n${t(lang, 'tool_usage_label')}\n${lang === 'fa' ? tool.usage.fa : tool.usage.en}`,
      keyboard: UI.resultKeyboard(lang, tool),
      toast: truncate(message.replace(/<[^>]+>/g, ''), 180),
    };
  }
}

// ─── File-based tools (Phase 3) ───────────────────────────────────────────

/** KV slot holding the first file of a two-file comparison. */
const pairKey = (userId: number, toolId: string): string => `pair:${toolId}:${userId}`;

/**
 * Runs a tool whose input is an uploaded document.
 *
 * The guard rails mirror `runTool` and add the file-specific ones: a declared
 * size check before the download, a streamed byte cap during it, and a MIME
 * check against the tool's accept list. The bytes stay in memory and are
 * dropped when this function returns — only the derived result is kept.
 */
export async function runFileTool(
  ctx: BotContext,
  tool: ToolDefinition,
  message: TgMessage,
): Promise<RunOutcome> {
  const lang = ctx.lang;
  const spec = tool.file as FileToolSpec;

  const budget = await consume(ctx.env.STATE, 'tool', ctx.user.id);
  if (!budget.allowed) {
    return {
      ok: false,
      text: P.errorPage(lang, t(lang, 'err_rate_limited', { seconds: budget.retryAfterSec })),
      keyboard: UI.resultKeyboard(lang, tool),
      toast: t(lang, 'err_rate_limited', { seconds: budget.retryAfterSec }),
    };
  }

  try {
    const document = message.document;
    if (!document) {
      throw errInvalidInput(
        message.photo
          ? 'تصویر را به‌صورت «فایل/Document» بفرستید؛ تلگرام هنگام ارسال به‌صورت Photo متادیتا را حذف می‌کند.'
          : t(lang, 'tool_file_needed'),
        message.photo
          ? 'Send the image as a Document; Telegram strips metadata from photos.'
          : 'This tool needs a file; please send a Document rather than text.',
      );
    }

    const declared = document.file_size ?? 0;
    if (declared > spec.maxBytes) {
      throw errTooLarge(
        `حجم فایل (${formatBytes(declared)}) از حد مجاز ${formatBytes(spec.maxBytes)} بیشتر است.`,
        `The file (${formatBytes(declared)}) exceeds the ${formatBytes(spec.maxBytes)} limit.`,
      );
    }

    const download = await ctx.tg.downloadFile(document.file_id, spec.maxBytes);
    if (!download.ok) {
      if (download.reason === 'too_large') {
        throw errTooLarge(
          `حجم فایل از حد مجاز ${formatBytes(spec.maxBytes)} بیشتر است.`,
          `The file exceeds the ${formatBytes(spec.maxBytes)} limit.`,
        );
      }
      if (download.reason === 'not_found') {
        throw errInvalidInput(
          'تلگرام این فایل را در دسترس قرار نداد. فایل‌های بزرگ‌تر از ۲۰ مگابایت از طریق Bot API قابل دریافت نیستند.',
          'Telegram did not make this file available. Files larger than 20 MB cannot be fetched through the Bot API.',
        );
      }
      throw errInvalidInput(t(lang, 'tool_file_download_failed'), 'Could not fetch the file from Telegram.');
    }

    const file: UploadedFile = {
      name: document.file_name ?? 'file',
      mime: document.mime_type ?? 'application/octet-stream',
      size: download.data.length,
      data: download.data,
    };

    if (spec.accept?.length) {
      const declaredOk = spec.accept.some((prefix) => file.mime.startsWith(prefix));
      // The declared MIME is only a hint; the tool itself verifies the content.
      if (!declaredOk && file.mime !== 'application/octet-stream') {
        throw errInvalidInput(t(lang, 'tool_file_bad_type'), 'That file type is not suitable for the selected tool.');
      }
    }

    // Two-file tools carry a tiny state object between the uploads.
    let previous: Record<string, string | number> | undefined;
    if (spec.pair) {
      const stored = await ctx.env.STATE.get<Record<string, string | number>>(
        pairKey(ctx.user.id, tool.id),
        'json',
      ).catch(() => null);
      if (stored) previous = stored;
    }

    const result = await spec.run(file, {
      lang,
      userId: ctx.user.id,
      cache: ctx.env.STATE,
      ...(previous ? { previous } : {}),
    });

    if (spec.pair) {
      if (result.awaiting) {
        await ctx.env.STATE.put(pairKey(ctx.user.id, tool.id), JSON.stringify(result.awaiting), {
          expirationTtl: TOOL_FILE_LIMITS.pairTtlSec,
        }).catch((error: unknown) => logError('runner.pairPut', error, { tool: tool.id }));
      } else {
        await ctx.env.STATE.delete(pairKey(ctx.user.id, tool.id)).catch(() => undefined);
      }
    }

    ctx.waitUntil(
      recordToolRun(ctx.env.DB, ctx.user.id, tool.id).catch((error: unknown) =>
        logError('runner.recordToolRun', error, { tool: tool.id }),
      ),
    );

    return {
      ok: true,
      text: P.resultPage(lang, tool, truncate(result.html, LIMITS.maxOutputChars)),
      keyboard: UI.resultKeyboard(lang, tool),
      toast: result.toast ?? t(lang, 'ok_answered'),
      ...(result.attachment ? { attachment: result.attachment } : {}),
    };
  } catch (error) {
    const message = isToolError(error) ? error.localized(lang) : t(lang, 'err_generic');
    if (!isToolError(error)) {
      logError('runner.file.unexpected', error, { tool: tool.id });
      ctx.waitUntil(bumpCounter(ctx.env.DB, 'errors'));
    }
    return {
      ok: false,
      text: `${P.errorPage(lang, message)}\n\n${t(lang, 'tool_usage_label')}\n${pick(lang, tool.usage)}`,
      keyboard: UI.resultKeyboard(lang, tool),
      toast: truncate(message.replace(/<[^>]+>/g, ''), 180),
    };
  }
}

/**
 * Delivers a tool attachment.
 *
 * Failure here is never fatal: the summary message has already been sent, so
 * the user still gets an answer even when Telegram refuses the upload.
 */
export async function deliverAttachment(ctx: BotContext, attachment: ToolAttachment): Promise<boolean> {
  const response = await ctx.tg.sendDocument(ctx.chatId, attachment.name, attachment.content, {
    ...(attachment.caption ? { caption: pick(ctx.lang, attachment.caption) } : {}),
    maxBytes: TOOL_LIMITS.maxOutgoingFileBytes,
  });
  if (!response.ok) {
    logError('runner.attachment', new Error(response.description ?? 'unknown'), { name: attachment.name });
  }
  return response.ok === true;
}
