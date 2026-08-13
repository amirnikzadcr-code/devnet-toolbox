import type { Lang } from '../localization/index.js';

export type ToolCategory = 'programming' | 'network' | 'security' | 'utilities' | 'everyday';

/**
 * Sub-sections inside 🧰 Everyday Tools. The category page groups tools under
 * these headings instead of showing one flat 40-item list.
 */
export type EverydayGroup = 'calculators' | 'documents' | 'images' | 'media' | 'productivity' | 'information';

export interface Bilingual {
  fa: string;
  en: string;
}

export interface ToolRunContext {
  lang: Lang;
  userId: number;
  /** KV handle for caching; undefined in pure-unit test contexts. */
  cache?: KVNamespace;
}

/**
 * Attachment produced by a tool whose output is too large for one Telegram
 * message (diff reports, generated README/Dockerfile, CSV conversions …).
 * The bot still shows a short summary inline and sends this as a document.
 */
export interface ToolAttachment {
  /** File name including extension, e.g. `diff.txt`. */
  name: string;
  /** UTF-8 text content. */
  content: string;
  caption?: Bilingual;
}

export interface ToolResult {
  /** Telegram HTML body of the result (already escaped by the tool). */
  html: string;
  /** Optional short toast for answerCallbackQuery. */
  toast?: string;
  /** Optional document delivered alongside the summary. */
  attachment?: ToolAttachment;
}

/** A file the user uploaded for a file-based tool. */
export interface UploadedFile {
  name: string;
  mime: string;
  size: number;
  data: Uint8Array;
}

/**
 * Result of processing one uploaded file.
 * `awaiting` is used by two-file tools (hash comparison): the small state it
 * returns is kept in KV until the second file arrives — the file bytes
 * themselves are never stored.
 */
export interface FileToolResult extends ToolResult {
  awaiting?: Record<string, string | number>;
}

export interface FileToolContext extends ToolRunContext {
  /** State returned by the first file of a pair, if any. */
  previous?: Record<string, string | number>;
}

/** Declares that a tool consumes an upload instead of a text message. */
export interface FileToolSpec {
  maxBytes: number;
  /** True when the tool compares two files sent one after the other. */
  pair?: boolean;
  /** Allowed MIME prefixes; empty means any type is accepted. */
  accept?: readonly string[];
  prompt: Bilingual;
  run(file: UploadedFile, ctx: FileToolContext): Promise<FileToolResult> | FileToolResult;
}

export interface ToolDefinition {
  id: string;
  category: ToolCategory;
  /** Sub-section within 🧰 Everyday Tools; required for that category only. */
  group?: EverydayGroup;
  icon: string;
  /** Shown in Quick Tools shelf. */
  quick?: boolean;
  /** True when the tool consumes a network request budget. */
  network?: boolean;
  /** False for generators that need no user input. */
  needsInput: boolean;
  /**
   * Present when the tool works on an uploaded file rather than a text
   * message. `needsInput` stays true: the bot still waits for the user, it
   * just accepts a document instead of text.
   */
  file?: FileToolSpec;
  title: Bilingual;
  description: Bilingual;
  usage: Bilingual;
  example: Bilingual;
  limitations: Bilingual;
  run(input: string, ctx: ToolRunContext): Promise<ToolResult> | ToolResult;
}

/** Helper to keep tool definitions terse while staying fully typed. */
export function defineTool(def: ToolDefinition): ToolDefinition {
  return def;
}
