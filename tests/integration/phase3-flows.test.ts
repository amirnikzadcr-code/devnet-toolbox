/**
 * Integration tests for the Phase 3 delivery paths that only exist inside the
 * bot: file uploads routed to a tool, two-file pairing, and attachment
 * delivery for oversized output.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { handleUpdate } from '../../src/bot/router.js';
import { getTool } from '../../src/tools/registry.js';
import {
  callbackUpdate,
  documentUpdate,
  execCtx,
  installFakeTelegram,
  makeEnv,
  messageUpdate,
} from '../helpers/fakes.js';

let tg: ReturnType<typeof installFakeTelegram>;
let env: ReturnType<typeof makeEnv>;

/** A minimal but structurally valid 1×1 PNG. */
function pngBytes(): Uint8Array {
  return new Uint8Array([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
    0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
    0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4, 0x89,
    0x00, 0x00, 0x00, 0x0a, 0x49, 0x44, 0x41, 0x54,
    0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00, 0x05, 0x00, 0x01,
    0x0d, 0x0a, 0x2d, 0xb4,
    0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
  ]);
}

const run = async (update: Parameters<typeof handleUpdate>[0]): Promise<void> => {
  const ctx = execCtx();
  await handleUpdate(update, env, ctx);
  await Promise.all(ctx.pending);
};

const lastTexts = (): string[] => tg.sentTexts();

beforeEach(() => {
  env = makeEnv();
});

afterEach(() => {
  tg.restore();
});

// ─── File tool routing ────────────────────────────────────────────────────

describe('file-based tools receive uploads', () => {
  it('prompts for a document when a file tool is started', async () => {
    tg = installFakeTelegram();
    await run(callbackUpdate('run:image_metadata'));
    const text = lastTexts().join('\n');
    expect(text).toMatch(/Document|سند|فایل/);
  });

  it('analyses an uploaded image and reports its dimensions', async () => {
    tg = installFakeTelegram({
      files: { 'img-1': { data: pngBytes(), path: 'photos/img-1.png' } },
    });
    await run(callbackUpdate('run:image_metadata'));
    await run(documentUpdate({ fileId: 'img-1', fileName: 'a.png', mimeType: 'image/png', fileSize: 70 }));
    const text = lastTexts().join('\n');
    expect(text).toContain('1 × 1');
    expect(text).toMatch(/PNG/i);
  });

  it('keeps waiting when a file tool is sent text instead', async () => {
    tg = installFakeTelegram();
    await run(callbackUpdate('run:image_metadata'));
    await run(messageUpdate('this is not a file'));
    const text = lastTexts().join('\n');
    expect(text).toMatch(/Document|فایل/);
    // The tool must not have produced a result from the text.
    expect(text).not.toContain('SHA-256');
  });

  it('rejects a non-image sent to the image tool', async () => {
    const notAnImage = new TextEncoder().encode('%PDF-1.4\nnot an image at all');
    tg = installFakeTelegram({
      files: { 'doc-1': { data: notAnImage, path: 'docs/doc-1.pdf' } },
    });
    await run(callbackUpdate('run:image_metadata'));
    await run(documentUpdate({ fileId: 'doc-1', fileName: 'a.pdf', mimeType: 'application/pdf', fileSize: 30 }));
    expect(lastTexts().join('\n')).toMatch(/not suitable|مناسب|not an image|تصویر نیست/i);
  });

  it('refuses a file larger than the tool allows before downloading it', async () => {
    tg = installFakeTelegram({ files: {} });
    await run(callbackUpdate('run:image_metadata'));
    await run(
      documentUpdate({ fileId: 'huge', fileName: 'big.png', mimeType: 'image/png', fileSize: 50 * 1024 * 1024 }),
    );
    expect(lastTexts().join('\n')).toMatch(/limit|حد مجاز/i);
    // getFile must never have been called for an over-sized upload.
    expect(tg.methods()).not.toContain('getFile');
  });

  it('reports a clear error when Telegram cannot supply the file', async () => {
    tg = installFakeTelegram({ files: {} });
    await run(callbackUpdate('run:image_metadata'));
    await run(documentUpdate({ fileId: 'missing', fileName: 'x.png', mimeType: 'image/png', fileSize: 100 }));
    expect(lastTexts().join('\n')).toMatch(/did not make this file available|در دسترس/i);
  });
});

// ─── Two-file pairing ─────────────────────────────────────────────────────

describe('file hash comparison pairs two uploads', () => {
  const fileA = new TextEncoder().encode('identical content');
  const fileB = new TextEncoder().encode('different content');

  it('reports MATCH for two identical files', async () => {
    tg = installFakeTelegram({
      files: {
        'a-1': { data: fileA, path: 'docs/a-1.bin' },
        'a-2': { data: fileA, path: 'docs/a-2.bin' },
      },
    });
    await run(callbackUpdate('run:file_hash_compare'));
    await run(documentUpdate({ fileId: 'a-1', fileName: 'one.bin', fileSize: fileA.length }));
    expect(lastTexts().join('\n')).toMatch(/second|دوم/i);

    await run(documentUpdate({ fileId: 'a-2', fileName: 'two.bin', fileSize: fileA.length }));
    const text = lastTexts().join('\n');
    expect(text).toContain('MATCH');
    expect(text).not.toContain('NOT MATCH');
  });

  it('reports NOT MATCH for two different files', async () => {
    tg = installFakeTelegram({
      files: {
        'b-1': { data: fileA, path: 'docs/b-1.bin' },
        'b-2': { data: fileB, path: 'docs/b-2.bin' },
      },
    });
    await run(callbackUpdate('run:file_hash_compare'));
    await run(documentUpdate({ fileId: 'b-1', fileName: 'one.bin', fileSize: fileA.length }));
    await run(documentUpdate({ fileId: 'b-2', fileName: 'two.bin', fileSize: fileB.length }));
    const text = lastTexts().join('\n');
    expect(text).toContain('NOT MATCH');
    expect(text).toMatch(/SHA-256/);
  });

  it('starts a fresh pair when the tool is re-run', async () => {
    tg = installFakeTelegram({
      files: {
        'c-1': { data: fileA, path: 'docs/c-1.bin' },
        'c-2': { data: fileB, path: 'docs/c-2.bin' },
      },
    });
    await run(callbackUpdate('run:file_hash_compare'));
    await run(documentUpdate({ fileId: 'c-1', fileName: 'one.bin', fileSize: fileA.length }));

    // Re-running must clear the half-finished pair.
    await run(callbackUpdate('run:file_hash_compare'));
    await run(documentUpdate({ fileId: 'c-2', fileName: 'two.bin', fileSize: fileB.length }));
    const text = lastTexts().join('\n');
    expect(text).toMatch(/second|دوم/i);
    expect(text).not.toContain('NOT MATCH');
  });

  it('never stores raw file bytes in KV', async () => {
    tg = installFakeTelegram({ files: { 'd-1': { data: fileA, path: 'docs/d-1.bin' } } });
    await run(callbackUpdate('run:file_hash_compare'));
    await run(documentUpdate({ fileId: 'd-1', fileName: 'one.bin', fileSize: fileA.length }));

    const kv = env.STATE;
    const pairKeys = kv.keys().filter((key) => key.startsWith('pair:'));
    expect(pairKeys.length).toBe(1);
    const stored = String(await kv.get(pairKeys[0] as string));
    expect(stored).not.toContain('identical content');
    expect(stored).toContain('sha256');
  });
});

// ─── Attachment delivery ──────────────────────────────────────────────────

describe('large output is delivered as a document', () => {
  it('sends a document for a long diff and keeps the summary inline', async () => {
    tg = installFakeTelegram();
    const a = Array.from({ length: 120 }, (_, i) => `line ${i}`).join('\n');
    const b = Array.from({ length: 120 }, (_, i) => `LINE ${i}`).join('\n');

    await run(callbackUpdate('run:diff_check'));
    await run(messageUpdate(`${a}\n---\n${b}`));

    expect(tg.methods()).toContain('sendDocument');
    const summary = lastTexts().join('\n');
    expect(summary).toMatch(/Similarity|شباهت/);
  });

  it('sends the generated README as a document', async () => {
    tg = installFakeTelegram();
    await run(callbackUpdate('run:readme_gen'));
    await run(messageUpdate('name: My Project\nlanguage: TypeScript\nfeatures: a, b'));
    expect(tg.methods()).toContain('sendDocument');
  });

  it('sends no document when the output fits in a message', async () => {
    tg = installFakeTelegram();
    await run(callbackUpdate('run:base_convert'));
    await run(messageUpdate('0xFF'));
    expect(tg.methods()).not.toContain('sendDocument');
  });

  it('still shows the summary when the upload fails', async () => {
    tg = installFakeTelegram({ failMethods: ['sendDocument'] });
    await run(callbackUpdate('run:gitignore_gen'));
    await run(messageUpdate('node'));
    const text = lastTexts().join('\n');
    expect(text).toContain('node_modules');
    // The failure is reported, not swallowed silently.
    expect(text).toMatch(/attachment|پیوست/i);
  });
});

// ─── Regression guards for the existing UI ────────────────────────────────

describe('Phase 3 does not disturb the existing navigation', () => {
  it('still opens every new tool page from a callback', async () => {
    tg = installFakeTelegram();
    for (const id of ['yaml_json', 'diff_check', 'cron_builder', 'http_request', 'image_metadata']) {
      await run(callbackUpdate(`tool:${id}`));
      const text = lastTexts().join('\n');
      const title = getTool(id)?.title.fa ?? '';
      expect(text, id).toContain(title);
    }
  });

  it('keeps the toolbox categories reachable', async () => {
    tg = installFakeTelegram();
    for (const category of ['programming', 'network', 'security', 'utilities']) {
      await run(callbackUpdate(`cat:${category}:1`));
    }
    expect(tg.methods().filter((m) => m === 'editMessageText' || m === 'sendMessage').length).toBeGreaterThan(0);
  });

  it('paginates the enlarged programming category', async () => {
    tg = installFakeTelegram();
    await run(callbackUpdate('cat:programming:3'));
    const text = lastTexts().join('\n');
    expect(text).toMatch(/3/);
  });
});
