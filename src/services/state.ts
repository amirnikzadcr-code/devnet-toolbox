import { STATE_TTL } from '../config/index.js';
import { logError } from '../utils/errors.js';

/** What the bot is waiting for from a given user. */
export interface PendingInput {
  toolId: string;
  /** Message id of the tool page, so the answer can be edited in place. */
  messageId: number;
  chatId: number;
  createdAt: number;
}

const pendingKey = (userId: number): string => `pending:${userId}`;

export async function setPending(kv: KVNamespace, userId: number, value: PendingInput): Promise<void> {
  try {
    await kv.put(pendingKey(userId), JSON.stringify(value), { expirationTtl: STATE_TTL.pendingInputSec });
  } catch (error) {
    logError('state.setPending', error, { userId });
  }
}

export async function getPending(kv: KVNamespace, userId: number): Promise<PendingInput | null> {
  try {
    return await kv.get<PendingInput>(pendingKey(userId), 'json');
  } catch (error) {
    logError('state.getPending', error, { userId });
    return null;
  }
}

export async function clearPending(kv: KVNamespace, userId: number): Promise<void> {
  try {
    await kv.delete(pendingKey(userId));
  } catch (error) {
    logError('state.clearPending', error, { userId });
  }
}

/** Cheap language cache so the hot path avoids a D1 read on every update. */
const langKey = (userId: number): string => `lang:${userId}`;

export async function cacheLang(kv: KVNamespace, userId: number, lang: string): Promise<void> {
  try {
    await kv.put(langKey(userId), lang, { expirationTtl: 86_400 });
  } catch (error) {
    logError('state.cacheLang', error, { userId });
  }
}

export async function readCachedLang(kv: KVNamespace, userId: number): Promise<string | null> {
  try {
    return await kv.get(langKey(userId));
  } catch {
    return null;
  }
}

/** Idempotency guard: Telegram can retry the same update_id. */
export async function isDuplicateUpdate(kv: KVNamespace, updateId: number): Promise<boolean> {
  const key = `upd:${updateId}`;
  try {
    const seen = await kv.get(key);
    if (seen) return true;
    await kv.put(key, '1', { expirationTtl: 300 });
    return false;
  } catch {
    return false;
  }
}

/**
 * Ban check for the hot path.
 *
 * The admin panel writes bans to D1 and mirrors them into KV. Reading the
 * mirror keeps this a single cheap lookup on every update instead of a D1
 * round-trip, and a KV failure fails open so an infrastructure blip can never
 * lock the whole user base out of the bot.
 */
export async function isBanned(kv: KVNamespace, userId: number): Promise<boolean> {
  try {
    return (await kv.get(`ban:${userId}`)) !== null;
  } catch (error) {
    logError('state.isBanned', error, { userId });
    return false;
  }
}
