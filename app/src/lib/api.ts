/**
 * API client.
 *
 * Auth model: every call carries the raw `initData` string in a header. The
 * Worker verifies its HMAC against BOT_TOKEN, so the user id is authenticated
 * rather than claimed. Nothing here trusts `initDataUnsafe`.
 */
import { initData } from './telegram';

export interface ToolMeta {
  id: string;
  category: string;
  group?: string;
  icon: string;
  title: string;
  description: string;
  usage: string;
  example: string;
  limitations: string;
  needsInput: boolean;
  network: boolean;
  file: boolean;
  quick: boolean;
}

export interface CatalogResponse {
  tools: ToolMeta[];
  categories: { id: string; icon: string; title: string; count: number }[];
  groups: { id: string; icon: string; title: string }[];
  favorites: string[];
  user: { id: number; name: string; lang: 'fa' | 'en'; runs: number; joined: number };
  lang: 'fa' | 'en';
}

export interface RunResponse {
  ok: boolean;
  html?: string;
  attachment?: { name: string; content: string };
  error?: string;
  ms?: number;
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

const TIMEOUT_MS = 15_000;

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(`/api${path}`, {
      ...init,
      signal: controller.signal,
      headers: {
        'content-type': 'application/json',
        'x-init-data': initData(),
        ...(init?.headers ?? {}),
      },
    });
    const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    if (!response.ok) {
      throw new ApiError(typeof body.error === 'string' ? body.error : `HTTP ${response.status}`, response.status);
    }
    return body as T;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new ApiError('زمان پاسخ سرور تمام شد.', 408);
    }
    throw new ApiError('اتصال به سرور برقرار نشد.', 0);
  } finally {
    clearTimeout(timer);
  }
}

export const api = {
  catalog: (): Promise<CatalogResponse> => request<CatalogResponse>('/catalog'),

  run: (toolId: string, input: string): Promise<RunResponse> =>
    request<RunResponse>('/run', { method: 'POST', body: JSON.stringify({ toolId, input }) }),

  favorite: (toolId: string, on: boolean): Promise<{ ok: boolean; favorites: string[] }> =>
    request('/favorite', { method: 'POST', body: JSON.stringify({ toolId, on }) }),

  setLang: (lang: 'fa' | 'en'): Promise<{ ok: boolean }> =>
    request('/lang', { method: 'POST', body: JSON.stringify({ lang }) }),

  stats: (): Promise<{ topTools: { toolId: string; uses: number }[]; totalRuns: number; distinct: number }> =>
    request('/stats'),
};
