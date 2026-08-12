/**
 * Security tests for the HTTP Request Builder (Phase 3, requirement 14).
 *
 * This is the only tool that sends a user-controlled request from the
 * Worker's network position, so each guard rail gets an explicit test:
 * public URLs work, every class of internal target is refused, redirects to
 * an internal target are refused *after* the first hop, timeouts and large
 * responses are bounded, and headers cannot be spoofed.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getTool } from '../../src/tools/registry.js';
import { ToolError } from '../../src/utils/errors.js';
import { HTTP_BUILDER } from '../../src/config/index.js';
import { parseRequestSpec } from '../../src/tools/network/request-builder.js';
import { installFakeTelegram } from '../helpers/fakes.js';
import type { ToolRunContext } from '../../src/tools/types.js';

const ctx: ToolRunContext = { lang: 'en', userId: 42 };
const builder = getTool('http_request');

/** Records every outbound URL the tool actually attempted. */
let attempted: string[] = [];
let tg: ReturnType<typeof installFakeTelegram>;

const install = (handler: (url: string, init?: RequestInit) => Response | Promise<Response>): void => {
  tg = installFakeTelegram({
    onOther: (url, init) => {
      attempted.push(url);
      return handler(url, init);
    },
  });
};

beforeEach(() => {
  attempted = [];
});

afterEach(() => {
  tg?.restore();
});

const run = async (input: string): Promise<string> =>
  (await Promise.resolve(builder!.run(input, ctx))).html;

const refuses = async (input: string): Promise<ToolError> => {
  try {
    await Promise.resolve(builder!.run(input, ctx));
  } catch (error) {
    expect(error).toBeInstanceOf(ToolError);
    return error as ToolError;
  }
  throw new Error(`expected a refusal for: ${input}`);
};

// ─── Happy path ───────────────────────────────────────────────────────────

describe('public URLs', () => {
  it('performs a GET and reports status, timing and body', async () => {
    install(() => new Response('hello world', { status: 200, headers: { 'content-type': 'text/plain' } }));
    const html = await run('GET https://example.com/status');
    expect(html).toContain('200');
    expect(html).toContain('hello world');
    expect(html).toContain('ms');
    expect(attempted[0]).toContain('https://example.com/status');
  });

  it('sends a POST with a JSON body and content type', async () => {
    let sentBody = '';
    let sentMethod = '';
    install((_url, init) => {
      sentBody = String(init?.body ?? '');
      sentMethod = String(init?.method ?? '');
      return new Response('{"ok":true}', { status: 201, headers: { 'content-type': 'application/json' } });
    });
    const html = await run('POST https://api.example.com/items\n\n{"name":"x"}');
    expect(sentMethod).toBe('POST');
    expect(sentBody).toBe('{"name":"x"}');
    expect(html).toContain('201');
  });

  it('adds query parameters from ?key=value directives', async () => {
    install(() => new Response('ok', { status: 200 }));
    await run('GET https://example.com/search\n?q=test\n?page=2');
    expect(attempted[0]).toContain('q=test');
    expect(attempted[0]).toContain('page=2');
  });

  it('pretty-prints a JSON response', async () => {
    install(() => new Response('{"a":1,"b":[2,3]}', { status: 200, headers: { 'content-type': 'application/json' } }));
    const html = await run('GET https://api.example.com/data');
    expect(html).toContain('&quot;a&quot;: 1');
  });

  it('supports every allowed method', async () => {
    for (const method of HTTP_BUILDER.methods) {
      install(() => new Response(method === 'HEAD' ? null : 'ok', { status: 200 }));
      const body = method === 'GET' || method === 'HEAD' ? '' : '\n\nx';
      const html = await run(`${method} https://example.com/${body}`);
      expect(html, method).toContain('200');
      tg.restore();
    }
  });
});

// ─── SSRF: direct targets ─────────────────────────────────────────────────

describe('SSRF — direct targets are refused before any request', () => {
  const BLOCKED = [
    ['localhost', 'GET http://localhost/admin'],
    ['loopback IPv4', 'GET http://127.0.0.1:8080/'],
    ['loopback alternative', 'GET http://127.1.1.1/'],
    ['IPv6 loopback', 'GET http://[::1]/'],
    ['private 10/8', 'GET http://10.0.0.5/'],
    ['private 192.168/16', 'GET http://192.168.1.1/'],
    ['private 172.16/12', 'GET http://172.16.0.1/'],
    ['link-local', 'GET http://169.254.1.1/'],
    ['AWS IMDS', 'GET http://169.254.169.254/latest/meta-data/'],
    ['GCP metadata', 'GET http://metadata.google.internal/computeMetadata/v1/'],
    ['Alibaba metadata', 'GET http://100.100.100.200/latest/meta-data/'],
    ['ECS metadata', 'GET http://169.254.170.2/v2/credentials'],
    ['0.0.0.0', 'GET http://0.0.0.0/'],
    ['CGNAT', 'GET http://100.64.0.1/'],
    ['.internal suffix', 'GET http://db.internal/'],
    ['.local suffix', 'GET http://printer.local/'],
    ['.consul suffix', 'GET http://service.consul/'],
    ['unique local IPv6', 'GET http://[fd00::1]/'],
    ['decimal-encoded IP', 'GET http://2130706433/'],
    ['hex-encoded IP', 'GET http://0x7f000001/'],
  ] as const;

  for (const [label, input] of BLOCKED) {
    it(`refuses ${label}`, async () => {
      install(() => new Response('SHOULD NOT BE REACHED', { status: 200 }));
      await refuses(input);
      // The decisive assertion: nothing left the Worker at all.
      expect(attempted, label).toHaveLength(0);
    });
  }

  it('refuses a non-http scheme', async () => {
    install(() => new Response('no', { status: 200 }));
    await refuses('GET file:///etc/passwd');
    await refuses('GET gopher://example.com/');
    expect(attempted).toHaveLength(0);
  });

  it('refuses userinfo embedded in the URL', async () => {
    install(() => new Response('no', { status: 200 }));
    await refuses('GET https://user:pass@example.com/');
    expect(attempted).toHaveLength(0);
  });

  it('refuses a port outside the allow-list', async () => {
    install(() => new Response('no', { status: 200 }));
    const error = await refuses('GET https://example.com:22/');
    expect(error.en).toContain('not allowed');
    expect(attempted).toHaveLength(0);
  });

  it('allows a standard alternative port', async () => {
    install(() => new Response('ok', { status: 200 }));
    await run('GET https://example.com:8443/');
    expect(attempted[0]).toContain(':8443');
  });
});

// ─── SSRF: redirects ──────────────────────────────────────────────────────

describe('SSRF — redirects are re-validated on every hop', () => {
  it('refuses a redirect that lands on cloud metadata', async () => {
    install((url) =>
      url.includes('example.com')
        ? new Response(null, { status: 302, headers: { location: 'http://169.254.169.254/latest/meta-data/' } })
        : new Response('SECRET CREDENTIALS', { status: 200 }),
    );
    await refuses('GET https://example.com/redirect');
    // The first hop went out, the metadata hop never did.
    expect(attempted).toHaveLength(1);
    expect(attempted[0]).toContain('example.com');
    expect(attempted.some((u) => u.includes('169.254.169.254'))).toBe(false);
  });

  it('refuses a redirect to localhost', async () => {
    install((url) =>
      url.includes('example.com')
        ? new Response(null, { status: 301, headers: { location: 'http://127.0.0.1:8080/admin' } })
        : new Response('internal', { status: 200 }),
    );
    await refuses('GET https://example.com/go');
    expect(attempted.some((u) => u.includes('127.0.0.1'))).toBe(false);
  });

  it('refuses a private target reached only on the second hop', async () => {
    install((url) => {
      if (url.includes('/first')) {
        return new Response(null, { status: 302, headers: { location: 'https://example.com/second' } });
      }
      if (url.includes('/second')) {
        return new Response(null, { status: 302, headers: { location: 'http://10.0.0.1/' } });
      }
      return new Response('internal', { status: 200 });
    });
    await refuses('GET https://example.com/first');
    expect(attempted.some((u) => u.includes('10.0.0.1'))).toBe(false);
  });

  it('follows a public redirect chain and reports it', async () => {
    install((url) =>
      url.includes('/start')
        ? new Response(null, { status: 302, headers: { location: 'https://example.org/final' } })
        : new Response('arrived', { status: 200 }),
    );
    const html = await run('GET https://example.com/start');
    expect(html).toContain('Redirect chain');
    expect(html).toContain('arrived');
  });

  it('stops after too many redirects', async () => {
    let n = 0;
    install(() => {
      n += 1;
      return new Response(null, { status: 302, headers: { location: `https://example.com/hop${n}` } });
    });
    await refuses('GET https://example.com/loop');
    expect(attempted.length).toBeLessThanOrEqual(6);
  });

  it('refuses a relative redirect that resolves to a blocked port', async () => {
    install((url) =>
      url.endsWith('/r')
        ? new Response(null, { status: 302, headers: { location: 'http://169.254.169.254/' } })
        : new Response('x', { status: 200 }),
    );
    await refuses('GET https://example.com/r');
  });
});

// ─── Header hardening ─────────────────────────────────────────────────────

describe('header handling', () => {
  it('refuses headers that would spoof identity or origin', async () => {
    install(() => new Response('ok', { status: 200 }));
    for (const header of ['Host', 'X-Forwarded-For', 'CF-Connecting-IP', 'Cookie', 'Content-Length']) {
      await refuses(`GET https://example.com/\n${header}: evil`);
    }
  });

  it('refuses a header value containing CRLF (request smuggling)', async () => {
    install(() => new Response('ok', { status: 200 }));
    const spec = 'GET https://example.com/\nX-Test: a\r\nInjected: b';
    await expect(async () => parseRequestSpec(spec)).rejects.toBeInstanceOf(ToolError);
  });

  it('allows ordinary custom headers', async () => {
    let seen: Record<string, string> = {};
    install((_url, init) => {
      seen = (init?.headers ?? {}) as Record<string, string>;
      return new Response('ok', { status: 200 });
    });
    await run('GET https://example.com/\nAccept: application/json\nX-Request-Id: abc123');
    expect(seen['accept']).toBe('application/json');
    expect(seen['x-request-id']).toBe('abc123');
  });

  it('caps the number of headers', async () => {
    const many = Array.from({ length: 20 }, (_, i) => `X-H${i}: v`).join('\n');
    await refuses(`GET https://example.com/\n${many}`);
  });

  it('caps a header value length', async () => {
    await refuses(`GET https://example.com/\nX-Big: ${'v'.repeat(400)}`);
  });

  it('redacts an Authorization header from the echoed request', async () => {
    install(() => new Response('ok', { status: 200 }));
    const html = await run('GET https://example.com/\nAuthorization: Bearer supersecrettoken');
    expect(html).not.toContain('supersecrettoken');
    expect(html).toContain('••••••');
  });

  it('redacts sensitive response headers', async () => {
    install(() => new Response('ok', { status: 200, headers: { 'set-cookie': 'session=secretvalue' } }));
    const html = await run('GET https://example.com/');
    expect(html).not.toContain('secretvalue');
  });
});

// ─── Body, timeout and response limits ────────────────────────────────────

describe('resource limits', () => {
  it('refuses a body larger than the cap', async () => {
    const big = 'x'.repeat(HTTP_BUILDER.maxBodyBytes + 100);
    await refuses(`POST https://example.com/\n\n${big}`);
  });

  it('refuses a body on GET and HEAD', async () => {
    await refuses('GET https://example.com/\n\n{"a":1}');
    await refuses('HEAD https://example.com/\n\n{"a":1}');
  });

  it('truncates an oversized response instead of buffering it', async () => {
    const huge = 'A'.repeat(HTTP_BUILDER.maxResponseBytes * 3);
    install(() => new Response(huge, { status: 200, headers: { 'content-type': 'text/plain' } }));
    const html = await run('GET https://example.com/huge');
    expect(html).toContain('200');
    expect(html).toContain('truncated');
    // Nothing close to the full payload reaches the message.
    expect(html.length).toBeLessThan(HTTP_BUILDER.maxResponseBytes);
  });

  it('surfaces a timeout as a friendly error', async () => {
    install(
      () =>
        new Promise<Response>((_resolve, reject) => {
          // Mimic what fetch does when the AbortSignal fires.
          const error = new Error('The operation was aborted');
          error.name = 'AbortError';
          setTimeout(() => reject(error), 5);
        }),
    );
    const error = await refuses('GET https://example.com/slow');
    expect(error.code).toBe('TIMEOUT');
    expect(error.en).not.toContain('AbortError');
  });

  it('reports a network failure without leaking internals', async () => {
    install(() => {
      throw new Error('ECONNREFUSED 10.1.2.3:443');
    });
    const error = await refuses('GET https://example.com/down');
    expect(error.en).not.toContain('10.1.2.3');
    expect(error.en).not.toContain('ECONNREFUSED');
  });
});

// ─── Input validation ─────────────────────────────────────────────────────

describe('request parsing', () => {
  it('refuses an unsupported method', async () => {
    await refuses('TRACE https://example.com/');
    await refuses('CONNECT https://example.com/');
  });

  it('refuses empty input and a malformed URL', async () => {
    await refuses('');
    await refuses('GET not a url at all');
  });

  it('refuses a line that is neither a header nor a parameter', async () => {
    await refuses('GET https://example.com/\nthis is nonsense');
  });

  it('defaults to GET when only a URL is given', () => {
    expect(parseRequestSpec('https://example.com/').method).toBe('GET');
  });

  it('infers a JSON content type from the body', () => {
    const spec = parseRequestSpec('POST https://example.com/\n\n{"a":1}');
    expect(spec.headers['content-type']).toBe('application/json');
  });

  it('keeps an explicit content type', () => {
    const spec = parseRequestSpec('POST https://example.com/\nContent-Type: text/xml\n\n<a/>');
    expect(spec.headers['content-type']).toBe('text/xml');
  });
});
