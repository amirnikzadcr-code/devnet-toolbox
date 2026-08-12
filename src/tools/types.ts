import type { Lang } from '../localization/index.js';

export type ToolCategory = 'programming' | 'network' | 'security' | 'utilities';

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

export interface ToolResult {
  /** Telegram HTML body of the result (already escaped by the tool). */
  html: string;
  /** Optional short toast for answerCallbackQuery. */
  toast?: string;
}

export interface ToolDefinition {
  id: string;
  category: ToolCategory;
  icon: string;
  /** Shown in Quick Tools shelf. */
  quick?: boolean;
  /** True when the tool consumes a network request budget. */
  network?: boolean;
  /** False for generators that need no user input. */
  needsInput: boolean;
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
