import { chromium } from 'playwright-core';
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH, args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 390, height: 780 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });

// Wrap the real SDK once it publishes itself, and feed it signed launch data
// via the URL hash exactly the way Telegram does.
await page.addInitScript(({ initData }) => {
  let held;
  Object.defineProperty(window, 'Telegram', {
    configurable: true,
    get: () => held,
    set: (v) => {
      held = v;
      const patch = (w) => {
        if (!w) return w;
        try { Object.defineProperty(w, 'initData', { value: initData, configurable: true }); } catch {}
        return w;
      };
      if (v && v.WebApp) patch(v.WebApp);
      else if (v) {
        let inner;
        Object.defineProperty(v, 'WebApp', { configurable: true, get: () => inner, set: (w) => { inner = patch(w); } });
      }
    },
  });
}, { initData: process.env.INIT_DATA });

const url = 'https://devnet-app.nikiaaaaacr.workers.dev/#tgWebAppData=' +
  encodeURIComponent(process.env.INIT_DATA) +
  '&tgWebAppVersion=7.10&tgWebAppPlatform=android&tgWebAppThemeParams=' +
  encodeURIComponent(JSON.stringify({ bg_color: '#17212b', text_color: '#ffffff' }));

const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(String(e)));

await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 });
await page.waitForSelector('.tile', { timeout: 30000 });
await page.waitForTimeout(1500);

const state = await page.evaluate(() => {
  const el = document.querySelector('.scroll');
  const re = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}\u{2B50}]/u;
  const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  const emoji = [];
  let n; while ((n = w.nextNode())) if (re.test(n.nodeValue || '')) emoji.push(n.nodeValue.trim().slice(0, 30));
  return { tiles: document.querySelectorAll('.tile').length,
           svg: document.querySelectorAll('.tile .badge svg').length,
           bounded: el.clientHeight <= window.innerHeight + 1,
           scrollable: el.scrollHeight > el.clientHeight + 50, emoji };
});
console.log('PROD tiles=%d svgBadges=%d scrollBounded=%s scrollable=%s emoji=%s',
  state.tiles, state.svg, state.bounded, state.scrollable, state.emoji.length ? state.emoji.join('|') : 'none');

await page.mouse.move(195, 500);
await page.mouse.wheel(0, 1200);
await page.waitForTimeout(500);
const top = await page.evaluate(() => document.querySelector('.scroll').scrollTop);
console.log('PROD scrollTop after wheel =', Math.round(top));
console.log('PROD console errors:', errors.length ? errors.slice(0, 3).join(' || ') : 'none');
await page.evaluate(() => { document.querySelector('.scroll').scrollTop = 0; });
await page.waitForTimeout(400);
await page.screenshot({ path: 'e2e/prod-home.png' });
await browser.close();
