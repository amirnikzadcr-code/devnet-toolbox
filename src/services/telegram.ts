import type { InlineKeyboardMarkup, TgApiResponse, TgMessage } from '../types/telegram.js';
import { LIMITS } from '../config/index.js';
import { logError } from '../utils/errors.js';
import { truncate } from '../utils/text.js';

const API_BASE = 'https://api.telegram.org/bot';
const CALL_TIMEOUT_MS = 8000;

export class TelegramClient {
  readonly #token: string;

  constructor(token: string) {
    if (!token) throw new Error('BOT_TOKEN is missing');
    this.#token = token;
  }

  /** Low-level API call. The token never appears in logs or errors. */
  async call<T>(method: string, payload: Record<string, unknown>): Promise<TgApiResponse<T>> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), CALL_TIMEOUT_MS);
    try {
      const response = await fetch(`${API_BASE}${this.#token}/${method}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      const data = (await response.json()) as TgApiResponse<T>;
      if (!data.ok) {
        logError('telegram.api', new Error(data.description ?? 'unknown'), { method, code: data.error_code });
      }
      return data;
    } catch (error) {
      logError('telegram.call', error, { method });
      return { ok: false, description: 'network failure' };
    } finally {
      clearTimeout(timer);
    }
  }

  sendMessage(
    chatId: number,
    text: string,
    keyboard?: InlineKeyboardMarkup,
    options: { disablePreview?: boolean } = {},
  ): Promise<TgApiResponse<TgMessage>> {
    return this.call<TgMessage>('sendMessage', {
      chat_id: chatId,
      text: truncate(text, LIMITS.maxOutputChars + 400),
      parse_mode: 'HTML',
      link_preview_options: { is_disabled: options.disablePreview !== false },
      ...(keyboard ? { reply_markup: keyboard } : {}),
    });
  }

  editMessageText(
    chatId: number,
    messageId: number,
    text: string,
    keyboard?: InlineKeyboardMarkup,
    options: { disablePreview?: boolean } = {},
  ): Promise<TgApiResponse<TgMessage>> {
    return this.call<TgMessage>('editMessageText', {
      chat_id: chatId,
      message_id: messageId,
      text: truncate(text, LIMITS.maxOutputChars + 400),
      parse_mode: 'HTML',
      link_preview_options: { is_disabled: options.disablePreview !== false },
      ...(keyboard ? { reply_markup: keyboard } : {}),
    });
  }

  answerCallbackQuery(id: string, text?: string, showAlert = false): Promise<TgApiResponse<boolean>> {
    return this.call<boolean>('answerCallbackQuery', {
      callback_query_id: id,
      ...(text ? { text: truncate(text, 190) } : {}),
      show_alert: showAlert,
    });
  }

  setMyCommands(commands: { command: string; description: string }[]): Promise<TgApiResponse<boolean>> {
    return this.call<boolean>('setMyCommands', { commands });
  }

  getMe(): Promise<TgApiResponse<{ id: number; username?: string; first_name?: string }>> {
    return this.call('getMe', {});
  }

  getWebhookInfo(): Promise<TgApiResponse<Record<string, unknown>>> {
    return this.call('getWebhookInfo', {});
  }

  setWebhook(url: string, secretToken: string): Promise<TgApiResponse<boolean>> {
    return this.call<boolean>('setWebhook', {
      url,
      secret_token: secretToken,
      allowed_updates: ['message', 'callback_query'],
      drop_pending_updates: true,
      max_connections: 40,
    });
  }
}
