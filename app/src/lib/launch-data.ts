/**
 * Parsing of Telegram's launch URL.
 *
 * Deliberately DOM-free: it takes the URL parts as arguments rather than
 * reading `window`, so the bot's Worker test suite can import it without
 * pulling in `lib.dom`. See `telegram.ts` for the browser-facing wrapper.
 */

/**
 * Reads `tgWebAppData` straight out of the launch URL.
 *
 * Telegram passes initData in the fragment (`#tgWebAppData=...`), and on some
 * platforms in the query string. The official SDK parses this for us, but the
 * SDK is fetched over the user's own network — when that fetch fails the app
 * would otherwise have no launch data at all and every API call would 401.
 * The value is still verified server-side against BOT_TOKEN, so reading it
 * from the URL grants no trust that the SDK path would not also grant.
 */
export function initDataFromUrl(hash: string, search: string): string {
  for (const source of [hash.replace(/^#/, ''), search.replace(/^\?/, '')]) {
    if (!source) continue;
    try {
      const value = new URLSearchParams(source).get('tgWebAppData');
      if (value) return value;
    } catch {
      /* Malformed escape sequence — fall through to the next source. */
    }
  }
  return '';
}
