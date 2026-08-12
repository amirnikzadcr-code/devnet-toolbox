/**
 * Professional Security Report renderer (requirement 12), Security Alerts
 * (14) and the Hardening Advisor (11).
 *
 * Renders a `RiskReport` into Telegram HTML. PDF generation is deliberately
 * not attempted: producing a real PDF inside a Worker would mean bundling a
 * font and a layout engine for a document nobody reads on a phone. Telegram
 * HTML is the readable format here, and `renderMarkdown()` exists for anyone
 * who wants to archive the result.
 */
import type { Finding, Ioc, RiskReport, Severity } from './types.js';
import { CATEGORY_LABEL, SEVERITY_META, pickText } from './types.js';
import { severityRank } from './risk.js';
import { buildIocTree, iocIcon, type IocNode } from './ioc.js';
import type { Lang } from '../localization/index.js';
import { DIVIDER, escapeHtml, mono } from '../utils/text.js';

/** Requirement 14: HIGH and CRITICAL must be impossible to miss. */
export function alertBanner(severity: Severity, lang: Lang): string {
  if (severity === 'critical') {
    return pickText(lang, {
      fa: '⚫️ <b>هشدار بحرانی</b>\nنشانه‌های متعددی از رفتار خطرناک با هم دیده شده‌اند. تا روشن شدن وضعیت، این مورد را نصب/باز نکنید.',
      en: '⚫️ <b>CRITICAL ALERT</b>\nMultiple indicators of dangerous behaviour occur together. Do not install/open this until the situation is clear.',
    });
  }
  if (severity === 'high') {
    return pickText(lang, {
      fa: '🔴 <b>هشدار زیاد</b>\nیافته‌های مهمی وجود دارد که پیش از اعتماد باید بررسی شوند.',
      en: '🔴 <b>HIGH RISK</b>\nSignificant findings require review before you trust this target.',
    });
  }
  return '';
}

const severityLine = (severity: Severity, lang: Lang): string => {
  const meta = SEVERITY_META[severity];
  return `${meta.icon} <b>${escapeHtml(pickText(lang, { fa: meta.fa, en: meta.en }))}</b>`;
};

/** Renders the score as a 10-segment bar; explainable at a glance. */
function scoreBar(score: number): string {
  const filled = Math.round(score / 10);
  return `${'█'.repeat(filled)}${'░'.repeat(10 - filled)} ${score}/100`;
}

function countBySeverity(findings: Finding[]): Record<Severity, number> {
  const counts: Record<Severity, number> = { safe: 0, low: 0, medium: 0, high: 0, critical: 0 };
  for (const finding of findings) counts[finding.severity]++;
  return counts;
}

export function severitySummaryLine(findings: Finding[]): string {
  const counts = countBySeverity(findings);
  const parts: string[] = [];
  for (const severity of ['critical', 'high', 'medium', 'low'] as Severity[]) {
    if (counts[severity] > 0) parts.push(`${SEVERITY_META[severity].icon} ${counts[severity]}`);
  }
  return parts.length > 0 ? parts.join('  ') : '🟢 0';
}

function renderFinding(finding: Finding, lang: Lang, index: number): string {
  const meta = SEVERITY_META[finding.severity];
  const lines: string[] = [];

  lines.push(
    `${meta.icon} <b>${index}. ${escapeHtml(pickText(lang, finding.title))}</b>  <i>${finding.confidence}%</i>`,
  );
  lines.push(
    `<i>${escapeHtml(pickText(lang, CATEGORY_LABEL[finding.category]))}</i> · ${escapeHtml(
      pickText(lang, { fa: meta.fa, en: meta.en }),
    )}`,
  );

  if (finding.evidence.length > 0) {
    const label = pickText(lang, { fa: 'شواهد', en: 'Evidence' });
    const items = finding.evidence.slice(0, 5).map((item) => `  • ${mono(item.slice(0, 150))}`);
    lines.push(`<b>${label}:</b>\n${items.join('\n')}`);
  }

  lines.push(escapeHtml(pickText(lang, finding.explanation)));

  if (finding.recommendation) {
    lines.push(
      `💡 <i>${escapeHtml(pickText(lang, finding.recommendation))}</i>`,
    );
  }

  return lines.join('\n');
}

function renderIocNode(node: IocNode, lang: Lang, prefix: string, isLast: boolean): string[] {
  const meta = SEVERITY_META[node.ioc.severity];
  const connector = prefix === '' ? '' : isLast ? '└─ ' : '├─ ';
  const lines: string[] = [
    `${prefix}${connector}${iocIcon(node.ioc.kind)} ${meta.icon} ${mono(node.ioc.value.slice(0, 90))}${
      node.ioc.note ? ` <i>${escapeHtml(pickText(lang, node.ioc.note).slice(0, 70))}</i>` : ''
    }`,
  ];

  const childPrefix = prefix === '' ? '   ' : `${prefix}${isLast ? '   ' : '│  '}`;
  node.children.slice(0, 6).forEach((child, index, array) => {
    lines.push(...renderIocNode(child, lang, childPrefix, index === array.length - 1));
  });
  if (node.children.length > 6) {
    lines.push(`${childPrefix}└─ <i>+${node.children.length - 6}</i>`);
  }
  return lines;
}

/** Requirement 5: the IOC tree with risk and confidence per indicator. */
export function renderIocTree(iocs: Ioc[], lang: Lang, limit = 12): string {
  if (iocs.length === 0) {
    return pickText(lang, { fa: '<i>نشانه‌ای یافت نشد.</i>', en: '<i>No indicators found.</i>' });
  }
  const tree = buildIocTree(iocs);
  const lines: string[] = [];
  for (const node of tree.slice(0, limit)) {
    lines.push(...renderIocNode(node, lang, '', true));
  }
  if (tree.length > limit) {
    lines.push(
      pickText(lang, {
        fa: `<i>و ${tree.length - limit} مورد دیگر…</i>`,
        en: `<i>and ${tree.length - limit} more…</i>`,
      }),
    );
  }
  return lines.join('\n');
}

/** Requirement 11: defensive advice derived from the findings themselves. */
export function hardeningAdvice(report: RiskReport, lang: Lang): string[] {
  const advice: { fa: string; en: string }[] = [...report.hardening];
  const ids = new Set(report.findings.map((finding) => finding.id));
  const categories = new Set(report.findings.map((finding) => finding.category));

  const add = (fa: string, en: string) => advice.push({ fa, en });

  if (report.scanType === 'apk') {
    if ([...ids].some((id) => id.startsWith('apk.perm.'))) {
      add(
        'پس از نصب، در «تنظیمات ← برنامه‌ها ← مجوزها» هر مجوزی را که برای کارکرد اصلی برنامه لازم نیست لغو کنید. اندروید امروز اجازه‌ی لغو تک‌تک مجوزها را می‌دهد و بیشتر برنامه‌ها بدون آن‌ها هم کار می‌کنند.',
        'After installing, revoke any permission not needed for the app’s core function under Settings → Apps → Permissions. Modern Android allows revoking individual permissions and most apps keep working without them.',
      );
    }
    if (ids.has('apk.service.accessibility') || ids.has('apk.behaviour.keylog')) {
      add(
        'سرویس Accessibility را فقط برای برنامه‌های کمک‌توان‌یابی فعال کنید. این مجوز عملاً کنترل کامل رابط کاربری را می‌دهد و قوی‌ترین مجوز اندروید است.',
        'Only enable Accessibility services for genuine assistive apps. That permission effectively grants full UI control and is the strongest permission in Android.',
      );
    }
    if (ids.has('apk.integrity.unsigned') || ids.has('apk.config.debuggable')) {
      add(
        'برنامه‌ها را از فروشگاه رسمی نصب کنید. نصب از فایل APK دریافتی در پیام‌رسان‌ها هیچ تضمینی درباره‌ی هویت ناشر نمی‌دهد.',
        'Install apps from official stores. Side-loading an APK received in a messenger provides no guarantee about the publisher’s identity.',
      );
    }
    if (categories.has('network')) {
      add(
        'با یک فایروال محلی (مانند NetGuard) ترافیک برنامه را محدود کنید تا ببینید بدون دسترسی به اینترنت هم کار می‌کند یا نه.',
        'Restrict the app with an on-device firewall (e.g. NetGuard) to see whether it still functions without internet access.',
      );
    }
  }

  if (report.scanType === 'url') {
    add(
      'برای ورود به سرویس‌های مهم، به‌جای کلیک روی لینک، آدرس را از نشانک‌های خودتان باز کنید.',
      'For important services, open the site from your own bookmarks instead of clicking a link.',
    );
    add(
      'احراز هویت دومرحله‌ای را فعال کنید — حتی اگر رمز شما فاش شود، ورود بدون عامل دوم ممکن نخواهد بود. کلید سخت‌افزاری یا Passkey در برابر فیشینگ مقاوم است، برخلاف کد پیامکی.',
      'Enable two-factor authentication — even a leaked password will not allow sign-in without the second factor. Hardware keys and passkeys are phishing-resistant; SMS codes are not.',
    );
  }

  if (categories.has('secret')) {
    add(
      'هر اعتبارنامه‌ای که در فایل دیده شده را سوخته فرض کنید و بچرخانید. حذف کردن آن از فایل کافی نیست، چون در تاریخچه‌ی Git، لاگ CI و کش‌ها باقی می‌ماند.',
      'Treat every credential seen in the file as burned and rotate it. Removing it from the file is not enough — it persists in Git history, CI logs, and caches.',
    );
    add(
      'یک ابزار pre-commit مانند gitleaks اضافه کنید تا اعتبارنامه پیش از کامیت شدن گرفته شود.',
      'Add a pre-commit tool such as gitleaks so credentials are caught before they are committed.',
    );
  }

  if (categories.has('privacy')) {
    add(
      'پیش از انتشار عمومی فایل، متادیتا را حذف کنید. در اندروید و iOS گزینه‌ی اشتراک‌گذاری بدون اطلاعات مکان وجود دارد؛ در دسکتاپ ابزارهایی مانند exiftool این کار را انجام می‌دهند.',
      'Strip metadata before publishing a file. Android and iOS both offer “share without location”; on desktop, tools such as exiftool do the job.',
    );
  }

  if (categories.has('dependency')) {
    add(
      'فایل قفل (lock file) را در مخزن نگه دارید و به‌روزرسانی وابستگی‌ها را به یک فرآیند خودکار با بازبینی انسانی بسپارید.',
      'Keep the lock file committed and route dependency updates through an automated process with human review.',
    );
  }

  if (advice.length === 0) {
    add(
      'یافته‌ی مهمی وجود ندارد. با این حال، این تحلیل ایستا است و رفتار زمان اجرا را نمی‌بیند.',
      'No significant findings. Note nonetheless that this is static analysis and does not observe runtime behaviour.',
    );
  }

  return advice.slice(0, 6).map((item) => pickText(lang, item));
}

export interface RenderOptions {
  lang: Lang;
  /** Show the full finding list rather than the top few. */
  detailed?: boolean;
  /** Extra note appended to the header (e.g. cached-result marker). */
  headerNote?: string;
  maxFindings?: number;
}

/** Main report renderer — Telegram HTML. */
export function renderReport(report: RiskReport, options: RenderOptions): string {
  const { lang } = options;
  const maxFindings = options.maxFindings ?? (options.detailed ? 12 : 6);
  const sections: string[] = [];

  const typeLabel = pickText(lang, {
    fa: { apk: 'تحلیل APK', url: 'تحلیل نشانی', file: 'بررسی فایل', secret: 'اسکن اعتبارنامه', dependency: 'بررسی وابستگی', ioc: 'همبستگی نشانه‌ها' }[report.scanType],
    en: { apk: 'APK Analysis', url: 'URL Analysis', file: 'File Inspection', secret: 'Secret Scan', dependency: 'Dependency Review', ioc: 'IOC Correlation' }[report.scanType],
  });

  // ── Header
  sections.push(
    [
      `🛡️ <b>${escapeHtml(typeLabel)}</b>`,
      `${pickText(lang, { fa: 'هدف', en: 'Target' })}: ${mono(report.target.slice(0, 90))}`,
      options.headerNote ? `<i>${escapeHtml(options.headerNote)}</i>` : '',
    ]
      .filter(Boolean)
      .join('\n'),
  );

  const banner = alertBanner(report.severity, lang);
  if (banner) sections.push(banner);

  // ── Verdict
  sections.push(
    [
      `${pickText(lang, { fa: 'سطح ریسک', en: 'Risk level' })}: ${severityLine(report.severity, lang)}`,
      `${pickText(lang, { fa: 'امتیاز', en: 'Score' })}: ${mono(scoreBar(report.score))}`,
      `${pickText(lang, { fa: 'یافته‌ها', en: 'Findings' })}: ${severitySummaryLine(report.findings)}  (${report.findings.length})`,
    ].join('\n'),
  );

  // ── Facts
  if (report.facts.length > 0) {
    const rows = report.facts
      .slice(0, 14)
      .map((fact) => `• <b>${escapeHtml(pickText(lang, fact.label))}:</b> ${mono(String(fact.value).slice(0, 80))}`);
    sections.push(`📋 <b>${pickText(lang, { fa: 'مشخصات', en: 'Details' })}</b>\n${rows.join('\n')}`);
  }

  // ── Findings
  if (report.findings.length > 0) {
    const shown = report.findings.slice(0, maxFindings);
    const rendered = shown.map((finding, index) => renderFinding(finding, lang, index + 1));
    let block = `🔎 <b>${pickText(lang, { fa: 'یافته‌ها', en: 'Findings' })}</b>\n\n${rendered.join(`\n\n`)}`;
    if (report.findings.length > shown.length) {
      block += `\n\n<i>${pickText(lang, {
        fa: `+${report.findings.length - shown.length} یافته‌ی دیگر با شدت کمتر`,
        en: `+${report.findings.length - shown.length} further lower-severity findings`,
      })}</i>`;
    }
    sections.push(block);
  } else {
    sections.push(
      pickText(lang, {
        fa: '🟢 <b>یافته‌ی امنیتی قابل توجهی وجود ندارد.</b>\nاین به معنی «قطعاً امن» نیست؛ فقط یعنی هیچ‌کدام از الگوهای بررسی‌شده مطابقت نداشتند.',
        en: '🟢 <b>No notable security findings.</b>\nThat is not the same as “definitely safe” — it means none of the checked patterns matched.',
      }),
    );
  }

  // ── IOCs
  if (report.iocs.length > 0) {
    sections.push(
      `🕸️ <b>${pickText(lang, { fa: 'نشانه‌های ارتباطی (IOC)', en: 'Indicators of Compromise' })}</b>\n${renderIocTree(report.iocs, lang)}`,
    );
  }

  // ── Score breakdown (requirement 6: explainable)
  if (report.scoreBreakdown.length > 0) {
    const rows = report.scoreBreakdown
      .slice(0, 8)
      .map(
        (step) =>
          `• ${escapeHtml(pickText(lang, step.label))} → <b>+${step.points}</b>${
            step.detail ? `  <i>${escapeHtml(step.detail)}</i>` : ''
          }`,
      );
    const remainder = report.scoreBreakdown.slice(8);
    if (remainder.length > 0) {
      const sum = Math.round(remainder.reduce((total, step) => total + step.points, 0) * 10) / 10;
      rows.push(`• <i>+${remainder.length} ${pickText(lang, { fa: 'مورد دیگر', en: 'more' })}</i> → <b>+${sum}</b>`);
    }
    sections.push(
      `🧮 <b>${pickText(lang, { fa: 'نحوه‌ی محاسبه‌ی امتیاز', en: 'How the score was computed' })}</b>\n${rows.join('\n')}`,
    );
  }

  // ── Hardening
  const advice = hardeningAdvice(report, lang);
  if (advice.length > 0) {
    sections.push(
      `🛠️ <b>${pickText(lang, { fa: 'توصیه‌های دفاعی', en: 'Hardening recommendations' })}</b>\n${advice
        .map((item) => `• ${escapeHtml(item)}`)
        .join('\n')}`,
    );
  }

  sections.push(
    `<i>${pickText(lang, {
      fa: 'این گزارش نتیجه‌ی تحلیل ایستا و مبتنی بر الگو است و جای بررسی تخصصی را نمی‌گیرد.',
      en: 'This report is static, pattern-based analysis and does not replace expert review.',
    })}</i>`,
  );

  return sections.join(`\n${DIVIDER}\n`);
}

/** Compact one-screen summary, used in history and dashboard lists. */
export function renderSummary(report: RiskReport, lang: Lang): string {
  const meta = SEVERITY_META[report.severity];
  return [
    `${meta.icon} ${mono(report.target.slice(0, 40))}`,
    `${pickText(lang, { fa: 'امتیاز', en: 'Score' })} ${report.score} · ${severitySummaryLine(report.findings)}`,
  ].join(' — ');
}

/** Markdown export (requirement 12’s “clean Markdown/HTML” alternative). */
export function renderMarkdown(report: RiskReport, lang: Lang): string {
  const lines: string[] = [];
  const meta = SEVERITY_META[report.severity];

  lines.push(`# Security Report — ${report.scanType.toUpperCase()}`);
  lines.push('');
  lines.push(`- **Target:** \`${report.target}\``);
  lines.push(`- **Target hash:** \`${report.targetHash}\``);
  lines.push(`- **Risk:** ${meta.icon} ${meta.en} (${report.score}/100)`);
  lines.push(`- **Findings:** ${report.findings.length}`);
  lines.push('');

  if (report.facts.length > 0) {
    lines.push('## Details', '');
    lines.push('| Field | Value |', '| --- | --- |');
    for (const fact of report.facts) lines.push(`| ${pickText(lang, fact.label)} | ${String(fact.value)} |`);
    lines.push('');
  }

  if (report.findings.length > 0) {
    lines.push('## Findings', '');
    for (const finding of report.findings) {
      const finfo = SEVERITY_META[finding.severity];
      lines.push(`### ${finfo.icon} ${pickText(lang, finding.title)} (${finding.confidence}%)`);
      lines.push('');
      lines.push(`- **Category:** ${pickText(lang, CATEGORY_LABEL[finding.category])}`);
      lines.push(`- **Severity:** ${finfo.en}`);
      if (finding.evidence.length > 0) {
        lines.push(`- **Evidence:**`);
        for (const item of finding.evidence) lines.push(`  - \`${item.replace(/`/g, "'")}\``);
      }
      lines.push('');
      lines.push(pickText(lang, finding.explanation));
      if (finding.recommendation) {
        lines.push('');
        lines.push(`> **Recommendation:** ${pickText(lang, finding.recommendation)}`);
      }
      lines.push('');
    }
  }

  if (report.iocs.length > 0) {
    lines.push('## Indicators', '');
    lines.push('| Kind | Value | Severity | Confidence |', '| --- | --- | --- | --- |');
    for (const ioc of report.iocs) {
      lines.push(`| ${ioc.kind} | \`${ioc.value}\` | ${SEVERITY_META[ioc.severity].en} | ${ioc.confidence}% |`);
    }
    lines.push('');
  }

  if (report.scoreBreakdown.length > 0) {
    lines.push('## Score breakdown', '');
    for (const step of report.scoreBreakdown) {
      lines.push(`- ${pickText(lang, step.label)}: **+${step.points}**${step.detail ? ` — ${step.detail}` : ""}`);
    }
    lines.push('');
  }

  const advice = hardeningAdvice(report, lang);
  if (advice.length > 0) {
    lines.push('## Hardening', '');
    for (const item of advice) lines.push(`- ${item}`);
  }

  return lines.join('\n');
}

/** Sorts findings worst-first — used by the dashboard's "recent findings". */
export const byRisk = (a: Finding, b: Finding): number =>
  severityRank(b.severity) - severityRank(a.severity) || b.confidence - a.confidence;
