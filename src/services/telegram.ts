import type { InlineKeyboardMarkup, TgApiResponse, TgFile, TgMessage } from '../types/telegram.js';
import { LIMITS } from '../config/index.js';
import { logError } from '../utils/errors.js';
import { truncate } from '../utils/text.js';

const API_BASE = 'https://api.telegram.org/bot';
const FILE_BASE = 'https://api.telegram.org/file/bot';
const CALL_TIMEOUT_MS = 8000;
/** File downloads get a longer budget than API calls: payloads are larger. */
const FILE_TIMEOUT_MS = 20_000;

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

  /** Resolves a `file_id` into a downloadable path. */
  getFile(fileId: string): Promise<TgApiResponse<TgFile>> {
    return this.call<TgFile>('getFile', { file_id: fileId });
  }

  /**
   * Downloads an uploaded file into memory.
   *
   * The bot token appears in the download URL (Telegram's API design), so the
   * URL is never logged or surfaced in an error — only the failure reason is.
   * `maxBytes` is enforced while streaming so an oversized upload cannot
   * exhaust the Worker's memory even when `file_size` is missing or lies.
   */
  async downloadFile(fileId: string, maxBytes: number): Promise<
    { ok: true; data: Uint8Array; path: string } | { ok: false; reason: 'not_found' | 'too_large' | 'network' }
  > {
    const info = await this.getFile(fileId);
    const filePath = info.result?.file_path;
    if (!info.ok || !filePath) return { ok: false, reason: 'not_found' };
    if ((info.result?.file_size ?? 0) > maxBytes) return { ok: false, reason: 'too_large' };

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FILE_TIMEOUT_MS);
    try {
      const response = await fetch(`${FILE_BASE}${this.#token}/${filePath}`, {
        signal: controller.signal,
      });
      if (!response.ok || !response.body) return { ok: false, reason: 'network' };

      const reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let total = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = value as Uint8Array;
        total += chunk.length;
        if (total > maxBytes) {
          await reader.cancel().catch(() => undefined);
          return { ok: false, reason: 'too_large' };
        }
        chunks.push(chunk);
      }

      const data = new Uint8Array(total);
      let offset = 0;
      for (const chunk of chunks) {
        data.set(chunk, offset);
        offset += chunk.length;
      }
      return { ok: true, data, path: filePath };
    } catch (error) {
      // Deliberately logs no URL: it embeds the bot token.
      logError('telegram.download', error, { fileId: fileId.slice(0, 8) });
      return { ok: false, reason: 'network' };
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Uploads a UTF-8 text document.
   *
   * Phase 3 tools (diff reports, generated README/Dockerfile, CSV output) can
   * exceed Telegram's 4096-character message limit; rather than spamming the
   * chat with a dozen consecutive messages, the summary stays inline and the
   * full payload arrives as one attachment.
   *
   * `multipart/form-data` is built through `FormData`, which `fetch` encodes
   * itself — the boundary must not be set manually.
   */
  async sendDocument(
    chatId: number,
    fileName: string,
    content: string,
    options: { caption?: string; keyboard?: InlineKeyboardMarkup; maxBytes?: number } = {},
  ): Promise<TgApiResponse<TgMessage>> {
    const bytes = new TextEncoder().encode(content);
    const maxBytes = options.maxBytes ?? 512 * 1024;
    if (bytes.byteLength > maxBytes) {
      return { ok: false, description: 'attachment too large' };
    }
    // Only a safe leaf name ever reaches Telegram: no path separators, no
    // control characters, and a bounded length.
    const safeName = (fileName.split(/[/\\]/).pop() ?? 'output.txt')
      // eslint-disable-next-line no-control-regex
      .replace(/[\u0000-\u001f"]/g, '')
      .slice(0, 60) || 'output.txt';

    const form = new FormData();
    form.append('chat_id', String(chatId));
    form.append('document', new Blob([bytes], { type: 'text/plain; charset=utf-8' }), safeName);
    if (options.caption) {
      form.append('caption', truncate(options.caption, 900));
      form.append('parse_mode', 'HTML');
    }
    if (options.keyboard) form.append('reply_markup', JSON.stringify(options.keyboard));

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FILE_TIMEOUT_MS);
    try {
      const response = await fetch(`${API_BASE}${this.#token}/sendDocument`, {
        method: 'POST',
        body: form,
        signal: controller.signal,
      });
      const data = (await response.json()) as TgApiResponse<TgMessage>;
      if (!data.ok) {
        logError('telegram.api', new Error(data.description ?? 'unknown'), {
          method: 'sendDocument',
          code: data.error_code,
        });
      }
      return data;
    } catch (error) {
      logError('telegram.sendDocument', error, { bytes: bytes.byteLength });
      return { ok: false, description: 'network failure' };
    } finally {
      clearTimeout(timer);
    }
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
