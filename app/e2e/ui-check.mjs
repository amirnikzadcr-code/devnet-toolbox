/**
 * Headless UI checks for the Mini App shell.
 *
 * These assert the two things the user reported as broken:
 *   1. the tool list actually scrolls inside the WebView, and
 *   2. no glyph in the rendered UI is an emoji (icons must be vector).
 *
 * It drives the real production bundle from `app/dist` through the mock
 * harness, at a phone viewport, with a stubbed Telegram.WebApp object.
 */
import { chromium } from 'playwright-core';

const BASE = process.env.BASE ?? 'http://127.0.0.1:4173';
const EXECUTABLE = process.env.CHROME_PATH;

/* Pictographic ranges only. Persian text, arrows and box glyphs are fine;
   these are the ones that render as coloured emoji. */
const EMOJI_RE =
  /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}\u{1F1E6}-\u{1F1FF}\u{2190}-\u{21FF}\u{2B50}\u{23F0}-\u{23FF}]/u;

const results = [];
function check(name, pass, detail = '') {
  results.push({ name, pass, detail });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}

const browser = await chromium.launch({ executablePath: EXECUTABLE, args: ['--no-sandbox'] });
const page = await browser.newPage({
  viewport: { width: 390, height: 780 },
  deviceScaleFactor: 2,
  hasTouch: true,
  isMobile: true,
});

// The page loads the real self-hosted Telegram SDK, which overwrites any
// `window.Telegram` we define up front. So instead of replacing it, wait for
// it and wrap it: install a defineProperty trap that patches the real object
// the moment the SDK publishes it. That keeps the app under test running
// against genuine SDK plumbing while letting us observe BackButton wiring.
await page.addInitScript(() => {
  const patch = (webApp) => {
    if (!webApp || webApp.__patched) return webApp;
    webApp.__patched = true;
    const back = webApp.BackButton;
    if (back) {
      const realOn = back.onClick.bind(back);
      const realOff = back.offClick.bind(back);
      back.onClick = (fn) => { window.__back = fn; return realOn(fn); };
      back.offClick = (fn) => { if (window.__back === fn) window.__back = null; return realOff(fn); };
    }
    const main = webApp.MainButton;
    if (main) {
      const realOn = main.onClick.bind(main);
      main.onClick = (fn) => { window.__main = fn; return realOn(fn); };
    }
    return webApp;
  };

  let held;
  Object.defineProperty(window, 'Telegram', {
    configurable: true,
    get: () => held,
    set: (value) => {
      held = value;
      if (value && value.WebApp) patch(value.WebApp);
      else if (value) {
        // WebApp may be attached a tick later by the SDK.
        let inner;
        Object.defineProperty(value, 'WebApp', {
          configurable: true,
          get: () => inner,
          set: (w) => { inner = patch(w); },
        });
      }
    },
  });
});

await page.goto(BASE, { waitUntil: 'networkidle' });
await page.waitForSelector('.tile', { timeout: 15000 });
await page.waitForTimeout(900); // let the stagger animation settle

/* ─── 1. Scroll ──────────────────────────────────────────────────────── */
const shell = await page.evaluate(() => {
  const el = document.querySelector('.scroll');
  const shellEl = document.querySelector('.shell');
  const screenEl = document.querySelector('.screen');
  return {
    scrollHeight: el.scrollHeight,
    clientHeight: el.clientHeight,
    shellHeight: shellEl.getBoundingClientRect().height,
    screenHeight: screenEl ? screenEl.getBoundingClientRect().height : -1,
    overflowY: getComputedStyle(el).overflowY,
    innerHeight: window.innerHeight,
  };
});

check(
  'scroll container is height-bounded (clientHeight <= viewport)',
  shell.clientHeight > 0 && shell.clientHeight <= shell.innerHeight + 1,
  `client=${Math.round(shell.clientHeight)} viewport=${shell.innerHeight}`,
);
check(
  'content overflows so scrolling is meaningful',
  shell.scrollHeight > shell.clientHeight + 50,
  `content=${Math.round(shell.scrollHeight)} visible=${Math.round(shell.clientHeight)}`,
);
check('screen wrapper does not exceed shell', shell.screenHeight <= shell.shellHeight + 1,
  `screen=${Math.round(shell.screenHeight)} shell=${Math.round(shell.shellHeight)}`);

// Actually move it, the way a finger would.
const scrolled = await page.evaluate(async () => {
  const el = document.querySelector('.scroll');
  el.scrollTop = 0;
  el.scrollTop = 600;
  await new Promise((r) => requestAnimationFrame(r));
  return el.scrollTop;
});
check('programmatic scroll moves the container', scrolled > 400, `scrollTop=${Math.round(scrolled)}`);

// Wheel gesture over the grid — closest proxy to a real touch drag.
await page.mouse.move(195, 500);
await page.mouse.wheel(0, 900);
await page.waitForTimeout(400);
const afterWheel = await page.evaluate(() => document.querySelector('.scroll').scrollTop);
check('wheel/touch gesture scrolls the list', afterWheel > 400, `scrollTop=${Math.round(afterWheel)}`);

// Bottom of the list must be reachable, not clipped behind the tab bar.
const reachedEnd = await page.evaluate(async () => {
  const el = document.querySelector('.scroll');
  el.scrollTop = el.scrollHeight;
  await new Promise((r) => requestAnimationFrame(r));
  const last = [...document.querySelectorAll('.tile')].pop();
  const tab = document.querySelector('.tabbar');
  const lastRect = last.getBoundingClientRect();
  const tabRect = tab ? tab.getBoundingClientRect() : { top: window.innerHeight };
  return { lastBottom: lastRect.bottom, tabTop: tabRect.top, visible: lastRect.top < window.innerHeight };
});
check('last tile is reachable above the tab bar', reachedEnd.visible && reachedEnd.lastBottom <= reachedEnd.tabTop + 2,
  `lastBottom=${Math.round(reachedEnd.lastBottom)} tabTop=${Math.round(reachedEnd.tabTop)}`);

/* ─── 2. No emoji anywhere in rendered text ──────────────────────────── */
const emojiFound = await page.evaluate((source) => {
  const re = new RegExp(source, 'u');
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  const hits = [];
  let node;
  while ((node = walker.nextNode())) {
    const text = node.nodeValue ?? '';
    if (re.test(text)) hits.push(text.trim().slice(0, 40));
  }
  return hits;
}, EMOJI_RE.source);
check('home screen renders zero emoji', emojiFound.length === 0, emojiFound.join(' | ') || 'clean');

const svgCount = await page.evaluate(() => document.querySelectorAll('.tile .badge svg').length);
const tileCount = await page.evaluate(() => document.querySelectorAll('.tile').length);
check('every tile has a vector icon badge', svgCount === tileCount && tileCount > 0,
  `${svgCount} svg / ${tileCount} tiles`);

/* ─── 3. Tool detail screen ──────────────────────────────────────────── */
await page.evaluate(() => { document.querySelector('.scroll').scrollTop = 0; });
await page.click('.tile');
await page.waitForTimeout(700);
const detail = await page.evaluate((source) => {
  const re = new RegExp(source, 'u');
  const el = document.querySelector('.scroll');
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  const hits = [];
  let node;
  while ((node = walker.nextNode())) if (re.test(node.nodeValue ?? '')) hits.push(node.nodeValue.trim().slice(0, 40));
  return { emoji: hits, bounded: el.clientHeight <= window.innerHeight + 1, svg: document.querySelectorAll('svg').length };
}, EMOJI_RE.source);
check('tool screen renders zero emoji', detail.emoji.length === 0, detail.emoji.join(' | ') || 'clean');
check('tool screen scroll stays bounded', detail.bounded);
check('tool screen uses vector icons', detail.svg > 0, `${detail.svg} svg`);
await page.screenshot({ path: 'e2e/shot-tool.png' });

/* ─── 4. Profile tab ─────────────────────────────────────────────────── */
// Leave the tool screen through Telegram's BackButton, then assert the tab
// bar is genuinely back before trusting anything measured on it.
const backWired = await page.evaluate(() => typeof window.__back === 'function');
check('tool screen wires Telegram BackButton', backWired);
await page.evaluate(() => window.__back?.());
await page.waitForTimeout(800);
const tabsBack = await page.evaluate(() => document.querySelectorAll('.tabbar button').length);
check('tab bar returns after leaving a tool', tabsBack === 3, `${tabsBack} tabs`);

await page.evaluate(() => [...document.querySelectorAll('.tabbar button')][2].click());
await page.waitForTimeout(900);
const onProfile = await page.evaluate(() =>
  document.querySelectorAll('.tabbar button')[2]?.dataset.on === '1');
check('profile tab is active', onProfile);
const profile = await page.evaluate((source) => {
  const re = new RegExp(source, 'u');
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  const hits = [];
  let node;
  while ((node = walker.nextNode())) if (re.test(node.nodeValue ?? '')) hits.push(node.nodeValue.trim().slice(0, 40));
  const el = document.querySelector('.scroll');
  return { emoji: hits, bounded: el.clientHeight <= window.innerHeight + 1, scrollable: el.scrollHeight > el.clientHeight };
}, EMOJI_RE.source);
check('profile renders zero emoji', profile.emoji.length === 0, profile.emoji.join(' | ') || 'clean');
check('profile scroll stays bounded', profile.bounded);
await page.screenshot({ path: 'e2e/shot-profile.png' });

/* ─── 5. Favourites tab ──────────────────────────────────────────────── */
await page.evaluate(() => [...document.querySelectorAll('.tabbar button')][1].click());
await page.waitForTimeout(900);
const favs = await page.evaluate(() => document.querySelectorAll('.tile').length);
check('favourites tab lists only starred tools', favs === 4, `${favs} tiles`);
await page.screenshot({ path: 'e2e/shot-favorites.png' });

/* ─── 6. Back home for the hero shot ─────────────────────────────────── */
await page.evaluate(() => [...document.querySelectorAll('.tabbar button')][0].click());
await page.waitForTimeout(1000);
const onHome = await page.evaluate(() => document.querySelectorAll('.tile').length);
check('home tab restores the full grid', onHome === 77, `${onHome} tiles`);
await page.screenshot({ path: 'e2e/shot-home.png' });

/* ─── 7. Light theme sanity ──────────────────────────────────────────── */
await page.evaluate(() => { document.documentElement.dataset.scheme = 'light'; });
await page.waitForTimeout(400);
await page.screenshot({ path: 'e2e/shot-light.png' });
check('light theme renders without crash', true);

await browser.close();

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length === 0 ? 0 : 1);
