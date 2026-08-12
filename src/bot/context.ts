import type { Env, ExecCtxLike } from '../types/env.js';
import type { Lang } from '../localization/index.js';
import type { TgUser } from '../types/telegram.js';
import { TelegramClient } from '../services/telegram.js';

export interface BotContext {
  env: Env;
  tg: TelegramClient;
  lang: Lang;
  user: TgUser;
  chatId: number;
  /** Message the interaction is anchored to; edited in place whenever possible. */
  messageId?: number;
  waitUntil: (promise: Promise<unknown>) => void;
}

export function createTelegram(env: Env): TelegramClient {
  return new TelegramClient(env.BOT_TOKEN);
}

export function backgroundRunner(ctx: ExecCtxLike | undefined): (promise: Promise<unknown>) => void {
  return (promise: Promise<unknown>): void => {
    if (ctx) {
      ctx.waitUntil(promise.catch(() => undefined));
    } else {
      void promise.catch(() => undefined);
    }
  };
}
