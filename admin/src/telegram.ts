/**
 * Minimal Telegram client for the panel.
 *
 * Deliberately not shared with the bot's client: the panel only needs to send
 * messages and manage webhook/command metadata, and keeping the surface small
 * means the panel cannot accidentally act as the bot.
 */
const API = 'https://api.telegram.org';
const TIMEOUT_MS = 10_000;

export interface TelegramResult<T> {
  ok: boolean;
  result?: T;
  description?: string;
  error_code?: number;
  parameters?: { retry_after?: number };
}

export class PanelTelegram {
  constructor(private readonly token: string) {}

  async call<T>(method: string, payload: Record<string, unknown> = {}): Promise<TelegramResult<T>> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const response = await fetch(`${API}/bot${this.token}/${method}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      return (await response.json()) as TelegramResult<T>;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'network error';
      // The token lives in the URL, so a raw fetch error is never surfaced.
      return { ok: false, description: message.includes('abort') ? 'timeout' : 'network error' };
    } finally {
      clearTimeout(timer);
    }
  }

  sendMessage(chatId: number | string, text: string, extra: Record<string, unknown> = {}) {
    return this.call<{ message_id: number }>('sendMessage', {
      chat_id: chatId,
      text,
      parse_mode: 'HTML',
      disable_web_page_preview: true,
      ...extra,
    });
  }

  getMe() {
    return this.call<{ id: number; username: string; first_name: string }>('getMe');
  }

  getWebhookInfo() {
    return this.call<{
      url: string;
      has_custom_certificate: boolean;
      pending_update_count: number;
      last_error_date?: number;
      last_error_message?: string;
      max_connections?: number;
    }>('getWebhookInfo');
  }

  setWebhook(url: string, secret: string) {
    return this.call<boolean>('setWebhook', {
      url,
      secret_token: secret,
      allowed_updates: ['message', 'callback_query'],
      drop_pending_updates: false,
      max_connections: 40,
    });
  }

  setMyDescription(description: string, languageCode?: string) {
    return this.call<boolean>('setMyDescription', {
      description,
      ...(languageCode ? { language_code: languageCode } : {}),
    });
  }

  setMyShortDescription(shortDescription: string, languageCode?: string) {
    return this.call<boolean>('setMyShortDescription', {
      short_description: shortDescription,
      ...(languageCode ? { language_code: languageCode } : {}),
    });
  }

  getMyDescription(languageCode?: string) {
    return this.call<{ description: string }>('getMyDescription', languageCode ? { language_code: languageCode } : {});
  }

  getMyShortDescription(languageCode?: string) {
    return this.call<{ short_description: string }>(
      'getMyShortDescription',
      languageCode ? { language_code: languageCode } : {},
    );
  }

  setMyCommands(commands: { command: string; description: string }[], languageCode?: string) {
    return this.call<boolean>('setMyCommands', {
      commands,
      ...(languageCode ? { language_code: languageCode } : {}),
    });
  }
}
