/**
 * Server-rendered HTML for the panel.
 *
 * No framework, no CDN, no external font: the whole interface is one inline
 * stylesheet and a few small scripts. That keeps the Worker bundle tiny, works
 * under a strict Content-Security-Policy, and means the panel renders even
 * when the network is hostile.
 *
 * Direction is RTL and all copy is Persian, matching the bot.
 */
import type {
  ActivityRow,
  AuditRow,
  BroadcastRow,
  CloudflareUsage,
  DailyPoint,
  DeliveryRow,
  OverviewStats,
  ToolRow,
  UserRow,
} from './types.js';

/** Every value interpolated into HTML passes through here. */
export function esc(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const FA_DIGITS = ['۰', '۱', '۲', '۳', '۴', '۵', '۶', '۷', '۸', '۹'];

/** Latin digits with thousands separators, then Persian digits. */
export function faNum(value: number): string {
  const grouped = Math.round(value).toLocaleString('en-US');
  return grouped.replace(/[0-9]/g, (digit) => FA_DIGITS[Number(digit)] ?? digit);
}

export function faDate(unix: number): string {
  if (!unix) return '—';
  const date = new Date(unix * 1000);
  const parts = new Intl.DateTimeFormat('fa-IR', {
    dateStyle: 'short',
    timeStyle: 'short',
    timeZone: 'Asia/Tehran',
  }).format(date);
  return parts;
}

export function relTime(unix: number): string {
  if (!unix) return '—';
  const diff = Math.floor(Date.now() / 1000) - unix;
  if (diff < 60) return 'همین حالا';
  if (diff < 3600) return `${faNum(Math.floor(diff / 60))} دقیقه پیش`;
  if (diff < 86_400) return `${faNum(Math.floor(diff / 3600))} ساعت پیش`;
  if (diff < 2_592_000) return `${faNum(Math.floor(diff / 86_400))} روز پیش`;
  return faDate(unix);
}

const STYLE = `
*{box-sizing:border-box;margin:0;padding:0}
:root{
  --bg:#0b1020;--panel:#141a2e;--panel2:#1b2340;--line:#28304d;
  --text:#e8ecf8;--muted:#93a0c4;--accent:#5b8cff;--accent2:#8b5cf6;
  --ok:#34d399;--warn:#fbbf24;--bad:#f87171;--radius:14px;
}
body{
  background:radial-gradient(1200px 600px at 80% -10%,#1a2450 0%,transparent 60%),var(--bg);
  color:var(--text);font-family:system-ui,'Segoe UI',Tahoma,sans-serif;
  direction:rtl;min-height:100vh;line-height:1.7;font-size:15px;
}
a{color:var(--accent);text-decoration:none}
a:hover{text-decoration:underline}
.wrap{max-width:1180px;margin:0 auto;padding:22px 18px 60px}

/* ── Login ── */
.login-shell{display:flex;align-items:center;justify-content:center;min-height:100vh;padding:20px}
.login-card{background:var(--panel);border:1px solid var(--line);border-radius:20px;padding:34px 30px;width:100%;max-width:400px;box-shadow:0 24px 60px rgba(0,0,0,.45)}
.login-card h1{font-size:22px;margin-bottom:6px;text-align:center}
.login-card .sub{color:var(--muted);font-size:13px;text-align:center;margin-bottom:24px}
.logo{width:58px;height:58px;border-radius:16px;margin:0 auto 16px;display:grid;place-items:center;
  background:linear-gradient(135deg,var(--accent),var(--accent2));font-size:28px}

/* ── Header ── */
header{background:rgba(20,26,46,.85);border-bottom:1px solid var(--line);position:sticky;top:0;z-index:20;backdrop-filter:blur(10px)}
.hbar{max-width:1180px;margin:0 auto;padding:12px 18px;display:flex;align-items:center;gap:14px;flex-wrap:wrap}
.brand{font-weight:700;display:flex;align-items:center;gap:9px;font-size:16px}
.brand span.dot{width:9px;height:9px;border-radius:50%;background:var(--ok);box-shadow:0 0 10px var(--ok)}
nav{display:flex;gap:5px;flex-wrap:wrap;margin-inline-start:auto}
nav a{padding:7px 13px;border-radius:9px;color:var(--muted);font-size:14px;transition:.15s}
nav a:hover{background:var(--panel2);color:var(--text);text-decoration:none}
nav a.on{background:linear-gradient(135deg,var(--accent),var(--accent2));color:#fff}

/* ── Cards & grid ── */
.grid{display:grid;gap:14px}
.g2{grid-template-columns:repeat(auto-fit,minmax(300px,1fr))}
.g4{grid-template-columns:repeat(auto-fit,minmax(190px,1fr))}
.card{background:var(--panel);border:1px solid var(--line);border-radius:var(--radius);padding:18px}
.card h2{font-size:15px;margin-bottom:14px;display:flex;align-items:center;gap:8px}
.stat .label{color:var(--muted);font-size:12.5px;margin-bottom:6px}
.stat .value{font-size:27px;font-weight:700;letter-spacing:.4px}
.stat .foot{color:var(--muted);font-size:12px;margin-top:4px}
.accent{background:linear-gradient(135deg,rgba(91,140,255,.16),rgba(139,92,246,.10));border-color:#3a4a86}

/* ── Table ── */
table{width:100%;border-collapse:collapse;font-size:13.5px}
th,td{padding:9px 10px;text-align:right;border-bottom:1px solid var(--line);white-space:nowrap}
th{color:var(--muted);font-weight:600;font-size:12.5px}
tbody tr:hover{background:var(--panel2)}
tbody tr:last-child td{border-bottom:none}
.tscroll{overflow-x:auto}

/* ── Bits ── */
.badge{display:inline-block;padding:2px 9px;border-radius:20px;font-size:11.5px;border:1px solid}
.b-ok{color:var(--ok);border-color:rgba(52,211,153,.4);background:rgba(52,211,153,.1)}
.b-bad{color:var(--bad);border-color:rgba(248,113,113,.4);background:rgba(248,113,113,.1)}
.b-warn{color:var(--warn);border-color:rgba(251,191,36,.4);background:rgba(251,191,36,.1)}
.b-mute{color:var(--muted);border-color:var(--line);background:var(--panel2)}
.bar{height:7px;border-radius:5px;background:var(--panel2);overflow:hidden}
.bar>i{display:block;height:100%;background:linear-gradient(90deg,var(--accent),var(--accent2))}
.bar>i.q-ok{background:linear-gradient(90deg,#34d399,#10b981)}
.bar>i.q-warn{background:linear-gradient(90deg,#fbbf24,#f59e0b)}
.bar>i.q-bad{background:linear-gradient(90deg,#f87171,#dc2626)}

/* ── Forms ── */
label{display:block;font-size:13px;color:var(--muted);margin:12px 0 6px}
input,textarea,select{width:100%;padding:11px 13px;border-radius:10px;border:1px solid var(--line);
  background:#0e1428;color:var(--text);font-family:inherit;font-size:14px;direction:rtl}
input:focus,textarea:focus,select:focus{outline:none;border-color:var(--accent);box-shadow:0 0 0 3px rgba(91,140,255,.16)}
input.code{letter-spacing:9px;text-align:center;font-size:23px;direction:ltr}
textarea{min-height:120px;resize:vertical;line-height:1.8}
button,.btn{padding:10px 17px;border-radius:10px;border:none;cursor:pointer;font-family:inherit;
  font-size:14px;font-weight:600;background:linear-gradient(135deg,var(--accent),var(--accent2));color:#fff;transition:.15s}
button:hover,.btn:hover{filter:brightness(1.12);text-decoration:none}
button:disabled{opacity:.55;cursor:not-allowed}
button.ghost,.btn.ghost{background:var(--panel2);color:var(--text);border:1px solid var(--line)}
button.danger,.btn.danger{background:linear-gradient(135deg,#ef4444,#b91c1c)}
button.wide{width:100%;margin-top:18px;padding:12px}
.row{display:flex;gap:9px;flex-wrap:wrap;align-items:center}
.inline-form{display:inline}

/* ── Messages ── */
.msg{padding:11px 14px;border-radius:10px;font-size:13.5px;margin-bottom:14px}
.m-err{background:rgba(248,113,113,.12);border:1px solid rgba(248,113,113,.4);color:#fca5a5}
.m-ok{background:rgba(52,211,153,.12);border:1px solid rgba(52,211,153,.4);color:#6ee7b7}
.m-info{background:rgba(91,140,255,.1);border:1px solid rgba(91,140,255,.35);color:#a5c2ff}
.hint{color:var(--muted);font-size:12.5px;margin-top:8px;line-height:1.8}

/* ── Chart ── */
.chart{display:flex;align-items:flex-end;gap:5px;height:150px;padding-top:10px}
.chart .col{flex:1;display:flex;flex-direction:column;justify-content:flex-end;align-items:center;gap:5px;height:100%}
.chart .fill{width:100%;border-radius:5px 5px 0 0;background:linear-gradient(180deg,var(--accent),var(--accent2));min-height:3px;transition:.2s}
.chart .col:hover .fill{filter:brightness(1.3)}
.chart .cap{font-size:10px;color:var(--muted);writing-mode:vertical-rl;transform:rotate(180deg)}

.mono{font-family:ui-monospace,'SF Mono',Menlo,monospace;font-size:12.5px;direction:ltr;display:inline-block}
.muted{color:var(--muted)}
.right{text-align:left}
.sep{height:1px;background:var(--line);margin:16px 0}
.pager{display:flex;gap:6px;justify-content:center;margin-top:16px;flex-wrap:wrap}
.pager a,.pager span{padding:6px 12px;border-radius:8px;background:var(--panel2);font-size:13px;border:1px solid var(--line)}
.pager span.cur{background:var(--accent);color:#fff;border-color:var(--accent)}
footer{text-align:center;color:var(--muted);font-size:12px;margin-top:34px}
@media(max-width:640px){.wrap{padding:14px 12px 40px}.stat .value{font-size:22px}nav{width:100%;margin:0}}
`;

export function layout(
  title: string,
  active: string,
  body: string,
  options: { refreshSeconds?: number } = {},
): string {
  const tabs: [string, string, string][] = [
    ['/', 'dash', '📊 داشبورد'],
    ['/monitor', 'monitor', '📡 مانیتور زنده'],
    ['/users', 'users', '👥 کاربران'],
    ['/tools', 'tools', '🧰 ابزارها'],
    ['/broadcast', 'broadcast', '📣 پیام همگانی'],
    ['/bot', 'bot', '🤖 تنظیمات ربات'],
    ['/audit', 'audit', '📜 رویدادها'],
  ];
  const nav = tabs
    .map(([href, id, label]) => `<a href="${href}"${id === active ? ' class="on"' : ''}>${label}</a>`)
    .join('');

  return `<!doctype html>
<html lang="fa" dir="rtl"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow">
${options.refreshSeconds ? `<meta http-equiv="refresh" content="${options.refreshSeconds}">` : ''}
<title>${esc(title)} — پنل مدیریت</title>
<style>${STYLE}</style>
</head><body>
<header><div class="hbar">
  <div class="brand"><span class="dot"></span> DevNet Toolbox</div>
  <nav>${nav}</nav>
  <form method="post" action="/logout" class="inline-form"><button class="ghost" type="submit">خروج</button></form>
</div></header>
<div class="wrap">${body}</div>
<footer>پنل مدیریت DevNet Toolbox · ساخته‌شده روی Cloudflare Workers</footer>
</body></html>`;
}

export function loginPage(step: 'password' | 'code', error?: string, challenge?: string): string {
  const inner =
    step === 'password'
      ? `<form method="post" action="/login">
      <label for="pw">رمز عبور</label>
      <input id="pw" name="password" type="password" required autofocus autocomplete="current-password">
      <button class="wide" type="submit">ورود</button>
    </form>
    <p class="hint">پس از تأیید رمز، یک کد ۶ رقمی به تلگرام شما ارسال می‌شود.</p>`
      : `<form method="post" action="/login/verify">
      <input type="hidden" name="challenge" value="${esc(challenge)}">
      <label for="code">کد ۶ رقمی ارسال‌شده به تلگرام</label>
      <input id="code" name="code" class="code" inputmode="numeric" pattern="[0-9]{6}" maxlength="6" required autofocus autocomplete="one-time-code">
      <button class="wide" type="submit">تأیید و ورود</button>
    </form>
    <p class="hint">کد تا ۵ دقیقه اعتبار دارد. <a href="/login">شروع دوباره</a></p>`;

  return `<!doctype html>
<html lang="fa" dir="rtl"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<title>ورود — پنل مدیریت</title>
<style>${STYLE}</style>
</head><body>
<div class="login-shell"><div class="login-card">
  <div class="logo">🛠️</div>
  <h1>پنل مدیریت</h1>
  <p class="sub">DevNet Toolbox</p>
  ${error ? `<div class="msg m-err">${esc(error)}</div>` : ''}
  ${step === 'code' ? '<div class="msg m-info">کد ورود به تلگرام شما ارسال شد.</div>' : ''}
  ${inner}
</div></div>
</body></html>`;
}

// ─── Dashboard ───────────────────────────────────────────────────────────

function statCard(label: string, value: string, foot = '', accent = false): string {
  return `<div class="card stat${accent ? ' accent' : ''}">
    <div class="label">${label}</div><div class="value">${value}</div>
    ${foot ? `<div class="foot">${foot}</div>` : ''}</div>`;
}

export function dashboardPage(
  stats: OverviewStats,
  series: DailyPoint[],
  tools: ToolRow[],
  recent: AuditRow[],
  botInfo: { username: string; webhook: string; pending: number; lastError?: string } | null,
): string {
  const peak = Math.max(...series.map((point) => point.uses), 1);
  const chart = series
    .map(
      (point) =>
        `<div class="col" title="${esc(point.day)}: ${faNum(point.uses)}">
          <div class="fill" style="height:${Math.max((point.uses / peak) * 100, 2)}%"></div>
          <div class="cap">${esc(point.day.slice(5))}</div></div>`,
    )
    .join('');

  const maxUses = Math.max(...tools.map((tool) => tool.uses), 1);
  const toolRows = tools
    .slice(0, 10)
    .map(
      (tool, index) => `<tr>
        <td class="muted">${faNum(index + 1)}</td>
        <td><span class="mono">${esc(tool.tool_id)}</span></td>
        <td>${faNum(tool.uses)}</td>
        <td style="width:34%"><div class="bar"><i style="width:${(tool.uses / maxUses) * 100}%"></i></div></td>
      </tr>`,
    )
    .join('');

  const auditRows = recent
    .slice(0, 8)
    .map(
      (row) =>
        `<tr><td>${esc(row.action)}</td><td class="mono">${esc(row.target)}</td>
         <td class="muted">${esc(row.detail)}</td><td class="muted">${relTime(row.created_at)}</td></tr>`,
    )
    .join('');

  const webhookBadge = botInfo?.webhook
    ? `<span class="badge b-ok">فعال</span>`
    : `<span class="badge b-bad">تنظیم‌نشده</span>`;

  return layout(
    'داشبورد',
    'dash',
    `<div class="grid g4" style="margin-bottom:14px">
      ${statCard('کاربران کل', faNum(stats.users), `${faNum(stats.newUsersToday)} کاربر جدید امروز`, true)}
      ${statCard('فعال امروز', faNum(stats.activeToday), `${faNum(stats.activeWeek)} در ۷ روز اخیر`)}
      ${statCard('اجرای ابزار', faNum(stats.toolRuns), `${faNum(stats.runsToday)} اجرا امروز`)}
      ${statCard('کل درخواست‌ها', faNum(stats.requests), `${faNum(stats.distinctTools)} ابزار استفاده‌شده`)}
    </div>
    <div class="grid g4" style="margin-bottom:14px">
      ${statCard('علاقه‌مندی‌ها', faNum(stats.favorites))}
      ${statCard('اسکن امنیتی', faNum(stats.scans), `${faNum(stats.highRiskScans)} پرخطر`)}
      ${statCard('کاربران مسدود', faNum(stats.banned))}
      ${statCard('وضعیت Webhook', webhookBadge, botInfo ? `${faNum(botInfo.pending)} آپدیت در صف` : 'در دسترس نیست')}
    </div>

    ${
      botInfo?.lastError
        ? `<div class="msg m-err">آخرین خطای Webhook: ${esc(botInfo.lastError)}</div>`
        : ''
    }

    <div class="card" style="margin-bottom:14px">
      <h2>📈 فعالیت ۱۴ روز اخیر</h2>
      <div class="chart">${chart}</div>
    </div>

    <div class="grid g2">
      <div class="card"><h2>🔥 پرکاربردترین ابزارها</h2>
        <div class="tscroll"><table><thead><tr><th>#</th><th>ابزار</th><th>اجرا</th><th></th></tr></thead>
        <tbody>${toolRows || '<tr><td colspan="4" class="muted">داده‌ای نیست</td></tr>'}</tbody></table></div>
        <div class="sep"></div><a href="/tools">مشاهده همه ابزارها ←</a>
      </div>
      <div class="card"><h2>📜 آخرین رویدادهای مدیریتی</h2>
        <div class="tscroll"><table><thead><tr><th>عملیات</th><th>هدف</th><th>توضیح</th><th>زمان</th></tr></thead>
        <tbody>${auditRows || '<tr><td colspan="4" class="muted">رویدادی ثبت نشده</td></tr>'}</tbody></table></div>
        <div class="sep"></div><a href="/audit">مشاهده همه رویدادها ←</a>
      </div>
    </div>`,
  );
}

// ─── Users ───────────────────────────────────────────────────────────────

export function usersPage(
  data: { rows: UserRow[]; total: number; page: number; pages: number },
  query: { search: string; sort: string; banned: boolean },
  flash?: { kind: 'ok' | 'err'; text: string },
): string {
  const rows = data.rows
    .map((user) => {
      const name = [user.first_name, user.last_name].filter(Boolean).join(' ') || '—';
      const handle = user.username ? `@${user.username}` : '';
      return `<tr>
      <td><a href="/users/${user.user_id}"><span class="mono">${user.user_id}</span></a></td>
      <td>${esc(name)} ${handle ? `<span class="muted mono">${esc(handle)}</span>` : ''}</td>
      <td><span class="badge b-mute">${user.lang === 'fa' ? 'فارسی' : 'English'}</span></td>
      <td>${faNum(user.tool_runs)}</td>
      <td>${faNum(user.requests)}</td>
      <td class="muted">${relTime(user.last_seen)}</td>
      <td>${user.banned ? '<span class="badge b-bad">مسدود</span>' : '<span class="badge b-ok">فعال</span>'}</td>
      <td class="right">
        <form method="post" action="/users/${user.user_id}/${user.banned ? 'unban' : 'ban'}" class="inline-form">
          <button class="ghost" type="submit">${user.banned ? 'رفع مسدودی' : 'مسدود کردن'}</button>
        </form>
      </td></tr>`;
    })
    .join('');

  const link = (page: number): string =>
    `/users?page=${page}&search=${encodeURIComponent(query.search)}&sort=${encodeURIComponent(query.sort)}${query.banned ? '&banned=1' : ''}`;

  const pager: string[] = [];
  const from = Math.max(1, data.page - 2);
  const to = Math.min(data.pages, from + 4);
  if (data.page > 1) pager.push(`<a href="${link(data.page - 1)}">قبلی</a>`);
  for (let index = from; index <= to; index += 1) {
    pager.push(
      index === data.page ? `<span class="cur">${faNum(index)}</span>` : `<a href="${link(index)}">${faNum(index)}</a>`,
    );
  }
  if (data.page < data.pages) pager.push(`<a href="${link(data.page + 1)}">بعدی</a>`);

  const sel = (value: string, label: string): string =>
    `<option value="${value}"${query.sort === value ? ' selected' : ''}>${label}</option>`;

  return layout(
    'کاربران',
    'users',
    `${flash ? `<div class="msg m-${flash.kind === 'ok' ? 'ok' : 'err'}">${esc(flash.text)}</div>` : ''}
    <div class="card" style="margin-bottom:14px">
      <form method="get" action="/users" class="row">
        <input name="search" placeholder="جستجو: نام، یوزرنیم یا شناسه عددی" value="${esc(query.search)}" style="flex:2;min-width:220px">
        <select name="sort" style="flex:1;min-width:150px">
          ${sel('last_seen', 'آخرین فعالیت')}${sel('tool_runs', 'بیشترین استفاده')}${sel('first_seen', 'تاریخ عضویت')}
        </select>
        <label class="row" style="margin:0;gap:6px;color:var(--text);font-size:13px">
          <input type="checkbox" name="banned" value="1"${query.banned ? ' checked' : ''} style="width:auto"> فقط مسدودها
        </label>
        <button type="submit">اعمال</button>
      </form>
    </div>
    <div class="card">
      <h2>👥 ${faNum(data.total)} کاربر</h2>
      <div class="tscroll"><table>
        <thead><tr><th>شناسه</th><th>نام</th><th>زبان</th><th>ابزار</th><th>درخواست</th><th>آخرین فعالیت</th><th>وضعیت</th><th></th></tr></thead>
        <tbody>${rows || '<tr><td colspan="8" class="muted">کاربری یافت نشد</td></tr>'}</tbody>
      </table></div>
      ${pager.length > 1 ? `<div class="pager">${pager.join('')}</div>` : ''}
    </div>`,
  );
}

export function userDetailPage(
  detail: { user: UserRow; tools: ToolRow[]; favorites: string[]; scans: number },
  flash?: { kind: 'ok' | 'err'; text: string },
): string {
  const { user } = detail;
  const name = [user.first_name, user.last_name].filter(Boolean).join(' ') || '—';
  const toolRows = detail.tools
    .map(
      (tool) =>
        `<tr><td class="mono">${esc(tool.tool_id)}</td><td>${faNum(tool.uses)}</td><td class="muted">${relTime(tool.last_used)}</td></tr>`,
    )
    .join('');
  const favorites = detail.favorites.map((id) => `<span class="badge b-mute mono">${esc(id)}</span>`).join(' ');

  return layout(
    `کاربر ${user.user_id}`,
    'users',
    `${flash ? `<div class="msg m-${flash.kind === 'ok' ? 'ok' : 'err'}">${esc(flash.text)}</div>` : ''}
    <div class="row" style="margin-bottom:14px"><a href="/users" class="btn ghost">→ بازگشت به کاربران</a></div>

    <div class="grid g4" style="margin-bottom:14px">
      ${statCard('نام', esc(name), user.username ? `@${esc(user.username)}` : '', true)}
      ${statCard('اجرای ابزار', faNum(user.tool_runs), `${faNum(user.requests)} درخواست`)}
      ${statCard('عضویت', relTime(user.first_seen), faDate(user.first_seen))}
      ${statCard('آخرین فعالیت', relTime(user.last_seen), faDate(user.last_seen))}
    </div>

    <div class="grid g2">
      <div class="card"><h2>🧰 ابزارهای پرکاربرد این کاربر</h2>
        <div class="tscroll"><table><thead><tr><th>ابزار</th><th>دفعات</th><th>آخرین بار</th></tr></thead>
        <tbody>${toolRows || '<tr><td colspan="3" class="muted">استفاده‌ای ثبت نشده</td></tr>'}</tbody></table></div>
        <div class="sep"></div>
        <div class="muted" style="font-size:13px">⭐ علاقه‌مندی‌ها (${faNum(detail.favorites.length)})</div>
        <div style="margin-top:8px">${favorites || '<span class="muted">—</span>'}</div>
        <div class="sep"></div>
        <div class="muted" style="font-size:13px">🛡️ اسکن امنیتی: ${faNum(detail.scans)}</div>
      </div>

      <div class="card"><h2>⚙️ عملیات</h2>
        <form method="post" action="/users/${user.user_id}/message">
          <label for="text">ارسال پیام مستقیم</label>
          <textarea id="text" name="text" maxlength="3000" placeholder="متن پیام… (HTML مجاز است)" required></textarea>
          <button type="submit" style="margin-top:10px">ارسال پیام</button>
        </form>
        <div class="sep"></div>
        ${
          user.banned
            ? `<form method="post" action="/users/${user.user_id}/unban">
                 <p class="hint" style="margin-bottom:10px">این کاربر در حال حاضر مسدود است و ربات به او پاسخ نمی‌دهد.</p>
                 <button type="submit">رفع مسدودی</button></form>`
            : `<form method="post" action="/users/${user.user_id}/ban">
                 <label for="reason">دلیل مسدودسازی (اختیاری)</label>
                 <input id="reason" name="reason" maxlength="200" placeholder="مثلاً: ارسال هرزنامه">
                 <button class="danger" type="submit" style="margin-top:10px">مسدود کردن کاربر</button></form>`
        }
        <div class="sep"></div>
        <form method="post" action="/users/${user.user_id}/purge" onsubmit="return confirm('همه داده‌های این کاربر برای همیشه حذف می‌شود. مطمئن هستید؟')">
          <p class="hint" style="margin-bottom:10px">حذف کامل داده‌ها: پروفایل، آمار استفاده، علاقه‌مندی‌ها و تاریخچه اسکن. این عمل بازگشت‌پذیر نیست.</p>
          <button class="danger" type="submit">حذف کامل داده‌های کاربر</button>
        </form>
      </div>
    </div>`,
  );
}

// ─── Tools ───────────────────────────────────────────────────────────────

export function toolsPage(tools: ToolRow[], totalRuns: number): string {
  const maxUses = Math.max(...tools.map((tool) => tool.uses), 1);
  const rows = tools
    .map(
      (tool, index) => `<tr>
      <td class="muted">${faNum(index + 1)}</td>
      <td class="mono">${esc(tool.tool_id)}</td>
      <td>${faNum(tool.uses)}</td>
      <td>${faNum(tool.users)}</td>
      <td class="muted">${relTime(tool.last_used)}</td>
      <td style="width:26%"><div class="bar"><i style="width:${(tool.uses / maxUses) * 100}%"></i></div></td>
    </tr>`,
    )
    .join('');

  return layout(
    'ابزارها',
    'tools',
    `<div class="card">
      <h2>🧰 آمار ابزارها — ${faNum(totalRuns)} اجرا</h2>
      <div class="tscroll"><table>
        <thead><tr><th>#</th><th>شناسه ابزار</th><th>اجرا</th><th>کاربر یکتا</th><th>آخرین استفاده</th><th>سهم</th></tr></thead>
        <tbody>${rows || '<tr><td colspan="6" class="muted">داده‌ای نیست</td></tr>'}</tbody>
      </table></div>
      <p class="hint">فقط ابزارهایی فهرست می‌شوند که دست‌کم یک بار اجرا شده‌اند.</p>
    </div>`,
  );
}

// ─── Broadcast ───────────────────────────────────────────────────────────

export function broadcastPage(
  history: BroadcastRow[],
  counts: { all: number; active7: number; active30: number },
  flash?: { kind: 'ok' | 'err'; text: string },
): string {
  const rows = history
    .map((item) => {
      const badge =
        item.status === 'done'
          ? '<span class="badge b-ok">پایان‌یافته</span>'
          : item.status === 'running'
            ? '<span class="badge b-warn">در حال ارسال</span>'
            : '<span class="badge b-bad">ناموفق</span>';
      const preview = item.body.length > 60 ? `${item.body.slice(0, 60)}…` : item.body;
      return `<tr><td class="muted">${relTime(item.created_at)}</td>
        <td><a href="/broadcast/${esc(item.id)}">${esc(preview)}</a></td>
        <td><span class="badge b-mute">${esc(item.audience)}</span></td>
        <td>${faNum(item.sent)} / ${faNum(item.total)}</td>
        <td>${item.failed > 0 ? `<span class="badge b-bad">${faNum(item.failed)}</span>` : '۰'}</td>
        <td>${badge}</td>
        <td><a class="btn ghost" href="/broadcast/${esc(item.id)}">گیرندگان</a></td></tr>`;
    })
    .join('');

  return layout(
    'پیام همگانی',
    'broadcast',
    `${flash ? `<div class="msg m-${flash.kind === 'ok' ? 'ok' : 'err'}">${esc(flash.text)}</div>` : ''}
    <div class="grid g2">
      <div class="card"><h2>📣 ارسال پیام همگانی</h2>
        <form method="post" action="/broadcast" onsubmit="return confirm('پیام برای همه مخاطبان انتخاب‌شده ارسال شود؟')">
          <label for="audience">مخاطبان</label>
          <select id="audience" name="audience">
            <option value="all">همه کاربران (${faNum(counts.all)})</option>
            <option value="active7">فعال در ۷ روز اخیر (${faNum(counts.active7)})</option>
            <option value="active30">فعال در ۳۰ روز اخیر (${faNum(counts.active30)})</option>
            <option value="fa">فقط فارسی‌زبان‌ها</option>
            <option value="en">فقط انگلیسی‌زبان‌ها</option>
          </select>
          <label for="body">متن پیام</label>
          <textarea id="body" name="body" maxlength="3500" required placeholder="متن پیام… تگ‌های &lt;b&gt; &lt;i&gt; &lt;code&gt; &lt;a&gt; پشتیبانی می‌شوند."></textarea>
          <button class="wide" type="submit">ارسال پیام همگانی</button>
        </form>
        <p class="hint">
          کاربران مسدودشده هرگز پیام دریافت نمی‌کنند. ارسال با رعایت محدودیت نرخ تلگرام (حدود ۲۵ پیام در ثانیه)
          و در پس‌زمینه انجام می‌شود؛ می‌توانید صفحه را ببندید. سقف هر ارسال ۵۰۰۰ گیرنده است.
        </p>
      </div>
      <div class="card"><h2>🗂️ تاریخچه ارسال‌ها</h2>
        <div class="tscroll"><table>
          <thead><tr><th>زمان</th><th>متن</th><th>مخاطب</th><th>ارسال‌شده</th><th>ناموفق</th><th>وضعیت</th><th></th></tr></thead>
          <tbody>${rows || '<tr><td colspan="7" class="muted">هنوز پیامی ارسال نشده</td></tr>'}</tbody>
        </table></div>
      </div>
    </div>`,
  );
}

// ─── Bot settings ────────────────────────────────────────────────────────

export function botPage(
  info: {
    username: string;
    id: number;
    webhook: string;
    pending: number;
    lastError?: string;
    maxConnections?: number;
  } | null,
  descriptions: { fa: string; faShort: string; en: string; enShort: string },
  workerUrl: string,
  flash?: { kind: 'ok' | 'err'; text: string },
): string {
  return layout(
    'تنظیمات ربات',
    'bot',
    `${flash ? `<div class="msg m-${flash.kind === 'ok' ? 'ok' : 'err'}">${esc(flash.text)}</div>` : ''}
    <div class="grid g2">
      <div class="card"><h2>🤖 وضعیت ربات</h2>
        ${
          info
            ? `<table>
                <tr><th>یوزرنیم</th><td class="mono">@${esc(info.username)}</td></tr>
                <tr><th>شناسه</th><td class="mono">${info.id}</td></tr>
                <tr><th>Webhook</th><td class="mono" style="white-space:normal;word-break:break-all">${esc(info.webhook) || '—'}</td></tr>
                <tr><th>آپدیت در صف</th><td>${faNum(info.pending)}</td></tr>
                <tr><th>حداکثر اتصال</th><td>${faNum(info.maxConnections ?? 0)}</td></tr>
                <tr><th>آخرین خطا</th><td>${info.lastError ? `<span class="badge b-bad">${esc(info.lastError)}</span>` : '<span class="badge b-ok">بدون خطا</span>'}</td></tr>
              </table>`
            : '<div class="msg m-err">ارتباط با Telegram API برقرار نشد.</div>'
        }
        <div class="sep"></div>
        <form method="post" action="/bot/webhook">
          <label for="url">آدرس Webhook</label>
          <input id="url" name="url" value="${esc(workerUrl)}/webhook" dir="ltr" required>
          <label for="secret">Secret Token فعلی ربات</label>
          <input id="secret" name="secret" type="password" required placeholder="مقدار WEBHOOK_SECRET">
          <button type="submit" style="margin-top:12px">به‌روزرسانی Webhook</button>
          <p class="hint">این مقدار ذخیره نمی‌شود؛ فقط برای همین یک درخواست به تلگرام فرستاده می‌شود.</p>
        </form>
        <div class="sep"></div>
        <form method="post" action="/bot/commands">
          <button class="ghost" type="submit">همگام‌سازی دستورات (/commands)</button>
          <p class="hint">فهرست دستورات ربات را دوباره روی تلگرام ثبت می‌کند.</p>
        </form>
      </div>

      <div class="card"><h2>📝 معرفی و توضیحات ربات</h2>
        <form method="post" action="/bot/profile">
          <label for="faShort">توضیح کوتاه — فارسی (زیر نام ربات، حداکثر ۱۲۰ نویسه)</label>
          <textarea id="faShort" name="faShort" maxlength="120" style="min-height:64px">${esc(descriptions.faShort)}</textarea>
          <label for="fa">توضیح کامل — فارسی (صفحه شروع، حداکثر ۵۱۲ نویسه)</label>
          <textarea id="fa" name="fa" maxlength="512">${esc(descriptions.fa)}</textarea>
          <div class="sep"></div>
          <label for="enShort">Short description — English</label>
          <textarea id="enShort" name="enShort" maxlength="120" dir="ltr" style="min-height:64px">${esc(descriptions.enShort)}</textarea>
          <label for="en">Full description — English</label>
          <textarea id="en" name="en" maxlength="512" dir="ltr">${esc(descriptions.en)}</textarea>
          <button class="wide" type="submit">ذخیره توضیحات</button>
        </form>
        <p class="hint">
          توضیح کوتاه در پروفایل ربات و نتایج جستجو دیده می‌شود؛ توضیح کامل پیش از فشردن Start
          به کاربر نمایش داده می‌شود. تغییرات ممکن است تا چند دقیقه در تلگرام کش شوند.
        </p>
      </div>
    </div>`,
  );
}

// ─── Audit ───────────────────────────────────────────────────────────────

export function auditPage(rows: AuditRow[]): string {
  const body = rows
    .map(
      (row) => `<tr>
      <td class="muted">${faNum(row.id)}</td>
      <td><span class="badge b-mute">${esc(row.action)}</span></td>
      <td class="mono">${esc(row.target) || '—'}</td>
      <td style="white-space:normal">${esc(row.detail) || '—'}</td>
      <td class="mono">${esc(row.ip) || '—'}</td>
      <td class="muted">${faDate(row.created_at)}</td>
    </tr>`,
    )
    .join('');

  return layout(
    'رویدادها',
    'audit',
    `<div class="card">
      <h2>📜 رویدادهای مدیریتی</h2>
      <div class="tscroll"><table>
        <thead><tr><th>#</th><th>عملیات</th><th>هدف</th><th>توضیح</th><th>IP</th><th>زمان</th></tr></thead>
        <tbody>${body || '<tr><td colspan="6" class="muted">رویدادی ثبت نشده</td></tr>'}</tbody>
      </table></div>
      <p class="hint">هر عملیات تغییردهنده در پنل اینجا ثبت می‌شود. این فهرست فقط افزودنی است و از پنل قابل حذف نیست.</p>
    </div>`,
  );
}

export function errorPage(code: number, message: string): string {
  return `<!doctype html><html lang="fa" dir="rtl"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>${code}</title><style>${STYLE}</style></head>
<body><div class="login-shell"><div class="login-card" style="text-align:center">
<div class="logo">⚠️</div><h1>${code}</h1><p class="sub">${esc(message)}</p>
<a class="btn" href="/">بازگشت به داشبورد</a></div></div></body></html>`;
}

// ─── Live monitor ────────────────────────────────────────────────────────

/** Human label + colour for each activity kind. */
const KIND_META: Record<string, { label: string; cls: string }> = {
  command: { label: 'دستور', cls: 'b-mute' },
  tool: { label: 'ابزار', cls: 'b-ok' },
  callback: { label: 'ناوبری', cls: 'b-mute' },
  input: { label: 'ورودی', cls: 'b-warn' },
  media: { label: 'فایل', cls: 'b-warn' },
};

function userCell(id: number, first?: string | null, username?: string | null): string {
  const name = (first ?? '').trim() || `کاربر ${faNum(id)}`;
  const handle = username ? ` <span class="muted mono">@${esc(username)}</span>` : '';
  return `<a href="/users/${id}">${esc(name)}</a>${handle}`;
}

/** A usage bar with its numeric readout. */
function quotaBar(label: string, used: number, limit: number, note: string): string {
  const pct = limit > 0 ? Math.min(100, (used / limit) * 100) : 0;
  const cls = pct >= 90 ? 'bad' : pct >= 70 ? 'warn' : 'ok';
  return `<div style="margin-bottom:14px">
    <div class="row" style="justify-content:space-between;margin-bottom:5px">
      <span style="font-size:13px">${esc(label)}</span>
      <span class="muted" style="font-size:12.5px">${faNum(used)} از ${faNum(limit)} · ${faNum(Math.round(pct))}٪</span>
    </div>
    <div class="bar"><i class="q-${cls}" style="width:${pct.toFixed(1)}%"></i></div>
    <div class="hint" style="margin-top:4px">${esc(note)}</div>
  </div>`;
}

export function monitorPage(
  events: ActivityRow[],
  pulse: { lastMin: number; last5Min: number; lastHour: number; errorsHour: number; activeNow: number },
  usage: CloudflareUsage,
  options: { kind: string; refresh: number; retentionDays: number },
): string {
  const rows = events
    .map((event) => {
      const meta = KIND_META[event.kind] ?? { label: event.kind, cls: 'b-mute' };
      const status =
        event.ok === 0 ? '<span class="badge b-bad">ناموفق</span>' : '<span class="badge b-ok">موفق</span>';
      const timing = event.ms > 0 ? `<span class="muted">${faNum(event.ms)}ms</span>` : '<span class="muted">—</span>';
      return `<tr>
        <td class="muted" title="${esc(faDate(event.created_at))}">${relTime(event.created_at)}</td>
        <td>${userCell(event.user_id, event.first_name, event.username)}</td>
        <td><span class="badge ${meta.cls}">${esc(meta.label)}</span></td>
        <td class="mono">${esc(event.detail || '—')}</td>
        <td>${status}</td>
        <td>${timing}</td>
      </tr>`;
    })
    .join('');

  const filters = [
    ['', 'همه'],
    ['tool', 'ابزارها'],
    ['command', 'دستورها'],
    ['callback', 'ناوبری'],
  ]
    .map(
      ([value, label]) =>
        `<a class="btn ${options.kind === value ? '' : 'ghost'}" href="/monitor${value ? `?kind=${value}` : ''}">${esc(String(label))}</a>`,
    )
    .join(' ');

  const scriptRows = usage.scripts
    .map(
      (script) =>
        `<tr><td class="mono">${esc(script.name)}</td><td>${faNum(script.requests)}</td>
         <td>${script.errors > 0 ? `<span class="badge b-bad">${faNum(script.errors)}</span>` : '۰'}</td></tr>`,
    )
    .join('');

  const usageCard = usage.available
    ? `${quotaBar('درخواست‌های Worker (امروز)', usage.workers.requests, usage.limits.workerRequests, 'سقف روزانه پلن رایگان')}
       ${quotaBar('خواندن از D1 (امروز)', usage.d1.readQueries, usage.limits.d1Reads, 'سقف روزانه پلن رایگان')}
       ${quotaBar('نوشتن در D1 (امروز)', usage.d1.writeQueries, usage.limits.d1Writes, 'سقف روزانه پلن رایگان')}
       <div class="sep"></div>
       <div class="tscroll"><table>
         <thead><tr><th>Worker</th><th>درخواست</th><th>خطا</th></tr></thead>
         <tbody>${scriptRows || '<tr><td colspan="3" class="muted">امروز درخواستی ثبت نشده</td></tr>'}</tbody>
       </table></div>
       <p class="hint">Subrequestهای امروز: ${faNum(usage.workers.subrequests)} · ارقام از Cloudflare Analytics و بر مبنای روز UTC است.</p>`
    : `<div class="msg m-info">${esc(usage.reason ?? 'اطلاعات مصرف در دسترس نیست.')}</div>
       <p class="hint">
         عمداً عدد صفر نشان داده نمی‌شود: «نتوانستیم بپرسیم» با «مصرفی نبوده» یکی نیست.
         برای فعال‌سازی، یک API Token با دسترسی <span class="mono">Account Analytics: Read</span> بسازید و
         آن را به‌صورت Secret با نام <span class="mono">CF_ANALYTICS_TOKEN</span> به Worker پنل اضافه کنید.
       </p>`;

  return layout(
    'مانیتور زنده',
    'monitor',
    `<div class="grid g4" style="margin-bottom:14px">
      ${statCard('رویداد در دقیقهٔ اخیر', faNum(pulse.lastMin), 'ضربان لحظه‌ای', true)}
      ${statCard('کاربر فعال (۵ دقیقه)', faNum(pulse.activeNow), 'کاربران یکتا')}
      ${statCard('رویداد در ساعت اخیر', faNum(pulse.lastHour), `${faNum(pulse.last5Min)} در ۵ دقیقهٔ اخیر`)}
      ${statCard('خطا در ساعت اخیر', faNum(pulse.errorsHour), pulse.errorsHour > 0 ? 'نیازمند بررسی' : 'بدون خطا')}
    </div>

    <div class="card" style="margin-bottom:14px">
      <h2>☁️ مصرف Cloudflare</h2>
      ${usageCard}
    </div>

    <div class="card">
      <h2>📡 جریان زندهٔ فعالیت
        <span class="badge b-ok" style="margin-inline-start:auto">هر ${faNum(options.refresh)} ثانیه تازه می‌شود</span>
      </h2>
      <div class="row" style="margin-bottom:12px">${filters}</div>
      <div class="tscroll"><table>
        <thead><tr><th>زمان</th><th>کاربر</th><th>نوع</th><th>شناسه</th><th>نتیجه</th><th>مدت</th></tr></thead>
        <tbody>${rows || '<tr><td colspan="6" class="muted">هنوز رویدادی ثبت نشده است</td></tr>'}</tbody>
      </table></div>
      <p class="hint">
        🔒 فقط فراداده ثبت می‌شود: چه کسی، چه ابزاری، چه زمانی و با چه نتیجه‌ای.
        <b>متن پیام‌ها و ورودی ابزارها هرگز ذخیره نمی‌شود</b> — چون کاربران ممکن است توکن، رمز یا اطلاعات شخصی وارد کنند.
        رویدادها پس از ${faNum(options.retentionDays)} روز خودکار حذف می‌شوند.
      </p>
    </div>`,
    { refreshSeconds: options.refresh },
  );
}

// ─── Broadcast delivery detail ───────────────────────────────────────────

export function deliveryPage(
  broadcast: BroadcastRow,
  rows: DeliveryRow[],
  engaged: number,
  filter: string,
): string {
  const list = rows
    .map((row) => {
      const badge =
        row.status === 'sent'
          ? '<span class="badge b-ok">تحویل شد</span>'
          : '<span class="badge b-bad">ناموفق</span>';
      return `<tr>
        <td>${userCell(row.user_id, row.first_name, row.username)}</td>
        <td>${badge}</td>
        <td class="muted">${row.error ? esc(row.error) : '—'}</td>
        <td class="muted">${relTime(row.sent_at)}</td>
      </tr>`;
    })
    .join('');

  const tabs = [
    ['', 'همه'],
    ['sent', 'تحویل‌شده'],
    ['failed', 'ناموفق'],
  ]
    .map(
      ([value, label]) =>
        `<a class="btn ${filter === value ? '' : 'ghost'}" href="/broadcast/${esc(broadcast.id)}${value ? `?status=${value}` : ''}">${esc(String(label))}</a>`,
    )
    .join(' ');

  const pct = broadcast.total > 0 ? Math.round((broadcast.sent / broadcast.total) * 100) : 0;

  return layout(
    'جزئیات ارسال',
    'broadcast',
    `<div class="row" style="margin-bottom:14px">
       <a class="btn ghost" href="/broadcast">→ بازگشت به پیام همگانی</a>
     </div>

    <div class="grid g4" style="margin-bottom:14px">
      ${statCard('گیرندگان', faNum(broadcast.total), 'مخاطب انتخاب‌شده')}
      ${statCard('تحویل‌شده', faNum(broadcast.sent), `${faNum(pct)}٪ از کل`, true)}
      ${statCard('ناموفق', faNum(broadcast.failed), broadcast.failed > 0 ? 'ربات بلاک یا حساب حذف شده' : 'بدون خطا')}
      ${statCard('تعامل پس از ارسال', faNum(engaged), 'با ربات کار کردند')}
    </div>

    <div class="card" style="margin-bottom:14px">
      <h2>📄 متن ارسال‌شده</h2>
      <div style="background:var(--panel2);border:1px solid var(--line);border-radius:10px;padding:14px;white-space:pre-wrap;font-size:13.5px">${esc(broadcast.body)}</div>
      <p class="hint">ارسال ${relTime(broadcast.created_at)} · مخاطب: ${esc(broadcast.audience)}</p>
    </div>

    <div class="msg m-info">
      <b>دربارهٔ «سین»:</b> Telegram Bot API اصلاً امکان خواندن تیک دوم را به ربات‌ها نمی‌دهد؛
      هیچ متدی برای read receipt وجود ندارد. بنابراین این صفحه دو چیز <i>واقعی</i> را نشان می‌دهد:
      <b>تحویل</b> (تلگرام پیام را برای کاربر پذیرفت) و <b>تعامل پس از ارسال</b>
      (کاربر بعد از دریافت پیام با ربات کار کرده است). این دومی نشانهٔ قوی توجه است، اما «سین» نیست و ما آن را «سین» نمی‌نامیم.
    </div>

    <div class="card">
      <h2>👥 وضعیت تک‌تک گیرندگان</h2>
      <div class="row" style="margin-bottom:12px">${tabs}</div>
      <div class="tscroll"><table>
        <thead><tr><th>کاربر</th><th>وضعیت</th><th>توضیح خطا</th><th>زمان</th></tr></thead>
        <tbody>${list || '<tr><td colspan="4" class="muted">رکوردی برای این ارسال ثبت نشده است</td></tr>'}</tbody>
      </table></div>
    </div>`,
  );
}
