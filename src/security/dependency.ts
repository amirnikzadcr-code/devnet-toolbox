/**
 * Dependency Risk Analysis (requirement 10).
 *
 * Parses the five manifest formats, then queries the OSV.dev API — a free,
 * authoritative aggregator (GitHub Advisory, RustSec, PyPA, Go vulndb) with no
 * API key requirement, which keeps requirement 15 satisfied: no new secret is
 * introduced.
 *
 * When the network is unavailable the parser still reports structural risks
 * (wildcard ranges, git/URL dependencies, install scripts) so the feature
 * degrades rather than fails.
 */
import type { Finding, Severity } from './types.js';
import { safeFetchGuarded } from './ssrf.js';
import { severityRank } from './risk.js';
import { errInvalidInput } from '../utils/errors.js';

export type Ecosystem = 'npm' | 'PyPI' | 'Go' | 'crates.io' | 'Packagist';

export interface Dependency {
  name: string;
  /** Raw range as written in the manifest. */
  range: string;
  /** Concrete version to query, when one can be pinned from the range. */
  resolved: string | null;
  dev: boolean;
}

export interface ManifestParse {
  ecosystem: Ecosystem;
  manifest: string;
  dependencies: Dependency[];
  findings: Finding[];
}

/** Strips range operators to the base version, or null when unpinnable. */
function pinVersion(range: string): string | null {
  const cleaned = range.trim().replace(/^[v=]+/, '');
  const match = cleaned.match(/^[\^~>=<\s]*(\d+(?:\.\d+){0,2}(?:[-+][0-9A-Za-z.-]+)?)/);
  return match?.[1] ?? null;
}

const isLooseRange = (range: string): boolean =>
  /^(\*|x|latest|>=?\s*0|.*\|\|.*)$/i.test(range.trim()) || range.trim() === '';

const isRemoteSource = (range: string): boolean =>
  /^(git\+|git:|https?:|file:|link:|github:|bitbucket:|gitlab:)/i.test(range.trim());

// ─── Parsers ──────────────────────────────────────────────────────────────

function parsePackageJson(text: string): ManifestParse {
  let json: Record<string, unknown>;
  try {
    json = JSON.parse(text) as Record<string, unknown>;
  } catch {
    throw errInvalidInput('محتوای package.json یک JSON معتبر نیست.', 'package.json content is not valid JSON.');
  }

  const dependencies: Dependency[] = [];
  const findings: Finding[] = [];

  for (const [field, dev] of [['dependencies', false], ['devDependencies', true], ['optionalDependencies', true]] as const) {
    const block = json[field];
    if (!block || typeof block !== 'object') continue;
    for (const [name, rawRange] of Object.entries(block as Record<string, unknown>)) {
      const range = String(rawRange);
      dependencies.push({ name, range, resolved: pinVersion(range), dev });
    }
  }

  const remote = dependencies.filter((dep) => isRemoteSource(dep.range));
  if (remote.length > 0) {
    findings.push({
      id: 'dep.remote_source',
      category: 'dependency',
      severity: 'high',
      confidence: 90,
      title: { fa: 'وابستگی از منبع خارج از رجیستری', en: 'Dependency from outside the registry' },
      evidence: remote.slice(0, 6).map((dep) => `${dep.name}: ${dep.range.slice(0, 60)}`),
      explanation: {
        fa: 'برخی وابستگی‌ها مستقیماً از یک آدرس Git یا URL نصب می‌شوند، نه از رجیستری رسمی. چنین منابعی نسخه‌گذاری تغییرناپذیر ندارند: محتوای همان ارجاع می‌تواند بعداً بی‌سروصدا عوض شود و هیچ فرآیند بازبینی یا اسکنی روی آن اعمال نمی‌شود.',
        en: 'Some dependencies install directly from a Git address or URL rather than the official registry. Such sources have no immutable versioning: the content behind the same reference can change silently later, and no review or scanning process applies to it.',
      },
      recommendation: {
        fa: 'به یک commit hash مشخص پین کنید یا بسته را در رجیستری خصوصی منتشر کنید.',
        en: 'Pin to a specific commit hash, or publish the package to a private registry.',
      },
    });
  }

  const scripts = json['scripts'];
  if (scripts && typeof scripts === 'object') {
    const hooks = ['preinstall', 'install', 'postinstall', 'prepare'].filter(
      (hook) => (scripts as Record<string, unknown>)[hook] !== undefined,
    );
    if (hooks.length > 0) {
      findings.push({
        id: 'dep.install_scripts',
        category: 'dependency',
        severity: 'medium',
        confidence: 85,
        title: { fa: 'اسکریپت نصب خودکار', en: 'Automatic install scripts' },
        evidence: hooks,
        explanation: {
          fa: 'این پروژه اسکریپت‌هایی دارد که هنگام `npm install` به‌طور خودکار اجرا می‌شوند. همین مکانیزم مسیر اصلی حملات زنجیره‌ی تأمین در اکوسیستم npm است، چون کد دلخواه بدون هیچ تأییدی روی ماشین توسعه‌دهنده و سرور CI اجرا می‌شود.',
          en: 'The project defines scripts that run automatically during `npm install`. This mechanism is the primary supply-chain attack path in the npm ecosystem, since arbitrary code executes on developer machines and CI servers without any confirmation.',
        },
        recommendation: {
          fa: 'در CI از `npm ci --ignore-scripts` استفاده کنید و محتوای این اسکریپت‌ها را بازبینی کنید.',
          en: 'Use `npm ci --ignore-scripts` in CI and review what these scripts do.',
        },
      });
    }
  }

  return { ecosystem: 'npm', manifest: 'package.json', dependencies, findings };
}

function parseRequirementsTxt(text: string): ManifestParse {
  const dependencies: Dependency[] = [];
  const findings: Finding[] = [];
  let unsafeIndexes = 0;

  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    if (/^--(index-url|extra-index-url|trusted-host)/.test(trimmed)) {
      unsafeIndexes++;
      continue;
    }
    if (trimmed.startsWith('-')) continue;

    const withoutMarker = trimmed.split(';')[0]?.trim() ?? '';
    const withoutExtras = withoutMarker.replace(/\[[^\]]*\]/, '');
    const match = withoutExtras.match(/^([A-Za-z0-9._-]+)\s*(.*)$/);
    if (!match) continue;
    const name = match[1] ?? '';
    const range = (match[2] ?? '').trim();
    if (!name) continue;
    dependencies.push({ name, range: range || '*', resolved: pinVersion(range), dev: false });
  }

  if (unsafeIndexes > 0) {
    findings.push({
      id: 'dep.custom_index',
      category: 'dependency',
      severity: 'medium',
      confidence: 80,
      title: { fa: 'مخزن بسته سفارشی', en: 'Custom package index' },
      evidence: [`${unsafeIndexes} index directives`],
      explanation: {
        fa: 'فایل از یک مخزن بسته‌ی غیر از PyPI رسمی استفاده می‌کند. اگر نامی هم در مخزن سفارشی و هم در PyPI وجود داشته باشد، ابزار نصب ممکن است نسخه‌ی اشتباه را انتخاب کند — این همان حمله‌ی «dependency confusion» است.',
        en: 'The file uses a package index other than official PyPI. If a name exists both in the custom index and on PyPI, the installer may pick the wrong one — the classic "dependency confusion" attack.',
      },
      recommendation: { fa: 'از `--index-url` تنها (به‌جای `--extra-index-url`) استفاده کنید.', en: 'Use `--index-url` alone rather than `--extra-index-url`.' },
    });
  }

  const unpinned = dependencies.filter((dep) => !/[=~<>]/.test(dep.range));
  if (unpinned.length > 0 && unpinned.length === dependencies.length && dependencies.length > 2) {
    findings.push({
      id: 'dep.unpinned',
      category: 'dependency',
      severity: 'low',
      confidence: 90,
      title: { fa: 'هیچ نسخه‌ای پین نشده است', en: 'No versions pinned' },
      evidence: unpinned.slice(0, 6).map((dep) => dep.name),
      explanation: {
        fa: 'هیچ‌کدام از وابستگی‌ها نسخه‌ی مشخصی ندارند. نتیجه این است که دو نصب در دو زمان مختلف کد متفاوتی می‌آورند؛ هم بازتولیدپذیری از بین می‌رود و هم یک نسخه‌ی مخرب تازه‌منتشرشده بلافاصله وارد پروژه می‌شود.',
        en: 'None of the dependencies specify a version. Two installs at different times therefore fetch different code; reproducibility is lost and a freshly published malicious version enters the project immediately.',
      },
      recommendation: { fa: 'نسخه‌ها را پین کنید و از فایل قفل (`pip freeze` یا `pip-tools`) استفاده کنید.', en: 'Pin versions and use a lock file (`pip freeze` or `pip-tools`).' },
    });
  }

  return { ecosystem: 'PyPI', manifest: 'requirements.txt', dependencies, findings };
}

function parseGoMod(text: string): ManifestParse {
  const dependencies: Dependency[] = [];
  const findings: Finding[] = [];
  let inBlock = false;

  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (trimmed.startsWith('require (')) {
      inBlock = true;
      continue;
    }
    if (inBlock && trimmed === ')') {
      inBlock = false;
      continue;
    }

    const source = inBlock ? trimmed : trimmed.startsWith('require ') ? trimmed.slice(8) : '';
    if (!source) {
      if (trimmed.startsWith('replace ')) {
        findings.push({
          id: 'dep.go_replace',
          category: 'dependency',
          severity: 'medium',
          confidence: 85,
          title: { fa: 'دستور replace در go.mod', en: '`replace` directive in go.mod' },
          evidence: [trimmed.slice(0, 100)],
          explanation: {
            fa: 'یک وابستگی با نسخه‌ی دیگری جایگزین شده است. این کار در توسعه‌ی محلی رایج است، اما اگر به شاخه‌ی اصلی راه پیدا کند، کد واقعاً کامپایل‌شده با آنچه در فایل نوشته شده تفاوت خواهد داشت.',
            en: 'A dependency is substituted with another source. Common in local development, but if it reaches the main branch the code actually compiled differs from what the file declares.',
          },
        });
      }
      continue;
    }

    const parts = source.replace(/\/\/.*$/, '').trim().split(/\s+/);
    const name = parts[0] ?? '';
    const version = parts[1] ?? '';
    if (!name || !version.startsWith('v')) continue;
    dependencies.push({
      name,
      range: version,
      resolved: version,
      dev: source.includes('// indirect'),
    });
  }

  return { ecosystem: 'Go', manifest: 'go.mod', dependencies, findings };
}

function parseCargoToml(text: string): ManifestParse {
  const dependencies: Dependency[] = [];
  const findings: Finding[] = [];
  let section = '';

  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (trimmed.startsWith('#')) continue;

    const header = trimmed.match(/^\[([^\]]+)\]$/);
    if (header) {
      section = header[1] ?? '';
      continue;
    }
    if (!/^(dependencies|dev-dependencies|build-dependencies)$/.test(section)) continue;

    const inline = trimmed.match(/^([A-Za-z0-9_-]+)\s*=\s*(.+)$/);
    if (!inline) continue;
    const name = inline[1] ?? '';
    const rawValue = (inline[2] ?? '').trim();

    let range = '';
    if (rawValue.startsWith('"') || rawValue.startsWith("'")) {
      range = rawValue.slice(1, -1);
    } else if (rawValue.startsWith('{')) {
      const versionMatch = rawValue.match(/version\s*=\s*"([^"]+)"/);
      range = versionMatch?.[1] ?? '';
      if (/\b(git|path)\s*=/.test(rawValue)) {
        findings.push({
          id: 'dep.remote_source',
          category: 'dependency',
          severity: 'medium',
          confidence: 85,
          title: { fa: 'وابستگی از منبع Git یا مسیر محلی', en: 'Dependency from Git or a local path' },
          evidence: [`${name}: ${rawValue.slice(0, 70)}`],
          explanation: {
            fa: 'این وابستگی از crates.io نمی‌آید. محتوای آن ممکن است بدون تغییر نسخه عوض شود و توسط ابزارهای بازبینی رجیستری بررسی نمی‌شود.',
            en: 'This dependency does not come from crates.io. Its content can change without a version bump and is not covered by registry review tooling.',
          },
        });
      }
    }
    if (!name || !range) continue;
    dependencies.push({ name, range, resolved: pinVersion(range), dev: section !== 'dependencies' });
  }

  return { ecosystem: 'crates.io', manifest: 'Cargo.toml', dependencies, findings };
}

function parseComposerJson(text: string): ManifestParse {
  let json: Record<string, unknown>;
  try {
    json = JSON.parse(text) as Record<string, unknown>;
  } catch {
    throw errInvalidInput('محتوای composer.json یک JSON معتبر نیست.', 'composer.json content is not valid JSON.');
  }

  const dependencies: Dependency[] = [];
  for (const [field, dev] of [['require', false], ['require-dev', true]] as const) {
    const block = json[field];
    if (!block || typeof block !== 'object') continue;
    for (const [name, rawRange] of Object.entries(block as Record<string, unknown>)) {
      if (name === 'php' || name.startsWith('ext-') || name.startsWith('lib-')) continue;
      const range = String(rawRange);
      dependencies.push({ name, range, resolved: pinVersion(range), dev });
    }
  }

  return { ecosystem: 'Packagist', manifest: 'composer.json', dependencies, findings: [] };
}

/** Detects the manifest kind from a file name and/or its content. */
export function parseManifest(text: string, fileName?: string): ManifestParse {
  const name = (fileName ?? '').toLowerCase();

  if (name.endsWith('package.json') || (!name && /"(dependencies|devDependencies)"\s*:/.test(text))) {
    return parsePackageJson(text);
  }
  if (name.endsWith('composer.json') || (!name && /"(require|require-dev)"\s*:/.test(text))) {
    return parseComposerJson(text);
  }
  if (name.endsWith('go.mod') || (!name && /^module\s+\S+/m.test(text))) {
    return parseGoMod(text);
  }
  if (name.endsWith('cargo.toml') || (!name && /^\[package\]/m.test(text))) {
    return parseCargoToml(text);
  }
  if (name.endsWith('requirements.txt') || name.endsWith('.txt') || /^[A-Za-z0-9._-]+\s*[=~<>]{1,2}\s*\d/m.test(text)) {
    return parseRequirementsTxt(text);
  }

  throw errInvalidInput(
    'قالب فایل شناسایی نشد. از package.json، requirements.txt، go.mod، Cargo.toml یا composer.json استفاده کنید.',
    'Unrecognised manifest format. Use package.json, requirements.txt, go.mod, Cargo.toml or composer.json.',
  );
}

// ─── OSV.dev vulnerability lookup ─────────────────────────────────────────

interface OsvVulnerability {
  id: string;
  summary?: string;
  aliases?: string[];
  database_specific?: { severity?: string };
  severity?: { type: string; score: string }[];
  affected?: { ranges?: { events?: { fixed?: string }[] }[] }[];
}

export interface VulnerabilityHit {
  package: string;
  version: string;
  ids: string[];
  summary: string;
  severity: Severity;
  fixedIn: string | null;
}

const OSV_SEVERITY: Record<string, Severity> = {
  CRITICAL: 'critical',
  HIGH: 'high',
  MODERATE: 'medium',
  MEDIUM: 'medium',
  LOW: 'low',
};

/** CVSS v3.1 metric weights (base score only). */
const CVSS_WEIGHTS = {
  AV: { N: 0.85, A: 0.62, L: 0.55, P: 0.2 },
  AC: { L: 0.77, H: 0.44 },
  PR: { N: 0.85, L: 0.62, H: 0.27 }, // unchanged-scope values
  PR_C: { N: 0.85, L: 0.68, H: 0.5 }, // changed-scope values
  UI: { N: 0.85, R: 0.62 },
  CIA: { H: 0.56, L: 0.22, N: 0 },
} as const;

/**
 * Computes the CVSS v3.1 base score from a vector string.
 * OSV reports vectors, not numbers, so the score has to be derived here.
 */
export function cvssBaseScore(vector: string): number | null {
  if (!/^CVSS:3\.[01]\//.test(vector)) return null;
  const parts = new Map(
    vector
      .split('/')
      .slice(1)
      .map((part) => part.split(':') as [string, string]),
  );

  const scopeChanged = parts.get('S') === 'C';
  const av = CVSS_WEIGHTS.AV[parts.get('AV') as keyof typeof CVSS_WEIGHTS.AV];
  const ac = CVSS_WEIGHTS.AC[parts.get('AC') as keyof typeof CVSS_WEIGHTS.AC];
  const pr = scopeChanged
    ? CVSS_WEIGHTS.PR_C[parts.get('PR') as keyof typeof CVSS_WEIGHTS.PR_C]
    : CVSS_WEIGHTS.PR[parts.get('PR') as keyof typeof CVSS_WEIGHTS.PR];
  const ui = CVSS_WEIGHTS.UI[parts.get('UI') as keyof typeof CVSS_WEIGHTS.UI];
  const c = CVSS_WEIGHTS.CIA[parts.get('C') as keyof typeof CVSS_WEIGHTS.CIA];
  const i = CVSS_WEIGHTS.CIA[parts.get('I') as keyof typeof CVSS_WEIGHTS.CIA];
  const a = CVSS_WEIGHTS.CIA[parts.get('A') as keyof typeof CVSS_WEIGHTS.CIA];

  if ([av, ac, pr, ui, c, i, a].some((value) => value === undefined)) return null;

  const impactSubScore = 1 - (1 - c) * (1 - i) * (1 - a);
  const impact = scopeChanged
    ? 7.52 * (impactSubScore - 0.029) - 3.25 * Math.pow(impactSubScore - 0.02, 15)
    : 6.42 * impactSubScore;
  if (impact <= 0) return 0;

  const exploitability = 8.22 * av * ac * pr * ui;
  const raw = scopeChanged
    ? Math.min(1.08 * (impact + exploitability), 10)
    : Math.min(impact + exploitability, 10);

  // CVSS rounds *up* to one decimal place.
  return Math.ceil(raw * 10) / 10;
}

/** CVSS qualitative rating bands (v3.1 §5). */
function severityFromCvss(vector: string): Severity | null {
  const score = cvssBaseScore(vector);
  if (score === null) return null;
  if (score >= 9.0) return 'critical';
  if (score >= 7.0) return 'high';
  if (score >= 4.0) return 'medium';
  if (score > 0) return 'low';
  return 'safe';
}

function severityOf(vulnerability: OsvVulnerability): Severity {
  for (const entry of vulnerability.severity ?? []) {
    const mapped = severityFromCvss(entry.score);
    if (mapped) return mapped;
  }
  const declared = vulnerability.database_specific?.severity?.toUpperCase();
  if (declared && OSV_SEVERITY[declared]) return OSV_SEVERITY[declared] as Severity;
  return 'medium';
}

/**
 * Queries OSV.dev in a single batch request.
 * Returns an empty list (not an error) when the service is unreachable, so a
 * network problem degrades the report instead of failing the scan.
 */
export async function queryOsv(
  ecosystem: Ecosystem,
  dependencies: Dependency[],
  timeoutMs = 8000,
): Promise<{ hits: VulnerabilityHit[]; queried: number; online: boolean }> {
  const queryable = dependencies.filter((dep) => dep.resolved).slice(0, 60);
  if (queryable.length === 0) return { hits: [], queried: 0, online: false };

  const body = JSON.stringify({
    queries: queryable.map((dep) => ({
      package: { name: dep.name, ecosystem },
      version: dep.resolved,
    })),
  });

  let parsed: { results?: { vulns?: OsvVulnerability[] }[] };
  try {
    const response = await safeFetchGuarded('https://api.osv.dev/v1/querybatch', {
      method: 'POST',
      body,
      headers: { 'content-type': 'application/json' },
      timeoutMs,
      maxBytes: 256 * 1024,
    });
    if (response.status !== 200 || !response.body) return { hits: [], queried: queryable.length, online: false };
    parsed = JSON.parse(response.body) as typeof parsed;
  } catch {
    return { hits: [], queried: queryable.length, online: false };
  }

  const hits: VulnerabilityHit[] = [];
  const results = parsed.results ?? [];

  for (let index = 0; index < queryable.length; index++) {
    const dependency = queryable[index];
    const vulnerabilities = results[index]?.vulns ?? [];
    if (!dependency || vulnerabilities.length === 0) continue;

    let worst: Severity = 'low';
    const ids: string[] = [];
    let fixedIn: string | null = null;
    let summary = '';

    for (const vulnerability of vulnerabilities.slice(0, 8)) {
      ids.push(vulnerability.id);
      const severity = severityOf(vulnerability);
      if (severityRank(severity) > severityRank(worst)) worst = severity;
      if (!summary && vulnerability.summary) summary = vulnerability.summary;
      for (const affected of vulnerability.affected ?? []) {
        for (const range of affected.ranges ?? []) {
          for (const event of range.events ?? []) {
            if (event.fixed && !fixedIn) fixedIn = event.fixed;
          }
        }
      }
    }

    hits.push({
      package: dependency.name,
      version: dependency.resolved ?? '?',
      ids: ids.slice(0, 5),
      summary,
      severity: worst,
      fixedIn,
    });
  }

  // `querybatch` returns ids only. Enrich the most severe-looking entries with
  // real severity data, bounded so one manifest cannot fan out into 60 calls.
  await enrichHits(hits, timeoutMs);

  return { hits, queried: queryable.length, online: true };
}

/** Fetches full records for a bounded number of vulnerabilities. */
async function enrichHits(hits: VulnerabilityHit[], timeoutMs: number): Promise<void> {
  const targets = hits.slice(0, 8);
  const details = await Promise.all(
    targets.map(async (hit) => {
      const id = hit.ids[0];
      if (!id) return null;
      try {
        const response = await safeFetchGuarded(`https://api.osv.dev/v1/vulns/${encodeURIComponent(id)}`, {
          timeoutMs,
          maxBytes: 96 * 1024,
        });
        if (response.status !== 200 || !response.body) return null;
        return JSON.parse(response.body) as OsvVulnerability;
      } catch {
        return null;
      }
    }),
  );

  for (let index = 0; index < targets.length; index++) {
    const hit = targets[index];
    const detail = details[index];
    if (!hit || !detail) continue;
    hit.severity = severityOf(detail);
    if (detail.summary) hit.summary = detail.summary;
    for (const affected of detail.affected ?? []) {
      for (const range of affected.ranges ?? []) {
        for (const event of range.events ?? []) {
          if (event.fixed && !hit.fixedIn) hit.fixedIn = event.fixed;
        }
      }
    }
  }
}

/** Turns vulnerability hits into findings. */
export function vulnerabilityFindings(hits: VulnerabilityHit[], ecosystem: Ecosystem): Finding[] {
  if (hits.length === 0) return [];

  const bySeverity = new Map<Severity, VulnerabilityHit[]>();
  for (const hit of hits) {
    if (!bySeverity.has(hit.severity)) bySeverity.set(hit.severity, []);
    bySeverity.get(hit.severity)?.push(hit);
  }

  const findings: Finding[] = [];
  for (const [severity, list] of bySeverity) {
    findings.push({
      id: `dep.vuln.${severity}`,
      category: 'dependency',
      severity,
      confidence: 95,
      title: {
        fa: `${list.length} بسته با آسیب‌پذیری شناخته‌شده (${severity})`,
        en: `${list.length} package(s) with known ${severity} vulnerabilities`,
      },
      evidence: list.slice(0, 8).map(
        (hit) => `${hit.package}@${hit.version} → ${hit.ids.slice(0, 2).join(', ')}${hit.fixedIn ? ` (fixed in ${hit.fixedIn})` : ''}`,
      ),
      explanation: {
        fa: `این بسته‌ها نسخه‌هایی دارند که در پایگاه داده‌ی OSV.dev دارای آسیب‌پذیری ثبت‌شده هستند. توجه داشته باشید که وجود یک آسیب‌پذیری در وابستگی لزوماً به معنی آسیب‌پذیر بودن برنامه‌ی شما نیست — این به آن بستگی دارد که آیا کد شما اصلاً بخش آسیب‌پذیر را فراخوانی می‌کند یا نه. با این حال، به‌روزرسانی همیشه کم‌هزینه‌تر از بررسی این موضوع است.${
          list[0]?.summary ? ` نمونه: ${list[0].summary.slice(0, 160)}` : ''
        }`,
        en: `These packages are at versions with vulnerabilities recorded in the OSV.dev database. Note that a vulnerable dependency does not automatically make your application vulnerable — that depends on whether your code reaches the affected part. Updating is nonetheless cheaper than proving it does not.${
          list[0]?.summary ? ` Example: ${list[0].summary.slice(0, 160)}` : ''
        }`,
      },
      recommendation: {
        fa: `بسته‌ها را به نسخه‌ی اصلاح‌شده ارتقا دهید${ecosystem === 'npm' ? ' (`npm audit fix`)' : ''} و پس از آن تست‌ها را اجرا کنید.`,
        en: `Upgrade to the fixed versions${ecosystem === 'npm' ? ' (`npm audit fix`)' : ''} and re-run your tests afterwards.`,
      },
    });
  }

  return findings;
}

/** Structural checks that need no network access. */
export function structuralFindings(parse: ManifestParse): Finding[] {
  const findings: Finding[] = [...parse.findings];
  const { dependencies } = parse;

  const loose = dependencies.filter((dep) => isLooseRange(dep.range) && !isRemoteSource(dep.range));
  if (loose.length > 0) {
    findings.push({
      id: 'dep.wildcard_range',
      category: 'dependency',
      severity: 'medium',
      confidence: 85,
      title: { fa: 'محدوده‌ی نسخه‌ی باز', en: 'Wildcard version range' },
      evidence: loose.slice(0, 8).map((dep) => `${dep.name}: ${dep.range}`),
      explanation: {
        fa: 'این وابستگی‌ها هر نسخه‌ای را می‌پذیرند. اگر حساب یک نگه‌دارنده به خطر بیفتد و نسخه‌ی مخربی منتشر شود، آن نسخه در اولین نصب بعدی به‌طور خودکار وارد پروژه‌ی شما می‌شود.',
        en: 'These dependencies accept any version. If a maintainer account is compromised and a malicious release is published, it enters your project automatically on the next install.',
      },
      recommendation: { fa: 'محدوده‌های مشخص تعریف کنید و فایل قفل را در نسخه‌بندی نگه دارید.', en: 'Define explicit ranges and commit the lock file.' },
    });
  }

  if (dependencies.length > 120) {
    findings.push({
      id: 'dep.large_tree',
      category: 'dependency',
      severity: 'low',
      confidence: 80,
      title: { fa: 'تعداد زیاد وابستگی مستقیم', en: 'Large number of direct dependencies' },
      evidence: [`${dependencies.length} direct dependencies`],
      explanation: {
        fa: `${dependencies.length} وابستگی مستقیم اعلام شده است. هر وابستگی یک نگه‌دارنده‌ی دیگر است که باید به او اعتماد کرد؛ سطح حمله با اندازه‌ی درخت وابستگی رشد می‌کند.`,
        en: `${dependencies.length} direct dependencies are declared. Each one is another maintainer you must trust; the attack surface grows with the size of the dependency tree.`,
      },
    });
  }

  return findings;
}
