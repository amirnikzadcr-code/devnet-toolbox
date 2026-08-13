/**
 * Authentication for the admin panel.
 *
 * Two factors, both required:
 *   1. A password held as a Cloudflare Secret.
 *   2. A six-digit code delivered to the administrator's Telegram account.
 *
 * A leaked password alone is therefore not enough to enter the panel, which
 * matters because the panel can broadcast to every user of the bot.
 *
 * Sessions are stateless-signed *and* stored in KV. The signature stops
 * forgery; the KV record makes instant revocation ("log out everywhere")
 * possible, which a pure JWT cannot do.
 */
import type { AdminEnv, Session } from './types.js';

const encoder = new TextEncoder();

const SESSION_TTL_SEC = 8 * 60 * 60;
const CHALLENGE_TTL_SEC = 5 * 60;
const MAX_PASSWORD_ATTEMPTS = 5;
const MAX_CODE_ATTEMPTS = 5;
const LOCKOUT_SEC = 15 * 60;

export const COOKIE_NAME = 'dnt_admin';

/** Comparison whose duration does not depend on where the first difference is. */
export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function base64url(bytes: ArrayBuffer | Uint8Array): string {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let binary = '';
  for (const byte of view) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function hmac(secret: string, data: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  return base64url(await crypto.subtle.sign('HMAC', key, encoder.encode(data)));
}

/** Random six-digit code, drawn without modulo bias. */
export function generateCode(): string {
  const buffer = new Uint32Array(1);
  do {
    crypto.getRandomValues(buffer);
  } while ((buffer[0] ?? 0) >= 4_294_000_000);
  return String((buffer[0] ?? 0) % 1_000_000).padStart(6, '0');
}

export function randomId(bytes = 16): string {
  return base64url(crypto.getRandomValues(new Uint8Array(bytes)));
}

// ─── Login throttling ────────────────────────────────────────────────────

const throttleKey = (kind: string, id: string): string => `admin:throttle:${kind}:${id}`;

export async function isLockedOut(env: AdminEnv, kind: string, id: string): Promise<boolean> {
  const raw = await env.STATE.get(throttleKey(kind, id));
  const attempts = raw === null ? 0 : Number.parseInt(raw, 10);
  const cap = kind === 'code' ? MAX_CODE_ATTEMPTS : MAX_PASSWORD_ATTEMPTS;
  return Number.isFinite(attempts) && attempts >= cap;
}

export async function recordFailure(env: AdminEnv, kind: string, id: string): Promise<void> {
  const key = throttleKey(kind, id);
  const raw = await env.STATE.get(key);
  const attempts = (raw === null ? 0 : Number.parseInt(raw, 10) || 0) + 1;
  await env.STATE.put(key, String(attempts), { expirationTtl: LOCKOUT_SEC });
}

export async function clearFailures(env: AdminEnv, kind: string, id: string): Promise<void> {
  await env.STATE.delete(throttleKey(kind, id));
}

// ─── Second factor ───────────────────────────────────────────────────────

interface Challenge {
  code: string;
  createdAt: number;
}

const challengeKey = (id: string): string => `admin:challenge:${id}`;

export async function createChallenge(env: AdminEnv): Promise<{ id: string; code: string }> {
  const id = randomId();
  const code = generateCode();
  const challenge: Challenge = { code, createdAt: Math.floor(Date.now() / 1000) };
  await env.STATE.put(challengeKey(id), JSON.stringify(challenge), { expirationTtl: CHALLENGE_TTL_SEC });
  return { id, code };
}

export async function verifyChallenge(env: AdminEnv, id: string, code: string): Promise<boolean> {
  if (!/^[0-9]{6}$/.test(code)) return false;
  const stored = await env.STATE.get<Challenge>(challengeKey(id), 'json');
  if (!stored) return false;
  const match = safeEqual(stored.code, code);
  // One-shot: a code is burned whether or not it was correct, so an attacker
  // cannot keep guessing against the same challenge.
  await env.STATE.delete(challengeKey(id));
  return match;
}

// ─── Sessions ────────────────────────────────────────────────────────────

const sessionKey = (id: string): string => `admin:session:${id}`;

export async function createSession(env: AdminEnv, uid: number): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const session: Session = { uid, iat: now, exp: now + SESSION_TTL_SEC };
  const id = randomId(24);
  await env.STATE.put(sessionKey(id), JSON.stringify(session), { expirationTtl: SESSION_TTL_SEC });
  const signature = await hmac(env.SESSION_SECRET, id);
  return `${id}.${signature}`;
}

export async function readSession(env: AdminEnv, token: string | null): Promise<Session | null> {
  if (!token) return null;
  const dot = token.indexOf('.');
  if (dot <= 0) return null;
  const id = token.slice(0, dot);
  const signature = token.slice(dot + 1);
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) return null;

  const expected = await hmac(env.SESSION_SECRET, id);
  if (!safeEqual(expected, signature)) return null;

  const session = await env.STATE.get<Session>(sessionKey(id), 'json');
  if (!session) return null;
  if (session.exp <= Math.floor(Date.now() / 1000)) {
    await env.STATE.delete(sessionKey(id));
    return null;
  }
  return session;
}

export async function destroySession(env: AdminEnv, token: string | null): Promise<void> {
  if (!token) return;
  const id = token.split('.')[0] ?? '';
  if (id) await env.STATE.delete(sessionKey(id));
}

export function readCookie(request: Request, name: string): string | null {
  const header = request.headers.get('cookie');
  if (!header) return null;
  for (const part of header.split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return rest.join('=');
  }
  return null;
}

export function sessionCookie(token: string): string {
  return `${COOKIE_NAME}=${token}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${SESSION_TTL_SEC}`;
}

export function clearedCookie(): string {
  return `${COOKIE_NAME}=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0`;
}

/**
 * CSRF defence. The panel is same-origin only, so a mismatched Origin on a
 * state-changing request is rejected outright rather than merely logged.
 */
export function originAllowed(request: Request): boolean {
  const origin = request.headers.get('origin');
  if (origin === null) return true; // non-browser client (curl, tests)
  try {
    return new URL(origin).host === new URL(request.url).host;
  } catch {
    return false;
  }
}

export const AUTH_TUNING = {
  SESSION_TTL_SEC,
  CHALLENGE_TTL_SEC,
  MAX_PASSWORD_ATTEMPTS,
  MAX_CODE_ATTEMPTS,
  LOCKOUT_SEC,
} as const;
