import { describe, expect, it } from 'vitest';
import { analyseUrlStatic, registrableDomain, PHISHING_CORRELATIONS } from '../../src/security/phishing.js';
import { assertSafeHost, assertSafeUrl, safeFetchGuarded, METADATA_HOST_PATTERNS } from '../../src/security/ssrf.js';
import { scanUrl } from '../../src/security/scans.js';
import { correlate } from '../../src/security/risk.js';
import { ToolError } from '../../src/utils/errors.js';
import type { Finding } from '../../src/security/types.js';

const idsFor = (url: string): string[] =>
  analyseUrlStatic(new URL(url)).findings.map((finding) => finding.id);

describe('SSRF protection — host blocklist', () => {
  const blocked = [
    ['localhost', 'loopback name'],
    ['127.0.0.1', 'loopback'],
    ['127.99.1.5', '127.0.0.0/8'],
    ['0.0.0.0', 'unspecified'],
    ['10.0.0.1', '10/8'],
    ['10.255.255.254', '10/8 upper'],
    ['172.16.0.1', '172.16/12 lower'],
    ['172.31.255.254', '172.16/12 upper'],
    ['192.168.1.1', '192.168/16'],
    ['169.254.169.254', 'link-local / cloud metadata'],
    ['::1', 'IPv6 loopback'],
    ['[::1]', 'bracketed IPv6 loopback'],
    ['fd00::1', 'IPv6 ULA'],
    ['fe80::1', 'IPv6 link-local'],
    ['metadata.google.internal', 'GCP metadata'],
    ['db.internal', 'internal TLD'],
    ['printer.local', 'mDNS'],
    ['100.100.100.200', 'Alibaba metadata'],
  ] as const;

  for (const [host, why] of blocked) {
    it(`blocks ${host} (${why})`, () => {
      expect(() => assertSafeHost(host)).toThrow(ToolError);
    });
  }

  const allowed = ['example.com', 'github.com', '1.1.1.1', '8.8.8.8', '172.32.0.1', '11.0.0.1', 'sub.domain.co.uk'];
  for (const host of allowed) {
    it(`allows the public host ${host}`, () => {
      expect(() => assertSafeHost(host)).not.toThrow();
    });
  }

  it('blocks decimal and hexadecimal encodings of 127.0.0.1', () => {
    // 2130706433 === 0x7f000001 === 127.0.0.1; a blocklist that only matches
    // dotted-quad text is trivially bypassed by these forms.
    expect(() => assertSafeHost('2130706433')).toThrow(ToolError);
    expect(() => assertSafeHost('0x7f000001')).toThrow(ToolError);
  });

  it('rejects non-HTTP schemes', () => {
    for (const url of ['file:///etc/passwd', 'ftp://example.com', 'gopher://example.com']) {
      expect(() => assertSafeUrl(new URL(url))).toThrow(ToolError);
    }
  });

  it('covers every documented cloud metadata endpoint', () => {
    expect(METADATA_HOST_PATTERNS.length).toBeGreaterThan(0);
    for (const host of ['169.254.169.254', 'metadata.google.internal', 'metadata.goog']) {
      expect(() => assertSafeHost(host)).toThrow(ToolError);
    }
  });
});

describe('SSRF protection — redirect revalidation', () => {
  const originalFetch = globalThis.fetch;

  /** Serves a redirect chain without touching the network. */
  const stubRedirects = (map: Record<string, string>): void => {
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      const location = map[url];
      if (location) {
        return new Response(null, { status: 302, headers: { location } });
      }
      return new Response('<html><title>ok</title></html>', {
        status: 200,
        headers: { 'content-type': 'text/html' },
      });
    }) as typeof fetch;
  };

  const restore = (): void => {
    globalThis.fetch = originalFetch;
  };

  it('follows a redirect that stays on public hosts', async () => {
    stubRedirects({ 'https://public.example.com/a': 'https://public.example.com/b' });
    try {
      const result = await safeFetchGuarded('https://public.example.com/a', { timeoutMs: 2000 });
      expect(result.status).toBe(200);
      expect(result.chain).toHaveLength(2);
    } finally {
      restore();
    }
  });

  it('blocks a redirect into cloud metadata', async () => {
    // The original request is to a legitimate public host — only the redirect
    // target is internal. This is the bypass a first-hop-only check misses.
    stubRedirects({ 'https://public.example.com/evil': 'http://169.254.169.254/latest/meta-data/' });
    try {
      await expect(safeFetchGuarded('https://public.example.com/evil', { timeoutMs: 2000 })).rejects.toThrow(ToolError);
    } finally {
      restore();
    }
  });

  it('blocks a redirect into a private network', async () => {
    stubRedirects({ 'https://public.example.com/evil': 'http://10.0.0.5/admin' });
    try {
      await expect(safeFetchGuarded('https://public.example.com/evil', { timeoutMs: 2000 })).rejects.toThrow(ToolError);
    } finally {
      restore();
    }
  });

  it('blocks a redirect to localhost', async () => {
    stubRedirects({ 'https://public.example.com/evil': 'http://localhost:8080/' });
    try {
      await expect(safeFetchGuarded('https://public.example.com/evil', { timeoutMs: 2000 })).rejects.toThrow(ToolError);
    } finally {
      restore();
    }
  });

  it('blocks an internal target reached through several public hops', async () => {
    stubRedirects({
      'https://public.example.com/1': 'https://public.example.com/2',
      'https://public.example.com/2': 'https://public.example.com/3',
      'https://public.example.com/3': 'http://192.168.0.1/',
    });
    try {
      await expect(safeFetchGuarded('https://public.example.com/1', { timeoutMs: 2000 })).rejects.toThrow(ToolError);
    } finally {
      restore();
    }
  });

  it('stops an endless redirect loop', async () => {
    stubRedirects({ 'https://public.example.com/loop': 'https://public.example.com/loop' });
    try {
      await expect(safeFetchGuarded('https://public.example.com/loop', { timeoutMs: 2000 })).rejects.toThrow(ToolError);
    } finally {
      restore();
    }
  });
});

describe('Phishing analysis', () => {
  it('detects punycode domains', () => {
    expect(idsFor('https://xn--pple-43d.com/signin')).toContain('phish.punycode');
  });

  it('detects homograph characters', () => {
    // "аpple.com" with a Cyrillic а.
    const ids = idsFor('https://\u0430pple.com/login');
    expect(ids).toContain('phish.homograph');
  });

  it('detects brand impersonation in a subdomain', () => {
    expect(idsFor('https://apple.com.secure-login.xyz/verify')).toContain('phish.brand_impersonation');
  });

  it('detects typosquatting of a known brand', () => {
    const finding = analyseUrlStatic(new URL('https://paypa1.com/webscr')).findings.find(
      (item) => item.id === 'phish.brand_impersonation',
    );
    expect(finding).toBeDefined();
  });

  it('detects the "@" userinfo trick', () => {
    expect(idsFor('https://www.paypal.com@evil.tk/login')).toContain('phish.userinfo_trick');
  });

  it('flags a raw IP address as the host', () => {
    expect(idsFor('http://93.184.216.34/login')).toContain('phish.ip_host');
  });

  it('flags plain HTTP', () => {
    expect(idsFor('http://example.com/')).toContain('phish.no_https');
  });

  it('flags suspicious TLDs and disposable hosting', () => {
    expect(idsFor('https://free-gift.tk/')).toContain('phish.host_reputation');
    expect(idsFor('https://abc123.ngrok-free.app/')).toContain('phish.host_reputation');
  });

  it('flags sensitive parameters without revealing their values', () => {
    const finding = analyseUrlStatic(new URL('https://site.example/login?password=hunter2&token=abcd1234')).findings.find(
      (item) => item.id === 'phish.sensitive_params',
    );
    expect(finding).toBeDefined();
    expect(JSON.stringify(finding)).not.toContain('hunter2');
    expect(JSON.stringify(finding)).not.toContain('abcd1234');
  });

  it('flags direct executable downloads', () => {
    expect(idsFor('https://cdn.example.com/update.apk')).toContain('phish.executable_download');
  });

  it('does not flag ordinary, legitimate URLs', () => {
    for (const url of [
      'https://github.com/torvalds/linux',
      'https://www.google.com/search?q=hello',
      'https://en.wikipedia.org/wiki/Phishing',
    ]) {
      expect(idsFor(url)).toEqual([]);
    }
  });

  it('resolves registrable domains, including two-level TLDs', () => {
    expect(registrableDomain('a.b.example.com')).toBe('example.com');
    expect(registrableDomain('shop.example.co.uk')).toBe('example.co.uk');
    expect(registrableDomain('example.com')).toBe('example.com');
  });

  it('escalates to critical when a login form meets brand impersonation', () => {
    const findings: Finding[] = [
      { id: 'phish.login_form', category: 'phishing', severity: 'medium', confidence: 85, title: { fa: '', en: '' }, evidence: [], explanation: { fa: '', en: '' } },
      { id: 'phish.brand_impersonation', category: 'phishing', severity: 'high', confidence: 75, title: { fa: '', en: '' }, evidence: [], explanation: { fa: '', en: '' } },
    ];
    const correlated = correlate(findings, PHISHING_CORRELATIONS);
    expect(correlated.map((item) => item.id)).toContain('phish.corr.credential_harvest');
    expect(correlated[0]?.severity).toBe('critical');
  });
});

describe('URL scan entry point', () => {
  it('refuses to scan an internal address', async () => {
    await expect(scanUrl('http://127.0.0.1/admin', { live: false })).rejects.toThrow(ToolError);
    await expect(scanUrl('http://169.254.169.254/', { live: false })).rejects.toThrow(ToolError);
  });

  it('rejects a malformed URL', async () => {
    await expect(scanUrl('not a url at all', { live: false })).rejects.toThrow(ToolError);
  });

  it('produces a report with a stable target hash', async () => {
    const first = await scanUrl('https://example.com/page', { live: false });
    const second = await scanUrl('https://example.com/page', { live: false });
    expect(first.report.targetHash).toBe(second.report.targetHash);
    expect(first.report.targetHash).toHaveLength(64);
  });

  it('rates a clean URL as safe and a phishing URL as high or worse', async () => {
    const clean = await scanUrl('https://github.com/explore', { live: false });
    expect(clean.report.severity).toBe('safe');

    const bad = await scanUrl('http://apple.com.verify-account.tk/signin?password=x', { live: false });
    expect(['high', 'critical']).toContain(bad.report.severity);
  });
});
