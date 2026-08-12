import type { Env } from './types/env.js';
import type { TgUpdate } from './types/telegram.js';
import { handleUpdate, BOT_COMMANDS } from './bot/router.js';
import { TelegramClient } from './services/telegram.js';
import { assertUniqueToolIds, TOTAL_TOOLS } from './tools/registry.js';
import { APP } from './config/index.js';
import { logError } from './utils/errors.js';

const MAX_UPDATE_BYTES = 200 * 1024;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}

function text(body: string, status = 200): Response {
  return new Response(body, {
    status,
    headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' },
  });
}

/** Constant-time-ish comparison to avoid trivial timing oracles on secrets. */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function requireAdmin(request: Request, env: Env): Response | null {
  const provided = request.headers.get('x-admin-secret') ?? '';
  if (!env.ADMIN_SECRET || !safeEqual(provided, env.ADMIN_SECRET)) {
    return json({ ok: false, error: 'unauthorized' }, 401);
  }
  return null;
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    // ─── Health ────────────────────────────────────────────────────────
    if (url.pathname === '/' || url.pathname === '/health') {
      return json({
        ok: true,
        name: APP.name,
        version: APP.version,
        tools: TOTAL_TOOLS,
        environment: env.ENVIRONMENT ?? 'production',
        bindings: { kv: Boolean(env.STATE), d1: Boolean(env.DB), token: Boolean(env.BOT_TOKEN) },
        time: new Date().toISOString(),
      });
    }

    // ─── Telegram webhook ──────────────────────────────────────────────
    if (url.pathname === '/webhook') {
      if (request.method !== 'POST') return text('Method Not Allowed', 405);

      const secret = request.headers.get('x-telegram-bot-api-secret-token') ?? '';
      if (!env.WEBHOOK_SECRET || !safeEqual(secret, env.WEBHOOK_SECRET)) {
        return json({ ok: false }, 401);
      }

      const contentLength = Number(request.headers.get('content-length') ?? '0');
      if (contentLength > MAX_UPDATE_BYTES) return json({ ok: false }, 413);

      let update: TgUpdate;
      try {
        const body = await request.text();
        if (body.length > MAX_UPDATE_BYTES) return json({ ok: false }, 413);
        update = JSON.parse(body) as TgUpdate;
      } catch {
        return json({ ok: false }, 400);
      }
      if (typeof update?.update_id !== 'number') return json({ ok: false }, 400);

      // Telegram must get 200 fast; the work continues in the background.
      ctx.waitUntil(
        handleUpdate(update, env, ctx).catch((error: unknown) =>
          logError('worker.handleUpdate', error, { updateId: update.update_id }),
        ),
      );
      return json({ ok: true });
    }

    // ─── Admin: one-off setup helpers (protected by ADMIN_SECRET) ──────
    if (url.pathname === '/admin/set-webhook' && request.method === 'POST') {
      const denied = requireAdmin(request, env);
      if (denied) return denied;
      const tg = new TelegramClient(env.BOT_TOKEN);
      const hookUrl = `${url.origin}/webhook`;
      const res = await tg.setWebhook(hookUrl, env.WEBHOOK_SECRET);
      await tg.setMyCommands(BOT_COMMANDS);
      return json({ ok: res.ok, url: hookUrl, description: res.description ?? null });
    }

    if (url.pathname === '/admin/webhook-info' && request.method === 'GET') {
      const denied = requireAdmin(request, env);
      if (denied) return denied;
      const tg = new TelegramClient(env.BOT_TOKEN);
      const info = await tg.getWebhookInfo();
      const result = (info.result ?? {}) as Record<string, unknown>;
      // Never echo the token; the webhook URL itself is safe (no token in path).
      return json({ ok: info.ok, info: result });
    }

    if (url.pathname === '/admin/self-test' && request.method === 'GET') {
      const denied = requireAdmin(request, env);
      if (denied) return denied;
      const checks: Record<string, unknown> = {};
      try {
        assertUniqueToolIds();
        checks['toolIds'] = 'unique';
      } catch (error) {
        checks['toolIds'] = error instanceof Error ? error.message : 'error';
      }
      try {
        await env.STATE.put('healthcheck', String(Date.now()), { expirationTtl: 60 });
        checks['kv'] = (await env.STATE.get('healthcheck')) ? 'ok' : 'read-failed';
      } catch (error) {
        checks['kv'] = error instanceof Error ? error.message : 'error';
      }
      try {
        const row = await env.DB.prepare('SELECT COUNT(*) AS c FROM users').first<{ c: number }>();
        checks['d1'] = { ok: true, users: row?.c ?? 0 };
      } catch (error) {
        checks['d1'] = { ok: false, error: error instanceof Error ? error.message : 'error' };
      }
      const tg = new TelegramClient(env.BOT_TOKEN);
      const me = await tg.getMe();
      checks['telegram'] = me.ok ? { ok: true, username: me.result?.username ?? null } : { ok: false };
      return json({ ok: true, tools: TOTAL_TOOLS, checks });
    }

    return text('Not Found', 404);
  },
} satisfies ExportedHandler<Env>;
