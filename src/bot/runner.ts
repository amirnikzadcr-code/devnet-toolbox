import type { BotContext } from './context.js';
import type { ToolDefinition } from '../tools/types.js';
import type { Screen } from './screens.js';
import { t } from '../localization/index.js';
import { LIMITS } from '../config/index.js';
import { isToolError, logError } from '../utils/errors.js';
import { assertMaxLength, assertNotEmpty } from '../utils/validate.js';
import { normalizeInput, truncate } from '../utils/text.js';
import { consume, consumeNetwork } from '../services/ratelimit.js';
import { bumpCounter, recordToolRun } from '../db/queries.js';
import * as P from './pages.js';
import * as UI from './ui.js';

export interface RunOutcome extends Screen {
  ok: boolean;
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
