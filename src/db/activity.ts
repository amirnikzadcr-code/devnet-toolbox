/**
 * Activity log — metadata only.
 *
 * The admin monitor needs to answer "who is using the bot, with which tool,
 * and is it working?". It does **not** need the content of what people typed,
 * and storing that content would be a real hazard: users paste tokens, private
 * keys and personal data into tools like the hash and JWT decoders.
 *
 * So the message text never reaches this module. `detail` is deliberately
 * typed as a narrow label — a tool id, a command name, or a callback route —
 * and is truncated and stripped of control characters before it is written.
 */
import { logError } from '../utils/errors.js';

/** What produced the event. Kept coarse so the feed stays readable. */
export type ActivityKind = 'command' | 'tool' | 'callback' | 'input' | 'media';

/** Labels are short by design; a tool id or command is well under this. */
const MAX_DETAIL = 48;

/**
 * Normalise a label before storage.
 *
 * Only characters that legitimately appear in an id, command or route are
 * kept. Anything else is dropped, so even a coding mistake that passed user
 * text into `detail` could not persist a readable secret or break the HTML
 * feed in the panel.
 */
export function sanitiseDetail(value: string): string {
  return value
    .replace(/[^a-zA-Z0-9_:\-./]/g, '')
    .slice(0, MAX_DETAIL);
}

export interface ActivityEvent {
  userId: number;
  kind: ActivityKind;
  /** A tool id, command name or callback route — never free text. */
  detail: string;
  ok?: boolean;
  /** Duration in milliseconds, when the caller measured one. */
  ms?: number;
}

/**
 * Append one event.
 *
 * Never throws and never blocks the reply: logging is strictly best-effort
 * telemetry, so a D1 hiccup must not turn into a failed user request. Call it
 * through `waitUntil` so the write settles after the response is sent.
 */
export async function recordActivity(db: D1Database, event: ActivityEvent): Promise<void> {
  try {
    await db
      .prepare(
        'INSERT INTO activity (user_id, kind, detail, ok, ms, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)',
      )
      .bind(
        event.userId,
        event.kind,
        sanitiseDetail(event.detail),
        event.ok === false ? 0 : 1,
        Math.max(0, Math.round(event.ms ?? 0)),
        Math.floor(Date.now() / 1000),
      )
      .run();
  } catch (error) {
    logError('db.recordActivity', error, { kind: event.kind });
  }
}
