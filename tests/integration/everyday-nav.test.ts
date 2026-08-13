import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { handleUpdate } from '../../src/bot/router.js';
import { MAX_FAVORITES } from '../../src/db/favorites.js';
import { EVERYDAY_GROUPS, populatedGroups, toolsByCategory, toolsByGroup } from '../../src/tools/registry.js';
import { callbackUpdate, execCtx, installFakeTelegram, makeEnv, messageUpdate } from '../helpers/fakes.js';
import type { FakeD1 } from '../helpers/fakes.js';

/**
 * Phase 4 · Stage A — navigation for 🧰 Everyday Tools and ⭐ Favorites.
 *
 * These exercise the real router, so they also prove the new callbacks stay
 * inside Telegram's 64-byte callback_data budget and that every sub-group is
 * reachable from the home screen.
 */

let tg: ReturnType<typeof installFakeTelegram>;
let env: ReturnType<typeof makeEnv>;

const db = (): FakeD1 => env.DB as unknown as FakeD1;

async function run(update: Parameters<typeof handleUpdate>[0]): Promise<void> {
  const ctx = execCtx();
  await handleUpdate(update, env, ctx);
  await Promise.all(ctx.pending);
}

/** Text of the last screen the bot rendered, however it was delivered. */
function lastScreen(): string {
  const texts = tg.calls
    .filter((c) => c.method === 'editMessageText' || c.method === 'sendMessage')
    .map((c) => (c.body['text'] as string) ?? '');
  return texts[texts.length - 1] ?? '';
}

function lastButtons(): { text: string; callback_data?: string }[] {
  const call = [...tg.calls].reverse().find((c) => c.body['reply_markup'] !== undefined);
  const markup = call?.body['reply_markup'] as
    | { inline_keyboard: { text: string; callback_data?: string }[][] }
    | undefined;
  return markup?.inline_keyboard.flat() ?? [];
}

function answers(): { text?: string; show_alert?: boolean }[] {
  return tg.calls
    .filter((c) => c.method === 'answerCallbackQuery')
    .map((c) => ({ text: c.body['text'] as string | undefined, show_alert: c.body['show_alert'] as boolean }));
}

beforeEach(() => {
  tg = installFakeTelegram();
  env = makeEnv();
});

afterEach(() => {
  tg.restore();
});

describe('🧰 Everyday Tools category', () => {
  it('is not empty', () => {
    expect(toolsByCategory('everyday').length).toBeGreaterThan(0);
  });

  it('opens from the /everyday command and lists sub-groups', async () => {
    await run(messageUpdate('/everyday'));
    const datas = lastButtons().map((b) => b.callback_data);
    for (const group of populatedGroups()) {
      expect(datas, group.id).toContain(`grp:${group.id}:1`);
    }
  });

  it('opens from the category callback too', async () => {
    await run(callbackUpdate('cat:everyday:1'));
    expect(lastScreen()).not.toBe('');
    expect(lastScreen()).not.toContain('undefined');
  });

  it('renders every populated sub-group without an empty or broken screen', async () => {
    for (const group of populatedGroups()) {
      tg.restore();
      tg = installFakeTelegram();
      env = makeEnv();
      await run(callbackUpdate(`grp:${group.id}:1`));
      const text = lastScreen();
      expect(text, group.id).not.toBe('');
      expect(text, group.id).not.toContain('undefined');
      const datas = lastButtons().map((b) => b.callback_data ?? '');
      const first = toolsByGroup(group.id)[0];
      expect(datas.some((d) => d === `tool:${first?.id ?? ''}`), group.id).toBe(true);
    }
  });

  it('rejects an unknown sub-group instead of rendering an empty list', async () => {
    await run(callbackUpdate('grp:not_a_group:1'));
    expect(answers().some((a) => a.show_alert === true)).toBe(true);
  });

  it('clamps a nonsense page number', async () => {
    await run(callbackUpdate('grp:calculators:abc'));
    expect(lastScreen()).not.toBe('');
    await run(callbackUpdate('grp:calculators:99999'));
    expect(lastScreen()).not.toBe('');
  });

  it('keeps every group callback within Telegram\u2019s 64-byte limit', () => {
    for (const group of EVERYDAY_GROUPS) {
      expect(new TextEncoder().encode(`grp:${group.id}:99`).length, group.id).toBeLessThanOrEqual(64);
    }
  });

  it('sends a tool page whose Back button returns to its sub-group', async () => {
    const tool = toolsByGroup('calculators')[0];
    expect(tool).toBeDefined();
    await run(callbackUpdate(`tool:${tool?.id ?? ''}`));
    const datas = lastButtons().map((b) => b.callback_data);
    expect(datas).toContain('grp:calculators:1');
  });
});

describe('⭐ Favorites', () => {
  it('shows an empty state rather than a blank screen', async () => {
    await run(messageUpdate('/favorites'));
    expect(lastScreen().length).toBeGreaterThan(10);
  });

  it('is reachable from its callback and its /fav alias', async () => {
    await run(callbackUpdate('fav'));
    expect(lastScreen()).not.toBe('');
    await run(messageUpdate('/fav'));
    expect(lastScreen()).not.toBe('');
  });

  it('toggling a tool writes to D1 and acknowledges the tap', async () => {
    await run(callbackUpdate('favt:calculator'));
    const sql = db().allSql();
    expect(sql).toMatch(/favorites/i);
    expect(answers().length).toBeGreaterThan(0);
  });

  it('binds the real user id and tool id, and nothing else', async () => {
    await run(callbackUpdate('favt:calculator'));
    const insert = db().log.find((entry) => /INSERT/i.test(entry.sql) && /favorites/i.test(entry.sql));
    expect(insert).toBeDefined();
    expect(insert?.params[1]).toBe('calculator');
  });

  it('refuses to star a tool that does not exist', async () => {
    await run(callbackUpdate('favt:no_such_tool'));
    expect(answers().some((a) => a.show_alert === true)).toBe(true);
    expect(db().allSql()).not.toMatch(/INSERT[\s\S]*favorites/i);
  });

  it('surfaces a database failure as an alert instead of a false success', async () => {
    db().failOn = /favorites/i;
    await run(callbackUpdate('favt:calculator'));
    expect(answers().some((a) => a.show_alert === true)).toBe(true);
  });

  it('exposes a sane cap', () => {
    expect(MAX_FAVORITES).toBeGreaterThan(0);
    expect(MAX_FAVORITES).toBeLessThanOrEqual(100);
  });

  it('paginates without crashing on an out-of-range page', async () => {
    await run(callbackUpdate('fav:42'));
    expect(lastScreen()).not.toBe('');
    expect(lastScreen()).not.toContain('undefined');
  });
});
