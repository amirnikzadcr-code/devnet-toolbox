import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { handleUpdate } from '../../src/bot/router.js';
import { ALL_TOOLS, TOTAL_TOOLS, getTool } from '../../src/tools/registry.js';
import {
  callbackUpdate,
  execCtx,
  installFakeTelegram,
  makeEnv,
  messageUpdate,
  TEST_BOT_TOKEN,
} from '../helpers/fakes.js';
import type { FakeD1, FakeKV } from '../helpers/fakes.js';

let tg: ReturnType<typeof installFakeTelegram>;
let env: ReturnType<typeof makeEnv>;

const kv = (): FakeKV => env.STATE as unknown as FakeKV;
const db = (): FakeD1 => env.DB as unknown as FakeD1;

/** Runs an update and awaits every waitUntil promise it scheduled. */
async function run(update: Parameters<typeof handleUpdate>[0]): Promise<void> {
  const ctx = execCtx();
  await handleUpdate(update, env, ctx);
  await Promise.all(ctx.pending);
}

beforeEach(() => {
  tg = installFakeTelegram();
  env = makeEnv();
});

afterEach(() => {
  tg.restore();
});

describe('/start', () => {
  it('replies with the home page', async () => {
    await run(messageUpdate('/start'));
    expect(tg.methods()).toContain('sendMessage');
    const text = tg.sentTexts()[0] ?? '';
    expect(text).toContain('DevNet');
  });

  it('advertises the real tool count', async () => {
    await run(messageUpdate('/start'));
    expect(tg.sentTexts()[0]).toContain(String(TOTAL_TOOLS));
  });

  it('attaches an inline keyboard with the main sections', async () => {
    await run(messageUpdate('/start'));
    const call = tg.calls.find((c) => c.method === 'sendMessage');
    const markup = call?.body['reply_markup'] as { inline_keyboard: { text: string; callback_data: string }[][] };
    expect(markup).toBeDefined();
    const datas = markup.inline_keyboard.flat().map((b) => b.callback_data);
    expect(datas).toContain('tb');
    expect(datas).toContain('prof');
    expect(datas).toContain('help');
    expect(datas).toContain('about');
  });

  it('records the user in D1', async () => {
    await run(messageUpdate('/start'));
    expect(db().allSql()).toMatch(/insert into users/i);
  });

  it('never echoes the bot token into a message', async () => {
    await run(messageUpdate('/start'));
    for (const text of tg.sentTexts()) expect(text).not.toContain(TEST_BOT_TOKEN);
  });
});

describe('command coverage', () => {
  const commands = ['/menu', '/home', '/tools', '/toolbox', '/quick', '/profile', '/stats', '/settings', '/lang', '/help', '/about', '/id', '/version', '/cancel'];

  for (const command of commands) {
    it(`${command} answers with a message and does not throw`, async () => {
      await run(messageUpdate(command));
      const texts = tg.sentTexts();
      expect(texts.length, command).toBeGreaterThan(0);
      expect(texts.join(''), command).not.toBe('');
    });
  }

  it('handles /tool <id> for a valid tool', async () => {
    await run(messageUpdate('/tool uuid_gen'));
    expect(tg.sentTexts().join('')).toMatch(/[0-9a-f]{8}-[0-9a-f]{4}/i);
  });

  it('handles /tool with an unknown id gracefully', async () => {
    await run(messageUpdate('/tool does_not_exist'));
    const text = tg.sentTexts().join('');
    expect(text).not.toBe('');
    expect(text.toLowerCase()).not.toContain('undefined');
  });

  it('handles an unknown command without crashing', async () => {
    await run(messageUpdate('/definitely_not_a_command'));
    expect(tg.sentTexts().length).toBeGreaterThan(0);
  });

  it('supports the /command@botusername form', async () => {
    await run(messageUpdate('/help@devnet_toolbox_bot'));
    expect(tg.sentTexts().length).toBeGreaterThan(0);
  });
});

describe('callback navigation', () => {
  const targets = ['home', 'tb', 'quick', 'prof', 'mytools', 'stats', 'set', 'help', 'about'];

  for (const data of targets) {
    it(`callback "${data}" edits the message and answers the query`, async () => {
      await run(callbackUpdate(data));
      expect(tg.methods(), data).toContain('answerCallbackQuery');
      expect(tg.methods().some((m) => m === 'editMessageText' || m === 'sendMessage'), data).toBe(true);
    });
  }

  it('opens a category page with pagination controls', async () => {
    await run(callbackUpdate('cat:programming:1'));
    const call = tg.calls.find((c) => c.method === 'editMessageText');
    const markup = call?.body['reply_markup'] as { inline_keyboard: { callback_data: string }[][] };
    const datas = markup.inline_keyboard.flat().map((b) => b.callback_data);
    expect(datas.some((d) => d.startsWith('tool:'))).toBe(true);
    expect(datas).toContain('home');
  });

  it('paginates to page 2 of a category', async () => {
    await run(callbackUpdate('cat:programming:2'));
    const text = tg.calls.find((c) => c.method === 'editMessageText')?.body['text'] as string;
    expect(text).toContain('2');
  });

  it('clamps an out-of-range page instead of erroring', async () => {
    await run(callbackUpdate('cat:programming:999'));
    expect(tg.methods()).toContain('answerCallbackQuery');
    const text = (tg.calls.find((c) => c.method === 'editMessageText')?.body['text'] as string) ?? '';
    expect(text.toLowerCase()).not.toContain('undefined');
  });

  it('rejects an unknown category safely', async () => {
    await run(callbackUpdate('cat:hacking:1'));
    expect(tg.methods()).toContain('answerCallbackQuery');
  });

  it('shows a tool detail page with example and back buttons', async () => {
    await run(callbackUpdate('tool:json_format'));
    const call = tg.calls.find((c) => c.method === 'editMessageText');
    const text = call?.body['text'] as string;
    const markup = call?.body['reply_markup'] as { inline_keyboard: { callback_data: string }[][] };
    expect(text).toContain('JSON');
    const datas = markup.inline_keyboard.flat().map((b) => b.callback_data);
    expect(datas).toContain('run:json_format');
    expect(datas).toContain('home');
  });

  it('ignores an unknown tool id in a callback', async () => {
    await run(callbackUpdate('tool:__proto__'));
    expect(tg.methods()).toContain('answerCallbackQuery');
  });

  it('treats "noop" as a no-op that still answers the query', async () => {
    await run(callbackUpdate('noop'));
    expect(tg.methods()).toContain('answerCallbackQuery');
  });

  it('handles malformed callback data without throwing', async () => {
    for (const data of ['', ':::', 'cat:', 'run:', 'tool:', 'lang:', 'cat:programming:abc']) {
      await expect(run(callbackUpdate(data))).resolves.toBeUndefined();
    }
  });
});

describe('tool execution flow', () => {
  it('asks for input when running a tool that needs it', async () => {
    await run(callbackUpdate('run:base64_encode'));
    expect(tg.sentTexts().join('')).not.toBe('');
    expect(kv().keys().some((k) => k.includes('pending'))).toBe(true);
  });

  it('runs the tool on the next free-text message and clears the pending state', async () => {
    await run(callbackUpdate('run:base64_encode'));
    await run(messageUpdate('Hello'));
    const output = tg.sentTexts().join('\n') + tg.calls.map((c) => String(c.body['text'] ?? '')).join('\n');
    expect(output).toContain('SGVsbG8=');
    expect(kv().keys().some((k) => k.includes('pending'))).toBe(false);
  });

  it('runs an input-free tool immediately', async () => {
    await run(callbackUpdate('run:uuid_gen'));
    const all = tg.calls.map((c) => String(c.body['text'] ?? '')).join('\n');
    expect(all).toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}/i);
  });

  it('shows a loading state before the result', async () => {
    await run(callbackUpdate('run:base64_encode'));
    await run(messageUpdate('Hello'));
    expect(tg.methods()).toContain('editMessageText');
  });

  it('reports a friendly error for invalid tool input', async () => {
    await run(callbackUpdate('run:json_format'));
    await run(messageUpdate('{not json'));
    const all = tg.calls.map((c) => String(c.body['text'] ?? '')).join('\n');
    expect(all).toMatch(/⚠️|❌/);
    expect(all).not.toMatch(/SyntaxError:\s*Unexpected token.*at JSON\.parse/s);
    expect(all).not.toContain('at Object.');
  });

  it('records the tool run in D1', async () => {
    await run(callbackUpdate('run:uuid_gen'));
    expect(db().allSql()).toMatch(/tool_usage|daily_stats/i);
  });

  it('never stores tool input or output in D1', async () => {
    await run(callbackUpdate('run:base64_encode'));
    await run(messageUpdate('super-secret-input-string'));
    const logged = JSON.stringify(db().log);
    expect(logged).not.toContain('super-secret-input-string');
    expect(logged).not.toContain('c3VwZXItc2VjcmV0');
  });

  it('cancels a pending input with /cancel', async () => {
    await run(callbackUpdate('run:base64_encode'));
    expect(kv().keys().some((k) => k.includes('pending'))).toBe(true);
    await run(messageUpdate('/cancel'));
    expect(kv().keys().some((k) => k.includes('pending'))).toBe(false);
  });
});

describe('language switching', () => {
  it('switches to English and persists the choice', async () => {
    await run(callbackUpdate('lang:en'));
    expect(db().allSql()).toMatch(/update users|insert into users/i);
    await run(messageUpdate('/help'));
    const text = tg.sentTexts().join('\n');
    expect(text).toMatch(/[A-Za-z]{4,}/);
  });

  it('ignores an unsupported language code', async () => {
    await expect(run(callbackUpdate('lang:de'))).resolves.toBeUndefined();
  });
});

describe('resilience', () => {
  it('ignores non-private chats with a clear message', async () => {
    await run(messageUpdate('/start', { chatType: 'group', chatId: -100 }));
    const text = tg.sentTexts().join('');
    expect(text).not.toBe('');
  });

  it('ignores messages from other bots', async () => {
    const update = messageUpdate('/start');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (update as any).message.from.is_bot = true;
    await run(update);
    expect(tg.calls).toHaveLength(0);
  });

  it('deduplicates a replayed update_id', async () => {
    const update = messageUpdate('/start');
    await run(update);
    const first = tg.calls.length;
    await run(update);
    expect(tg.calls.length).toBe(first);
  });

  it('survives a D1 outage without crashing or leaking the error', async () => {
    db().failNext = true;
    await expect(run(messageUpdate('/start'))).resolves.toBeUndefined();
    const text = tg.sentTexts().join('');
    expect(text).not.toContain('D1_ERROR');
  });

  it('falls back to sendMessage when editMessageText fails', async () => {
    tg.restore();
    tg = installFakeTelegram({ failMethods: ['editMessageText'] });
    await run(callbackUpdate('help'));
    expect(tg.methods()).toContain('sendMessage');
  });

  it('handles an update with neither message nor callback_query', async () => {
    await expect(run({ update_id: 99999 } as never)).resolves.toBeUndefined();
    expect(tg.calls).toHaveLength(0);
  });

  it('handles a message with no text', async () => {
    const update = messageUpdate('');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (update as any).message.text;
    await expect(run(update)).resolves.toBeUndefined();
  });
});

describe('every tool is reachable and renders a detail page', () => {
  it('renders all tool pages without throwing', async () => {
    for (const tool of ALL_TOOLS) {
      tg.restore();
      tg = installFakeTelegram();
      env = makeEnv();
      await run(callbackUpdate(`tool:${tool.id}`));
      const text = (tg.calls.find((c) => c.method === 'editMessageText')?.body['text'] as string) ?? '';
      expect(text, tool.id).not.toBe('');
      expect(text, tool.id).not.toContain('undefined');
    }
  });

  it('every registered tool id resolves', () => {
    for (const tool of ALL_TOOLS) expect(getTool(tool.id), tool.id).toBeDefined();
  });
});
