/**
 * Icon system — real vector glyphs, no emoji.
 *
 * Why hand-drawn inline SVG instead of an icon package:
 *  - Emoji render differently on every OS (and look like a chat message, not
 *    an app). A stroked 24px grid reads as product UI.
 *  - Every glyph inherits `currentColor` and the stroke geometry, so one badge
 *    style themes all 77 tools without per-icon assets.
 *  - Inlining costs ~3 KB gzip and zero requests; an icon font or a package
 *    would cost a network round trip inside a WebView we do not control.
 *
 * The bot registry keeps its emoji (Telegram message text needs them). The
 * Mini App maps tool id -> glyph locally, so nothing server-side changes.
 */
import type { ReactElement, ReactNode } from 'react';

/* ─── Glyph table (24×24 grid, stroked, round joins) ─────────────────── */
const G: Record<string, ReactNode> = {
  /* generic UI */
  search: (
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="m20.5 20.5-4.2-4.2" />
    </>
  ),
  close: <path d="M18 6 6 18M6 6l12 12" />,
  star: (
    <path d="M12 3.6 14.47 9l5.9.68-4.38 4.02 1.18 5.82L12 16.6l-5.17 2.92 1.18-5.82L3.63 9.68 9.53 9z" />
  ),
  check: <path d="m5 13 4.5 4.5L19 7" />,
  copy: (
    <>
      <rect x="8.5" y="8.5" width="12" height="12" rx="3" />
      <path d="M15.5 5.5a3 3 0 0 0-3-3h-6a4 4 0 0 0-4 4v6a3 3 0 0 0 3 3" />
    </>
  ),
  info: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5" />
      <circle cx="12" cy="7.8" r="1" fill="currentColor" stroke="none" />
    </>
  ),
  alert: (
    <>
      <path d="M10.3 3.9 2.5 17.4a2 2 0 0 0 1.7 3h15.6a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" />
      <path d="M12 9v4.5" />
      <circle cx="12" cy="17" r="1" fill="currentColor" stroke="none" />
    </>
  ),
  phone: (
    <>
      <rect x="6" y="2.5" width="12" height="19" rx="3" />
      <path d="M10.5 18.5h3" />
    </>
  ),
  bulb: (
    <>
      <path d="M9 17.5a6 6 0 1 1 6 0v1.5a1.5 1.5 0 0 1-1.5 1.5h-3A1.5 1.5 0 0 1 9 19z" />
      <path d="M9.5 17.5h5" />
    </>
  ),
  expand: (
    <path d="M8.5 3H6a3 3 0 0 0-3 3v2.5M15.5 3H18a3 3 0 0 1 3 3v2.5M8.5 21H6a3 3 0 0 1-3-3v-2.5M15.5 21H18a3 3 0 0 0 3-3v-2.5" />
  ),
  exit: (
    <>
      <path d="M9.5 21H6a3 3 0 0 1-3-3V6a3 3 0 0 1 3-3h3.5" />
      <path d="m16 16.5 4.5-4.5L16 7.5M20.5 12H9.5" />
    </>
  ),
  user: (
    <>
      <circle cx="12" cy="8" r="4" />
      <path d="M4.5 20.5a7.5 7.5 0 0 1 15 0" />
    </>
  ),
  grid: (
    <>
      <rect x="3" y="3" width="7.5" height="7.5" rx="2.2" />
      <rect x="13.5" y="3" width="7.5" height="7.5" rx="2.2" />
      <rect x="3" y="13.5" width="7.5" height="7.5" rx="2.2" />
      <rect x="13.5" y="13.5" width="7.5" height="7.5" rx="2.2" />
    </>
  ),
  sparkles: (
    <>
      <path d="m12 3 1.7 4.5L18 9.2l-4.3 1.7L12 15.4l-1.7-4.5L6 9.2l4.3-1.7z" />
      <path d="m18.6 15.4.75 2.05L21.4 18.2l-2.05.75-.75 2.05-.75-2.05L15.8 18.2l2.05-.75z" />
    </>
  ),
  bolt: <path d="M13.2 2.5 4.6 13.6H11l-.8 7.9 8.7-11.2H12.4z" />,
  paperclip: (
    <path d="M20 11.5 12.3 19.2a5 5 0 0 1-7.1-7.1l8.4-8.4a3.4 3.4 0 0 1 4.8 4.8l-8.3 8.4a1.8 1.8 0 0 1-2.5-2.5l7.5-7.5" />
  ),
  globe: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M3.2 9.5h17.6M3.2 14.5h17.6" />
      <ellipse cx="12" cy="12" rx="4" ry="9" />
    </>
  ),
  layers: (
    <>
      <path d="m12 3 8.5 4.5L12 12 3.5 7.5z" />
      <path d="m3.5 12.5 8.5 4.5 8.5-4.5" />
    </>
  ),
  chart: <path d="M3 21h18M6.5 21v-6.5M12 21V7M17.5 21v-10" />,
  puzzle: (
    <path d="M9 3.5a2 2 0 0 1 4 0V5h3.5a1.5 1.5 0 0 1 1.5 1.5V10h1.5a2 2 0 0 1 0 4H18v3.5a1.5 1.5 0 0 1-1.5 1.5H13v-1.5a2 2 0 0 0-4 0V19H5.5A1.5 1.5 0 0 1 4 17.5V14h1.5a2 2 0 0 0 0-4H4V6.5A1.5 1.5 0 0 1 5.5 5H9z" />
  ),

  /* families */
  code: <path d="m9 18-6-6 6-6M15 6l6 6-6 6" />,
  shield: (
    <>
      <path d="m12 3 7.5 3v5.6c0 4.5-3.1 8-7.5 9.4-4.4-1.4-7.5-4.9-7.5-9.4V6z" />
      <path d="m8.8 12 2.3 2.3 4.1-4.6" />
    </>
  ),
  wrench: (
    <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.8-3.8a6 6 0 0 1-7.9 7.9l-6.9 6.9a2.1 2.1 0 0 1-3-3l6.9-6.9a6 6 0 0 1 7.9-7.9z" />
  ),
  toolbox: (
    <>
      <rect x="2.5" y="7.5" width="19" height="13" rx="3.2" />
      <path d="M8.5 7.5V6a2.5 2.5 0 0 1 2.5-2.5h2A2.5 2.5 0 0 1 15.5 6v1.5" />
      <path d="M2.5 13h6.5M15 13h6.5" />
      <rect x="9" y="11" width="6" height="4" rx="1.2" />
    </>
  ),

  /* code / data */
  braces: (
    <>
      <path d="M8 3H7a2 2 0 0 0-2 2v4a2 2 0 0 1-2 2 2 2 0 0 1 2 2v4c0 1.1.9 2 2 2h1" />
      <path d="M16 21h1a2 2 0 0 0 2-2v-4c0-1.1.9-2 2-2a2 2 0 0 1-2-2V5a2 2 0 0 0-2-2h-1" />
    </>
  ),
  bracesCheck: (
    <>
      <path d="M9 3H7.5a2 2 0 0 0-2 2v4a2 2 0 0 1-2 2 2 2 0 0 1 2 2v4c0 1.1.9 2 2 2H9" />
      <path d="M15 3h1.5a2 2 0 0 1 2 2v3" />
      <path d="m10.5 15 2.2 2.2 4.3-4.6" />
    </>
  ),
  minimize: <path d="M4 9.5h5.5V4M20 9.5h-5.5V4M4 14.5h5.5V20M20 14.5h-5.5V20" />,
  codeXml: <path d="m18 16 4-4-4-4M6 8l-4 4 4 4M14.5 4l-5 16" />,
  markdown: (
    <>
      <rect x="2.5" y="5" width="19" height="14" rx="3" />
      <path d="M6 15.5v-7l3 3 3-3v7" />
      <path d="M17 8.5v7M14.5 13l2.5 2.5 2.5-2.5" />
    </>
  ),
  brush: (
    <>
      <path d="M12 3a9 9 0 1 0 0 18c1.1 0 2-.9 2-2 0-.5-.2-1-.5-1.3-.3-.3-.5-.8-.5-1.2 0-1.1.9-2 2-2h1.5a4.5 4.5 0 0 0 4.5-4.5C21 6.4 17 3 12 3z" />
      <circle cx="7.8" cy="11.5" r="1.2" fill="currentColor" stroke="none" />
      <circle cx="10.5" cy="7.5" r="1.2" fill="currentColor" stroke="none" />
      <circle cx="15.5" cy="8" r="1.2" fill="currentColor" stroke="none" />
    </>
  ),
  droplet: <path d="M12 3.2c3.1 3.6 6.2 6.6 6.2 10a6.2 6.2 0 0 1-12.4 0c0-3.4 3.1-6.4 6.2-10z" />,
  binary: (
    <>
      <rect x="3" y="3.5" width="6.5" height="7" rx="1.6" />
      <rect x="14.5" y="13.5" width="6.5" height="7" rx="1.6" />
      <path d="M17.5 3.5v7M14.5 3.5h3M14.5 10.5h6.5" />
      <path d="M6.5 13.5v7M3 13.5h3.5M3 20.5h6.5" />
    </>
  ),
  hash: <path d="M4.5 9h15M4.5 15h15M10 3.5 8.5 20.5M17 3.5l-1.5 17" />,
  exchange: <path d="M3.5 8h14M14 4.5 17.5 8 14 11.5M20.5 16h-14M10 12.5 6.5 16 10 19.5" />,
  swapVertical: <path d="M8 3.5v17M4.5 17 8 20.5 11.5 17M16 20.5v-17M12.5 7 16 3.5 19.5 7" />,
  table: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="2.8" />
      <path d="M3 9.5h18M3 14.8h18M9.2 4v16" />
    </>
  ),
  diff: (
    <>
      <rect x="2.8" y="4" width="8" height="16" rx="2" />
      <rect x="13.2" y="4" width="8" height="16" rx="2" />
      <path d="M5.4 9h2.8M5.4 12.5h4M16 9h2.8M16 12.5h2" />
    </>
  ),
  dice: (
    <>
      <rect x="3" y="3" width="18" height="18" rx="4.5" />
      <circle cx="8.4" cy="8.4" r="1.15" fill="currentColor" stroke="none" />
      <circle cx="15.6" cy="8.4" r="1.15" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="1.15" fill="currentColor" stroke="none" />
      <circle cx="8.4" cy="15.6" r="1.15" fill="currentColor" stroke="none" />
      <circle cx="15.6" cy="15.6" r="1.15" fill="currentColor" stroke="none" />
    </>
  ),
  flask: (
    <>
      <path d="M9.2 3h5.6M10.4 3v6L5.1 17.9a2 2 0 0 0 1.7 3h10.4a2 2 0 0 0 1.7-3L13.6 9V3" />
      <path d="M7.6 15h8.8" />
    </>
  ),
  wand: (
    <>
      <path d="m3.5 20.5 11-11M12.8 8.2l3 3" />
      <path d="M17.5 2.5v3.6M15.7 4.3h3.6M19.2 14.6v3.4M17.5 16.3h3.4" />
    </>
  ),
  container: (
    <>
      <rect x="3" y="10.2" width="4" height="4" rx="0.9" />
      <rect x="8" y="10.2" width="4" height="4" rx="0.9" />
      <rect x="13" y="10.2" width="4" height="4" rx="0.9" />
      <rect x="8" y="5.6" width="4" height="4" rx="0.9" />
      <path d="M2 16c1.7 3.6 5 5 8.8 5 4.4 0 8.1-2.4 9.4-7 .3-1 .7-1.2 1.3-1.2" />
    </>
  ),
  gitBranch: (
    <>
      <circle cx="7" cy="5.2" r="2.6" />
      <circle cx="7" cy="18.8" r="2.6" />
      <circle cx="17" cy="9.2" r="2.6" />
      <path d="M7 7.8v8.4M17 11.8c0 3.1-3.2 3.9-6.2 4.4" />
    </>
  ),
  fileText: (
    <>
      <path d="M14 2.8H7.5a2.5 2.5 0 0 0-2.5 2.5v13.4a2.5 2.5 0 0 0 2.5 2.5h9a2.5 2.5 0 0 0 2.5-2.5V7.8z" />
      <path d="M14 2.8v5h5" />
      <path d="M8.5 13h7M8.5 16.8h4.5" />
    </>
  ),
  fileX: (
    <>
      <path d="M14 2.8H7.5a2.5 2.5 0 0 0-2.5 2.5v13.4a2.5 2.5 0 0 0 2.5 2.5h9a2.5 2.5 0 0 0 2.5-2.5V7.8z" />
      <path d="M14 2.8v5h5" />
      <path d="m9.8 13.2 4.4 4.4M14.2 13.2l-4.4 4.4" />
    </>
  ),
  book: (
    <>
      <path d="M12 7.2v13.6" />
      <path d="M3 18.5a1 1 0 0 1-1-1V4.2a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13.3a1 1 0 0 1-1 1h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3z" />
    </>
  ),
  idCard: (
    <>
      <rect x="2.5" y="5" width="19" height="14" rx="3" />
      <circle cx="8.4" cy="10.8" r="2.1" />
      <path d="M5.2 16c.6-1.5 1.9-2.3 3.2-2.3s2.6.8 3.2 2.3" />
      <path d="M14.8 10h4.2M14.8 13.6h4.2" />
    </>
  ),

  /* network */
  globeSearch: (
    <>
      <circle cx="10.5" cy="10.5" r="7.5" />
      <path d="M3.2 10.5h14.6" />
      <ellipse cx="10.5" cy="10.5" rx="3.3" ry="7.5" />
      <path d="m21 21-3.7-3.7" />
    </>
  ),
  uturn: (
    <>
      <path d="M4.5 17.5h10a5 5 0 0 0 0-10H8" />
      <path d="m11 4.5-3 3 3 3" />
    </>
  ),
  mapPin: (
    <>
      <path d="M12 21.2s7-5.7 7-11.2a7 7 0 1 0-14 0c0 5.5 7 11.2 7 11.2z" />
      <circle cx="12" cy="10" r="2.6" />
    </>
  ),
  pulse: <path d="M2.5 12h4l2.6-7.2 4 14.4 2.6-7.2h5.8" />,
  listLines: <path d="M4 6.5h16M4 12h16M4 17.5h10" />,
  lock: (
    <>
      <rect x="4.5" y="10.2" width="15" height="10.6" rx="2.8" />
      <path d="M8 10.2V7a4 4 0 0 1 8 0v3.2" />
      <circle cx="12" cy="15.5" r="1.3" fill="currentColor" stroke="none" />
    </>
  ),
  unlock: (
    <>
      <rect x="4.5" y="10.2" width="15" height="10.6" rx="2.8" />
      <path d="M8 10.2V7a4 4 0 0 1 7.5-1.9" />
      <circle cx="12" cy="15.5" r="1.3" fill="currentColor" stroke="none" />
    </>
  ),
  link: (
    <>
      <path d="M10 13.2a5 5 0 0 0 7.5.5l2.6-2.6a5 5 0 0 0-7-7L11.4 6.3" />
      <path d="M14 10.8a5 5 0 0 0-7.5-.5l-2.6 2.6a5 5 0 0 0 7 7l1.6-1.6" />
    </>
  ),
  linkOff: (
    <>
      <path d="M10 13.2a5 5 0 0 0 7.5.5l1.4-1.4" />
      <path d="M14 10.8a5 5 0 0 0-7.5-.5l-2.6 2.6a5 5 0 0 0 7 7l1.6-1.6" />
      <path d="M3.5 3.5 20.5 20.5" />
    </>
  ),
  door: (
    <>
      <path d="M3.5 21h17" />
      <path d="M6 21V4.5a1.5 1.5 0 0 1 1.5-1.5h9A1.5 1.5 0 0 1 18 4.5V21" />
      <circle cx="14.8" cy="12.4" r="1.1" fill="currentColor" stroke="none" />
    </>
  ),
  signal: (
    <>
      <path d="M5.5 14.8a8 8 0 0 1 13 0" />
      <path d="M2.2 11.2a12.4 12.4 0 0 1 19.6 0" />
      <circle cx="12" cy="19" r="1.6" fill="currentColor" stroke="none" />
    </>
  ),
  radar: (
    <>
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="4.6" />
      <circle cx="12" cy="12" r="1.2" fill="currentColor" stroke="none" />
      <path d="m12 12 5.4-5.4" />
    </>
  ),
  send: (
    <>
      <path d="M21.5 2.5 14 21.5l-3.6-8.4L2.5 9.5z" />
      <path d="M21.5 2.5 10.4 13.1" />
    </>
  ),
  tag: (
    <>
      <path d="M3.5 11.4V5a1.5 1.5 0 0 1 1.5-1.5h6.4a2 2 0 0 1 1.4.6l7.2 7.2a2 2 0 0 1 0 2.8l-6.4 6.4a2 2 0 0 1-2.8 0L4.1 13.3a2 2 0 0 1-.6-1.9z" />
      <circle cx="8" cy="8" r="1.5" />
    </>
  ),

  /* security */
  key: (
    <>
      <circle cx="8" cy="15.2" r="4.2" />
      <path d="m10.9 12.2 8.6-8.6M17 6.1l2.4 2.4M14.6 8.5l2.2 2.2" />
    </>
  ),
  vault: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="3" />
      <circle cx="12" cy="12" r="4.2" />
      <path d="M12 6.4V4.8M12 19.2v-1.6M6.4 12H4.8M19.2 12h-1.6" />
    </>
  ),
  fingerprint: (
    <>
      <path d="M4 12.4a8 8 0 0 1 16 0v1.8" />
      <path d="M7.6 13a4.4 4.4 0 0 1 8.8 0c0 2.4-.4 4.6-1.3 6.6" />
      <path d="M11 13a1 1 0 0 1 2 0c0 3.2-.5 5.9-1.5 8" />
      <path d="M6.6 18.8c.9-1.7 1.4-3.6 1.4-5.8" />
    </>
  ),
  pen: (
    <>
      <path d="M17.2 3.2 20.8 6.8 8 19.6l-4.6 1 1-4.6z" />
      <path d="m14.4 6 3.6 3.6" />
    </>
  ),
  filesCompare: (
    <>
      <rect x="2.8" y="3" width="10" height="13.5" rx="2.4" />
      <rect x="11.2" y="7.5" width="10" height="13.5" rx="2.4" />
    </>
  ),
  circleCheck: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="m8.2 12 2.6 2.6 5-5.4" />
    </>
  ),

  /* everyday / math */
  calculator: (
    <>
      <rect x="4" y="2.5" width="16" height="19" rx="3" />
      <rect x="7" y="5.5" width="10" height="3.6" rx="1.2" />
      <circle cx="8.4" cy="13" r="1.05" fill="currentColor" stroke="none" />
      <circle cx="12" cy="13" r="1.05" fill="currentColor" stroke="none" />
      <circle cx="15.6" cy="13" r="1.05" fill="currentColor" stroke="none" />
      <circle cx="8.4" cy="17.2" r="1.05" fill="currentColor" stroke="none" />
      <circle cx="12" cy="17.2" r="1.05" fill="currentColor" stroke="none" />
      <circle cx="15.6" cy="17.2" r="1.05" fill="currentColor" stroke="none" />
    </>
  ),
  percent: (
    <>
      <path d="M18.5 5.5 5.5 18.5" />
      <circle cx="7.8" cy="7.8" r="2.6" />
      <circle cx="16.2" cy="16.2" r="2.6" />
    </>
  ),
  percentBadge: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M15.4 8.6 8.6 15.4" />
      <circle cx="9.6" cy="9.6" r="1.35" />
      <circle cx="14.4" cy="14.4" r="1.35" />
    </>
  ),
  gauge: (
    <>
      <path d="M3.5 18a9 9 0 1 1 17 0" />
      <path d="m12 14.5 4-4.5" />
      <circle cx="12" cy="15.4" r="1.4" fill="currentColor" stroke="none" />
    </>
  ),
  receipt: (
    <>
      <path d="M6 2.8h12a1 1 0 0 1 1 1v17.4l-3-1.7-2.5 1.7L11 19.5l-2.5 1.7L5 19.2V3.8a1 1 0 0 1 1-1z" />
      <path d="M8.6 8.5h6.8M8.6 12.5h6.8" />
    </>
  ),
  creditCard: (
    <>
      <rect x="2.5" y="5" width="19" height="14" rx="3" />
      <path d="M2.5 9.8h19" />
      <path d="M6.5 15h3.5" />
    </>
  ),
  trendingUp: <path d="m3 17.5 6-6 4 4 8-8M15 7.5h6v6" />,
  coins: (
    <>
      <circle cx="8.6" cy="8.6" r="5.6" />
      <path d="M18.4 10.6a6 6 0 1 1-7.9 7.7" />
      <path d="M7.6 6.6h1.2v4" />
    </>
  ),
  fuel: (
    <>
      <path d="M3.5 21.5h11" />
      <path d="M4.5 9.5h9" />
      <path d="M13.5 21.5V4.5a2 2 0 0 0-2-2h-5a2 2 0 0 0-2 2v17" />
      <path d="M13.5 12.8h2a2 2 0 0 1 2 2v2.2a2 2 0 0 0 4 0V9.6a2 2 0 0 0-.6-1.4L17.6 5" />
    </>
  ),
  shapes: (
    <>
      <path d="M6.8 3 11 10.6H2.6z" />
      <rect x="13.4" y="3" width="8" height="7.6" rx="1.8" />
      <circle cx="12" cy="17.6" r="4.4" />
    </>
  ),
  hardHat: (
    <>
      <path d="M4.5 16.6a7.5 7.5 0 0 1 15 0" />
      <path d="M9.4 9.6V6.2a2 2 0 0 1 2-2h1.2a2 2 0 0 1 2 2v3.4" />
      <rect x="2" y="16.6" width="20" height="3.6" rx="1.5" />
    </>
  ),
  ruler: (
    <>
      <path d="M21.3 8.7 8.7 21.3a1 1 0 0 1-1.4 0l-4.6-4.6a1 1 0 0 1 0-1.4L15.3 2.7a1 1 0 0 1 1.4 0l4.6 4.6a1 1 0 0 1 0 1.4z" />
      <path d="m7.5 10.5 2 2M10.5 7.5l2 2M13.5 4.5l2 2M4.5 13.5l2 2" />
    </>
  ),

  /* time */
  clock: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 6.8V12l3.4 2" />
    </>
  ),
  clockRepeat: (
    <>
      <path d="M21 12a9 9 0 1 1-2.9-6.6" />
      <path d="M21.2 3.8v4.4h-4.4" />
      <path d="M12 7.6V12l2.8 1.7" />
    </>
  ),
  calendar: (
    <>
      <rect x="3" y="5" width="18" height="16" rx="3" />
      <path d="M3 10h18M8 3v4M16 3v4" />
    </>
  ),
  calendarClock: (
    <>
      <path d="M21 11.4V8a3 3 0 0 0-3-3H6a3 3 0 0 0-3 3v10a3 3 0 0 0 3 3h4.6" />
      <path d="M3 10h18M8 3v4M16 3v4" />
      <circle cx="17.4" cy="17.4" r="4.4" />
      <path d="M17.4 15.4v2.2l1.5.9" />
    </>
  ),
  globeClock: (
    <>
      <path d="M20.7 13.6A9 9 0 1 0 13.4 20.8" />
      <path d="M3.4 9.5h13.4M3.4 14.5h7.2" />
      <path d="M12 3a14 14 0 0 1 0 18" />
      <path d="M12 3a14 14 0 0 0 0 18" />
      <circle cx="17.6" cy="17.6" r="4.4" />
      <path d="M17.6 15.6v2.2l1.5.9" />
    </>
  ),
  sliders: (
    <>
      <path d="M3.5 8h9M17.5 8h3M3.5 16h3M11.5 16h9" />
      <circle cx="15" cy="8" r="2.4" />
      <circle cx="9" cy="16" r="2.4" />
    </>
  ),

  /* text / misc */
  type: <path d="M4 6.5V4.5h16v2M12 4.5v15M8.8 19.5h6.4" />,
  caseConvert: (
    <>
      <path d="M2.8 18 7.2 6.2 11.6 18" />
      <path d="M4.3 14.2h5.8" />
      <circle cx="17.4" cy="14.4" r="3.6" />
      <path d="M21 10.6V18" />
    </>
  ),
  textCount: (
    <>
      <path d="M3 6h18M3 11h11" />
      <path d="M14.6 15h6.8M14.2 19h6.8M17.6 13.6l-.9 6.8M20.4 13.6l-.9 6.8" />
    </>
  ),
  qr: (
    <>
      <rect x="3" y="3" width="7" height="7" rx="1.8" />
      <rect x="14" y="3" width="7" height="7" rx="1.8" />
      <rect x="3" y="14" width="7" height="7" rx="1.8" />
      <path d="M14 14h3.2v3.2H14zM20.6 14h.4M14 20.6h3.2M20.6 17.4v3.6" />
    </>
  ),
  image: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="3" />
      <circle cx="8.4" cy="9.4" r="1.8" />
      <path d="m3.8 17.4 4.8-4.6 3.6 3.4 3-2.8 5 4" />
    </>
  ),
  layersMinus: (
    <>
      <path d="m12 3 8.5 4.5L12 12 3.5 7.5z" />
      <path d="m3.5 12.5 8.5 4.5 3.6-1.9" />
      <path d="M17 18.6h5" />
    </>
  ),
  listLink: (
    <>
      <path d="M4 6.5h9M4 12h9M4 17.5h5" />
      <path d="M16.2 15.2a2.8 2.8 0 0 1 4 0 2.8 2.8 0 0 1 0 4l-.9.9M19.4 18.4a2.8 2.8 0 0 1-4 0 2.8 2.8 0 0 1 0-4" />
    </>
  ),
};

export type IconName = keyof typeof G;

export function Icon({
  name,
  size = 20,
  filled = false,
  strokeWidth = 1.7,
  className,
  style,
}: {
  name: IconName | string;
  size?: number;
  filled?: boolean;
  strokeWidth?: number;
  className?: string;
  style?: React.CSSProperties;
}): ReactElement {
  const glyph = G[name] ?? G.puzzle;
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill={filled ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      style={{ flexShrink: 0, display: 'block', ...style }}
      aria-hidden="true"
      focusable="false"
    >
      {glyph}
    </svg>
  );
}

/* ─── Brand mark ─────────────────────────────────────────────────────── */
export function LogoMark({ size = 30 }: { size?: number }): ReactElement {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true" style={{ display: 'block' }}>
      <defs>
        <linearGradient id="dnt-logo" x1="0" y1="0" x2="24" y2="24" gradientUnits="userSpaceOnUse">
          <stop stopColor="#ffffff" stopOpacity="0.95" />
          <stop offset="1" stopColor="#ffffff" stopOpacity="0.62" />
        </linearGradient>
      </defs>
      <g stroke="url(#dnt-logo)" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
        <rect x="2.5" y="7.5" width="19" height="13" rx="3.2" />
        <path d="M8.5 7.5V6a2.5 2.5 0 0 1 2.5-2.5h2A2.5 2.5 0 0 1 15.5 6v1.5" />
        <path d="M2.5 13h6.5M15 13h6.5" />
        <rect x="9" y="11" width="6" height="4" rx="1.2" />
      </g>
    </svg>
  );
}

/* ─── Category → glyph ───────────────────────────────────────────────── */
const CATEGORY_ICON: Record<string, IconName> = {
  all: 'sparkles',
  programming: 'code',
  network: 'globe',
  security: 'shield',
  everyday: 'calculator',
  utilities: 'wrench',
  favorites: 'star',
};

export function categoryIcon(id: string): IconName {
  return CATEGORY_ICON[id] ?? 'puzzle';
}

/* ─── Tool → glyph ───────────────────────────────────────────────────── */
const TOOL_ICON: Record<string, IconName> = {
  /* programming */
  json_format: 'braces',
  json_minify: 'minimize',
  json_validate: 'bracesCheck',
  base64_encode: 'binary',
  base64_decode: 'exchange',
  url_encode: 'link',
  url_decode: 'linkOff',
  html_entities: 'codeXml',
  jwt_decode: 'idCard',
  regex_test: 'flask',
  html_format: 'codeXml',
  css_format: 'brush',
  js_format: 'code',
  markdown_html: 'markdown',
  text_stats: 'chart',
  random_string: 'dice',
  yaml_json: 'swapVertical',
  xml_format: 'tag',
  base_convert: 'binary',
  prog_calc: 'calculator',
  diff_check: 'diff',
  regex_helper: 'wand',
  docker_helper: 'container',
  git_helper: 'gitBranch',
  gitignore_gen: 'fileX',
  readme_gen: 'book',

  /* network */
  dns_lookup: 'globeSearch',
  reverse_dns: 'uturn',
  ip_info: 'mapPin',
  http_status: 'pulse',
  http_headers: 'listLines',
  ssl_info: 'shield',
  url_info: 'link',
  domain_info: 'tag',
  port_check: 'door',
  ping: 'signal',
  my_ip: 'radar',
  http_request: 'send',

  /* security */
  hash_all: 'hash',
  sha256: 'lock',
  sha1: 'unlock',
  md5: 'fingerprint',
  uuid_gen: 'idCard',
  password_gen: 'key',
  secret_gen: 'vault',
  hmac_gen: 'pen',
  file_hash_compare: 'filesCompare',

  /* everyday */
  percent_calc: 'percent',
  bmi_calc: 'gauge',
  tip_calc: 'receipt',
  installment_calc: 'creditCard',
  compound_calc: 'trendingUp',
  profit_calc: 'coins',
  tax_calc: 'percentBadge',
  fuel_calc: 'fuel',
  electricity_calc: 'bolt',
  geometry_calc: 'shapes',
  construction_calc: 'hardHat',
  currency_convert: 'exchange',

  /* utilities */
  calculator: 'calculator',
  timestamp: 'clockRepeat',
  unit_convert: 'ruler',
  qr_code: 'qr',
  text_counter: 'textCount',
  case_convert: 'caseConvert',
  color_convert: 'droplet',
  url_parse: 'listLink',
  url_normalize: 'sparkles',
  cron_helper: 'clock',
  datetime_convert: 'calendar',
  timezone_convert: 'globeClock',
  text_transform: 'type',
  dedupe_lines: 'layersMinus',
  csv_json: 'table',
  image_metadata: 'image',
  url_parse_pro: 'listLink',
  cron_builder: 'sliders',
};

export function toolIcon(id: string, category: string): IconName {
  return TOOL_ICON[id] ?? categoryIcon(category);
}
