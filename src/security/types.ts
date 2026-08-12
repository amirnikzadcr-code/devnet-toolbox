/**
 * Shared vocabulary for the 🛡️ Advanced Security module.
 *
 * Every analyser (APK, URL/phishing, file metadata, secrets, dependencies)
 * produces the same `Finding` shape so the central risk engine can score them
 * uniformly and the report renderer can print them uniformly.
 */
import type { Lang } from '../localization/index.js';

/** Ordered from harmless to worst. Index doubles as the numeric rank. */
export const SEVERITIES = ['safe', 'low', 'medium', 'high', 'critical'] as const;
export type Severity = (typeof SEVERITIES)[number];

export const SEVERITY_META: Record<Severity, { icon: string; rank: number; fa: string; en: string }> = {
  safe: { icon: '🟢', rank: 0, fa: 'ایمن', en: 'SAFE' },
  low: { icon: '🟡', rank: 1, fa: 'کم', en: 'LOW' },
  medium: { icon: '🟠', rank: 2, fa: 'متوسط', en: 'MEDIUM' },
  high: { icon: '🔴', rank: 3, fa: 'بالا', en: 'HIGH' },
  critical: { icon: '⚫', rank: 4, fa: 'بحرانی', en: 'CRITICAL' },
};

/** Which analyser produced a finding — drives grouping in the report. */
export type FindingCategory =
  | 'permission'
  | 'component'
  | 'persistence'
  | 'data-collection'
  | 'network'
  | 'obfuscation'
  | 'dynamic-code'
  | 'phishing'
  | 'privacy'
  | 'secret'
  | 'dependency'
  | 'integrity'
  | 'correlation';

export const CATEGORY_LABEL: Record<FindingCategory, { fa: string; en: string }> = {
  permission: { fa: 'مجوزها', en: 'Permissions' },
  component: { fa: 'کامپوننت‌ها', en: 'Components' },
  persistence: { fa: 'ماندگاری', en: 'Persistence' },
  'data-collection': { fa: 'جمع‌آوری داده', en: 'Data Collection' },
  network: { fa: 'شبکه', en: 'Network' },
  obfuscation: { fa: 'مبهم‌سازی', en: 'Obfuscation' },
  'dynamic-code': { fa: 'بارگذاری پویا', en: 'Dynamic Code' },
  phishing: { fa: 'فیشینگ', en: 'Phishing' },
  privacy: { fa: 'حریم خصوصی', en: 'Privacy' },
  secret: { fa: 'نشت اطلاعات محرمانه', en: 'Secret Exposure' },
  dependency: { fa: 'وابستگی‌ها', en: 'Dependencies' },
  integrity: { fa: 'یکپارچگی', en: 'Integrity' },
  correlation: { fa: 'هم‌بستگی نشانه‌ها', en: 'Risk Correlation' },
};

/**
 * A single observation. Findings are *evidence-based*: `evidence` must quote
 * what was actually observed, never a guess. `confidence` expresses how sure
 * we are that the evidence means what the title says (0..100).
 */
export interface Finding {
  /** Stable machine id, e.g. `apk.perm.record_audio`. Used for de-duplication. */
  id: string;
  category: FindingCategory;
  severity: Severity;
  /** 0..100 — how reliable this detection is. */
  confidence: number;
  title: { fa: string; en: string };
  /** Literal observed data (permission name, matched string, header value…). */
  evidence: string[];
  /** Why this matters, in plain language. */
  explanation: { fa: string; en: string };
  /** What the user should do about it. */
  recommendation?: { fa: string; en: string };
}

/** Indicator of compromise harvested from any artefact. */
export type IocKind = 'ip' | 'domain' | 'url' | 'hash' | 'email';

export interface Ioc {
  kind: IocKind;
  value: string;
  /** Where it was seen, e.g. `AndroidManifest.xml`, `classes.dex`, `redirect-chain`. */
  sources: string[];
  severity: Severity;
  confidence: number;
  /** Short reason for the assigned severity. */
  note?: { fa: string; en: string };
}

/** What kind of artefact was analysed. Mirrors the `scan_type` column in D1. */
export type ScanType = 'apk' | 'url' | 'file' | 'secret' | 'dependency' | 'ioc';

/** The complete result of one analysis run. */
export interface RiskReport {
  scanType: ScanType;
  /** Human-readable target label — a file name, domain, or `<pasted text>`. */
  target: string;
  /** SHA-256 of the artefact (files) or of the normalised target (URLs). */
  targetHash: string;
  severity: Severity;
  /** 0..100, explainable — see `explainScore`. */
  score: number;
  findings: Finding[];
  iocs: Ioc[];
  /** Key/value facts shown above the findings (package name, SDK, MIME…). */
  facts: { label: { fa: string; en: string }; value: string | number }[];
  /** Step-by-step arithmetic behind `score`, for transparency. */
  scoreBreakdown: ScoreStep[];
  /** Defensive advice derived from the findings (requirement 11). */
  hardening: { fa: string; en: string }[];
}

export interface ScoreStep {
  label: { fa: string; en: string };
  /** Points contributed (may be negative). */
  points: number;
  detail?: string;
}

export const pickText = (lang: Lang, value: { fa: string; en: string }): string =>
  lang === 'fa' ? value.fa : value.en;
