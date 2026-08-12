import type { ToolCategory, ToolDefinition } from './types.js';
import type { Lang } from '../localization/index.js';
import { PAGINATION } from '../config/index.js';

import { jsonFormat, jsonMinify, jsonValidate } from './programming/json.js';
import {
  base64DecodeTool,
  base64EncodeTool,
  htmlEntityTool,
  urlDecodeTool,
  urlEncodeTool,
} from './programming/encoding.js';
import { jwtDecodeTool } from './programming/jwt.js';
import {
  caseConverter,
  colorConverter,
  cssFormatter,
  htmlFormatter,
  jsFormatter,
  markdownTool,
  regexTester,
  textStatsTool,
  timestampTool,
} from './programming/misc.js';
import { hashAllTool, md5Tool, sha1Tool, sha256Tool } from './security/hash.js';
import { hmacTool, passwordTool, randomStringTool, secretTool, uuidTool } from './security/generators.js';
import {
  calculatorTool,
  cronTool,
  qrTool,
  textCounter,
  unitConverter,
  urlInfoLocal,
  urlParser,
} from './utilities/index.js';
import { networkTools } from './network/index.js';

/** Every tool in the bot, in display order. */
export const ALL_TOOLS: ToolDefinition[] = [
  // 💻 Programming
  jsonFormat,
  jsonMinify,
  jsonValidate,
  base64EncodeTool,
  base64DecodeTool,
  urlEncodeTool,
  urlDecodeTool,
  htmlEntityTool,
  jwtDecodeTool,
  regexTester,
  htmlFormatter,
  cssFormatter,
  jsFormatter,
  markdownTool,
  textStatsTool,
  randomStringTool,
  // 🌐 Network
  ...networkTools,
  // 🔐 Security
  hashAllTool,
  sha256Tool,
  sha1Tool,
  md5Tool,
  uuidTool,
  passwordTool,
  secretTool,
  hmacTool,
  // 🛠 Utilities
  calculatorTool,
  timestampTool,
  unitConverter,
  qrTool,
  textCounter,
  caseConverter,
  colorConverter,
  urlParser,
  urlInfoLocal,
  cronTool,
];

const TOOL_MAP: Map<string, ToolDefinition> = new Map(ALL_TOOLS.map((tool) => [tool.id, tool]));

export interface CategoryMeta {
  id: ToolCategory;
  icon: string;
  title: { fa: string; en: string };
  description: { fa: string; en: string };
}

export const CATEGORIES: CategoryMeta[] = [
  {
    id: 'programming',
    icon: '💻',
    title: { fa: 'برنامه‌نویسی', en: 'Programming' },
    description: {
      fa: 'ابزارهای روزمره‌ی توسعه: JSON، Base64، JWT، Regex، فرمترها و آمار متن.',
      en: 'Everyday developer tools: JSON, Base64, JWT, regex, formatters and text stats.',
    },
  },
  {
    id: 'network',
    icon: '🌐',
    title: { fa: 'شبکه', en: 'Network' },
    description: {
      fa: 'تشخیص و بررسی شبکه: DNS، IP، HTTP، SSL، دامنه، پورت و تست دسترسی.',
      en: 'Network diagnostics: DNS, IP, HTTP, SSL, domain, port and connectivity.',
    },
  },
  {
    id: 'security',
    icon: '🔐',
    title: { fa: 'امنیت', en: 'Security' },
    description: {
      fa: 'ابزارهای دفاعی: هش، HMAC، تولید رمز و توکن امن، UUID.',
      en: 'Defensive tooling: hashing, HMAC, secure password/token generation, UUIDs.',
    },
  },
  {
    id: 'utilities',
    icon: '🛠',
    title: { fa: 'ابزارهای کاربردی', en: 'Utilities' },
    description: {
      fa: 'ماشین‌حساب، تبدیل واحد، QR، تایم‌استمپ، رنگ، URL و کرون.',
      en: 'Calculator, unit conversion, QR, timestamps, colours, URLs and cron.',
    },
  },
];

export function getTool(id: string): ToolDefinition | undefined {
  return TOOL_MAP.get(id);
}

export function toolsByCategory(category: ToolCategory): ToolDefinition[] {
  return ALL_TOOLS.filter((tool) => tool.category === category);
}

export function quickTools(): ToolDefinition[] {
  return ALL_TOOLS.filter((tool) => tool.quick === true);
}

export function categoryMeta(id: ToolCategory): CategoryMeta | undefined {
  return CATEGORIES.find((category) => category.id === id);
}

export const TOTAL_TOOLS = ALL_TOOLS.length;

export function countByCategory(category: ToolCategory): number {
  return toolsByCategory(category).length;
}

export interface Page<T> {
  items: T[];
  page: number;
  pages: number;
  total: number;
}

export function paginate<T>(items: T[], page: number, perPage: number = PAGINATION.toolsPerPage): Page<T> {
  const total = items.length;
  const pages = Math.max(1, Math.ceil(total / perPage));
  const current = Math.min(Math.max(1, page), pages);
  const start = (current - 1) * perPage;
  return { items: items.slice(start, start + perPage), page: current, pages, total };
}

/** Simple bilingual search across id, title and description. */
export function searchTools(query: string, lang: Lang = 'fa'): ToolDefinition[] {
  const q = query.trim().toLowerCase();
  if (q.length < 2) return [];
  const score = (tool: ToolDefinition): number => {
    const id = tool.id.toLowerCase();
    const titleFa = tool.title.fa.toLowerCase();
    const titleEn = tool.title.en.toLowerCase();
    const desc = `${tool.description.fa} ${tool.description.en}`.toLowerCase();
    if (id === q) return 100;
    if (titleFa === q || titleEn === q) return 90;
    if (id.includes(q)) return 70;
    if (titleFa.includes(q) || titleEn.includes(q)) return 60;
    if (desc.includes(q)) return 30;
    return 0;
  };
  return ALL_TOOLS.map((tool) => ({ tool, s: score(tool) }))
    .filter((entry) => entry.s > 0)
    .sort((a, b) => b.s - a.s || a.tool.id.localeCompare(b.tool.id))
    .slice(0, 20)
    .map((entry) => {
      void lang;
      return entry.tool;
    });
}

/** Sanity guard: duplicate ids would break callback routing. */
export function assertUniqueToolIds(): void {
  if (TOOL_MAP.size !== ALL_TOOLS.length) {
    const seen = new Set<string>();
    const dupes = ALL_TOOLS.filter((tool) => (seen.has(tool.id) ? true : (seen.add(tool.id), false)));
    throw new Error(`Duplicate tool ids: ${dupes.map((tool) => tool.id).join(', ')}`);
  }
}
