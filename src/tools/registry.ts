import type { EverydayGroup, ToolCategory, ToolDefinition } from './types.js';
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
// ─── Phase 3: 20 additional tools ───────────────────────────
import { csvJsonTool, xmlFormatterTool, yamlJsonTool } from './programming/data-formats.js';
import { baseConverterTool, programmerCalcTool } from './programming/numbers.js';
import { diffTool, duplicateLineTool, textTransformTool } from './programming/text-tools.js';
import { regexHelperTool } from './programming/regex-tools.js';
import { dockerTool, gitignoreTool, gitTool, readmeTool } from './programming/devops.js';
import { dateTimeTool, timezoneTool } from './utilities/datetime.js';
import { cronBuilderTool } from './utilities/cron.js';
import { fileHashCompareTool, imageMetadataTool } from './utilities/files.js';
import { httpRequestBuilderTool, urlParserProTool } from './network/request-builder.js';
// ─── Phase 4: 🧰 Everyday Tools ─────────────────────────────
import { calculatorTools } from './everyday/calculators.js';
import { currencyTools } from './everyday/currency.js';
import { geometryTools } from './everyday/geometry.js';

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
  // 💻 Programming — Phase 3 additions
  yamlJsonTool,
  xmlFormatterTool,
  baseConverterTool,
  programmerCalcTool,
  diffTool,
  regexHelperTool,
  dockerTool,
  gitTool,
  gitignoreTool,
  readmeTool,
  // 🌐 Network
  ...networkTools,
  httpRequestBuilderTool,
  // 🔐 Security
  hashAllTool,
  sha256Tool,
  sha1Tool,
  md5Tool,
  uuidTool,
  passwordTool,
  secretTool,
  hmacTool,
  fileHashCompareTool,
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
  // 🛠 Utilities — Phase 3 additions
  dateTimeTool,
  timezoneTool,
  textTransformTool,
  duplicateLineTool,
  csvJsonTool,
  imageMetadataTool,
  urlParserProTool,
  cronBuilderTool,
  // 🧰 Everyday Tools — Phase 4
  ...calculatorTools,
  ...geometryTools,
  ...currencyTools,
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
      fa: 'ابزارهای روزمره‌ی توسعه: JSON، YAML، XML، Base64، JWT، Regex، مبنای عدد، Diff، Docker، Git و فرمترها.',
      en: 'Everyday developer tools: JSON, YAML, XML, Base64, JWT, regex, number bases, diff, Docker, Git and formatters.',
    },
  },
  {
    id: 'network',
    icon: '🌐',
    title: { fa: 'شبکه', en: 'Network' },
    description: {
      fa: 'تشخیص و بررسی شبکه: DNS، IP، HTTP، SSL، دامنه، پورت، تست دسترسی و ساخت درخواست HTTP.',
      en: 'Network diagnostics: DNS, IP, HTTP, SSL, domain, port, connectivity and a custom HTTP request builder.',
    },
  },
  {
    id: 'security',
    icon: '🔐',
    title: { fa: 'امنیت', en: 'Security' },
    description: {
      fa: 'ابزارهای دفاعی: هش، مقایسه‌ی هش فایل، HMAC، تولید رمز و توکن امن، UUID.',
      en: 'Defensive tooling: hashing, file hash comparison, HMAC, secure password/token generation, UUIDs.',
    },
  },
  {
    id: 'everyday',
    icon: '🧰',
    title: { fa: 'ابزارهای روزمره', en: 'Everyday Tools' },
    description: {
      fa: 'ماشین‌حساب‌های مالی و ساختمانی، اسناد و PDF، تصاویر، مدیا، بهره‌وری و اطلاعات روزمره.',
      en: 'Financial and construction calculators, documents and PDFs, images, media, productivity and everyday information.',
    },
  },
  {
    id: 'utilities',
    icon: '🛠',
    title: { fa: 'ابزارهای کاربردی', en: 'Utilities' },
    description: {
      fa: 'ماشین‌حساب، تبدیل واحد، QR، تاریخ و زمان، منطقه‌ی زمانی، CSV، متادیتای تصویر، تبدیل متن، URL و کرون.',
      en: 'Calculator, unit conversion, QR, date/time, timezones, CSV, image metadata, text transforms, URLs and cron.',
    },
  },
];

/** Display order and labels for the sub-sections of 🧰 Everyday Tools. */
export interface GroupMeta {
  id: EverydayGroup;
  icon: string;
  title: { fa: string; en: string };
}

export const EVERYDAY_GROUPS: GroupMeta[] = [
  { id: 'calculators', icon: '📐', title: { fa: 'ماشین‌حساب‌ها', en: 'Calculators' } },
  { id: 'documents', icon: '📄', title: { fa: 'اسناد', en: 'Documents' } },
  { id: 'images', icon: '🖼️', title: { fa: 'تصاویر', en: 'Images' } },
  { id: 'media', icon: '🎵', title: { fa: 'مدیا', en: 'Media' } },
  { id: 'productivity', icon: '🧠', title: { fa: 'بهره‌وری', en: 'Productivity' } },
  { id: 'information', icon: '🌍', title: { fa: 'اطلاعات', en: 'Information' } },
];

export function groupMeta(id: EverydayGroup): GroupMeta | undefined {
  return EVERYDAY_GROUPS.find((group) => group.id === id);
}

/** Tools inside one sub-section of 🧰 Everyday Tools, in registry order. */
export function toolsByGroup(group: EverydayGroup): ToolDefinition[] {
  return ALL_TOOLS.filter((tool) => tool.category === 'everyday' && tool.group === group);
}

/** Sub-sections that actually contain at least one tool. */
export function populatedGroups(): GroupMeta[] {
  return EVERYDAY_GROUPS.filter((group) => toolsByGroup(group.id).length > 0);
}

export function getTool(id: string): ToolDefinition | undefined {
  return TOOL_MAP.get(id);
}

export function toolsByCategory(category: ToolCategory): ToolDefinition[] {
  return ALL_TOOLS.filter((tool) => tool.category === category);
}

export function quickTools(): ToolDefinition[] {
  return ALL_TOOLS.filter((tool) => tool.quick === true);
}

/** Tools whose input is an uploaded document rather than a text message. */
export function fileTools(): ToolDefinition[] {
  return ALL_TOOLS.filter((tool) => tool.file !== undefined);
}

export function isFileTool(tool: ToolDefinition): boolean {
  return tool.file !== undefined;
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
