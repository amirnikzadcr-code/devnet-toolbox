/**
 * DevNet Toolbox — Mini App Worker.
 *
 * Serves the React bundle as static assets (free and unmetered on Cloudflare)
 * and exposes a small JSON API under /api that reuses the bot's existing tool
 * registry, D1 schema and KV namespace. Nothing here forks bot logic: a tool
 * behaves identically whether it was reached from a Telegram button or a tap
 * in the Mini App.
 */
import { ALL_TOOLS, CATEGORIES, EVERYDAY_GROUPS, getTool } from '../../src/tools/registry.js';
import { listFavorites, toggleFavorite, MAX_FAVORITES } from '../../src/db/favorites.js';
import { getLang, setLang, touchUser, recordToolRun, userTopTools, userDistinctTools } from '../../src/db/queries.js';
import { recordActivity } from '../../src/db/activity.js';
import { isBanned } from '../../src/services/state.js';
import { consume } from '../../src/services/ratelimit.js';
import { isToolError, logError } from '../../src/utils/errors.js';
import type { Lang } from '../../src/localization/index.js';
import { verifyInitData, AuthError, type AuthedUser } from './auth.js';
import { sanitizeHtml } from './sanitize.js';

export interface AppEnv {
  BOT_TOKEN: string;
  STATE: KVNamespace;
  DB: D1Database;
  ASSETS: Fetcher;
  BOT_USERNAME?: string;
}

const JSON_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'same-origin',
};

const MAX_INPUT_CHARS = 8000;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

/** Resolves the caller from the signed launch payload. */
async function authenticate(request: Request, env: AppEnv): Promise<AuthedUser> {
  const raw = request.headers.get('x-init-data') ?? '';
  return verifyInitData(raw, env.BOT_TOKEN);
}

async function readJson<T>(request: Request): Promise<T> {
  const length = Number(request.headers.get('content-length') ?? '0');
  if (length > 64 * 1024) throw new AuthError('payload too large', 413);
  try {
    return (await request.json()) as T;
  } catch {
    throw new AuthError('malformed body', 400);
  }
}

/* ─── Handlers ─────────────────────────────────────────────────────── */

async function handleCatalog(user: AuthedUser, env: AppEnv): Promise<Response> {
  const displayName = [user.firstName, user.lastName].filter(Boolean).join(' ') || user.username || 'کاربر';

  let lang: Lang = 'fa';
  let favorites: string[] = [];
  try {
    await touchUser(
      env.DB,
      {
        id: user.id,
        is_bot: false,
        first_name: user.firstName,
        last_name: user.lastName,
        username: user.username,
      },
      'fa',
    );
    lang = ((await getLang(env.DB, user.id)) as Lang) ?? 'fa';
    favorites = await listFavorites(env.DB, user.id);
  } catch (error) {
    logError('app.catalog', error, { userId: user.id });
  }

  const tools = ALL_TOOLS.map((tool) => ({
    id: tool.id,
    category: tool.category,
    group: tool.group,
    icon: tool.icon,
    title: tool.title[lang],
    description: tool.description[lang],
    usage: tool.usage[lang],
    example: tool.example[lang],
    limitations: tool.limitations[lang],
    needsInput: tool.needsInput,
    network: Boolean(tool.network),
    file: Boolean(tool.file),
    quick: Boolean(tool.quick),
  }));

  const categories = CATEGORIES.map((category) => ({
    id: category.id,
    icon: category.icon,
    title: category.title[lang],
    count: ALL_TOOLS.filter((tool) => tool.category === category.id).length,
  }));

  const groups = EVERYDAY_GROUPS.map((group) => ({
    id: group.id,
    icon: group.icon,
    title: group.title[lang],
  }));

  return json({
    tools,
    categories,
    groups,
    favorites,
    lang,
    user: { id: user.id, name: displayName, lang, runs: 0, joined: 0 },
  });
}

async function handleRun(request: Request, user: AuthedUser, env: AppEnv, ctx: ExecutionContext): Promise<Response> {
  const body = await readJson<{ toolId?: unknown; input?: unknown }>(request);
  const toolId = typeof body.toolId === 'string' ? body.toolId : '';
  const input = typeof body.input === 'string' ? body.input : '';

  if (input.length > MAX_INPUT_CHARS) {
    return json({ ok: false, error: `ورودی بیش از حد بلند است (حداکثر ${MAX_INPUT_CHARS} نویسه).` }, 413);
  }

  const tool = getTool(toolId);
  if (!tool) return json({ ok: false, error: 'ابزار پیدا نشد.' }, 404);
  if (tool.file) {
    return json({ ok: false, error: 'این ابزار فایل می‌گیرد؛ لطفاً فایل را در خود ربات بفرستید.' }, 400);
  }

  // Same budget the bot enforces, keyed on the same KV bucket, so the Mini App
  // cannot be used to bypass per-user limits.
  const verdict = await consume(env.STATE, 'tool', user.id);
  if (!verdict.allowed) {
    return json({ ok: false, error: `تعداد درخواست‌ها زیاد است. ${verdict.retryAfterSec} ثانیه صبر کنید.` }, 429);
  }

  const lang = ((await getLang(env.DB, user.id).catch(() => null)) as Lang) ?? 'fa';
  const started = Date.now();

  try {
    const result = await tool.run(input, { lang, userId: user.id, cache: env.STATE });
    const ms = Date.now() - started;

    ctx.waitUntil(
      Promise.allSettled([
        recordToolRun(env.DB, user.id, tool.id),
        recordActivity(env.DB, { userId: user.id, kind: 'tool', detail: tool.id, ok: true, ms }),
      ]),
    );

    return json({
      ok: true,
      html: sanitizeHtml(result.html),
      attachment: result.attachment
        ? { name: result.attachment.name, content: result.attachment.content.slice(0, 200_000) }
        : undefined,
      ms,
    });
  } catch (error) {
    const ms = Date.now() - started;
    ctx.waitUntil(recordActivity(env.DB, { userId: user.id, kind: 'tool', detail: tool.id, ok: false, ms }));
    if (isToolError(error)) {
      return json({ ok: false, error: error.localized(lang) }, 400);
    }
    logError('app.run', error, { tool: tool.id, userId: user.id });
    return json({ ok: false, error: 'اجرای ابزار با خطا مواجه شد.' }, 500);
  }
}

async function handleFavorite(request: Request, user: AuthedUser, env: AppEnv): Promise<Response> {
  const body = await readJson<{ toolId?: unknown }>(request);
  const toolId = typeof body.toolId === 'string' ? body.toolId : '';
  if (!getTool(toolId)) return json({ ok: false, error: 'ابزار پیدا نشد.' }, 404);

  try {
    const outcome = await toggleFavorite(env.DB, user.id, toolId);
    if (outcome.status === 'full') {
      return json({ ok: false, error: `حداکثر ${MAX_FAVORITES} ابزار می‌توانید منتخب کنید.` }, 409);
    }
    if (outcome.status === 'error') {
      return json({ ok: false, error: 'ذخیره نشد.' }, 500);
    }
    return json({ ok: true, favorites: await listFavorites(env.DB, user.id) });
  } catch (error) {
    logError('app.favorite', error, { userId: user.id });
    return json({ ok: false, error: 'ذخیره نشد.' }, 500);
  }
}

async function handleLang(request: Request, user: AuthedUser, env: AppEnv): Promise<Response> {
  const body = await readJson<{ lang?: unknown }>(request);
  const lang = body.lang === 'en' ? 'en' : 'fa';
  try {
    await setLang(env.DB, user.id, lang);
    await env.STATE.put(`lang:${user.id}`, lang, { expirationTtl: 86_400 });
  } catch (error) {
    logError('app.lang', error, { userId: user.id });
    return json({ ok: false, error: 'ذخیره نشد.' }, 500);
  }
  return json({ ok: true });
}

async function handleStats(user: AuthedUser, env: AppEnv): Promise<Response> {
  try {
    const [top, distinct] = await Promise.all([
      userTopTools(env.DB, user.id, 8),
      userDistinctTools(env.DB, user.id),
    ]);
    const totalRuns = top.reduce((sum, row) => sum + row.uses, 0);
    return json({
      topTools: top.map((row) => ({ toolId: row.tool_id, uses: row.uses })),
      totalRuns,
      distinct,
    });
  } catch (error) {
    logError('app.stats', error, { userId: user.id });
    return json({ topTools: [], totalRuns: 0, distinct: 0 });
  }
}

/* ─── Entry ────────────────────────────────────────────────────────── */

export default {
  async fetch(request: Request, env: AppEnv, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (!url.pathname.startsWith('/api/')) {
      // Static assets: served by Cloudflare directly, free and unmetered.
      // Security headers for these come from `app/public/_headers`: a request
      // that matches an asset is served from Cloudflare's edge without ever
      // invoking this Worker, so header logic here would not run.
      return env.ASSETS.fetch(request);
    }

    if (url.pathname === '/api/health') {
      return json({ ok: true, tools: ALL_TOOLS.length, time: new Date().toISOString() });
    }

    try {
      const user = await authenticate(request, env);

      if (await isBanned(env.STATE, user.id)) {
        return json({ ok: false, error: 'دسترسی شما محدود شده است.' }, 403);
      }

      // Cheap global budget shared with the bot's general bucket.
      const general = await consume(env.STATE, 'general', user.id);
      if (!general.allowed) {
        return json({ ok: false, error: 'درخواست‌ها بیش از حد سریع‌اند.' }, 429);
      }

      const method = request.method;
      const route = url.pathname;

      if (route === '/api/catalog' && method === 'GET') return await handleCatalog(user, env);
      if (route === '/api/run' && method === 'POST') return await handleRun(request, user, env, ctx);
      if (route === '/api/favorite' && method === 'POST') return await handleFavorite(request, user, env);
      if (route === '/api/lang' && method === 'POST') return await handleLang(request, user, env);
      if (route === '/api/stats' && method === 'GET') return await handleStats(user, env);

      return json({ ok: false, error: 'not found' }, 404);
    } catch (error) {
      if (error instanceof AuthError) {
        return json({ ok: false, error: error.message }, error.status);
      }
      logError('app.fetch', error, { path: url.pathname });
      return json({ ok: false, error: 'internal error' }, 500);
    }
  },
};
