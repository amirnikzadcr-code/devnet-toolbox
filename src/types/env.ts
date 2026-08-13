/**
 * Runtime bindings & environment contract for the Worker.
 * Secrets are NEVER hardcoded — they come from Cloudflare Secrets.
 */
export interface Env {
  /** Secret: Telegram Bot API token (from @BotFather). */
  BOT_TOKEN: string;
  /** Secret: random string echoed by Telegram in X-Telegram-Bot-Api-Secret-Token. */
  WEBHOOK_SECRET: string;
  /** Secret (optional): protects the /admin/* maintenance endpoints. */
  ADMIN_SECRET?: string;

  /** Var: public bot username used in About page (no @). */
  BOT_USERNAME?: string;
  /** https URL of the Mini App. When unset the launch button is hidden. */
  APP_URL?: string;
  /** Var: public repository URL shown in About. */
  REPO_URL?: string;
  /** Var: "production" | "staging" | "development". */
  ENVIRONMENT?: string;

  /** KV: ephemeral state — pending tool input, rate-limit counters, caches. */
  STATE: KVNamespace;
  /** D1: durable profile & statistics storage. */
  DB: D1Database;
}

export interface ExecCtxLike {
  waitUntil(promise: Promise<unknown>): void;
}
