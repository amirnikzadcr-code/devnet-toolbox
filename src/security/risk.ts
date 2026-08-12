/**
 * Central Security Risk Engine.
 *
 * Design goals:
 *  1. **Explainable** — every point in the final score is traceable to a
 *     finding, and `scoreBreakdown` is rendered verbatim in the report.
 *  2. **Evidence over accusation** — a single indicator never produces a
 *     CRITICAL verdict. Only *correlated* indicators escalate (see
 *     `correlate()`), because "app has RECORD_AUDIO" is not spyware.
 *  3. **Confidence-weighted** — a low-confidence HIGH contributes less than a
 *     high-confidence HIGH, so heuristic matches cannot dominate the verdict.
 */
import type { Finding, Ioc, RiskReport, ScanType, ScoreStep, Severity } from './types.js';
import { SEVERITY_META } from './types.js';

/** Base points per severity, before confidence weighting. */
const BASE_POINTS: Record<Severity, number> = {
  safe: 0,
  low: 4,
  medium: 12,
  high: 26,
  critical: 40,
};

/**
 * Diminishing returns: the 1st finding of a severity counts fully, the 2nd
 * 60%, the 3rd 40%… Ten medium findings must not out-score one critical one.
 */
const decay = (index: number): number => (index === 0 ? 1 : Math.max(0.2, 1 / (1 + index * 0.7)));

/** Score thresholds → severity band. */
const BANDS: { min: number; severity: Severity }[] = [
  { min: 75, severity: 'critical' },
  { min: 50, severity: 'high' },
  { min: 25, severity: 'medium' },
  { min: 8, severity: 'low' },
  { min: 0, severity: 'safe' },
];

export function severityFromScore(score: number): Severity {
  for (const band of BANDS) if (score >= band.min) return band.severity;
  return 'safe';
}

export const severityRank = (severity: Severity): number => SEVERITY_META[severity].rank;

export function maxSeverity(findings: Finding[]): Severity {
  let worst: Severity = 'safe';
  for (const finding of findings) {
    if (severityRank(finding.severity) > severityRank(worst)) worst = finding.severity;
  }
  return worst;
}

/** Removes duplicate findings by id, keeping the highest-severity instance. */
export function dedupeFindings(findings: Finding[]): Finding[] {
  const byId = new Map<string, Finding>();
  for (const finding of findings) {
    const existing = byId.get(finding.id);
    if (!existing || severityRank(finding.severity) > severityRank(existing.severity)) {
      byId.set(finding.id, finding);
    } else if (existing) {
      // Merge evidence so nothing observed is silently dropped.
      const merged = new Set([...existing.evidence, ...finding.evidence]);
      existing.evidence = [...merged].slice(0, 12);
    }
  }
  return [...byId.values()].sort(
    (a, b) => severityRank(b.severity) - severityRank(a.severity) || b.confidence - a.confidence,
  );
}

/**
 * Computes the 0..100 score plus a human-readable breakdown.
 * Findings are processed worst-first so decay favours the severe ones.
 */
export function scoreFindings(findings: Finding[]): { score: number; steps: ScoreStep[] } {
  const steps: ScoreStep[] = [];
  // Decay is keyed by category *and* severity. Keyed by severity alone, a long
  // permission list (every entry medium/100%) accumulated more points than a
  // genuine correlated threat, because unrelated categories shared one decay
  // curve. Grouping by category means "the eighth permission adds little"
  // without muting the first finding of some other category.
  const seenPerGroup = new Map<string, number>();
  let total = 0;

  const ordered = [...findings].sort(
    (a, b) => severityRank(b.severity) - severityRank(a.severity) || b.confidence - a.confidence,
  );

  for (const finding of ordered) {
    if (finding.severity === 'safe') continue;
    const group = `${finding.category}:${finding.severity}`;
    const index = seenPerGroup.get(group) ?? 0;
    seenPerGroup.set(group, index + 1);

    const base = BASE_POINTS[finding.severity];
    const weighted = base * (finding.confidence / 100) * decay(index);
    const points = Math.round(weighted * 10) / 10;
    if (points <= 0) continue;

    total += points;
    steps.push({
      label: finding.title,
      points,
      detail: `${SEVERITY_META[finding.severity].icon} ${SEVERITY_META[finding.severity].en} × ${finding.confidence}%${
        index > 0 ? ` × ${Math.round(decay(index) * 100)}% (repeat)` : ''
      }`,
    });
  }

  const score = Math.max(0, Math.min(100, Math.round(total)));
  return { score, steps };
}

/**
 * Risk Correlation (requirement 1).
 *
 * Emits an extra finding only when *several independent* indicators co-occur.
 * This is the only place allowed to raise a CRITICAL verdict, precisely so a
 * lone permission can never be branded spyware.
 */
export interface CorrelationRule {
  id: string;
  /** Finding ids (or id prefixes ending in `*`) that must all be present. */
  requires: string[];
  /**
   * A pattern from `requires` that must match regardless of `minMatches`.
   * Without it, a permissive `minMatches` lets the *incidental* members of a
   * rule fire it on their own — e.g. "boot + background service", which
   * describes a large share of ordinary apps, satisfying a device-admin rule
   * that never saw a device-admin component.
   */
  anchor?: string;
  /** How many of `requires` must match. Defaults to all of them. */
  minMatches?: number;
  severity: Severity;
  confidence: number;
  title: { fa: string; en: string };
  explanation: { fa: string; en: string };
  recommendation?: { fa: string; en: string };
}

const matches = (pattern: string, ids: Set<string>): string | null => {
  if (pattern.endsWith('*')) {
    const prefix = pattern.slice(0, -1);
    for (const id of ids) if (id.startsWith(prefix)) return id;
    return null;
  }
  return ids.has(pattern) ? pattern : null;
};

export function correlate(findings: Finding[], rules: CorrelationRule[]): Finding[] {
  const ids = new Set(findings.map((finding) => finding.id));
  const out: Finding[] = [];

  for (const rule of rules) {
    const hits = rule.requires.map((pattern) => matches(pattern, ids)).filter((hit): hit is string => hit !== null);
    const needed = rule.minMatches ?? rule.requires.length;
    if (hits.length < needed) continue;
    if (rule.anchor && matches(rule.anchor, ids) === null) continue;

    out.push({
      id: rule.id,
      category: 'correlation',
      severity: rule.severity,
      confidence: rule.confidence,
      title: rule.title,
      evidence: hits,
      explanation: rule.explanation,
      ...(rule.recommendation ? { recommendation: rule.recommendation } : {}),
    });
  }
  return out;
}

/** De-duplicates IOCs by kind+value, merging sources and keeping worst severity. */
export function mergeIocs(iocs: Ioc[]): Ioc[] {
  const map = new Map<string, Ioc>();
  for (const ioc of iocs) {
    const key = `${ioc.kind}:${ioc.value.toLowerCase()}`;
    const existing = map.get(key);
    if (!existing) {
      map.set(key, { ...ioc, sources: [...new Set(ioc.sources)] });
      continue;
    }
    existing.sources = [...new Set([...existing.sources, ...ioc.sources])];
    if (severityRank(ioc.severity) > severityRank(existing.severity)) {
      existing.severity = ioc.severity;
      if (ioc.note) existing.note = ioc.note;
    }
    existing.confidence = Math.max(existing.confidence, ioc.confidence);
  }
  return [...map.values()].sort(
    (a, b) => severityRank(b.severity) - severityRank(a.severity) || a.value.localeCompare(b.value),
  );
}

export interface BuildReportInput {
  scanType: ScanType;
  target: string;
  targetHash: string;
  findings: Finding[];
  iocs?: Ioc[];
  facts?: RiskReport['facts'];
  correlationRules?: CorrelationRule[];
  hardening?: { fa: string; en: string }[];
}

/**
 * Ceiling applied when nothing correlates.
 * The doc comment at the top of this file promises that a single indicator can
 * never produce a CRITICAL verdict — this is where that promise is *enforced*
 * rather than merely intended. Without it, an app with a long list of
 * individually-explainable permissions (a legitimate app store, a backup tool)
 * accumulates enough points to be branded critical, which is exactly the
 * accusation-without-evidence the design set out to avoid.
 */
const UNCORRELATED_SCORE_CEILING = 74; // top of the HIGH band

/** Confidence at or above which a finding counts as an observed fact. */
const CONFIRMED_CONFIDENCE = 95;

/** Single entry point every analyser uses to turn raw findings into a report. */
export function buildReport(input: BuildReportInput): RiskReport {
  const base = dedupeFindings(input.findings);
  const correlated = input.correlationRules ? correlate(base, input.correlationRules) : [];
  const findings = dedupeFindings([...base, ...correlated]);
  const scored = scoreFindings(findings);
  const steps = scored.steps;
  let score = scored.score;

  // A verdict can never be worse than the worst thing actually observed.
  const worstObserved = maxSeverity(findings);
  const hasCritical = findings.some((finding) => finding.severity === 'critical');

  if (!hasCritical && score > UNCORRELATED_SCORE_CEILING) {
    steps.push({
      label: {
        fa: 'سقف امتیاز: هیچ الگوی همبسته‌ای یافت نشد',
        en: 'Score ceiling: no correlated pattern found',
      },
      points: Math.round((UNCORRELATED_SCORE_CEILING - score) * 10) / 10,
      detail: 'single indicators alone cannot reach CRITICAL',
    });
    score = UNCORRELATED_SCORE_CEILING;
  }

  // Band from score, then clamped to the worst individual finding: a pile of
  // LOW findings must not add up to a HIGH verdict either.
  const band = severityFromScore(score);
  let severity = severityRank(band) > severityRank(worstObserved) ? worstObserved : band;

  // …and never *below* LOW while a real finding exists. A handful of small
  // findings can score under the LOW band and render as 🟢 SAFE, which reads
  // as "nothing here" directly above a list of things that are there.
  if (findings.length > 0 && severityRank(worstObserved) > severityRank('safe') && severity === 'safe') {
    severity = 'low';
  }

  // A correlation that concluded CRITICAL must be reported as CRITICAL. The
  // score bands are a summary of accumulated evidence; when several indicators
  // have already been matched against a named threat pattern, the verdict is
  // that pattern's, not the arithmetic's.
  if (hasCritical && severity !== 'critical') {
    const fromCorrelation = findings.some(
      (item) => item.severity === 'critical' && item.category === 'correlation',
    );
    severity = 'critical';
    steps.push({
      label: fromCorrelation
        ? { fa: 'الگوی همبستهٔ بحرانی', en: 'Correlated critical pattern' }
        : { fa: 'یافته‌ی بحرانی قطعی', en: 'Confirmed critical finding' },
      points: 0,
      detail: fromCorrelation ? 'verdict set by correlation rule' : 'verdict set by a critical finding',
    });
  }

  // Floor for *confirmed* facts. Score arithmetic averages things out, which
  // is right for heuristics but wrong for certainties: a photo carrying exact
  // GPS coordinates is a HIGH privacy problem at 100% confidence, and summing
  // it with a few minor findings must not report it as MEDIUM. Capped at HIGH
  // so this can never substitute for correlation on the way to CRITICAL.
  const confirmedFloor = findings
    .filter((finding) => finding.confidence >= CONFIRMED_CONFIDENCE && finding.severity !== 'critical')
    .reduce<Severity>((worst, finding) => (severityRank(finding.severity) > severityRank(worst) ? finding.severity : worst), 'safe');

  if (severityRank(confirmedFloor) > severityRank(severity)) {
    severity = confirmedFloor;
    steps.push({
      label: {
        fa: 'کف شدت: یافته‌ی قطعی با اطمینان بالا',
        en: 'Severity floor: confirmed high-confidence finding',
      },
      points: 0,
      detail: `verdict raised to ${SEVERITY_META[confirmedFloor].en}`,
    });
  }

  return {
    scanType: input.scanType,
    target: input.target,
    targetHash: input.targetHash,
    severity,
    score,
    findings,
    iocs: mergeIocs(input.iocs ?? []),
    facts: input.facts ?? [],
    scoreBreakdown: steps,
    hardening: input.hardening ?? [],
  };
}
