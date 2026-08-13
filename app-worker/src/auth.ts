/**
 * Mini App authentication.
 *
 * Telegram signs the launch payload (`initData`) with a key derived from the
 * bot token. Verifying that signature is the *only* trustworthy way to learn
 * who the user is — `initDataUnsafe.user.id` is attacker-controlled and is
 * never read here.
 *
 * Algorithm (core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app):
 *   secret = HMAC_SHA256(key="WebAppData", message=bot_token)
 *   hash   = HMAC_SHA256(key=secret,      message=data_check_string)
 * where data_check_string is every field except `hash`, sorted by key, joined
 * with "\n" as "key=value".
 *
 * Implemented directly on Web Crypto so it runs inside a Worker with no
 * Node polyfills and no dependency to keep current.
 */

export interface AuthedUser {
  id: number;
  firstName: string;
  lastName: string;
  username: string;
  languageCode: string;
}

/** Launch payloads older than this are rejected as replays. */
const MAX_AGE_SEC = 24 * 60 * 60;

const encoder = new TextEncoder();

async function hmac(key: ArrayBuffer | Uint8Array, message: string): Promise<ArrayBuffer> {
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    key as BufferSource,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  return crypto.subtle.sign('HMAC', cryptoKey, encoder.encode(message));
}

function toHex(buffer: ArrayBuffer): string {
  return [...new Uint8Array(buffer)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** Length-independent comparison so a mismatch leaks no timing signal. */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export class AuthError extends Error {
  constructor(
    message: string,
    readonly status = 401,
  ) {
    super(message);
    this.name = 'AuthError';
  }
}

/**
 * Verifies `initData` and returns the authenticated user.
 * @throws AuthError when the signature, freshness or shape is wrong.
 */
export async function verifyInitData(raw: string, botToken: string): Promise<AuthedUser> {
  if (!raw) throw new AuthError('missing init data');
  if (raw.length > 8192) throw new AuthError('init data too large', 413);
  if (!botToken) throw new AuthError('server misconfigured', 500);

  const params = new URLSearchParams(raw);
  const providedHash = params.get('hash');
  if (!providedHash || !/^[a-f0-9]{64}$/i.test(providedHash)) throw new AuthError('bad hash');

  // Only `hash` is removed. Telegram signs *every* other field it sends,
  // including `signature` — that field is excluded only from the separate
  // Ed25519 third-party check, never from this HMAC one. Dropping it here
  // silently broke every real launch: current clients always send
  // `signature`, so the check string was missing a line the client had
  // included and the digests could never match.
  params.delete('hash');

  const checkString = [...params.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');

  const secret = await hmac(encoder.encode('WebAppData'), botToken);
  const expected = toHex(await hmac(secret, checkString));
  if (!timingSafeEqual(expected, providedHash.toLowerCase())) throw new AuthError('signature mismatch');

  const authDate = Number(params.get('auth_date') ?? '0');
  if (!Number.isFinite(authDate) || authDate <= 0) throw new AuthError('bad auth_date');
  const age = Math.floor(Date.now() / 1000) - authDate;
  if (age > MAX_AGE_SEC) throw new AuthError('init data expired');
  // Small negative skew is normal; a large one means a forged future stamp.
  if (age < -300) throw new AuthError('auth_date in the future');

  const userRaw = params.get('user');
  if (!userRaw) throw new AuthError('no user in init data');

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(userRaw) as Record<string, unknown>;
  } catch {
    throw new AuthError('malformed user');
  }

  const id = typeof parsed.id === 'number' ? parsed.id : Number(parsed.id);
  if (!Number.isInteger(id) || id <= 0) throw new AuthError('bad user id');

  const str = (value: unknown, cap = 64): string =>
    typeof value === 'string' ? value.slice(0, cap) : '';

  return {
    id,
    firstName: str(parsed.first_name),
    lastName: str(parsed.last_name),
    username: str(parsed.username, 32),
    languageCode: str(parsed.language_code, 8),
  };
}
