/**
 * View layer: escaping above all.
 *
 * Names and usernames are attacker-controlled (a Telegram user picks their own
 * first name), so any of them reaching the page unescaped would be stored XSS
 * in the operator's browser.
 */
import { describe, expect, it } from 'vitest';
import {
  auditPage,
  botPage,
  broadcastPage,
  dashboardPage,
  errorPage,
  esc,
  faNum,
  layout,
  loginPage,
  relTime,
  toolsPage,
  userDetailPage,
  usersPage,
} from '../../admin/src/views.js';
import type { OverviewStats, UserRow } from '../../admin/src/types.js';

const STATS: OverviewStats = {
  users: 250,
  newUsersToday: 5,
  activeToday: 30,
  activeWeek: 120,
  requests: 1500,
  toolRuns: 900,
  runsToday: 12,
  distinctTools: 42,
  banned: 2,
  favorites: 60,
  scans: 7,
  highRiskScans: 1,
};

const XSS = '<script>alert(1)</script>';

function userRow(overrides: Partial<UserRow> = {}): UserRow {
  return {
    user_id: 1,
    first_name: 'Ali',
    last_name: null,
    username: 'ali',
    lang: 'fa',
    first_seen: 1_700_000_000,
    last_seen: 1_700_000_000,
    requests: 10,
    tool_runs: 5,
    banned: 0,
    ...overrides,
  };
}

describe('esc', () => {
  it('neutralises every HTML metacharacter', () => {
    expect(esc(`<>&"'`)).toBe('&lt;&gt;&amp;&quot;&#39;');
  });

  it('renders null and undefined as empty', () => {
    expect(esc(null)).toBe('');
    expect(esc(undefined)).toBe('');
  });

  it('escapes the ampersand first, so entities are not double-broken', () => {
    expect(esc('&lt;')).toBe('&amp;lt;');
  });

  it('leaves Persian text untouched', () => {
    expect(esc('سلام دنیا')).toBe('سلام دنیا');
  });
});

describe('faNum', () => {
  it('uses Persian digits', () => {
    expect(faNum(123)).toBe('۱۲۳');
  });

  it('groups thousands', () => {
    expect(faNum(1_234_567)).toBe('۱٬۲۳۴٬۵۶۷'.replace(/٬/g, ','));
  });

  it('renders zero', () => {
    expect(faNum(0)).toBe('۰');
  });

  it('rounds fractions', () => {
    expect(faNum(9.7)).toBe('۱۰');
  });
});

describe('relTime', () => {
  const now = Math.floor(Date.now() / 1000);

  it('shows a dash for a missing timestamp', () => {
    expect(relTime(0)).toBe('—');
  });

  it('describes the last minute as just now', () => {
    expect(relTime(now - 10)).toBe('همین حالا');
  });

  it('describes minutes, hours and days', () => {
    expect(relTime(now - 300)).toContain('دقیقه');
    expect(relTime(now - 7200)).toContain('ساعت');
    expect(relTime(now - 3 * 86_400)).toContain('روز');
  });
});

describe('layout', () => {
  it('marks the document as Persian and RTL', () => {
    const page = layout('t', 'dash', '');
    expect(page).toContain('lang="fa"');
    expect(page).toContain('dir="rtl"');
  });

  it('asks search engines not to index the panel', () => {
    expect(layout('t', 'dash', '')).toContain('noindex');
  });

  it('highlights the active tab exactly once', () => {
    const page = layout('t', 'users', '');
    expect(page.match(/class="on"/g)).toHaveLength(1);
  });

  it('escapes the page title', () => {
    expect(layout(XSS, 'dash', '')).not.toContain('<script>alert');
  });

  it('carries no external resource references', () => {
    const page = layout('t', 'dash', '<p>x</p>');
    expect(page).not.toMatch(/src="https?:/);
    expect(page).not.toMatch(/<link[^>]+href="https?:/);
  });
});

describe('loginPage', () => {
  it('asks for a password first', () => {
    const page = loginPage('password');
    expect(page).toContain('type="password"');
    expect(page).not.toContain('name="code"');
  });

  it('asks for the code at the second step', () => {
    const page = loginPage('code', undefined, 'abc123');
    expect(page).toContain('name="code"');
    expect(page).toContain('value="abc123"');
  });

  it('escapes the challenge id', () => {
    expect(loginPage('code', undefined, '"><script>')).not.toContain('"><script>');
  });

  it('escapes an error message', () => {
    expect(loginPage('password', XSS)).not.toContain('<script>alert');
  });
});

describe('dashboardPage', () => {
  it('renders all headline figures', () => {
    const page = dashboardPage(STATS, [{ day: '2026-08-13', uses: 12 }], [], [], null);
    expect(page).toContain('۲۵۰');
    expect(page).toContain('۹۰۰');
  });

  it('copes with an empty chart series', () => {
    expect(() => dashboardPage(STATS, [], [], [], null)).not.toThrow();
  });

  it('escapes a tool id in the top list', () => {
    const page = dashboardPage(STATS, [], [{ tool_id: XSS, uses: 1, users: 1, last_used: 0 }], [], null);
    expect(page).not.toContain('<script>alert');
  });

  it('escapes an audit detail', () => {
    const page = dashboardPage(
      STATS,
      [],
      [],
      [{ id: 1, action: XSS, target: XSS, detail: XSS, ip: '1.1.1.1', created_at: 0 }],
      null,
    );
    expect(page).not.toContain('<script>alert');
  });

  it('shows the webhook as inactive when the bot is unreachable', () => {
    expect(dashboardPage(STATS, [], [], [], null)).toContain('تنظیم‌نشده');
  });

  it('surfaces the last webhook error, escaped', () => {
    const page = dashboardPage(STATS, [], [], [], {
      username: 'bot',
      webhook: 'https://x/webhook',
      pending: 3,
      lastError: XSS,
    });
    expect(page).toContain('آخرین خطای Webhook');
    expect(page).not.toContain('<script>alert');
  });
});

describe('usersPage', () => {
  const data = { rows: [userRow()], total: 1, page: 1, pages: 1 };
  const query = { search: '', sort: 'last_seen', banned: false };

  it('lists a user', () => {
    expect(usersPage(data, query)).toContain('Ali');
  });

  it('escapes a hostile display name', () => {
    const hostile = { ...data, rows: [userRow({ first_name: XSS, username: XSS })] };
    expect(usersPage(hostile, query)).not.toContain('<script>alert');
  });

  it('escapes the search term echoed back into the form', () => {
    const page = usersPage(data, { ...query, search: '"><script>alert(1)</script>' });
    expect(page).not.toContain('<script>alert');
  });

  it('offers ban for an active user and unban for a banned one', () => {
    expect(usersPage(data, query)).toContain('مسدود کردن');
    const banned = { ...data, rows: [userRow({ banned: 1 })] };
    expect(usersPage(banned, query)).toContain('رفع مسدودی');
  });

  it('says so when nobody matches', () => {
    expect(usersPage({ rows: [], total: 0, page: 1, pages: 1 }, query)).toContain('کاربری یافت نشد');
  });

  it('renders a pager only when there is more than one page', () => {
    expect(usersPage(data, query)).not.toContain('class="pager"');
    expect(usersPage({ ...data, pages: 5 }, query)).toContain('class="pager"');
  });

  it('preserves the search term in pager links', () => {
    const page = usersPage({ ...data, pages: 5 }, { ...query, search: 'ali' });
    expect(page).toContain('search=ali');
  });
});

describe('userDetailPage', () => {
  const detail = { user: userRow(), tools: [], favorites: [], scans: 0 };

  it('shows the profile and the danger zone', () => {
    const page = userDetailPage(detail);
    expect(page).toContain('Ali');
    expect(page).toContain('حذف کامل داده‌های کاربر');
  });

  it('guards the destructive action with a confirmation', () => {
    expect(userDetailPage(detail)).toContain('onsubmit="return confirm');
  });

  it('escapes hostile favourites and tool ids', () => {
    const hostile = { ...detail, favorites: [XSS], tools: [{ tool_id: XSS, uses: 1, users: 1, last_used: 0 }] };
    expect(userDetailPage(hostile)).not.toContain('<script>alert');
  });

  it('escapes a flash message', () => {
    expect(userDetailPage(detail, { kind: 'ok', text: XSS })).not.toContain('<script>alert');
  });
});

describe('toolsPage', () => {
  it('renders rows and totals', () => {
    const page = toolsPage([{ tool_id: 'json_format', uses: 10, users: 3, last_used: 0 }], 10);
    expect(page).toContain('json_format');
  });

  it('handles an empty table without dividing by zero', () => {
    expect(toolsPage([], 0)).toContain('داده‌ای نیست');
  });

  it('escapes a tool id', () => {
    expect(toolsPage([{ tool_id: XSS, uses: 1, users: 1, last_used: 0 }], 1)).not.toContain('<script>alert');
  });
});

describe('broadcastPage', () => {
  const counts = { all: 100, active7: 40, active30: 70 };

  it('offers every audience with its size', () => {
    const page = broadcastPage([], counts);
    expect(page).toContain('۱۰۰');
    expect(page).toContain('فعال در ۷ روز اخیر');
  });

  it('confirms before sending', () => {
    expect(broadcastPage([], counts)).toContain('onsubmit="return confirm');
  });

  it('escapes a previous message body in the history', () => {
    const page = broadcastPage(
      [
        {
          id: '1',
          body: XSS,
          audience: 'all',
          total: 1,
          sent: 1,
          failed: 0,
          status: 'done',
          created_at: 0,
          finished_at: 0,
        },
      ],
      counts,
    );
    expect(page).not.toContain('<script>alert');
  });

  it('shows an empty state', () => {
    expect(broadcastPage([], counts)).toContain('هنوز پیامی ارسال نشده');
  });
});

describe('botPage', () => {
  const descriptions = { fa: 'توضیح', faShort: 'کوتاه', en: 'desc', enShort: 'short' };

  it('reports an unreachable Telegram API', () => {
    expect(botPage(null, descriptions, 'https://x.dev')).toContain('ارتباط با Telegram API برقرار نشد');
  });

  it('shows bot status when available', () => {
    const page = botPage(
      { username: 'Toolsbotxbot', id: 1, webhook: 'https://x/webhook', pending: 0 },
      descriptions,
      'https://x.dev',
    );
    expect(page).toContain('Toolsbotxbot');
    expect(page).toContain('بدون خطا');
  });

  it('pre-fills the description fields', () => {
    expect(botPage(null, descriptions, 'https://x.dev')).toContain('توضیح');
  });

  it('escapes hostile description content', () => {
    const page = botPage(null, { ...descriptions, fa: XSS }, 'https://x.dev');
    expect(page).not.toContain('<script>alert');
  });

  it('keeps the secret field a password input that is never pre-filled', () => {
    const page = botPage(null, descriptions, 'https://x.dev');
    expect(page).toContain('name="secret" type="password"');
    expect(page).not.toMatch(/name="secret"[^>]*value=/);
  });
});

describe('auditPage', () => {
  it('renders entries', () => {
    const page = auditPage([
      { id: 1, action: 'user.ban', target: '5', detail: 'spam', ip: '1.1.1.1', created_at: 1_700_000_000 },
    ]);
    expect(page).toContain('user.ban');
  });

  it('shows an empty state', () => {
    expect(auditPage([])).toContain('رویدادی ثبت نشده');
  });

  it('escapes every field', () => {
    const page = auditPage([{ id: 1, action: XSS, target: XSS, detail: XSS, ip: XSS, created_at: 0 }]);
    expect(page).not.toContain('<script>alert');
  });
});

describe('errorPage', () => {
  it('shows the code and message', () => {
    expect(errorPage(404, 'یافت نشد')).toContain('404');
  });

  it('escapes the message', () => {
    expect(errorPage(500, XSS)).not.toContain('<script>alert');
  });
});
