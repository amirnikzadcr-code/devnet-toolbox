/**
 * UI layer for the 🛡️ Advanced Security section.
 *
 * Kept in its own module rather than bloating `ui.ts`/`pages.ts`, but it reuses
 * the existing primitives (`kb`, `navRow`, `CB`, `DIVIDER`) so navigation,
 * Back/Home behaviour and styling stay identical to the rest of the bot.
 */
import type { InlineKeyboardButton, InlineKeyboardMarkup } from '../types/telegram.js';
import type { Lang } from '../localization/index.js';
import type { ScanRow, SecurityDashboard } from '../db/scans.js';
import type { ScanType } from '../security/types.js';
import { t } from '../localization/index.js';
import { SEVERITY_META } from '../security/types.js';
import { CB, kb, navRow } from './ui.js';
import { DIVIDER, escapeHtml, formatBytes, mono } from '../utils/text.js';
import { SECURITY_LIMITS } from '../config/index.js';

/** Callback grammar for this section (still within Telegram's 64-byte cap). */
export const SEC = {
  root: 'sec',
  history: (page = 1): string => `sech:${page}`,
  dashboard: 'secd',
  /** Start a scan flow: `secr:<scanType>`. */
  run: (kind: ScanType): string => `secr:${kind}`,
  /** Re-render a stored report section: `secv:<part>`. */
  view: (part: 'full' | 'iocs' | 'score'): string => `secv:${part}`,
  scan: (id: string): string => `secs:${id}`,
} as const;

const btn = (text: string, data: string): InlineKeyboardButton => ({ text, callback_data: data });

/** The section's own menu, reachable from Home and the Toolbox. */
export function securityKeyboard(lang: Lang): InlineKeyboardMarkup {
  return kb([
    [btn(t(lang, 'btn_sec_apk'), SEC.run('apk')), btn(t(lang, 'btn_sec_url'), SEC.run('url'))],
    [btn(t(lang, 'btn_sec_privacy'), SEC.run('file')), btn(t(lang, 'btn_sec_secret'), SEC.run('secret'))],
    [btn(t(lang, 'btn_sec_deps'), SEC.run('dependency')), btn(t(lang, 'btn_sec_ioc'), SEC.run('ioc'))],
    [btn(t(lang, 'btn_sec_dashboard'), SEC.dashboard), btn(t(lang, 'btn_sec_history'), SEC.history(1))],
    navRow(lang, CB.home),
  ]);
}

/** Shown while the bot waits for the user's file or text. */
export function securityWaitingKeyboard(lang: Lang): InlineKeyboardMarkup {
  return kb([[btn(t(lang, 'btn_cancel'), SEC.root)], navRow(lang, CB.home)]);
}

/** Shown under a finished report. */
export function reportKeyboard(lang: Lang, kind: ScanType, hasIocs: boolean): InlineKeyboardMarkup {
  const rows: InlineKeyboardButton[][] = [
    [btn(t(lang, 'btn_sec_full'), SEC.view('full')), btn(t(lang, 'btn_sec_score'), SEC.view('score'))],
  ];
  if (hasIocs) rows.push([btn(t(lang, 'btn_sec_iocs'), SEC.view('iocs'))]);
  rows.push([btn(t(lang, 'btn_again'), SEC.run(kind)), btn(t(lang, 'btn_sec_history'), SEC.history(1))]);
  rows.push(navRow(lang, SEC.root));
  return kb(rows);
}

export function historyKeyboard(lang: Lang, page: number, pages: number): InlineKeyboardMarkup {
  const rows: InlineKeyboardButton[][] = [];
  if (pages > 1) {
    rows.push([
      page > 1 ? btn(t(lang, 'btn_prev'), SEC.history(page - 1)) : btn('·', CB.noop),
      btn(`${page}/${pages}`, CB.noop),
      page < pages ? btn(t(lang, 'btn_next'), SEC.history(page + 1)) : btn('·', CB.noop),
    ]);
  }
  rows.push([btn(t(lang, 'btn_sec_dashboard'), SEC.dashboard)]);
  rows.push(navRow(lang, SEC.root));
  return kb(rows);
}

export function dashboardKeyboard(lang: Lang): InlineKeyboardMarkup {
  return kb([
    [btn(t(lang, 'btn_sec_history'), SEC.history(1)), btn(t(lang, 'btn_stats'), CB.stats)],
    navRow(lang, SEC.root),
  ]);
}

// ─── Pages ────────────────────────────────────────────────────────────────

const SCAN_LABEL: Record<ScanType, { fa: string; en: string; icon: string }> = {
  apk: { fa: 'تحلیل APK', en: 'APK analysis', icon: '📱' },
  url: { fa: 'بررسی نشانی', en: 'URL check', icon: '🎣' },
  file: { fa: 'حریم خصوصی فایل', en: 'File privacy', icon: '🔒' },
  secret: { fa: 'اسکن اعتبارنامه', en: 'Secret scan', icon: '🔑' },
  dependency: { fa: 'امنیت وابستگی', en: 'Dependency security', icon: '📦' },
  ioc: { fa: 'همبستگی IOC', en: 'IOC correlation', icon: '🕸️' },
};

export const scanLabel = (lang: Lang, kind: ScanType): string =>
  `${SCAN_LABEL[kind].icon} ${lang === 'fa' ? SCAN_LABEL[kind].fa : SCAN_LABEL[kind].en}`;

export function securityPage(lang: Lang): string {
  const rows = (Object.keys(SCAN_LABEL) as ScanType[]).map((kind) => `${scanLabel(lang, kind)}`);
  return [
    t(lang, 'sec_title'),
    DIVIDER,
    t(lang, 'sec_body'),
    '',
    rows.join(' · '),
    '',
    t(lang, 'sec_privacy_note'),
  ].join('\n');
}

/** Prompt page shown once a scan type is chosen. */
export function securityPromptPage(lang: Lang, kind: ScanType): string {
  const prompt = {
    apk: t(lang, 'sec_apk_prompt', { size: formatBytes(SECURITY_LIMITS.maxApkBytes) }),
    url: t(lang, 'sec_url_prompt'),
    file: t(lang, 'sec_privacy_prompt'),
    secret: t(lang, 'sec_secret_prompt'),
    dependency: t(lang, 'sec_deps_prompt'),
    ioc: t(lang, 'sec_ioc_prompt'),
  }[kind];

  return [
    `${scanLabel(lang, kind)}`,
    DIVIDER,
    prompt,
    '',
    t(lang, 'sec_privacy_note'),
  ].join('\n');
}

function formatDate(unixSec: number): string {
  const iso = new Date(unixSec * 1000).toISOString();
  return `${iso.slice(0, 10)} ${iso.slice(11, 16)}`;
}

function historyRow(lang: Lang, row: ScanRow): string {
  const meta = SEVERITY_META[row.severity];
  return [
    `${meta.icon} <b>${escapeHtml(scanLabel(lang, row.scan_type))}</b> · ${mono(row.scan_id)}`,
    `   ${lang === 'fa' ? 'امتیاز' : 'Score'} ${row.score}/100 · ${row.findings} ${
      lang === 'fa' ? 'یافته' : 'findings'
    }${row.high_count > 0 ? ` · 🔴 ${row.high_count}` : ''}`,
    `   ${mono(row.target_label || '—')} · <i>${formatDate(row.created_at)}</i>`,
    `   <code>${row.target_hash.slice(0, 16)}…</code>`,
  ].join('\n');
}

export function historyPage(lang: Lang, rows: ScanRow[], total: number, page: number, pages: number): string {
  if (rows.length === 0) {
    return [t(lang, 'sec_history_title'), DIVIDER, t(lang, 'sec_history_empty')].join('\n');
  }
  return [
    t(lang, 'sec_history_title'),
    DIVIDER,
    t(lang, 'sec_history_body', { count: total, page, pages }),
    '',
    rows.map((row) => historyRow(lang, row)).join('\n\n'),
  ].join('\n');
}

/** Requirement 17 — new dashboard section only, existing stats untouched. */
export function dashboardPage(lang: Lang, data: SecurityDashboard): string {
  if (data.total === 0) {
    return [t(lang, 'sec_dashboard_title'), DIVIDER, t(lang, 'sec_dashboard_empty')].join('\n');
  }

  const typeRows = (Object.keys(SCAN_LABEL) as ScanType[])
    .filter((kind) => (data.byType[kind] ?? 0) > 0)
    .map((kind) => `${scanLabel(lang, kind)}: <b>${data.byType[kind]}</b>`);

  const severityRow = (['critical', 'high', 'medium', 'low', 'safe'] as const)
    .filter((severity) => data.bySeverity[severity] > 0)
    .map((severity) => `${SEVERITY_META[severity].icon} ${data.bySeverity[severity]}`)
    .join('   ');

  const risky = data.bySeverity.high + data.bySeverity.critical;

  return [
    t(lang, 'sec_dashboard_title'),
    DIVIDER,
    `${lang === 'fa' ? 'مجموع اسکن‌ها' : 'Total scans'}: <b>${data.total}</b>  ·  ${
      lang === 'fa' ? '۷ روز اخیر' : 'last 7 days'
    }: <b>${data.last7Days}</b>`,
    '',
    typeRows.join('\n'),
    '',
    `${lang === 'fa' ? 'توزیع ریسک' : 'Risk distribution'}: ${severityRow}`,
    risky > 0
      ? `\n⚠️ <b>${risky}</b> ${
          lang === 'fa'
            ? 'اسکن با ریسک بالا یا بحرانی ثبت شده است.'
            : 'scan(s) recorded as high or critical risk.'
        }`
      : '',
    DIVIDER,
    t(lang, 'sec_recent_findings'),
    data.recent.map((row) => historyRow(lang, row)).join('\n\n'),
  ]
    .filter((line) => line !== '')
    .join('\n');
}
