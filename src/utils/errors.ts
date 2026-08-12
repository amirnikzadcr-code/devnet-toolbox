import type { Lang } from '../localization/index.js';

/**
 * A user-safe error. `messages` are already localized and never contain
 * stack traces, secrets, or internal identifiers.
 */
export class ToolError extends Error {
  readonly fa: string;
  readonly en: string;
  readonly code: string;

  constructor(code: string, fa: string, en: string) {
    super(`${code}: ${en}`);
    this.name = 'ToolError';
    this.code = code;
    this.fa = fa;
    this.en = en;
  }

  localized(lang: Lang): string {
    return lang === 'fa' ? this.fa : this.en;
  }
}

export const errInvalidInput = (fa: string, en: string): ToolError =>
  new ToolError('INVALID_INPUT', fa, en);

export const errTooLarge = (fa: string, en: string): ToolError =>
  new ToolError('TOO_LARGE', fa, en);

export const errNetwork = (fa: string, en: string): ToolError => new ToolError('NETWORK', fa, en);

export const errForbidden = (fa: string, en: string): ToolError =>
  new ToolError('FORBIDDEN', fa, en);

export const errTimeout = (): ToolError =>
  new ToolError(
    'TIMEOUT',
    'زمان پاسخ‌گویی سرویس بیرونی تمام شد. کمی بعد دوباره تلاش کنید.',
    'The upstream service timed out. Please try again shortly.',
  );

/** Type guard usable across module boundaries. */
export function isToolError(e: unknown): e is ToolError {
  return e instanceof Error && e.name === 'ToolError';
}

/** Structured, secret-free logging. */
export function logError(scope: string, error: unknown, meta: Record<string, unknown> = {}): void {
  const payload = {
    scope,
    message: error instanceof Error ? error.message : String(error),
    kind: error instanceof Error ? error.name : typeof error,
    ...meta,
  };
  console.error(JSON.stringify(payload));
}
