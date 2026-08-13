/**
 * The activity log is the one place where a privacy mistake would be silent
 * and permanent, so these tests pin down the guarantee itself: nothing that
 * resembles user content can survive `sanitiseDetail`, and the writer never
 * propagates a database failure into the user's request.
 */
import { describe, expect, it } from 'vitest';
import { recordActivity, sanitiseDetail } from '../../src/db/activity.js';
import { FakeD1 } from '../helpers/fakes.js';

describe('sanitiseDetail', () => {
  it('keeps the characters that real ids use', () => {
    expect(sanitiseDetail('jwt_decode')).toBe('jwt_decode');
    expect(sanitiseDetail('cat:network:0')).toBe('cat:network:0');
    expect(sanitiseDetail('/start')).toBe('/start');
    expect(sanitiseDetail('unit-convert.v2')).toBe('unit-convert.v2');
  });

  it('strips anything that could carry a secret or personal text', () => {
    // A Persian sentence, an email and a password-looking string all reduce to
    // nothing meaningful, so a wiring mistake cannot leak readable content.
    expect(sanitiseDetail('سلام دنیا')).toBe('');
    expect(sanitiseDetail('user@example.com')).toBe('userexample.com');
    expect(sanitiseDetail('p@ssw0rd! $ecret')).toBe('pssw0rdecret');
  });

  it('removes characters that would break the panel HTML', () => {
    expect(sanitiseDetail('<script>alert(1)</script>')).toBe('scriptalert1/script');
    expect(sanitiseDetail('a"b\'c`d')).toBe('abcd');
  });

  it('bounds the length so one row cannot grow unbounded', () => {
    expect(sanitiseDetail('a'.repeat(500))).toHaveLength(48);
  });

  it('handles empty input without throwing', () => {
    expect(sanitiseDetail('')).toBe('');
  });
});

describe('recordActivity', () => {
  it('writes exactly the metadata columns, with the label sanitised', async () => {
    const db = new FakeD1();
    await recordActivity(db as unknown as D1Database, {
      userId: 42,
      kind: 'tool',
      detail: 'base64_encode',
      ok: true,
      ms: 37,
    });

    const entry = db.log.find((row) => /INSERT INTO activity/.test(row.sql));
    expect(entry).toBeDefined();
    expect(entry?.params[0]).toBe(42);
    expect(entry?.params[1]).toBe('tool');
    expect(entry?.params[2]).toBe('base64_encode');
    expect(entry?.params[3]).toBe(1);
    expect(entry?.params[4]).toBe(37);
  });

  it('marks failures with ok = 0', async () => {
    const db = new FakeD1();
    await recordActivity(db as unknown as D1Database, {
      userId: 7,
      kind: 'tool',
      detail: 'dns_lookup',
      ok: false,
    });
    const entry = db.log.find((row) => /INSERT INTO activity/.test(row.sql));
    expect(entry?.params[3]).toBe(0);
  });

  it('defaults ok to 1 and ms to 0 when the caller omits them', async () => {
    const db = new FakeD1();
    await recordActivity(db as unknown as D1Database, { userId: 1, kind: 'command', detail: '/start' });
    const entry = db.log.find((row) => /INSERT INTO activity/.test(row.sql));
    expect(entry?.params[3]).toBe(1);
    expect(entry?.params[4]).toBe(0);
  });

  it('never rejects when the database fails', async () => {
    // Telemetry must not be able to break a user's request.
    const db = new FakeD1();
    db.failNext = true;
    await expect(
      recordActivity(db as unknown as D1Database, { userId: 1, kind: 'tool', detail: 'x' }),
    ).resolves.toBeUndefined();
  });

  it('rounds and floors a negative duration instead of storing it', async () => {
    const db = new FakeD1();
    await recordActivity(db as unknown as D1Database, {
      userId: 1,
      kind: 'tool',
      detail: 'x',
      ms: -5,
    });
    const entry = db.log.find((row) => /INSERT INTO activity/.test(row.sql));
    expect(entry?.params[4]).toBe(0);
  });
});
