/**
 * Central configuration. Every tunable lives here — no magic numbers in logic.
 */
export const APP = {
  name: 'DevNet Toolbox',
  version: '1.0.0',
  emoji: '💻',
} as const;

export const LIMITS = {
  /** Max characters accepted as tool input from a Telegram message. */
  maxInputChars: 8000,
  /** Max characters of a single outgoing Telegram message body (API hard limit 4096). */
  maxOutputChars: 3500,
  /** Max bytes we will read from a remote HTTP response in network tools. */
  maxRemoteBytes: 64 * 1024,
  /** Timeout for any outbound fetch performed by a network tool (ms). */
  networkTimeoutMs: 8000,
  /** Max regex input length (ReDoS mitigation). */
  maxRegexPatternChars: 300,
  maxRegexSubjectChars: 4000,
  /** Password / random string generator bounds. */
  minGeneratedLength: 4,
  maxGeneratedLength: 256,
  maxBulkCount: 20,
} as const;

/**
 * Advanced Security limits (Phase 2).
 *
 * Telegram's Bot API caps downloads at 20 MB, so anything larger cannot be
 * analysed regardless of what the Worker could handle. The APK cap is set
 * below that because the string sweep has to hold inflated DEX data in memory
 * alongside the archive itself.
 */
export const SECURITY_LIMITS = {
  /** Largest APK accepted for analysis. */
  maxApkBytes: 16 * 1024 * 1024,
  /** Largest generic file accepted for fingerprint/metadata scanning. */
  maxFileBytes: 8 * 1024 * 1024,
  /** Largest text file accepted for secret/dependency scanning. */
  maxTextBytes: 512 * 1024,
  /**
   * Total inflated bytes the APK string sweep may read.
   * Sized to fit two full DEX files (~9 MB each in a modern app) so the
   * behavioural rules see the whole codebase rather than a prefix of it.
   */
  apkSweepBudget: 24 * 1024 * 1024,
  /** Scan-history retention. */
  historyRetentionDays: 90,
  historyPerPage: 5,
} as const;

/**
 * Phase 3 limits for the 20 additional tools.
 *
 * Every value here is a hard guard rail: the bot runs on a Worker with a
 * 128 MB / 30 s budget shared by all users, so each new tool states exactly
 * how much input it will look at and how much output it will produce.
 */
export const TOOL_LIMITS = {
  /** YAML / XML / CSV documents: characters of source we will parse. */
  maxStructuredChars: 8000,
  /** Diff checker: characters per side and total lines compared. */
  maxDiffCharsPerSide: 6000,
  maxDiffLines: 1200,
  /** Rows rendered inline before the result is delivered as a file. */
  maxInlineDiffRows: 60,
  /** CSV: rows / columns accepted. */
  maxCsvRows: 2000,
  maxCsvColumns: 60,
  /** Duplicate-line remover. */
  maxLines: 3000,
  /** Number base converter / programmer calculator (bits of precision). */
  maxIntegerBits: 128,
  /** README / Dockerfile / .gitignore generators. */
  maxGeneratedDocChars: 12_000,
  /** Output longer than this is delivered as a .txt/.md/.json attachment. */
  fileDeliveryThreshold: 2800,
  /** Largest attachment the bot will ever upload back to Telegram. */
  maxOutgoingFileBytes: 512 * 1024,
} as const;

/** File-input tools (image metadata, hash comparison). */
export const TOOL_FILE_LIMITS = {
  /** Largest upload accepted by a file-based tool. */
  maxFileBytes: 8 * 1024 * 1024,
  /** How long the first file of a two-file comparison is remembered (seconds). */
  pairTtlSec: 900,
} as const;

/**
 * HTTP Request Builder (requirement 14) — the only tool that sends a
 * user-controlled request, so its budget is the tightest in the project.
 */
export const HTTP_BUILDER = {
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD'] as const,
  /**
   * Ports this tool may target.
   *
   * Deliberately narrower than `ALLOWED_PORTS`: that list exists for the
   * port-*check* tool, which legitimately probes SSH, SMTP and database
   * ports. Letting the request builder reach them would turn it into a
   * scanner for non-HTTP services.
   */
  allowedPorts: [80, 443, 8080, 8443, 3000, 5000, 8000] as readonly number[],
  /** Hard timeout for the outbound request. */
  timeoutMs: 8000,
  /** Largest request body the user may send. */
  maxBodyBytes: 8 * 1024,
  /** Largest response we will read (the rest is dropped, not buffered). */
  maxResponseBytes: 32 * 1024,
  /** Response body characters shown inline. */
  maxShownBodyChars: 1200,
  /** Custom headers the user may set. */
  maxHeaders: 15,
  maxHeaderValueChars: 300,
  /** Headers the user is never allowed to override (anti-abuse / anti-spoofing). */
  blockedHeaders: [
    'host', 'cf-connecting-ip', 'x-forwarded-for', 'x-forwarded-host', 'x-real-ip',
    'forwarded', 'content-length', 'connection', 'transfer-encoding', 'upgrade',
    'te', 'trailer', 'expect', 'cookie', 'proxy-authorization',
  ] as readonly string[],
} as const;

export const RATE_LIMIT = {
  /** Generic actions (menu navigation, cheap tools). */
  general: { windowSec: 60, max: 45 },
  /** Any tool execution. */
  tool: { windowSec: 60, max: 25 },
  /** Tools that make outbound network requests — deliberately strict. */
  network: { windowSec: 60, max: 8 },
  /** Extra daily cap for network tools per user. */
  networkDaily: { windowSec: 86_400, max: 120 },
  /** Security scans parse untrusted files — deliberately the tightest budget. */
  securityScan: { windowSec: 300, max: 10 },
  securityScanDaily: { windowSec: 86_400, max: 60 },
} as const;

export const STATE_TTL = {
  /** How long a "waiting for input" state stays alive (seconds). */
  pendingInputSec: 900,
  /** Cached network answers. */
  networkCacheSec: 300,
  /** Cached global statistics. */
  statsCacheSec: 60,
} as const;

/** Ports allowed for the port-check tool. Anything else is refused (anti-abuse). */
export const ALLOWED_PORTS: readonly number[] = [
  80, 443, 8080, 8443, 21, 22, 25, 53, 110, 143, 465, 587, 993, 995, 3306, 5432, 6379, 27017,
];

/** Hosts / networks that network tools must never touch (SSRF protection). */
export const BLOCKED_HOST_PATTERNS: readonly RegExp[] = [
  /^localhost$/i,
  /\.localhost$/i,
  /^127\./,
  /^0\./,
  /^10\./,
  /^192\.168\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^169\.254\./,
  /^::1$/,
  /^\[?::1\]?$/,
  /^f[cd][0-9a-f]{2}:/i,
  /^fe80:/i,
  /\.internal$/i,
  /\.local$/i,
  /^metadata\./i,
];

export const PAGINATION = {
  toolsPerPage: 8,
} as const;
