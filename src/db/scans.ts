/**
 * Scan history persistence (requirement 13) and the dashboard aggregates
 * (requirement 17).
 *
 * Privacy contract (requirement 15), enforced here rather than left to callers:
 *   • the scanned bytes are never written anywhere;
 *   • URLs and file names are reduced to a short redacted label;
 *   • the only stable identifier stored is a SHA-256 of the target.
 * That is enough to recognise a repeat scan (requirement 4) and to render
 * history, and not enough to reconstruct what the user submitted.
 */
import type { ScanType, Severity } from '../security/types.js';
import { logError } from '../utils/errors.js';

export interface ScanRow {
  scan_id: string;
  user_id: number;
  scan_type: ScanType;
  target_hash: string;
  target_label: string;
  severity: Severity;
  score: number;
  findings: number;
  high_count: number;
  created_at: number;
}

export interface RecordScanInput {
  userId: number;
  scanType: ScanType;
  targetHash: string;
  targetLabel: string;
  severity: Severity;
  score: number;
  findings: number;
  highCount: number;
}

const nowSec = (): number => Math.floor(Date.now() / 1000);

/** Short, collision-resistant-enough id for user-facing reference. */
export function newScanId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(5));
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('').toUpperCase();
}

/**
 * Reduces a target to something safe to store.
 * URLs keep only scheme+host (paths carry tokens); file names keep only the
 * extension, since a file name can itself be sensitive ("passport_scan.jpg").
 */
export function redactLabel(scanType: ScanType, raw: string): string {
  if (scanType === 'url') {
    try {
      const url = new URL(raw);
      return `${url.protocol}//${url.hostname}`.slice(0, 80);
    } catch {
      return 'url';
    }
  }
  if (scanType === 'apk' || scanType === 'file' || scanType === 'dependency') {
    const extension = raw.includes('.') ? raw.split('.').pop() ?? '' : '';
    return extension && extension.length <= 8 ? `*.${extension.toLowerCase()}` : 'file';
  }
  if (scanType === 'secret') return 'text input';
  return raw.slice(0, 40);
}

/** Inserts one history row. Failures are logged, never surfaced to the user. */
export async function recordScan(db: D1Database, input: RecordScanInput): Promise<string> {
  const scanId = newScanId();
  try {
    await db
      .prepare(
        `INSERT INTO security_scans
           (scan_id, user_id, scan_type, target_hash, target_label, severity, score, findings, high_count, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)`,
      )
      .bind(
        scanId,
        input.userId,
        input.scanType,
        input.targetHash,
        input.targetLabel.slice(0, 80),
        input.severity,
        Math.round(input.score),
        input.findings,
        input.highCount,
        nowSec(),
      )
      .run();
  } catch (error) {
    // History is a convenience; a write failure must not fail the scan itself.
    logError('db.recordScan', error, { scanType: input.scanType });
  }
  return scanId;
}

/**
 * Requirement 4: look up a previous verdict for the same target hash.
 * Scoped to the requesting user — one user's scan history must not leak to
 * another, even in the reduced form stored here.
 */
export async function findPreviousScan(
  db: D1Database,
  userId: number,
  targetHash: string,
): Promise<ScanRow | null> {
  try {
    return await db
      .prepare(
        `SELECT * FROM security_scans
         WHERE user_id = ?1 AND target_hash = ?2
         ORDER BY created_at DESC LIMIT 1`,
      )
      .bind(userId, targetHash)
      .first<ScanRow>();
  } catch (error) {
    logError('db.findPreviousScan', error);
    return null;
  }
}

export async function getScan(db: D1Database, userId: number, scanId: string): Promise<ScanRow | null> {
  try {
    return await db
      .prepare('SELECT * FROM security_scans WHERE user_id = ?1 AND scan_id = ?2')
      .bind(userId, scanId)
      .first<ScanRow>();
  } catch (error) {
    logError('db.getScan', error);
    return null;
  }
}

export async function listScans(
  db: D1Database,
  userId: number,
  limit = 10,
  offset = 0,
): Promise<ScanRow[]> {
  try {
    const result = await db
      .prepare(
        `SELECT * FROM security_scans
         WHERE user_id = ?1
         ORDER BY created_at DESC
         LIMIT ?2 OFFSET ?3`,
      )
      .bind(userId, Math.min(limit, 50), Math.max(0, offset))
      .all<ScanRow>();
    return result.results ?? [];
  } catch (error) {
    logError('db.listScans', error);
    return [];
  }
}

export async function countScans(db: D1Database, userId: number): Promise<number> {
  try {
    const row = await db
      .prepare('SELECT COUNT(*) AS n FROM security_scans WHERE user_id = ?1')
      .bind(userId)
      .first<{ n: number }>();
    return row?.n ?? 0;
  } catch (error) {
    logError('db.countScans', error);
    return 0;
  }
}

export interface SecurityDashboard {
  total: number;
  byType: Record<string, number>;
  bySeverity: Record<Severity, number>;
  recent: ScanRow[];
  last7Days: number;
}

/** Aggregates for the "Advanced Security" dashboard section. */
export async function securityDashboard(db: D1Database, userId: number): Promise<SecurityDashboard> {
  const empty: SecurityDashboard = {
    total: 0,
    byType: {},
    bySeverity: { safe: 0, low: 0, medium: 0, high: 0, critical: 0 },
    recent: [],
    last7Days: 0,
  };

  try {
    const weekAgo = nowSec() - 7 * 86400;
    const [types, severities, recent, week] = await db.batch<Record<string, unknown>>([
      db.prepare('SELECT scan_type, COUNT(*) AS n FROM security_scans WHERE user_id = ?1 GROUP BY scan_type').bind(userId),
      db.prepare('SELECT severity, COUNT(*) AS n FROM security_scans WHERE user_id = ?1 GROUP BY severity').bind(userId),
      db.prepare('SELECT * FROM security_scans WHERE user_id = ?1 ORDER BY created_at DESC LIMIT 5').bind(userId),
      db.prepare('SELECT COUNT(*) AS n FROM security_scans WHERE user_id = ?1 AND created_at >= ?2').bind(userId, weekAgo),
    ]);

    const byType: Record<string, number> = {};
    let total = 0;
    for (const row of types?.results ?? []) {
      const key = String(row['scan_type']);
      const count = Number(row['n'] ?? 0);
      byType[key] = count;
      total += count;
    }

    const bySeverity: Record<Severity, number> = { safe: 0, low: 0, medium: 0, high: 0, critical: 0 };
    for (const row of severities?.results ?? []) {
      const key = String(row['severity']) as Severity;
      if (key in bySeverity) bySeverity[key] = Number(row['n'] ?? 0);
    }

    return {
      total,
      byType,
      bySeverity,
      recent: (recent?.results ?? []) as unknown as ScanRow[],
      last7Days: Number((week?.results ?? [])[0]?.['n'] ?? 0),
    };
  } catch (error) {
    logError('db.securityDashboard', error);
    return empty;
  }
}

/**
 * Retention (requirement 15): drop rows older than the retention window.
 * Called opportunistically after a scan, from `ctx.waitUntil`, so it never
 * adds latency to the user's request.
 */
export async function pruneScans(db: D1Database, retentionDays = 90): Promise<void> {
  try {
    const cutoff = nowSec() - retentionDays * 86400;
    await db.prepare('DELETE FROM security_scans WHERE created_at < ?1').bind(cutoff).run();
  } catch (error) {
    logError('db.pruneScans', error);
  }
}
