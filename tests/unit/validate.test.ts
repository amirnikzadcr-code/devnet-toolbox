import { describe, expect, it } from 'vitest';
import {
  assertMaxLength,
  assertNotEmpty,
  assertPublicHost,
  isDomain,
  isIP,
  isIPv4,
  isIPv6,
  parseHostInput,
  parseHttpUrl,
  parsePositiveInt,
} from '../../src/utils/validate.js';
import { ToolError } from '../../src/utils/errors.js';
import { LIMITS } from '../../src/config/index.js';

describe('assertNotEmpty', () => {
  it('returns the trimmed value', () => {
    expect(assertNotEmpty('  hello  ')).toBe('hello');
  });

  it('rejects empty and whitespace-only input', () => {
    expect(() => assertNotEmpty('')).toThrowError(ToolError);
    expect(() => assertNotEmpty('   \n\t ')).toThrowError(ToolError);
  });
});

describe('assertMaxLength', () => {
  it('accepts input at the exact limit', () => {
    const value = 'a'.repeat(LIMITS.maxInputChars);
    expect(assertMaxLength(value)).toBe(value);
  });

  it('rejects oversized input with a TOO_LARGE error', () => {
    try {
      assertMaxLength('a'.repeat(LIMITS.maxInputChars + 1));
      throw new Error('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(ToolError);
      expect((error as ToolError).code).toBe('TOO_LARGE');
    }
  });

  it('honours a custom limit', () => {
    expect(() => assertMaxLength('abcdef', 3)).toThrowError(ToolError);
  });
});

describe('IP and domain detection', () => {
  it('recognises valid IPv4 addresses', () => {
    for (const ip of ['1.1.1.1', '8.8.8.8', '255.255.255.255', '0.0.0.0']) {
      expect(isIPv4(ip)).toBe(true);
    }
  });

  it('rejects malformed IPv4 addresses', () => {
    for (const ip of ['256.1.1.1', '1.1.1', '1.1.1.1.1', 'a.b.c.d', '']) {
      expect(isIPv4(ip)).toBe(false);
    }
  });

  it('recognises IPv6 addresses', () => {
    expect(isIPv6('2001:4860:4860::8888')).toBe(true);
    expect(isIPv6('::')).toBe(true);
    expect(isIPv6('not:an:ip:zz')).toBe(false);
  });

  it('treats both families as IPs', () => {
    expect(isIP('1.1.1.1')).toBe(true);
    expect(isIP('2606:4700:4700::1111')).toBe(true);
    expect(isIP('example.com')).toBe(false);
  });

  it('recognises domains but not bare labels', () => {
    expect(isDomain('example.com')).toBe(true);
    expect(isDomain('sub.domain.example.co.uk')).toBe(true);
    expect(isDomain('localhost')).toBe(false);
    expect(isDomain('-bad.com')).toBe(false);
    expect(isDomain('bad-.com')).toBe(false);
  });
});

describe('assertPublicHost (SSRF protection)', () => {
  const blocked = [
    'localhost',
    '127.0.0.1',
    '0.0.0.0',
    '10.0.0.5',
    '192.168.1.1',
    '172.16.0.1',
    '169.254.169.254',
    '::1',
    'metadata.google.internal',
    'router.local',
  ];

  for (const host of blocked) {
    it(`blocks ${host}`, () => {
      try {
        assertPublicHost(host);
        throw new Error(`expected ${host} to be blocked`);
      } catch (error) {
        expect(error).toBeInstanceOf(ToolError);
        expect((error as ToolError).code).toBe('FORBIDDEN');
      }
    });
  }

  it('allows genuine public hosts', () => {
    expect(assertPublicHost('example.com')).toBe('example.com');
    expect(assertPublicHost('EXAMPLE.COM')).toBe('example.com');
    expect(assertPublicHost('1.1.1.1')).toBe('1.1.1.1');
  });

  it('rejects an empty host', () => {
    expect(() => assertPublicHost('   ')).toThrowError(ToolError);
  });
});

describe('parseHostInput', () => {
  it('extracts the hostname from a full URL', () => {
    expect(parseHostInput('https://example.com/path?x=1')).toBe('example.com');
  });

  it('strips ports, userinfo and paths', () => {
    expect(parseHostInput('example.com:8443')).toBe('example.com');
    expect(parseHostInput('example.com/some/path')).toBe('example.com');
  });

  it('lowercases the result', () => {
    expect(parseHostInput('ExAmPlE.CoM')).toBe('example.com');
  });

  it('rejects internal targets even when wrapped in a URL', () => {
    expect(() => parseHostInput('http://127.0.0.1:8080/admin')).toThrowError(ToolError);
    expect(() => parseHostInput('http://192.168.0.1')).toThrowError(ToolError);
  });

  it('rejects junk input', () => {
    expect(() => parseHostInput('not a host!!')).toThrowError(ToolError);
    expect(() => parseHostInput('')).toThrowError(ToolError);
  });
});

describe('parseHttpUrl', () => {
  it('defaults to https when no scheme is given', () => {
    expect(parseHttpUrl('example.com').href).toBe('https://example.com/');
  });

  it('keeps an explicit http scheme', () => {
    expect(parseHttpUrl('http://example.com/a').protocol).toBe('http:');
  });

  it('rejects non-http protocols', () => {
    expect(() => parseHttpUrl('ftp://example.com')).toThrowError(ToolError);
    expect(() => parseHttpUrl('file:///etc/passwd')).toThrowError(ToolError);
    expect(() => parseHttpUrl('javascript:alert(1)')).toThrowError(ToolError);
  });

  it('rejects non-web ports', () => {
    expect(() => parseHttpUrl('https://example.com:22')).toThrowError(ToolError);
    expect(() => parseHttpUrl('https://example.com:3306')).toThrowError(ToolError);
  });

  it('allows standard web ports', () => {
    expect(parseHttpUrl('https://example.com:8443').port).toBe('8443');
  });

  it('rejects internal hosts', () => {
    expect(() => parseHttpUrl('http://localhost:8080')).toThrowError(ToolError);
    expect(() => parseHttpUrl('http://169.254.169.254/latest/meta-data/')).toThrowError(ToolError);
  });
});

describe('parsePositiveInt', () => {
  it('clamps into range', () => {
    expect(parsePositiveInt('5', 1, 1, 10)).toBe(5);
    expect(parsePositiveInt('99', 1, 1, 10)).toBe(10);
    expect(parsePositiveInt('-4', 1, 1, 10)).toBe(1);
  });

  it('falls back for non-numeric input', () => {
    expect(parsePositiveInt('abc', 7, 1, 10)).toBe(7);
    expect(parsePositiveInt('', 7, 1, 10)).toBe(7);
  });
});
