/**
 * Home keyboard composition.
 *
 * The Mini App launch button was added as an *extra* entry point. These tests
 * pin the promise that no pre-existing button was displaced by it, so a future
 * edit to `homeKeyboard` cannot quietly drop an inline flow.
 */
import { describe, expect, it } from 'vitest';
import { homeKeyboard, CB } from '../../src/bot/ui.js';
import type { InlineKeyboardButton } from '../../src/types/telegram.js';

const APP = 'https://devnet-app.example.workers.dev';

const flat = (rows: InlineKeyboardButton[][]): InlineKeyboardButton[] => rows.flat();
const callbacks = (rows: InlineKeyboardButton[][]): string[] =>
  flat(rows)
    .map((button) => button.callback_data)
    .filter((data): data is string => typeof data === 'string');

/** Every inline destination the home screen offered before the Mini App. */
const LEGACY = [CB.toolbox, CB.quick, CB.security, CB.favorites, CB.profile, CB.stats, CB.settings, CB.help, CB.about];

describe('homeKeyboard', () => {
  it('keeps every legacy button when no app URL is configured', () => {
    const { inline_keyboard: rows } = homeKeyboard('fa');
    expect(callbacks(rows).sort()).toEqual([...LEGACY].sort());
  });

  it('keeps every legacy button when the app URL IS configured', () => {
    const { inline_keyboard: rows } = homeKeyboard('fa', APP);
    for (const destination of LEGACY) {
      expect(callbacks(rows)).toContain(destination);
    }
  });

  it('adds exactly one web_app button, at the top', () => {
    const { inline_keyboard: rows } = homeKeyboard('fa', APP);
    const webApps = flat(rows).filter((button) => button.web_app);
    expect(webApps).toHaveLength(1);
    expect(rows[0]?.[0]?.web_app?.url).toBe(APP);
  });

  it('omits the web_app button entirely when the URL is absent', () => {
    const { inline_keyboard: rows } = homeKeyboard('fa');
    expect(flat(rows).some((button) => button.web_app)).toBe(false);
    // No empty row may survive the filter, or Telegram rejects the markup.
    expect(rows.every((row) => row.length > 0)).toBe(true);
  });

  it('labels the button in both languages', () => {
    expect(homeKeyboard('fa', APP).inline_keyboard[0]?.[0]?.text).toBe('🚀 اپلیکیشن');
    expect(homeKeyboard('en', APP).inline_keyboard[0]?.[0]?.text).toBe('🚀 Open App');
  });

  it('never mixes callback_data with web_app on one button', () => {
    // Telegram rejects a button carrying both.
    for (const button of flat(homeKeyboard('en', APP).inline_keyboard)) {
      expect(Boolean(button.web_app && button.callback_data)).toBe(false);
    }
  });

  it('keeps every callback_data within Telegram\'s 64-byte limit', () => {
    for (const data of callbacks(homeKeyboard('fa', APP).inline_keyboard)) {
      expect(new TextEncoder().encode(data).length).toBeLessThanOrEqual(64);
    }
  });
});
