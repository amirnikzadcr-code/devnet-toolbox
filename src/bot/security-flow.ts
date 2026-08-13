/**
 * Flow controller for the 🛡️ Advanced Security section.
 *
 * Responsibilities:
 *  • remember which scan the user started (reusing the existing KV pending
 *    mechanism rather than inventing a second one);
 *  • fetch the uploaded file, run the right analyser, persist a privacy-safe
 *    history row, and render the report;
 *  • keep every failure inside a `ToolError`, so the user never sees a stack.
 */
import type { BotContext } from './context.js';
import type { Screen } from './screens.js';
import type { TgMessage } from '../types/telegram.js';
import type { RiskReport, ScanType } from '../security/types.js';
import { t } from '../localization/index.js';
import { SECURITY_LIMITS } from '../config/index.js';
import { consumeSecurityScan } from '../services/ratelimit.js';
import { isToolError, logError, errInvalidInput, errTooLarge } from '../utils/errors.js';
import { chunk, formatBytes } from '../utils/text.js';
import { renderReport, renderIocTree, alertBanner } from '../security/report.js';
import { scanApk, scanDependencies, scanFile, scanIocs, scanSecretsText, scanUrl, highCount } from '../security/scans.js';
import { SEVERITY_META, pickText } from '../security/types.js';
import { findPreviousScan, listScans, countScans, pruneScans, recordScan, redactLabel, securityDashboard } from '../db/scans.js';
import * as SU from './security-ui.js';
import * as P from './pages.js';
import * as UI from './ui.js';

/** Scans that need a file rather than text. */
const FILE_SCANS = new Set<ScanType>(['apk', 'file']);
/** Scans that accept either text or an uploaded text file. */
const TEXT_OR_FILE_SCANS = new Set<ScanType>(['secret', 'dependency']);

const PENDING_PREFIX = 'sec:';

/** Encodes a security scan into the existing pending-tool slot. */
export const pendingIdFor = (kind: ScanType): string => `${PENDING_PREFIX}${kind}`;

export function scanTypeFromPending(toolId: string): ScanType | null {
  if (!toolId.startsWith(PENDING_PREFIX)) return null;
  const kind = toolId.slice(PENDING_PREFIX.length);
  return ['apk', 'url', 'file', 'secret', 'dependency', 'ioc'].includes(kind) ? (kind as ScanType) : null;
}

// ─── Screens ──────────────────────────────────────────────────────────────

export function securityScreen(ctx: BotContext): Screen {
  return { text: SU.securityPage(ctx.lang), keyboard: SU.securityKeyboard(ctx.lang) };
}

export function securityPromptScreen(ctx: BotContext, kind: ScanType): Screen {
  return {
    text: SU.securityPromptPage(ctx.lang, kind),
    keyboard: SU.securityWaitingKeyboard(ctx.lang),
  };
}

export async function historyScreen(ctx: BotContext, page: number): Promise<Screen> {
  const perPage = SECURITY_LIMITS.historyPerPage;
  const total = await countScans(ctx.env.DB, ctx.user.id);
  const pages = Math.max(1, Math.ceil(total / perPage));
  const safePage = Math.min(Math.max(1, page), pages);
  const rows = await listScans(ctx.env.DB, ctx.user.id, perPage, (safePage - 1) * perPage);
  return {
    text: SU.historyPage(ctx.lang, rows, total, safePage, pages),
    keyboard: SU.historyKeyboard(ctx.lang, safePage, pages),
  };
}

export async function dashboardScreen(ctx: BotContext): Promise<Screen> {
  const data = await securityDashboard(ctx.env.DB, ctx.user.id);
  return { text: SU.dashboardPage(ctx.lang, data), keyboard: SU.dashboardKeyboard(ctx.lang) };
}

// ─── Execution ────────────────────────────────────────────────────────────

export interface ScanOutcomeScreen extends Screen {
  ok: boolean;
}

/** Report bodies can exceed Telegram's limit; the first chunk goes in the edit. */
function toScreen(ctx: BotContext, report: RiskReport, kind: ScanType, note?: string): ScanOutcomeScreen {
  const body = renderReport(report, {
    lang: ctx.lang,
    ...(note ? { headerNote: note } : {}),
  });
  const parts = chunk(body, 3600);
  return {
    ok: true,
    text: parts[0] ?? body,
    keyboard: SU.reportKeyboard(ctx.lang, kind, report.iocs.length > 0),
    ...(report.severity === 'critical' || report.severity === 'high'
      ? { toast: pickText(ctx.lang, { fa: 'هشدار امنیتی', en: 'Security alert' }) }
      : {}),
  };
}

/**
 * Runs one scan end to end.
 * `message` supplies either the text input or the uploaded document.
 */
export async function runSecurityScan(
  ctx: BotContext,
  kind: ScanType,
  message: TgMessage,
): Promise<ScanOutcomeScreen> {
  const lang = ctx.lang;

  const budget = await consumeSecurityScan(ctx.env.STATE, ctx.user.id);
  if (!budget.allowed) {
    return {
      ok: false,
      text: P.errorPage(lang, t(lang, 'err_rate_limited', { seconds: budget.retryAfterSec })),
      keyboard: SU.securityKeyboard(lang),
      toast: t(lang, 'err_rate_limited', { seconds: budget.retryAfterSec }),
    };
  }

  try {
    const outcome = await dispatch(ctx, kind, message);
    const { report } = outcome;

    // Requirement 4: surface a previous verdict for the same target.
    let note: string | undefined;
    const previous = await findPreviousScan(ctx.env.DB, ctx.user.id, report.targetHash);
    if (previous) {
      note = t(lang, 'sec_cached_result', {
        date: new Date(previous.created_at * 1000).toISOString().slice(0, 10),
        id: previous.scan_id,
      });
    }

    const scanId = await recordScan(ctx.env.DB, {
      userId: ctx.user.id,
      scanType: report.scanType,
      targetHash: report.targetHash,
      targetLabel: redactLabel(report.scanType, outcome.label),
      severity: report.severity,
      score: report.score,
      findings: report.findings.length,
      highCount: highCount(report),
    });

    ctx.waitUntil(pruneScans(ctx.env.DB, SECURITY_LIMITS.historyRetentionDays));
    // Cached so "Full report" / "Indicators" / "Score" can re-render without
    // re-running the scan — the user's file is already gone by then.
    await cacheReport(ctx, report, kind);

    const screen = toScreen(ctx, report, kind, note);
    return {
      ...screen,
      text: `${screen.text}\n\n${t(lang, 'sec_scan_saved', { id: scanId })}`,
    };
  } catch (error) {
    if (isToolError(error)) {
      return {
        ok: false,
        text: P.errorPage(lang, lang === 'fa' ? error.fa : error.en),
        keyboard: SU.securityKeyboard(lang),
        toast: lang === 'fa' ? error.fa : error.en,
      };
    }
    logError('security.scan', error, { kind });
    return {
      ok: false,
      text: P.errorPage(lang, t(lang, 'err_generic')),
      keyboard: SU.securityKeyboard(lang),
      toast: t(lang, 'err_generic'),
    };
  }
}

interface Dispatched {
  report: RiskReport;
  /** Raw label, redacted before it reaches the database. */
  label: string;
}

async function dispatch(ctx: BotContext, kind: ScanType, message: TgMessage): Promise<Dispatched> {
  const text = (message.text ?? message.caption ?? '').trim();
  const document = message.document;

  if (FILE_SCANS.has(kind)) {
    if (!document) {
      throw errInvalidInput(
        message.photo
          ? 'عکس را به‌صورت «فایل/Document» ارسال کنید؛ تلگرام هنگام ارسال به‌صورت Photo متادیتا را حذف می‌کند.'
          : t(ctx.lang, 'sec_no_file'),
        message.photo
          ? 'Send the image as a Document; Telegram strips metadata when it is sent as a Photo.'
          : 'This tool requires you to send a file.',
      );
    }
    const maxBytes = kind === 'apk' ? SECURITY_LIMITS.maxApkBytes : SECURITY_LIMITS.maxFileBytes;
    const data = await download(ctx, document.file_id, document.file_size ?? 0, maxBytes);
    const name = document.file_name ?? (kind === 'apk' ? 'application.apk' : 'file');

    if (kind === 'apk') {
      const result = await scanApk(data, name);
      return { report: result.report, label: name };
    }
    const result = await scanFile(data, name, document.mime_type);
    return { report: result.report, label: name };
  }

  if (TEXT_OR_FILE_SCANS.has(kind)) {
    let content = text;
    let label = kind === 'dependency' ? 'manifest' : 'text input';

    if (document) {
      const data = await download(ctx, document.file_id, document.file_size ?? 0, SECURITY_LIMITS.maxTextBytes);
      content = new TextDecoder('utf-8', { fatal: false, ignoreBOM: false }).decode(data);
      label = document.file_name ?? label;
    }
    if (!content.trim()) {
      throw errInvalidInput('متنی برای بررسی ارسال نشده است.', 'No text was provided to scan.');
    }

    if (kind === 'secret') {
      const result = await scanSecretsText(content, document?.file_name ?? 'input');
      return { report: result.report, label };
    }
    const result = await scanDependencies(content, document?.file_name);
    return { report: result.report, label };
  }

  if (!text) {
    throw errInvalidInput('ورودی خالی است.', 'The input is empty.');
  }

  if (kind === 'url') {
    const result = await scanUrl(text);
    return { report: result.report, label: text };
  }

  const result = await scanIocs(text);
  return { report: result.report, label: 'ioc input' };
}

/** Downloads an upload, translating every failure into a user-facing error. */
async function download(
  ctx: BotContext,
  fileId: string,
  declaredSize: number,
  maxBytes: number,
): Promise<Uint8Array> {
  if (declaredSize > maxBytes) {
    throw errTooLarge(
      `حجم فایل (${formatBytes(declaredSize)}) از حد مجاز ${formatBytes(maxBytes)} بیشتر است.`,
      `The file (${formatBytes(declaredSize)}) exceeds the ${formatBytes(maxBytes)} limit.`,
    );
  }

  const result = await ctx.tg.downloadFile(fileId, maxBytes);
  if (result.ok) return result.data;

  if (result.reason === 'too_large') {
    throw errTooLarge(
      `حجم فایل از حد مجاز ${formatBytes(maxBytes)} بیشتر است.`,
      `The file exceeds the ${formatBytes(maxBytes)} limit.`,
    );
  }
  if (result.reason === 'not_found') {
    throw errInvalidInput(
      'تلگرام این فایل را در دسترس قرار نداد. توجه کنید که فایل‌های بزرگ‌تر از ۲۰ مگابایت از طریق Bot API قابل دریافت نیستند.',
      'Telegram did not make this file available. Note that files larger than 20 MB cannot be fetched through the Bot API.',
    );
  }
  throw errInvalidInput(t(ctx.lang, 'sec_download_failed'), 'Could not fetch the file from Telegram.');
}

// ─── Report sub-views ─────────────────────────────────────────────────────

/**
 * The last report is cached in KV so "Full report" / "Indicators" / "Score"
 * buttons work without re-running the scan (and without re-downloading the
 * user's file, which is never retained).
 */
const reportKey = (userId: number): string => `secrep:${userId}`;

export async function cacheReport(ctx: BotContext, report: RiskReport, kind: ScanType): Promise<void> {
  try {
    await ctx.env.STATE.put(reportKey(ctx.user.id), JSON.stringify({ report, kind }), {
      expirationTtl: 1800,
    });
  } catch (error) {
    logError('security.cacheReport', error);
  }
}

export async function readCachedReport(
  ctx: BotContext,
): Promise<{ report: RiskReport; kind: ScanType } | null> {
  try {
    return await ctx.env.STATE.get<{ report: RiskReport; kind: ScanType }>(reportKey(ctx.user.id), 'json');
  } catch {
    return null;
  }
}

export async function reportViewScreen(
  ctx: BotContext,
  part: 'full' | 'iocs' | 'score',
): Promise<Screen> {
  const cached = await readCachedReport(ctx);
  if (!cached) {
    return {
      text: P.errorPage(
        ctx.lang,
        ctx.lang === 'fa'
          ? 'گزارش دیگر در دسترس نیست. لطفاً دوباره اسکن کنید.'
          : 'The report is no longer available. Please run the scan again.',
      ),
      keyboard: SU.securityKeyboard(ctx.lang),
    };
  }

  const { report, kind } = cached;
  const keyboard = SU.reportKeyboard(ctx.lang, kind, report.iocs.length > 0);

  if (part === 'iocs') {
    return {
      text: [
        `🕸️ <b>${ctx.lang === 'fa' ? 'نشانه‌های ارتباطی' : 'Indicators of Compromise'}</b>`,
        renderIocTree(report.iocs, ctx.lang, 20),
      ].join('\n'),
      keyboard,
    };
  }

  if (part === 'score') {
    const meta = SEVERITY_META[report.severity];
    const rows = report.scoreBreakdown.map(
      (step) => `• ${pickText(ctx.lang, step.label)} → <b>+${step.points}</b>${step.detail ? `\n   <i>${step.detail}</i>` : ''}`,
    );
    return {
      text: [
        `🧮 <b>${ctx.lang === 'fa' ? 'نحوه‌ی محاسبه‌ی امتیاز' : 'Score computation'}</b>`,
        `${meta.icon} ${report.score}/100`,
        '',
        rows.length > 0 ? rows.join('\n') : ctx.lang === 'fa' ? 'یافته‌ای امتیاز نگرفت.' : 'No finding contributed points.',
        '',
        ctx.lang === 'fa'
          ? '<i>هر یافته بر اساس شدت، درصد اطمینان و تکرار وزن می‌گیرد؛ یافته‌های تکراری با ضریب کمتری شمرده می‌شوند تا چند مورد کم‌اهمیت نتوانند نتیجه را غالب کنند.</i>'
          : '<i>Each finding is weighted by severity, confidence and repetition; repeats count for less so many minor findings cannot dominate the verdict.</i>',
      ].join('\n'),
      keyboard,
    };
  }

  const body = renderReport(report, { lang: ctx.lang, detailed: true, maxFindings: 20 });
  const parts = chunk(body, 3600);
  return { text: parts[0] ?? body, keyboard };
}

/** Continuation chunks, sent as follow-up messages when a report is long. */
export function extraChunks(report: RiskReport, ctx: BotContext, detailed = false): string[] {
  const body = renderReport(report, { lang: ctx.lang, detailed, ...(detailed ? { maxFindings: 20 } : {}) });
  return chunk(body, 3600).slice(1);
}

/** Requirement 14: a standalone alert message for HIGH/CRITICAL verdicts. */
export function alertMessage(report: RiskReport, ctx: BotContext): string | null {
  const banner = alertBanner(report.severity, ctx.lang, report.scanType);
  return banner === '' ? null : banner;
}

export const securityHomeKeyboard = (ctx: BotContext) => UI.homeKeyboard(ctx.lang, ctx.env.APP_URL);
