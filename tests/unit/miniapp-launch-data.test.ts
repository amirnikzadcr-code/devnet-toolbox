/**
 * Launch-data parsing for the mini app.
 *
 * Regression cover for a real production failure: a user inside Telegram saw
 * "open this from inside Telegram", because initData was sourced only from the
 * Telegram SDK script. That script is fetched over the user's own network, so
 * when it fails to load the app has no launch data and every API call 401s.
 * The fallback below reads the same value out of the launch URL.
 */
import { describe, expect, it } from 'vitest';

import { initDataFromUrl } from '../../app/src/lib/launch-data';

/** A realistic signed payload; the trailing hash is what the server verifies. */
const SIGNED = 'user=%7B%22id%22%3A7%7D&auth_date=1760000000&hash=abc123';

describe('initDataFromUrl', () => {
  it('reads tgWebAppData from the URL fragment', () => {
    expect(initDataFromUrl(`#tgWebAppData=${encodeURIComponent(SIGNED)}`, '')).toBe(SIGNED);
  });

  it('reads it from the query string when the client used that instead', () => {
    expect(initDataFromUrl('', `?tgWebAppData=${encodeURIComponent(SIGNED)}`)).toBe(SIGNED);
  });

  it('prefers the fragment over the query string', () => {
    const fromHash = 'auth_date=1&hash=hashwins';
    expect(
      initDataFromUrl(
        `#tgWebAppData=${encodeURIComponent(fromHash)}`,
        `?tgWebAppData=${encodeURIComponent(SIGNED)}`,
      ),
    ).toBe(fromHash);
  });

  it('tolerates a missing leading # or ?', () => {
    expect(initDataFromUrl(`tgWebAppData=${encodeURIComponent(SIGNED)}`, '')).toBe(SIGNED);
  });

  it('ignores the other launch params Telegram appends', () => {
    const hash =
      `#tgWebAppData=${encodeURIComponent(SIGNED)}` +
      '&tgWebAppVersion=8.0&tgWebAppPlatform=android&tgWebAppThemeParams=%7B%7D';
    expect(initDataFromUrl(hash, '')).toBe(SIGNED);
  });

  it('returns the payload byte-for-byte so the HMAC still verifies', () => {
    // Any re-encoding here would silently break server-side signature checks.
    const out = initDataFromUrl(`#tgWebAppData=${encodeURIComponent(SIGNED)}`, '');
    expect(out).toBe(SIGNED);
    expect(out).toContain('hash=abc123');
    expect(out).not.toContain('%25'); // no double-encoding
  });

  it('returns empty for a plain browser visit', () => {
    expect(initDataFromUrl('', '')).toBe('');
    expect(initDataFromUrl('#section-two', '?utm_source=x')).toBe('');
  });

  it('returns empty when the param is present but blank', () => {
    expect(initDataFromUrl('#tgWebAppData=', '')).toBe('');
  });

  it('does not throw on a malformed percent-escape', () => {
    expect(() => initDataFromUrl('#%E0%A4%A', '')).not.toThrow();
    expect(initDataFromUrl('#%E0%A4%A', '')).toBe('');
  });

  it('falls through to the query string when the fragment is malformed', () => {
    expect(initDataFromUrl('#%E0%A4%A', `?tgWebAppData=${encodeURIComponent(SIGNED)}`)).toBe(
      SIGNED,
    );
  });

  it('handles a payload containing an encoded ampersand inside the user JSON', () => {
    const tricky = 'user=%7B%22first_name%22%3A%22A%26B%22%7D&auth_date=1&hash=zz';
    expect(initDataFromUrl(`#tgWebAppData=${encodeURIComponent(tricky)}`, '')).toBe(tricky);
  });
});
