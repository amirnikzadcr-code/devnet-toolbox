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

export const RATE_LIMIT = {
  /** Generic actions (menu navigation, cheap tools). */
  general: { windowSec: 60, max: 45 },
  /** Any tool execution. */
  tool: { windowSec: 60, max: 25 },
  /** Tools that make outbound network requests — deliberately strict. */
  network: { windowSec: 60, max: 8 },
  /** Extra daily cap for network tools per user. */
  networkDaily: { windowSec: 86_400, max: 120 },
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
