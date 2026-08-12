/**
 * Scan orchestrators — the glue between the analysers and the bot.
 *
 * Each function takes raw input, runs the relevant analysers, and returns a
 * finished `RiskReport` through the central risk engine. Nothing here renders
 * UI and nothing here talks to Telegram: that separation keeps every scanner
 * unit-testable without a bot context.
 */
import type { Finding, Ioc, RiskReport, ScanType } from './types.js';
import { buildReport, maxSeverity, severityRank, type CorrelationRule } from './risk.js';
import { fingerprint, integrityFindings, type Fingerprint } from './fingerprint.js';
import { analyseApk, manifestFindings, APK_CORRELATIONS, type ApkAnalysis } from './apk.js';
import { sweepApkStrings } from './behaviour.js';
import { analyseUrlLive, analyseUrlStatic, PHISHING_CORRELATIONS } from './phishing.js';
import { extractMetadata } from './metadata.js';
import { scanSecrets } from './secrets.js';
import { parseManifest, queryOsv, structuralFindings, vulnerabilityFindings } from './dependency.js';
import { extractIocs } from './ioc.js';
import { assertSafeUrl } from './ssrf.js';
import { digestHex } from '../utils/hash.js';
import { formatBytes } from '../utils/text.js';
import { errInvalidInput } from '../utils/errors.js';
import { parseHttpUrl } from '../utils/validate.js';

export interface ScanOutcome {
  report: RiskReport;
  /** Extra data the renderer may show; never persisted. */
  extra?: Record<string, string | number>;
}

/** Shared facts for any file-based scan (requirement 4). */
function fingerprintFacts(print: Fingerprint, fileName?: string): RiskReport['facts'] {
  return [
    ...(fileName ? [{ label: { fa: 'نام فایل', en: 'File name' }, value: fileName }] : []),
    { label: { fa: 'حجم', en: 'Size' }, value: formatBytes(print.size) },
    { label: { fa: 'نوع واقعی', en: 'Detected type' }, value: print.detected?.label ?? 'unknown' },
    { label: { fa: 'MIME', en: 'MIME' }, value: print.detected?.mime ?? print.claimedMime ?? 'application/octet-stream' },
    { label: { fa: 'Magic bytes', en: 'Magic bytes' }, value: print.magicBytes },
    { label: { fa: 'SHA-256', en: 'SHA-256' }, value: print.sha256 },
    { label: { fa: 'SHA-1', en: 'SHA-1' }, value: print.sha1 },
    { label: { fa: 'MD5', en: 'MD5' }, value: print.md5 },
  ];
}

// ─── 1. APK ───────────────────────────────────────────────────────────────

export async function scanApk(data: Uint8Array, fileName?: string): Promise<ScanOutcome> {
  const print = await fingerprint(data, {
    ...(fileName ? { fileName } : {}),
    mimeType: 'application/vnd.android.package-archive',
  });
  const { analysis, zip } = await analyseApk(data);

  const manifest = manifestFindings(analysis);
  const findings: Finding[] = [...integrityFindings(print), ...manifest];

  // The manifest ids let the string sweep tell "a bundled library references
  // this API" apart from "this app is declared to use it".
  const sweep = await sweepApkStrings(zip, analysis, new Set(manifest.map((finding) => finding.id)));
  findings.push(...sweep.findings);

  const iocs: Ioc[] = sweep.iocs;

  const report = buildReport({
    scanType: 'apk',
    target: analysis.packageName || fileName || 'application.apk',
    targetHash: print.sha256,
    findings,
    iocs,
    facts: apkFacts(analysis, print, sweep.scannedBytes),
    correlationRules: APK_CORRELATIONS as CorrelationRule[],
  });

  return {
    report,
    extra: {
      scannedBytes: sweep.scannedBytes,
      truncated: sweep.truncated ? 1 : 0,
      dexCount: analysis.dexCount,
    },
  };
}

function apkFacts(analysis: ApkAnalysis, print: Fingerprint, scannedBytes: number): RiskReport['facts'] {
  const components = analysis.components;
  const countOf = (kind: string): number => components.filter((component) => component.kind === kind).length;
  const exported = components.filter((component) => component.exported).length;

  return [
    { label: { fa: 'نام بسته', en: 'Package name' }, value: analysis.packageName || '—' },
    ...(analysis.appLabel ? [{ label: { fa: 'نام برنامه', en: 'App label' }, value: analysis.appLabel }] : []),
    {
      label: { fa: 'نسخه', en: 'Version' },
      value: `${analysis.versionName ?? '?'} (code ${analysis.versionCode ?? '?'})`,
    },
    {
      label: { fa: 'SDK', en: 'SDK' },
      value: `min ${analysis.minSdk ?? '?'} · target ${analysis.targetSdk ?? '?'}`,
    },
    {
      label: { fa: 'کامپوننت‌ها', en: 'Components' },
      value: `A:${countOf('activity')} S:${countOf('service')} R:${countOf('receiver')} P:${countOf('provider')} · exported ${exported}`,
    },
    { label: { fa: 'مجوزها', en: 'Permissions' }, value: String(analysis.permissions.length) },
    {
      label: { fa: 'امضا', en: 'Signature' },
      value: analysis.signatureScheme.length > 0 ? analysis.signatureScheme.join(', ') : 'unsigned',
    },
    { label: { fa: 'حجم', en: 'Size' }, value: formatBytes(print.size) },
    { label: { fa: 'DEX', en: 'DEX files' }, value: String(analysis.dexCount) },
    { label: { fa: 'کد اسکن‌شده', en: 'Code scanned' }, value: formatBytes(scannedBytes) },
    { label: { fa: 'SHA-256', en: 'SHA-256' }, value: print.sha256 },
  ];
}

// ─── 2. URL / phishing ────────────────────────────────────────────────────

export async function scanUrl(rawUrl: string, options: { live?: boolean } = {}): Promise<ScanOutcome> {
  const url = parseHttpUrl(rawUrl);
  assertSafeUrl(url); // requirement 16, before any request leaves the Worker

  const staticResult = analyseUrlStatic(url);
  const findings: Finding[] = [...staticResult.findings];
  const iocs: Ioc[] = [...staticResult.iocs];
  const facts: RiskReport['facts'] = [
    { label: { fa: 'میزبان', en: 'Host' }, value: url.hostname },
    { label: { fa: 'پروتکل', en: 'Scheme' }, value: url.protocol.replace(':', '') },
    { label: { fa: 'مسیر', en: 'Path' }, value: url.pathname.slice(0, 60) || '/' },
  ];

  let liveStatus = 0;
  if (options.live !== false) {
    try {
      const live = await analyseUrlLive(url);
      findings.push(...live.findings);
      iocs.push(...live.iocs);
      liveStatus = live.status;
      facts.push(
        { label: { fa: 'وضعیت HTTP', en: 'HTTP status' }, value: live.status },
        { label: { fa: 'مقصد نهایی', en: 'Final URL' }, value: live.finalUrl.slice(0, 80) },
        { label: { fa: 'تعداد هدایت', en: 'Redirect hops' }, value: Math.max(0, live.chain.length - 1) },
      );
    } catch (error) {
      // A dead host is information too: report it instead of failing the scan.
      findings.push({
        id: 'phish.unreachable',
        category: 'network',
        severity: 'low',
        confidence: 70,
        title: { fa: 'آدرس در دسترس نبود', en: 'Address was unreachable' },
        evidence: [error instanceof Error ? error.message.slice(0, 100) : 'fetch failed'],
        explanation: {
          fa: 'اتصال به این آدرس ممکن نشد، بنابراین تنها تحلیل ساختاری نشانی انجام شد. سایت‌های فیشینگ معمولاً عمر کوتاهی دارند و پس از مسدود شدن از دسترس خارج می‌شوند.',
          en: 'The address could not be reached, so only structural analysis of the URL was performed. Phishing sites are short-lived and often go offline once blocked.',
        },
      });
    }
  }

  const report = buildReport({
    scanType: 'url',
    target: url.href.slice(0, 120),
    targetHash: await digestHex('SHA-256', `${url.protocol}//${url.host}${url.pathname}`),
    findings,
    iocs,
    facts,
    correlationRules: PHISHING_CORRELATIONS as CorrelationRule[],
  });

  return { report, extra: { indicatorRatio: staticResult.indicatorRatio, liveStatus } };
}

// ─── 3. File / metadata privacy ───────────────────────────────────────────

export async function scanFile(
  data: Uint8Array,
  fileName?: string,
  declaredMime?: string,
): Promise<ScanOutcome> {
  const print = await fingerprint(data, {
    ...(fileName ? { fileName } : {}),
    ...(declaredMime ? { mimeType: declaredMime } : {}),
  });
  const findings: Finding[] = [...integrityFindings(print)];
  const facts = fingerprintFacts(print, fileName);

  const effectiveMime = print.detected?.mime ?? declaredMime ?? 'application/octet-stream';
  const metadata = extractMetadata(data, effectiveMime);
  findings.push(...metadata.findings);

  if (metadata.items.length > 0) {
    facts.push({
      label: { fa: 'متادیتا', en: 'Metadata' },
      value: `${metadata.items.length} ${metadata.format}`,
    });
  }

  const iocs: Ioc[] = [];
  if (metadata.gps) {
    // The coordinate itself is the indicator; it is shown to the *owner* of the
    // file only, and never written to the database.
    iocs.push({
      kind: 'url',
      value: `https://www.openstreetmap.org/?mlat=${metadata.gps.latitude}&mlon=${metadata.gps.longitude}#map=16/${metadata.gps.latitude}/${metadata.gps.longitude}`,
      sources: ['exif-gps'],
      severity: 'high',
      confidence: 100,
      note: { fa: 'محل ثبت‌شده روی نقشه', en: 'Recorded location on a map' },
    });
  }

  const report = buildReport({
    scanType: 'file',
    target: fileName ?? print.detected?.label ?? 'file',
    targetHash: print.sha256,
    findings,
    iocs,
    facts,
    hardening:
      metadata.items.length === 0
        ? [
            {
              fa: 'در این فایل متادیتای حساسی یافت نشد. توجه کنید که نبود متادیتا به معنی بی‌خطر بودن محتوای فایل نیست.',
              en: 'No sensitive metadata was found in this file. Note that absence of metadata says nothing about the safety of its content.',
            },
          ]
        : [],
  });

  return {
    report,
    extra: {
      metadataCount: metadata.items.length,
      sensitiveCount: metadata.items.filter((item) => item.sensitive).length,
    },
  };
}

/** Metadata items are returned separately so the renderer can list them. */
export function metadataItems(data: Uint8Array, mime: string): ReturnType<typeof extractMetadata> {
  return extractMetadata(data, mime);
}

// ─── 4. Secrets ───────────────────────────────────────────────────────────

export async function scanSecretsText(text: string, sourceLabel = 'input'): Promise<ScanOutcome> {
  if (text.trim().length === 0) {
    throw errInvalidInput('متنی برای بررسی ارسال نشده است.', 'No text was provided to scan.');
  }

  const result = scanSecrets(text, sourceLabel);
  const facts: RiskReport['facts'] = [
    { label: { fa: 'خطوط بررسی‌شده', en: 'Lines scanned' }, value: result.linesScanned },
    { label: { fa: 'حجم ورودی', en: 'Input size' }, value: formatBytes(text.length) },
    { label: { fa: 'موارد یافت‌شده', en: 'Matches' }, value: result.hits.length },
  ];

  const report = buildReport({
    scanType: 'secret',
    target: sourceLabel,
    // Hash of the content, so a repeat scan is recognised without storing it.
    targetHash: await digestHex('SHA-256', text),
    findings: result.findings,
    facts,
    hardening:
      result.findings.length > 0
        ? [
            {
              fa: 'مقادیر واقعی در این گزارش نمایش داده نشده‌اند و در هیچ جایی ذخیره نمی‌شوند؛ فقط شماره خط و شکل ماسک‌شده گزارش شده است.',
              en: 'Actual values are not shown in this report and are never stored; only line numbers and a masked form are reported.',
            },
          ]
        : [],
  });

  return { report, extra: { matches: result.hits.length } };
}

// ─── 5. Dependencies ──────────────────────────────────────────────────────

export async function scanDependencies(text: string, fileName?: string): Promise<ScanOutcome> {
  const parse = parseManifest(text, fileName);
  const findings: Finding[] = [...structuralFindings(parse)];

  const { hits, queried, online } = await queryOsv(parse.ecosystem, parse.dependencies);
  findings.push(...vulnerabilityFindings(hits, parse.ecosystem));

  const facts: RiskReport['facts'] = [
    { label: { fa: 'قالب', en: 'Manifest' }, value: parse.manifest },
    { label: { fa: 'اکوسیستم', en: 'Ecosystem' }, value: parse.ecosystem },
    { label: { fa: 'وابستگی‌ها', en: 'Dependencies' }, value: parse.dependencies.length },
    { label: { fa: 'بررسی‌شده در OSV', en: 'Checked against OSV' }, value: online ? queried : 0 },
    { label: { fa: 'بسته‌های آسیب‌پذیر', en: 'Vulnerable packages' }, value: hits.length },
  ];

  const hardening: { fa: string; en: string }[] = [];
  if (!online) {
    hardening.push({
      fa: 'پایگاه داده‌ی آسیب‌پذیری در دسترس نبود، بنابراین فقط بررسی‌های ساختاری انجام شد. نتیجه‌ی «بدون آسیب‌پذیری» در این حالت معتبر نیست.',
      en: 'The vulnerability database was unreachable, so only structural checks ran. A "no vulnerabilities" result is not meaningful in this case.',
    });
  }
  const unpinnable = parse.dependencies.filter((dependency) => !dependency.resolved).length;
  if (unpinnable > 0) {
    hardening.push({
      fa: `${unpinnable} وابستگی نسخه‌ی قابل استخراج نداشت و در برابر پایگاه داده بررسی نشد. برای پوشش کامل، فایل قفل را بررسی کنید.`,
      en: `${unpinnable} dependencies had no extractable version and were not checked against the database. For full coverage, inspect the lock file.`,
    });
  }

  const report = buildReport({
    scanType: 'dependency',
    target: parse.manifest,
    targetHash: await digestHex('SHA-256', text),
    findings,
    facts,
    hardening,
  });

  return { report, extra: { dependencies: parse.dependencies.length, vulnerable: hits.length } };
}

// ─── 6. Free-form IOC extraction ──────────────────────────────────────────

export async function scanIocs(text: string): Promise<ScanOutcome> {
  const iocs = extractIocs(text, { source: 'input', limit: 80 });
  if (iocs.length === 0) {
    throw errInvalidInput(
      'هیچ نشانه‌ای (IP، دامنه، URL یا هش) در متن یافت نشد.',
      'No indicators (IP, domain, URL or hash) were found in the text.',
    );
  }

  const findings: Finding[] = [];
  const risky = iocs.filter((ioc) => severityRank(ioc.severity) >= severityRank('medium'));
  if (risky.length > 0) {
    findings.push({
      id: 'ioc.risky_indicators',
      category: 'network',
      severity: maxSeverity(risky.map((ioc) => ({ severity: ioc.severity }) as Finding)),
      confidence: 75,
      title: { fa: 'نشانه‌های پرریسک', en: 'Risky indicators' },
      evidence: risky.slice(0, 8).map((ioc) => `${ioc.kind}: ${ioc.value.slice(0, 90)}`),
      explanation: {
        fa: 'برخی از نشانه‌های استخراج‌شده روی زیرساخت موقت، DNS پویا یا دامنه‌های پرسوءاستفاده قرار دارند. این ارزیابی بر پایه‌ی شکل و میزبانی نشانه است، نه فهرست سیاه؛ بنابراین مطلق نیست.',
        en: 'Some extracted indicators sit on temporary infrastructure, dynamic DNS, or high-abuse domains. This assessment is based on the indicator’s shape and hosting rather than a blocklist, so it is not definitive.',
      },
      recommendation: {
        fa: 'هر دامنه را با ابزارهای شبکه‌ی همین ربات (DNS، اطلاعات دامنه، گواهی TLS) بررسی کنید.',
        en: 'Inspect each domain with this bot’s network tools (DNS, domain info, TLS certificate).',
      },
    });
  }

  const byKind = new Map<string, number>();
  for (const ioc of iocs) byKind.set(ioc.kind, (byKind.get(ioc.kind) ?? 0) + 1);

  const report = buildReport({
    scanType: 'ioc',
    target: `${iocs.length} indicators`,
    targetHash: await digestHex('SHA-256', text),
    findings,
    iocs,
    facts: [...byKind.entries()].map(([kind, count]) => ({
      label: { fa: kind, en: kind },
      value: count,
    })),
  });

  return { report, extra: { indicators: iocs.length } };
}

/** Convenience used by history and dashboard writes. */
export function highCount(report: RiskReport): number {
  return report.findings.filter((finding) => finding.severity === 'high' || finding.severity === 'critical').length;
}

export const SCAN_TYPES: ScanType[] = ['apk', 'url', 'file', 'secret', 'dependency', 'ioc'];
