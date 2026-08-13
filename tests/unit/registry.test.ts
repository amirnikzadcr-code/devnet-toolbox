import { describe, expect, it } from 'vitest';
import {
  ALL_TOOLS,
  CATEGORIES,
  TOTAL_TOOLS,
  assertUniqueToolIds,
  categoryMeta,
  countByCategory,
  getTool,
  paginate,
  quickTools,
  searchTools,
  toolsByCategory,
} from '../../src/tools/registry.js';
import { PAGINATION } from '../../src/config/index.js';

const CATEGORY_IDS = CATEGORIES.map((c) => c.id);

describe('registry integrity', () => {
  it('has no duplicate tool ids', () => {
    expect(() => assertUniqueToolIds()).not.toThrow();
    const ids = ALL_TOOLS.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('exposes at least the 45 promised tools', () => {
    expect(TOTAL_TOOLS).toBe(ALL_TOOLS.length);
    expect(TOTAL_TOOLS).toBeGreaterThanOrEqual(45);
  });

  it('satisfies the per-category minimums from the spec', () => {
    expect(countByCategory('programming')).toBeGreaterThanOrEqual(15);
    expect(countByCategory('network')).toBeGreaterThanOrEqual(10);
    expect(countByCategory('security')).toBeGreaterThanOrEqual(8);
    expect(countByCategory('utilities')).toBeGreaterThanOrEqual(9);
  });

  it('uses only snake_case ascii ids that fit Telegram callback data', () => {
    for (const tool of ALL_TOOLS) {
      expect(tool.id).toMatch(/^[a-z0-9_]+$/);
      // "run:<id>" and "tool:<id>" must stay under Telegram's 64-byte cap.
      expect(new TextEncoder().encode(`run:${tool.id}`).length).toBeLessThanOrEqual(64);
    }
  });

  it('gives every tool complete bilingual documentation', () => {
    for (const tool of ALL_TOOLS) {
      for (const field of ['title', 'description', 'usage', 'example', 'limitations'] as const) {
        expect(tool[field].fa.trim(), `${tool.id}.${field}.fa`).not.toBe('');
        expect(tool[field].en.trim(), `${tool.id}.${field}.en`).not.toBe('');
      }
      expect(tool.icon.trim(), `${tool.id}.icon`).not.toBe('');
      expect(typeof tool.run, `${tool.id}.run`).toBe('function');
      expect(CATEGORY_IDS, `${tool.id}.category`).toContain(tool.category);
    }
  });

  it('flags outbound tools so the network rate-limit budget applies', () => {
    // Every tool that performs an outbound fetch must carry network:true so the
    // runner charges the stricter network budget.
    const mustBeNetwork = ['dns_lookup', 'reverse_dns', 'ip_info', 'http_status', 'http_headers', 'ssl_info', 'domain_info', 'port_check', 'ping'];
    for (const id of mustBeNetwork) {
      expect(getTool(id)?.network, id).toBe(true);
    }
    // Tools flagged as network must live in a category where that makes sense.
    for (const tool of ALL_TOOLS.filter((t) => t.network)) {
      expect(['network', 'utilities', 'everyday'], tool.id).toContain(tool.category);
    }
  });

  it('keeps purely local tools off the network budget', () => {
    for (const id of ['json_format', 'base64_encode', 'uuid_gen', 'calculator', 'my_ip']) {
      expect(getTool(id)?.network ?? false, id).toBe(false);
    }
  });
});

describe('getTool', () => {
  it('resolves every registered id', () => {
    for (const tool of ALL_TOOLS) expect(getTool(tool.id)?.id).toBe(tool.id);
  });

  it('returns undefined for unknown or hostile ids', () => {
    expect(getTool('nope')).toBeUndefined();
    expect(getTool('')).toBeUndefined();
    expect(getTool('__proto__')).toBeUndefined();
    expect(getTool('constructor')).toBeUndefined();
    expect(getTool('toString')).toBeUndefined();
  });
});

describe('toolsByCategory & categoryMeta', () => {
  it('partitions all tools without loss', () => {
    const total = CATEGORY_IDS.reduce((sum, c) => sum + toolsByCategory(c).length, 0);
    expect(total).toBe(TOTAL_TOOLS);
  });

  it('provides bilingual metadata and an icon for every category', () => {
    for (const category of CATEGORY_IDS) {
      const meta = categoryMeta(category);
      expect(meta, category).toBeDefined();
      expect(meta?.title.fa).toBeTruthy();
      expect(meta?.title.en).toBeTruthy();
      expect(meta?.description.fa).toBeTruthy();
      expect(meta?.icon).toBeTruthy();
    }
  });
});

describe('quickTools', () => {
  it('returns only tools flagged as quick', () => {
    const quick = quickTools();
    expect(quick.length).toBeGreaterThan(0);
    for (const tool of quick) expect(tool.quick).toBe(true);
  });
});

describe('paginate', () => {
  const items = Array.from({ length: 20 }, (_, i) => i);

  it('uses the configured page size by default', () => {
    const page = paginate(items, 1);
    expect(page.items).toHaveLength(PAGINATION.toolsPerPage);
    expect(page.total).toBe(20);
  });

  it('computes the page count correctly', () => {
    expect(paginate(items, 1, 8).pages).toBe(3);
    expect(paginate(items, 1, 20).pages).toBe(1);
    expect(paginate([], 1, 8).pages).toBe(1);
  });

  it('returns the right slice per page', () => {
    expect(paginate(items, 1, 8).items).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(paginate(items, 3, 8).items).toEqual([16, 17, 18, 19]);
  });

  it('clamps out-of-range pages instead of throwing', () => {
    expect(paginate(items, 0, 8).page).toBe(1);
    expect(paginate(items, -5, 8).page).toBe(1);
    expect(paginate(items, 99, 8).page).toBe(3);
    expect(paginate(items, 99, 8).items).toEqual([16, 17, 18, 19]);
  });

  it('handles an empty list', () => {
    const page = paginate([], 1, 8);
    expect(page.items).toEqual([]);
    expect(page.total).toBe(0);
  });
});

describe('searchTools', () => {
  it('finds tools by id fragment', () => {
    expect(searchTools('base64').some((t) => t.id === 'base64_encode')).toBe(true);
  });

  it('finds tools by English title', () => {
    expect(searchTools('password').some((t) => t.id === 'password_gen')).toBe(true);
  });

  it('is case-insensitive', () => {
    expect(searchTools('JSON').length).toBeGreaterThan(0);
    expect(searchTools('json').length).toBe(searchTools('JSON').length);
  });

  it('returns an empty list for nonsense', () => {
    expect(searchTools('zzzzzzzznope')).toEqual([]);
  });
});
