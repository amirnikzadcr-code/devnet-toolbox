/**
 * DevNet Toolbox — Admin Panel Worker (entry point).
 *
 * Routing is an explicit table: anything not listed is a 404, and every page
 * except the login flow and /health requires a valid session.
 */
import {
  AUTH_TUNING,
  clearFailures,
  clearedCookie,
  COOKIE_NAME,
  createChallenge,
  createSession,
  destroySession,
  isLockedOut,
  originAllowed,
  randomId,
  readCookie,
  readSession,
  recordFailure,
  safeEqual,
  sessionCookie,
  verifyChallenge,
} from './auth.js';
import {
  ACTIVITY_RETENTION_DAYS,
  activityPulse,
  audit,
  banUser,
  broadcastAudience,
  broadcastById,
  broadcastDeliveries,
  broadcastEngagement,
  createBroadcast,
  dailySeries,
  finishBroadcast,
  listUsers,
  overview,
  pruneActivity,
  purgeUser,
  recentActivity,
  recentAudit,
  recentBroadcasts,
  recordDeliveries,
  topTools,
  unbanUser,
  userDetail,
} from './data.js';
import { fetchUsage } from './cloudflare.js';
import { PanelTelegram } from './telegram.js';
import type { AdminEnv } from './types.js';
import {
  auditPage,
  botPage,
  broadcastPage,
  dashboardPage,
  deliveryPage,
  errorPage,
  loginPage,
  monitorPage,
  toolsPage,
  userDetailPage,
  usersPage,
} from './views.js';

interface ExecCtxLike {
  waitUntil(promise: Promise<unknown>): void;
}

/**
 * A strict CSP. `unsafe-inline` for styles is required because the stylesheet
 * is embedded; scripts are not allowed inline, and nothing may be loaded from
 * another origin or embed this panel in a frame.
 */
const SECURITY_HEADERS: Record<string, string> = {
  'content-security-policy':
    "default-src 'none'; style-src 'unsafe-inline'; img-src 'self' data:; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  // `same-origin` keeps referrers off every cross-origin request (the privacy
  // goal) while still letting the browser send a real `Origin` header on the
  // panel's own form submissions. `no-referrer` would force `Origin: null`
  // there and trip the CSRF check in originAllowed().
  'referrer-policy': 'same-origin',
  'permissions-policy': 'geolocation=(), microphone=(), camera=()',
  'cache-control': 'no-store, max-age=0',
};

function html(body: string, status = 200, extra: Record<string, string> = {}): Response {
  return new Response(body, {
    status,
    headers: { 'content-type': 'text/html; charset=utf-8', ...SECURITY_HEADERS, ...extra },
  });
}

function redirect(location: string, extra: Record<string, string> = {}): Response {
  return new Response(null, { status: 303, headers: { location, ...SECURITY_HEADERS, ...extra } });
}

const clientIp = (request: Request): string => request.headers.get('cf-connecting-ip') ?? 'unknown';

/** Flash messages travel in the query string, so they survive the POST-redirect-GET. */
/**
 * `request.formData()` throws when the body is empty or carries no
 * Content-Type, which is exactly what a fetch/curl POST to an action that
 * needs no fields looks like. Those actions (unban, purge, command sync) are
 * legitimate, so treat an unparsable body as "no fields" instead of a 500.
 */
async function readForm(request: Request): Promise<FormData> {
  try {
    return await request.formData();
  } catch {
    return new FormData();
  }
}

function flashFrom(url: URL): { kind: 'ok' | 'err'; text: string } | undefined {
  const ok = url.searchParams.get('ok');
  const err = url.searchParams.get('err');
  if (ok) return { kind: 'ok', text: ok.slice(0, 200) };
  if (err) return { kind: 'err', text: err.slice(0, 200) };
  return undefined;
}

const BOT_COMMANDS = [
  { command: 'start', description: 'شروع و منوی اصلی' },
  { command: 'tools', description: 'فهرست ابزارها' },
  { command: 'search', description: 'جستجو در ابزارها' },
  { command: 'favorites', description: 'ابزارهای مورد علاقه' },
  { command: 'remind', description: 'ساخت یادآور' },
  { command: 'notes', description: 'یادداشت‌های شخصی' },
  { command: 'profile', description: 'پروفایل و آمار من' },
  { command: 'settings', description: 'تنظیمات و زبان' },
  { command: 'help', description: 'راهنما' },
  { command: 'about', description: 'درباره ربات' },
];

export default {
  async fetch(request: Request, env: AdminEnv, ctx: ExecCtxLike): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, '') || '/';
    const method = request.method.toUpperCase();

    try {
      if (path === '/health') {
        return new Response(JSON.stringify({ ok: true, service: 'devnet-admin' }), {
          headers: { 'content-type': 'application/json', ...SECURITY_HEADERS },
        });
      }

      // Every mutation must come from this origin.
      if (method === 'POST' && !originAllowed(request)) {
        return html(errorPage(403, 'درخواست از مبدأ نامعتبر رد شد.'), 403);
      }

      // ── Login flow (unauthenticated) ──────────────────────────────────
      if (path === '/login' && method === 'GET') {
        const existing = await readSession(env, readCookie(request, COOKIE_NAME));
        if (existing) return redirect('/');
        return html(loginPage('password'));
      }

      if (path === '/login' && method === 'POST') return handlePasswordStep(request, env);
      if (path === '/login/verify' && method === 'POST') return handleCodeStep(request, env);

      if (path === '/logout' && method === 'POST') {
        const token = readCookie(request, COOKIE_NAME);
        await destroySession(env, token);
        return redirect('/login', { 'set-cookie': clearedCookie() });
      }

      // ── Authentication gate ───────────────────────────────────────────
      const session = await readSession(env, readCookie(request, COOKIE_NAME));
      if (!session) {
        return method === 'GET'
          ? redirect('/login')
          : html(errorPage(401, 'نشست شما منقضی شده است. دوباره وارد شوید.'), 401);
      }

      // ── Authenticated routes ──────────────────────────────────────────
      // Every handler is awaited here on purpose: returning the promise
      // directly would let a rejection escape this try/catch and surface as an
      // unhandled error instead of the 500 page.
      if (method === 'GET') {
        if (path === '/') return await dashboard(env);
        if (path === '/users') return await usersList(env, url);
        if (path === '/tools') return await toolsList(env);
        if (path === '/monitor') return await monitorView(env, url, ctx);
        if (path === '/broadcast') return await broadcastView(env, url);
        if (path === '/bot') return await botView(env, url);
        if (path === '/audit') return html(auditPage(await recentAudit(env.DB, 200)));

        const detail = /^\/users\/(\d{1,20})$/.exec(path);
        if (detail) return await userView(env, Number(detail[1]), url);

        const delivery = /^\/broadcast\/([A-Za-z0-9_-]{1,32})$/.exec(path);
        if (delivery) return await deliveryView(env, delivery[1] ?? '', url);
      }

      if (method === 'POST') {
        const action = /^\/users\/(\d{1,20})\/(ban|unban|purge|message)$/.exec(path);
        if (action) return await userAction(request, env, Number(action[1]), action[2] ?? '');
        if (path === '/broadcast') return await startBroadcast(request, env, ctx);
        if (path === '/bot/webhook') return await updateWebhook(request, env);
        if (path === '/bot/commands') return await syncCommands(request, env);
        if (path === '/bot/profile') return await updateProfile(request, env);
      }

      return html(errorPage(404, 'صفحه‌ای که دنبال آن بودید وجود ندارد.'), 404);
    } catch (error) {
      // The message is logged for the operator but never shown to the client:
      // a stack trace or a D1 error string can leak schema details.
      console.error('panel error', error instanceof Error ? error.message : String(error));
      return html(errorPage(500, 'خطای داخلی سرور. لطفاً دوباره تلاش کنید.'), 500);
    }
  },
};

// ─── Login handlers ──────────────────────────────────────────────────────

async function handlePasswordStep(request: Request, env: AdminEnv): Promise<Response> {
  const ip = clientIp(request);
  if (await isLockedOut(env, 'pw', ip)) {
    return html(loginPage('password', 'تلاش‌های ناموفق بیش از حد. ۱۵ دقیقه دیگر تلاش کنید.'), 429);
  }

  const form = await readForm(request);
  const password = String(form.get('password') ?? '');

  if (!password || !safeEqual(password, env.ADMIN_PASSWORD)) {
    await recordFailure(env, 'pw', ip);
    // Deliberately vague: no hint about which factor failed.
    return html(loginPage('password', 'اطلاعات ورود نادرست است.'), 401);
  }
  await clearFailures(env, 'pw', ip);

  const { id, code } = await createChallenge(env);
  const telegram = new PanelTelegram(env.BOT_TOKEN);
  const sent = await telegram.sendMessage(
    env.ADMIN_CHAT_ID,
    `🔐 <b>کد ورود پنل مدیریت</b>\n\n<code>${code}</code>\n\n` +
      `⏱ اعتبار: ۵ دقیقه\n🌐 IP: <code>${ip}</code>\n\n` +
      `اگر شما درخواست ورود نداده‌اید، رمز عبور پنل را فوراً تغییر دهید.`,
  );

  if (!sent.ok) {
    return html(loginPage('password', 'ارسال کد به تلگرام ناموفق بود. اتصال ربات را بررسی کنید.'), 502);
  }

  await audit(env.DB, { action: 'login.challenge', target: 'admin', detail: 'کد دومرحله‌ای ارسال شد', ip });
  return html(loginPage('code', undefined, id));
}

async function handleCodeStep(request: Request, env: AdminEnv): Promise<Response> {
  const ip = clientIp(request);
  if (await isLockedOut(env, 'code', ip)) {
    return html(loginPage('password', 'تلاش‌های ناموفق بیش از حد. ۱۵ دقیقه دیگر تلاش کنید.'), 429);
  }

  const form = await readForm(request);
  const challenge = String(form.get('challenge') ?? '');
  const code = String(form.get('code') ?? '').trim();

  if (!(await verifyChallenge(env, challenge, code))) {
    await recordFailure(env, 'code', ip);
    await audit(env.DB, { action: 'login.failed', target: 'admin', detail: 'کد نادرست', ip });
    return html(loginPage('password', 'کد نادرست یا منقضی شده است. دوباره وارد شوید.'), 401);
  }

  await clearFailures(env, 'code', ip);
  const uid = Number(env.ADMIN_CHAT_ID) || 0;
  const token = await createSession(env, uid);
  await audit(env.DB, { action: 'login.success', target: 'admin', detail: 'ورود موفق', ip });
  return redirect('/', { 'set-cookie': sessionCookie(token) });
}

// ─── Page handlers ───────────────────────────────────────────────────────

async function dashboard(env: AdminEnv): Promise<Response> {
  const telegram = new PanelTelegram(env.BOT_TOKEN);
  const [stats, series, tools, recent, webhook, me] = await Promise.all([
    overview(env.DB),
    dailySeries(env.DB, 14),
    topTools(env.DB, 10),
    recentAudit(env.DB, 8),
    telegram.getWebhookInfo(),
    telegram.getMe(),
  ]);

  const botInfo =
    webhook.ok && webhook.result
      ? {
          username: me.result?.username ?? env.BOT_USERNAME ?? '',
          webhook: webhook.result.url,
          pending: webhook.result.pending_update_count,
          ...(webhook.result.last_error_message ? { lastError: webhook.result.last_error_message } : {}),
        }
      : null;

  return html(dashboardPage(stats, series, tools, recent, botInfo));
}

async function usersList(env: AdminEnv, url: URL): Promise<Response> {
  const search = url.searchParams.get('search') ?? '';
  const sortParam = url.searchParams.get('sort') ?? 'last_seen';
  const sort: 'last_seen' | 'tool_runs' | 'first_seen' =
    sortParam === 'tool_runs' ? 'tool_runs' : sortParam === 'first_seen' ? 'first_seen' : 'last_seen';
  const banned = url.searchParams.get('banned') === '1';
  const page = Math.max(Number.parseInt(url.searchParams.get('page') ?? '1', 10) || 1, 1);

  const data = await listUsers(env.DB, { search, sort, page, bannedOnly: banned, perPage: 25 });
  return html(usersPage(data, { search, sort, banned }, flashFrom(url)));
}

async function userView(env: AdminEnv, userId: number, url: URL): Promise<Response> {
  const detail = await userDetail(env.DB, userId);
  if (!detail) return html(errorPage(404, 'چنین کاربری در پایگاه داده وجود ندارد.'), 404);
  return html(userDetailPage(detail, flashFrom(url)));
}

async function toolsList(env: AdminEnv): Promise<Response> {
  const tools = await topTools(env.DB, 200);
  const total = tools.reduce((sum, tool) => sum + tool.uses, 0);
  return html(toolsPage(tools, total));
}

/** Refresh cadence for the monitor, in seconds. Clamped to sane bounds. */
const MONITOR_REFRESH_DEFAULT = 5;

async function monitorView(env: AdminEnv, url: URL, ctx: ExecCtxLike): Promise<Response> {
  const kind = url.searchParams.get('kind') ?? '';
  const allowed = new Set(['tool', 'command', 'callback', 'input', 'media']);
  const refresh = Math.min(
    Math.max(Number(url.searchParams.get('refresh')) || MONITOR_REFRESH_DEFAULT, 3),
    60,
  );

  const [events, pulse, usage] = await Promise.all([
    recentActivity(env.DB, { limit: 60, ...(allowed.has(kind) ? { kind } : {}) }),
    activityPulse(env.DB),
    fetchUsage(env.CF_ANALYTICS_TOKEN, env.CF_ACCOUNT_ID),
  ]);

  // Retention is enforced opportunistically on view rather than by a cron, so
  // the panel needs no extra trigger and old rows still cannot accumulate.
  ctx.waitUntil(
    pruneActivity(env.DB).catch((error: unknown) =>
      console.error('prune failed', error instanceof Error ? error.message : String(error)),
    ),
  );

  return html(
    monitorPage(events, pulse, usage, {
      kind: allowed.has(kind) ? kind : '',
      refresh,
      retentionDays: ACTIVITY_RETENTION_DAYS,
    }),
  );
}

async function deliveryView(env: AdminEnv, id: string, url: URL): Promise<Response> {
  const broadcast = await broadcastById(env.DB, id);
  if (!broadcast) return html(errorPage(404, 'این ارسال یافت نشد.'), 404);

  const raw = url.searchParams.get('status') ?? '';
  const status = raw === 'sent' || raw === 'failed' ? raw : undefined;

  const [rows, engaged] = await Promise.all([
    broadcastDeliveries(env.DB, id, status),
    broadcastEngagement(env.DB, id, broadcast.created_at),
  ]);

  return html(deliveryPage(broadcast, rows, engaged, status ?? ''));
}

async function broadcastView(env: AdminEnv, url: URL): Promise<Response> {
  const [history, all, active7, active30] = await Promise.all([
    recentBroadcasts(env.DB, 20),
    broadcastAudience(env.DB, 'all'),
    broadcastAudience(env.DB, 'active7'),
    broadcastAudience(env.DB, 'active30'),
  ]);
  return html(
    broadcastPage(
      history,
      { all: all.length, active7: active7.length, active30: active30.length },
      flashFrom(url),
    ),
  );
}

async function botView(env: AdminEnv, url: URL): Promise<Response> {
  const telegram = new PanelTelegram(env.BOT_TOKEN);
  const [me, webhook, fa, faShort, en, enShort] = await Promise.all([
    telegram.getMe(),
    telegram.getWebhookInfo(),
    telegram.getMyDescription('fa'),
    telegram.getMyShortDescription('fa'),
    telegram.getMyDescription('en'),
    telegram.getMyShortDescription('en'),
  ]);

  const info =
    me.ok && me.result && webhook.ok && webhook.result
      ? {
          username: me.result.username,
          id: me.result.id,
          webhook: webhook.result.url,
          pending: webhook.result.pending_update_count,
          ...(webhook.result.last_error_message ? { lastError: webhook.result.last_error_message } : {}),
          ...(webhook.result.max_connections !== undefined
            ? { maxConnections: webhook.result.max_connections }
            : {}),
        }
      : null;

  return html(
    botPage(
      info,
      {
        fa: fa.result?.description ?? '',
        faShort: faShort.result?.short_description ?? '',
        en: en.result?.description ?? '',
        enShort: enShort.result?.short_description ?? '',
      },
      env.BOT_WORKER_URL ?? '',
      flashFrom(url),
    ),
  );
}

// ─── Action handlers ─────────────────────────────────────────────────────

async function userAction(
  request: Request,
  env: AdminEnv,
  userId: number,
  action: string,
): Promise<Response> {
  const ip = clientIp(request);
  const form = await readForm(request);
  const back = `/users/${userId}`;

  if (action === 'ban') {
    const reason = String(form.get('reason') ?? '').slice(0, 200);
    await banUser(env, userId, reason);
    await audit(env.DB, { action: 'user.ban', target: String(userId), detail: reason || 'بدون دلیل', ip });
    return redirect(`${back}?ok=${encodeURIComponent('کاربر مسدود شد.')}`);
  }

  if (action === 'unban') {
    await unbanUser(env, userId);
    await audit(env.DB, { action: 'user.unban', target: String(userId), detail: '', ip });
    return redirect(`${back}?ok=${encodeURIComponent('مسدودیت کاربر برداشته شد.')}`);
  }

  if (action === 'purge') {
    await purgeUser(env, userId);
    await audit(env.DB, { action: 'user.purge', target: String(userId), detail: 'حذف کامل داده‌ها', ip });
    return redirect(`/users?ok=${encodeURIComponent('همه داده‌های کاربر حذف شد.')}`);
  }

  if (action === 'message') {
    const text = String(form.get('text') ?? '').slice(0, 3000);
    if (!text.trim()) return redirect(`${back}?err=${encodeURIComponent('متن پیام خالی است.')}`);
    const result = await new PanelTelegram(env.BOT_TOKEN).sendMessage(userId, text);
    await audit(env.DB, {
      action: 'user.message',
      target: String(userId),
      detail: result.ok ? 'ارسال شد' : `ناموفق: ${result.description ?? ''}`,
      ip,
    });
    return redirect(
      result.ok
        ? `${back}?ok=${encodeURIComponent('پیام ارسال شد.')}`
        : `${back}?err=${encodeURIComponent('ارسال پیام ناموفق بود.')}`,
    );
  }

  return html(errorPage(400, 'عملیات نامعتبر است.'), 400);
}

/**
 * Broadcasts run in `waitUntil` so the operator gets an immediate response.
 * Telegram allows roughly 30 messages/second to different chats; the batching
 * below stays under that with a margin, and a 429 pauses the whole run for the
 * `retry_after` the API asks for rather than burning through failures.
 */
async function startBroadcast(request: Request, env: AdminEnv, ctx: ExecCtxLike): Promise<Response> {
  const ip = clientIp(request);
  const form = await readForm(request);
  const body = String(form.get('body') ?? '').trim().slice(0, 3500);
  const audience = String(form.get('audience') ?? 'all');

  if (!body) return redirect(`/broadcast?err=${encodeURIComponent('متن پیام خالی است.')}`);

  const recipients = await broadcastAudience(env.DB, audience);
  if (recipients.length === 0) {
    return redirect(`/broadcast?err=${encodeURIComponent('هیچ گیرنده‌ای برای این گروه یافت نشد.')}`);
  }

  const id = randomId(8);
  await createBroadcast(env.DB, id, body, audience, recipients.length);
  await audit(env.DB, {
    action: 'broadcast.start',
    target: audience,
    detail: `${recipients.length} گیرنده`,
    ip,
  });

  ctx.waitUntil(runBroadcast(env, id, body, recipients));

  return redirect(
    `/broadcast?ok=${encodeURIComponent(`ارسال به ${recipients.length} کاربر آغاز شد.`)}`,
  );
}

async function runBroadcast(env: AdminEnv, id: string, body: string, recipients: number[]): Promise<void> {
  const telegram = new PanelTelegram(env.BOT_TOKEN);
  const BATCH = 25;
  let sent = 0;
  let failed = 0;

  try {
    for (let index = 0; index < recipients.length; index += BATCH) {
      const slice = recipients.slice(index, index + BATCH);
      const results = await Promise.all(slice.map((chatId) => telegram.sendMessage(chatId, body)));

      let retryAfter = 0;
      // Per-recipient outcomes, so the panel can show exactly who received the
      // message and why it failed for the rest.
      const outcomes: { userId: number; status: 'sent' | 'failed'; error?: string }[] = [];

      results.forEach((result, offset) => {
        const userId = slice[offset] as number;
        if (result.ok) {
          sent += 1;
          outcomes.push({ userId, status: 'sent' });
        } else {
          failed += 1;
          retryAfter = Math.max(retryAfter, result.parameters?.retry_after ?? 0);
          outcomes.push({
            userId,
            status: 'failed',
            // Telegram's own diagnostic, e.g. "bot was blocked by the user".
            error: result.description ?? 'unknown error',
          });
        }
      });

      await recordDeliveries(env.DB, id, outcomes).catch((error: unknown) =>
        console.error('delivery log failed', error instanceof Error ? error.message : String(error)),
      );

      if (index + BATCH < recipients.length) {
        await new Promise((resolve) => setTimeout(resolve, retryAfter > 0 ? retryAfter * 1000 : 1100));
      }
    }
    await finishBroadcast(env.DB, id, sent, failed, 'done');
  } catch (error) {
    console.error('broadcast failed', error instanceof Error ? error.message : String(error));
    await finishBroadcast(env.DB, id, sent, failed, 'failed');
  }
}

async function updateWebhook(request: Request, env: AdminEnv): Promise<Response> {
  const ip = clientIp(request);
  const form = await readForm(request);
  const target = String(form.get('url') ?? '').trim();
  const secret = String(form.get('secret') ?? '');

  if (!/^https:\/\/[\w.-]+\/[\w/-]*$/.test(target)) {
    return redirect(`/bot?err=${encodeURIComponent('آدرس Webhook نامعتبر است.')}`);
  }
  if (secret.length < 8) {
    return redirect(`/bot?err=${encodeURIComponent('Secret Token باید حداقل ۸ نویسه باشد.')}`);
  }

  const result = await new PanelTelegram(env.BOT_TOKEN).setWebhook(target, secret);
  // The secret itself is never written to the audit trail.
  await audit(env.DB, {
    action: 'bot.webhook',
    target,
    detail: result.ok ? 'به‌روزرسانی شد' : `ناموفق: ${result.description ?? ''}`,
    ip,
  });
  return redirect(
    result.ok
      ? `/bot?ok=${encodeURIComponent('Webhook با موفقیت به‌روزرسانی شد.')}`
      : `/bot?err=${encodeURIComponent('به‌روزرسانی Webhook ناموفق بود.')}`,
  );
}

async function syncCommands(request: Request, env: AdminEnv): Promise<Response> {
  const ip = clientIp(request);
  const result = await new PanelTelegram(env.BOT_TOKEN).setMyCommands(BOT_COMMANDS);
  await audit(env.DB, {
    action: 'bot.commands',
    target: 'telegram',
    detail: result.ok ? `${BOT_COMMANDS.length} دستور` : 'ناموفق',
    ip,
  });
  return redirect(
    result.ok
      ? `/bot?ok=${encodeURIComponent('دستورات ربات همگام‌سازی شد.')}`
      : `/bot?err=${encodeURIComponent('همگام‌سازی دستورات ناموفق بود.')}`,
  );
}

async function updateProfile(request: Request, env: AdminEnv): Promise<Response> {
  const ip = clientIp(request);
  const form = await readForm(request);
  const telegram = new PanelTelegram(env.BOT_TOKEN);

  const fa = String(form.get('fa') ?? '').slice(0, 512);
  const faShort = String(form.get('faShort') ?? '').slice(0, 120);
  const en = String(form.get('en') ?? '').slice(0, 512);
  const enShort = String(form.get('enShort') ?? '').slice(0, 120);

  const results = await Promise.all([
    telegram.setMyDescription(fa, 'fa'),
    telegram.setMyShortDescription(faShort, 'fa'),
    telegram.setMyDescription(en, 'en'),
    telegram.setMyShortDescription(enShort, 'en'),
    // English also serves as the default for every other language.
    telegram.setMyDescription(en),
    telegram.setMyShortDescription(enShort),
  ]);

  const failures = results.filter((result) => !result.ok).length;
  await audit(env.DB, {
    action: 'bot.profile',
    target: 'telegram',
    detail: failures === 0 ? 'همه توضیحات به‌روزرسانی شد' : `${failures} مورد ناموفق`,
    ip,
  });

  return redirect(
    failures === 0
      ? `/bot?ok=${encodeURIComponent('توضیحات ربات به‌روزرسانی شد.')}`
      : `/bot?err=${encodeURIComponent(`${failures} مورد به‌روزرسانی نشد.`)}`,
  );
}

export { AUTH_TUNING, BOT_COMMANDS };
