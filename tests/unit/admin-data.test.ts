/**
 * Panel data layer: aggregation correctness and, above all, that no user input
 * is ever concatenated into SQL.
 */
import { describe, expect, it } from 'vitest';
import {
  audit,
  banUser,
  broadcastAudience,
  createBroadcast,
  dailySeries,
  finishBroadcast,
  listUsers,
  overview,
  purgeUser,
  recentAudit,
  topTools,
  unbanUser,
  userDetail,
} from '../../admin/src/data.js';
import { AdminD1, makeAdminEnv, seedDashboard } from '../helpers/admin-fakes.js';

const db = (fake: AdminD1): D1Database => fake as unknown as D1Database;
const today = (): string => new Date().toISOString().slice(0, 10);

describe('overview', () => {
  it('reads counters and counts into one shaped object', async () => {
    const fake = seedDashboard(new AdminD1());
    const stats = await overview(db(fake));
    expect(stats.requests).toBe(1500);
    expect(stats.toolRuns).toBe(900);
    expect(stats.distinctTools).toBe(42);
  });

  it('issues a single batch rather than serial queries', async () => {
    const fake = seedDashboard(new AdminD1());
    await overview(db(fake));
    expect(fake.log.length).toBe(11);
  });

  it('defaults every counter to zero when the table is empty', async () => {
    const stats = await overview(db(new AdminD1()));
    expect(stats.requests).toBe(0);
    expect(stats.toolRuns).toBe(0);
    expect(stats.users).toBe(0);
    expect(stats.banned).toBe(0);
  });

  it('coerces string values from D1 into numbers', async () => {
    const fake = new AdminD1().when(/FROM counters/i, [{ key: 'requests', value: '77' }]);
    expect((await overview(db(fake))).requests).toBe(77);
  });

  it('binds the day boundary rather than inlining it', async () => {
    const fake = seedDashboard(new AdminD1());
    await overview(db(fake));
    const dated = fake.log.filter((entry) => entry.params.length > 0);
    expect(dated.length).toBeGreaterThan(0);
    for (const entry of dated) expect(entry.sql).toContain('?1');
  });
});

describe('dailySeries', () => {
  it('returns one point per requested day', async () => {
    const series = await dailySeries(db(new AdminD1()), 14);
    expect(series).toHaveLength(14);
  });

  it('fills days with no activity with zero', async () => {
    const series = await dailySeries(db(new AdminD1()), 7);
    expect(series.every((point) => point.uses === 0)).toBe(true);
  });

  it('is ordered oldest to newest and ends today', async () => {
    const series = await dailySeries(db(new AdminD1()), 5);
    const days = series.map((point) => point.day);
    expect([...days].sort()).toEqual(days);
    expect(days.at(-1)).toBe(today());
  });

  it('merges real rows onto the filled skeleton', async () => {
    const fake = new AdminD1().when(/FROM daily_stats/i, [{ day: today(), uses: 33 }]);
    const series = await dailySeries(db(fake), 3);
    expect(series.at(-1)?.uses).toBe(33);
    expect(series[0]?.uses).toBe(0);
  });

  it('handles a single-day window', async () => {
    const series = await dailySeries(db(new AdminD1()), 1);
    expect(series).toHaveLength(1);
    expect(series[0]?.day).toBe(today());
  });
});

describe('topTools', () => {
  it('normalises row values to numbers', async () => {
    const fake = new AdminD1().when(/FROM tool_usage/i, [
      { tool_id: 'json_format', uses: '10', users: '4', last_used: '1700000000' },
    ]);
    const [tool] = await topTools(db(fake));
    expect(tool?.uses).toBe(10);
    expect(tool?.last_used).toBe(1_700_000_000);
  });

  it('returns an empty array when nothing has been used', async () => {
    expect(await topTools(db(new AdminD1()))).toEqual([]);
  });

  it('binds the limit', async () => {
    const fake = new AdminD1();
    await topTools(db(fake), 25);
    expect(fake.log[0]?.params).toContain(25);
  });
});

describe('listUsers', () => {
  it('binds the search term instead of interpolating it', async () => {
    const fake = new AdminD1().when(/COUNT/i, [{ c: 0 }]);
    await listUsers(db(fake), { search: "'; DROP TABLE users; --" });
    expect(fake.sqlText()).not.toContain('DROP TABLE');
    const bound = fake.log.some((entry) => entry.params.some((p) => String(p).includes('drop table users')));
    expect(bound).toBe(true);
  });

  it('never interpolates the sort column from raw input', async () => {
    const fake = new AdminD1().when(/COUNT/i, [{ c: 0 }]);
    // @ts-expect-error deliberately passing a value outside the union
    await listUsers(db(fake), { sort: 'user_id; DROP TABLE users' });
    expect(fake.sqlText()).not.toContain('DROP TABLE');
    expect(fake.sqlText()).toContain('ORDER BY u.last_seen');
  });

  it('accepts each allowed sort column', async () => {
    for (const sort of ['last_seen', 'tool_runs', 'first_seen'] as const) {
      const fake = new AdminD1().when(/COUNT/i, [{ c: 0 }]);
      await listUsers(db(fake), { sort });
      expect(fake.sqlText()).toContain(`ORDER BY u.${sort}`);
    }
  });

  it('clamps an absurd page size', async () => {
    const fake = new AdminD1().when(/COUNT/i, [{ c: 0 }]);
    await listUsers(db(fake), { perPage: 100_000 });
    const select = fake.log.find((entry) => /SELECT u\.user_id/.test(entry.sql));
    expect(select?.params).toContain(100);
  });

  it('clamps a page below one', async () => {
    const fake = new AdminD1().when(/COUNT/i, [{ c: 0 }]);
    const result = await listUsers(db(fake), { page: -5 });
    expect(result.page).toBe(1);
  });

  it('computes the page count from the total', async () => {
    const fake = new AdminD1().when(/COUNT/i, [{ c: 51 }]);
    const result = await listUsers(db(fake), { perPage: 25 });
    expect(result.pages).toBe(3);
  });

  it('reports at least one page when empty', async () => {
    const fake = new AdminD1().when(/COUNT/i, [{ c: 0 }]);
    expect((await listUsers(db(fake))).pages).toBe(1);
  });

  it('adds a banned filter only when asked', async () => {
    const plain = new AdminD1().when(/COUNT/i, [{ c: 0 }]);
    await listUsers(db(plain), {});
    expect(plain.sqlText()).not.toContain('b.user_id IS NOT NULL');

    const filtered = new AdminD1().when(/COUNT/i, [{ c: 0 }]);
    await listUsers(db(filtered), { bannedOnly: true });
    expect(filtered.sqlText()).toContain('b.user_id IS NOT NULL');
  });

  it('truncates an over-long search term', async () => {
    const fake = new AdminD1().when(/COUNT/i, [{ c: 0 }]);
    await listUsers(db(fake), { search: 'x'.repeat(500) });
    const param = fake.log[0]?.params[0];
    expect(String(param).length).toBeLessThanOrEqual(70);
  });
});

describe('userDetail', () => {
  it('returns null for an unknown user', async () => {
    expect(await userDetail(db(new AdminD1()), 999)).toBeNull();
  });

  it('assembles profile, tools, favourites and scan count', async () => {
    const fake = new AdminD1()
      .when(/SELECT u\.user_id/i, [
        {
          user_id: 5,
          first_name: 'Ali',
          last_name: null,
          username: 'ali',
          lang: 'fa',
          first_seen: 1,
          last_seen: 2,
          requests: 10,
          tool_runs: 4,
          banned: 0,
        },
      ])
      .when(/FROM tool_usage/i, [{ tool_id: 'qr_code', uses: 3, users: 1, last_used: 9 }])
      .when(/FROM favorites/i, [{ tool_id: 'json_format' }])
      .when(/FROM security_scans/i, [{ c: 2 }]);

    const detail = await userDetail(db(fake), 5);
    expect(detail?.user.first_name).toBe('Ali');
    expect(detail?.tools).toHaveLength(1);
    expect(detail?.favorites).toEqual(['json_format']);
    expect(detail?.scans).toBe(2);
  });

  it('binds the user id', async () => {
    const fake = new AdminD1();
    await userDetail(db(fake), 12_345);
    expect(fake.log[0]?.params).toEqual([12_345]);
  });
});

describe('ban / unban / purge', () => {
  it('writes to D1 and mirrors the ban into KV', async () => {
    const env = makeAdminEnv();
    await banUser(env, 77, 'spam');
    expect(await env.STATE.get('ban:77')).toBe('1');
  });

  it('upserts so a repeat ban does not throw', async () => {
    const env = makeAdminEnv();
    await banUser(env, 77, 'first');
    await banUser(env, 77, 'second');
    const fake = env.DB as unknown as AdminD1;
    expect(fake.sqlText()).toContain('ON CONFLICT(user_id) DO UPDATE');
  });

  it('truncates an over-long reason', async () => {
    const env = makeAdminEnv();
    await banUser(env, 77, 'x'.repeat(500));
    const fake = env.DB as unknown as AdminD1;
    expect(String(fake.log[0]?.params[1]).length).toBe(200);
  });

  it('removes both the row and the KV mirror on unban', async () => {
    const env = makeAdminEnv();
    await banUser(env, 88, 'test');
    await unbanUser(env, 88);
    expect(await env.STATE.get('ban:88')).toBeNull();
  });

  it('purges every table that holds user data', async () => {
    const env = makeAdminEnv();
    await purgeUser(env, 99);
    const sql = (env.DB as unknown as AdminD1).sqlText();
    for (const table of ['tool_usage', 'favorites', 'security_scans', 'users']) {
      expect(sql).toContain(`DELETE FROM ${table}`);
    }
  });

  it('clears the user\u2019s KV state on purge', async () => {
    const env = makeAdminEnv();
    await env.STATE.put('lang:99', 'fa');
    await env.STATE.put('pending:99', '{}');
    await purgeUser(env, 99);
    expect(await env.STATE.get('lang:99')).toBeNull();
    expect(await env.STATE.get('pending:99')).toBeNull();
  });
});

describe('audit trail', () => {
  it('records an action with bound parameters', async () => {
    const fake = new AdminD1();
    await audit(db(fake), { action: 'user.ban', target: '5', detail: 'spam', ip: '1.1.1.1' });
    expect(fake.log[0]?.params.slice(0, 4)).toEqual(['user.ban', '5', 'spam', '1.1.1.1']);
  });

  it('defaults optional fields to empty strings', async () => {
    const fake = new AdminD1();
    await audit(db(fake), { action: 'login.success' });
    expect(fake.log[0]?.params.slice(0, 4)).toEqual(['login.success', '', '', '']);
  });

  it('caps the detail field', async () => {
    const fake = new AdminD1();
    await audit(db(fake), { action: 'x', detail: 'y'.repeat(1000) });
    expect(String(fake.log[0]?.params[2]).length).toBe(300);
  });

  it('reads back newest first', async () => {
    const fake = new AdminD1().when(/FROM admin_audit/i, [
      { id: 2, action: 'a', target: '', detail: '', ip: '', created_at: 2 },
    ]);
    const rows = await recentAudit(db(fake), 10);
    expect(rows).toHaveLength(1);
    expect(fake.sqlText()).toContain('ORDER BY id DESC');
  });
});

describe('broadcasts', () => {
  it('opens a record in the running state', async () => {
    const fake = new AdminD1();
    await createBroadcast(db(fake), 'abc', 'hello', 'all', 10);
    expect(fake.log[0]?.params).toContain('running');
  });

  it('caps the stored body', async () => {
    const fake = new AdminD1();
    await createBroadcast(db(fake), 'abc', 'x'.repeat(9000), 'all', 1);
    expect(String(fake.log[0]?.params[1]).length).toBe(4000);
  });

  it('closes the record with final counts', async () => {
    const fake = new AdminD1();
    await finishBroadcast(db(fake), 'abc', 9, 1, 'done');
    expect(fake.log[0]?.params).toEqual(expect.arrayContaining(['abc', 9, 1, 'done']));
  });

  it('always excludes banned users from the audience', async () => {
    const fake = new AdminD1();
    await broadcastAudience(db(fake), 'all');
    expect(fake.sqlText()).toContain('b.user_id IS NULL');
  });

  it('falls back to everyone for an unknown audience key', async () => {
    const fake = new AdminD1();
    await broadcastAudience(db(fake), "'; DROP TABLE users; --");
    expect(fake.sqlText()).not.toContain('DROP TABLE');
    expect(fake.sqlText()).toContain('1 = 1');
  });

  it('applies a time window for the active audiences', async () => {
    const fake = new AdminD1();
    await broadcastAudience(db(fake), 'active7');
    expect(fake.sqlText()).toMatch(/last_seen >= \d+/);
  });

  it('filters by language for the language audiences', async () => {
    const fake = new AdminD1();
    await broadcastAudience(db(fake), 'fa');
    expect(fake.sqlText()).toContain("u.lang = 'fa'");
  });

  it('caps the recipient list', async () => {
    const fake = new AdminD1();
    await broadcastAudience(db(fake), 'all');
    expect(fake.sqlText()).toContain('LIMIT 5000');
  });
});
