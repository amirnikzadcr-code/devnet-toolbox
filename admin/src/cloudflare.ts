/**
 * Cloudflare account usage, read from the GraphQL Analytics API.
 *
 * Two rules govern this module:
 *
 *  1. **Never invent a number.** If the API token is missing, unauthorised or
 *     slow, `available` comes back false with a reason. Showing a confident
 *     "0 requests" when the truth is "we could not ask" would be worse than
 *     showing nothing, because it looks like a working, idle bot.
 *
 *  2. **Never leak the token.** The API token is a Worker secret. It is used
 *     for the outbound call and is never rendered, logged or echoed back.
 */
import type { CloudflareUsage } from './types.js';

const GRAPHQL = 'https://api.cloudflare.com/client/v4/graphql';
const TIMEOUT_MS = 8000;

/**
 * Free-plan daily allowances, used only to draw the progress bars.
 *
 * These are plan limits rather than measurements, so they are stated as
 * constants here and labelled as "free plan" in the UI. If the account is on a
 * paid plan the bars simply read low, which is the safe direction to be wrong.
 */
const FREE_LIMITS = {
  workerRequests: 100_000,
  d1Reads: 5_000_000,
  d1Writes: 100_000,
};

const QUERY = `
query Usage($account: String!, $start: Date!, $end: Date!, $startTime: Time!, $endTime: Time!) {
  viewer {
    accounts(filter: { accountTag: $account }) {
      workersInvocationsAdaptive(
        limit: 100
        filter: { datetime_geq: $startTime, datetime_leq: $endTime }
      ) {
        sum { requests errors subrequests }
        dimensions { scriptName }
      }
      d1AnalyticsAdaptiveGroups(
        limit: 100
        filter: { date_geq: $start, date_leq: $end }
      ) {
        sum { readQueries writeQueries }
      }
    }
  }
}`;

interface GqlInvocation {
  sum?: { requests?: number; errors?: number; subrequests?: number };
  dimensions?: { scriptName?: string };
}
interface GqlD1 {
  sum?: { readQueries?: number; writeQueries?: number };
}

const nz = (value: unknown): number => (typeof value === 'number' && Number.isFinite(value) ? value : 0);

function unavailable(reason: string): CloudflareUsage {
  return {
    available: false,
    reason,
    workers: { requests: 0, errors: 0, subrequests: 0 },
    scripts: [],
    d1: { readQueries: 0, writeQueries: 0 },
    limits: FREE_LIMITS,
  };
}

/**
 * Fetches today's usage (UTC day, matching how Cloudflare resets free quotas).
 *
 * @param token   API token with `Account Analytics: Read`.
 * @param account Cloudflare account id.
 */
export async function fetchUsage(token: string | undefined, account: string | undefined): Promise<CloudflareUsage> {
  if (!token || !account) {
    return unavailable(
      'برای نمایش مصرف، Secret به نام CF_ANALYTICS_TOKEN و متغیر CF_ACCOUNT_ID لازم است.',
    );
  }

  const now = new Date();
  const day = now.toISOString().slice(0, 10);
  const startTime = `${day}T00:00:00Z`;
  const endTime = now.toISOString().slice(0, 19) + 'Z';

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const response = await fetch(GRAPHQL, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        query: QUERY,
        variables: { account, start: day, end: day, startTime, endTime },
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      // 403 here almost always means the token lacks Account Analytics: Read.
      return unavailable(
        response.status === 403 || response.status === 401
          ? 'توکن اجازهٔ خواندن Analytics را ندارد (Account Analytics: Read لازم است).'
          : `پاسخ ناموفق از Cloudflare (کد ${response.status}).`,
      );
    }

    const payload = (await response.json()) as {
      data?: { viewer?: { accounts?: { workersInvocationsAdaptive?: GqlInvocation[]; d1AnalyticsAdaptiveGroups?: GqlD1[] }[] } };
      errors?: { message?: string }[];
    };

    if (payload.errors?.length) {
      const first = payload.errors[0]?.message ?? 'خطای نامشخص';
      return unavailable(`Cloudflare خطا برگرداند: ${first.slice(0, 140)}`);
    }

    const account0 = payload.data?.viewer?.accounts?.[0];
    if (!account0) return unavailable('حسابی با این شناسه در پاسخ Analytics یافت نشد.');

    const invocations = account0.workersInvocationsAdaptive ?? [];
    const scripts = invocations
      .map((row) => ({
        name: row.dimensions?.scriptName ?? 'unknown',
        requests: nz(row.sum?.requests),
        errors: nz(row.sum?.errors),
      }))
      .filter((row) => row.requests > 0 || row.errors > 0)
      .sort((a, b) => b.requests - a.requests);

    const workers = invocations.reduce(
      (acc, row) => ({
        requests: acc.requests + nz(row.sum?.requests),
        errors: acc.errors + nz(row.sum?.errors),
        subrequests: acc.subrequests + nz(row.sum?.subrequests),
      }),
      { requests: 0, errors: 0, subrequests: 0 },
    );

    const d1 = (account0.d1AnalyticsAdaptiveGroups ?? []).reduce(
      (acc, row) => ({
        readQueries: acc.readQueries + nz(row.sum?.readQueries),
        writeQueries: acc.writeQueries + nz(row.sum?.writeQueries),
      }),
      { readQueries: 0, writeQueries: 0 },
    );

    return { available: true, workers, scripts, d1, limits: FREE_LIMITS };
  } catch (error) {
    const aborted = error instanceof Error && error.name === 'AbortError';
    return unavailable(aborted ? 'پاسخ Cloudflare در مهلت مقرر نرسید.' : 'اتصال به Cloudflare ناموفق بود.');
  } finally {
    clearTimeout(timer);
  }
}
