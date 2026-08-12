import { describe, expect, it } from 'vitest';
import { scanSecrets, mask, entropy, SECRET_RULES } from '../../src/security/secrets.js';
import { extractMetadata } from '../../src/security/metadata.js';
import { fingerprint, detectMagic, integrityFindings } from '../../src/security/fingerprint.js';
import { extractIocs, buildIocTree, classifyHost } from '../../src/security/ioc.js';
import { scanFile, scanSecretsText, scanIocs } from '../../src/security/scans.js';
import { buildApk, BENIGN_APK } from '../helpers/apk-builder.js';
import { ToolError } from '../../src/utils/errors.js';

const ids = (findings: { id: string }[]): string[] => findings.map((finding) => finding.id);

/**
 * Synthetic credentials, shaped like the real thing but valid nowhere.
 *
 * Assembled from fragments at runtime rather than written as literals: a
 * committed string that *looks* like a live Slack or Stripe key trips GitHub
 * push protection and every other credential scanner pointed at this repo.
 * The scanner under test sees the identical joined value either way, so the
 * coverage is unchanged — only the bytes on disk differ.
 */
const join = (...parts: string[]): string => parts.join('');

const FIXTURES = {
  awsKey: join('AKIA', 'IOSFODNN', '7EXAMPLE'),
  awsSecret: join('wJalrXUtnFEMI/', 'K7MDENG/', 'bPxRfiCY', 'EXAMPLEKEY'),
  githubToken: join('ghp', '_', 'A1b2C3d4E5f6', 'G7h8I9j0K1l2', 'M3n4O5p6Q7r8'),
  jwt: join(
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.',
    'eyJzdWIiOiIxMjM0NTY3ODkwIn0.',
    'dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U',
  ),
  dbUrl: join('postgres://', 'dbadmin', ':', 'Str0ngP4ssw0rd', '@db.example.com:5432/production'),
  telegram: join('1234567890', ':', 'AAHdqTcvCH1vGWJxfSeofSAs', '0K5PALDsaw'),
  slack: join('xox', 'b-', '123456789012-', '1234567890123-', 'AbCdEfGhIjKlMnOpQrStUvWx'),
  stripe: join('sk', '_', 'live', '_', '4eC39HqLyjWDarjtT1zdp7dc'),
  privateKey: join('-----BEGIN RSA PRIVATE KEY-----', '\nMIIEpAIBAAKCAQEA\n', '-----END RSA PRIVATE KEY-----'),
};

describe('Secret scanner — detection', () => {
  it('detects an AWS access key', () => {
    expect(ids(scanSecrets(`key = "${FIXTURES.awsKey}"`).findings)).toContain('secret.aws_access_key');
  });

  it('detects an AWS secret key next to its variable name', () => {
    expect(ids(scanSecrets(`aws_secret_access_key = "${FIXTURES.awsSecret}"`).findings)).toContain('secret.aws_secret_key');
  });

  it('detects a private key block', () => {
    const findings = scanSecrets(FIXTURES.privateKey).findings;
    expect(ids(findings)).toContain('secret.private_key');
    expect(findings.find((item) => item.id === 'secret.private_key')?.severity).toBe('critical');
  });

  it('detects a GitHub token', () => {
    expect(ids(scanSecrets(`GH=${FIXTURES.githubToken}`).findings)).toContain('secret.github_token');
  });

  it('detects a JWT', () => {
    expect(ids(scanSecrets(`Authorization: ${FIXTURES.jwt}`).findings)).toContain('secret.jwt');
  });

  it('detects a database URL with credentials', () => {
    expect(ids(scanSecrets(`DATABASE_URL=${FIXTURES.dbUrl}`).findings)).toContain('secret.db_url');
  });

  it('detects a Telegram bot token', () => {
    expect(ids(scanSecrets(`BOT_TOKEN=${FIXTURES.telegram}`).findings)).toContain('secret.telegram_token');
  });

  it('detects Slack and Stripe keys', () => {
    expect(ids(scanSecrets(`a=${FIXTURES.slack}`).findings)).toContain('secret.slack_token');
    expect(ids(scanSecrets(`b=${FIXTURES.stripe}`).findings)).toContain('secret.stripe_key');
  });

  it('detects a webhook URL', () => {
    const text = `hook: ${join('https://hooks.', 'slack.com', '/services/', 'T00000000/', 'B00000000/', 'XXXXXXXXXXXXXXXXXXXXXXXX')}`;
    expect(ids(scanSecrets(text).findings)).toContain('secret.webhook_url');
  });

  it('reports nothing for text with no secrets', () => {
    const clean = `
      function add(a, b) { return a + b; }
      const greeting = "hello world";
      // TODO: refactor this later
    `;
    expect(scanSecrets(clean).findings).toEqual([]);
  });

  it('ignores documentation placeholders', () => {
    const placeholders = `
      API_KEY = "your_api_key_here"
      SECRET = "xxxxxxxxxxxxxxxxxxxx"
      password = "changeme"
      token = "<YOUR_TOKEN>"
      apikey = "INSERT_KEY_HERE"
    `;
    const findings = scanSecrets(placeholders).findings;
    expect(ids(findings)).not.toContain('secret.generic_api_key');
  });
});

describe('Secret scanner — privacy guarantees', () => {
  it('never includes a raw secret value in its output', () => {
    const text = Object.values(FIXTURES).join('\n');
    const result = scanSecrets(text, 'config.env');
    const serialised = JSON.stringify(result);

    for (const [name, value] of Object.entries(FIXTURES)) {
      // Check a distinctive slice — the full value must never round-trip out.
      const distinctive = value.replace(/-----[A-Z ]+-----/g, '').trim().slice(4, 20);
      if (distinctive.length >= 8) {
        expect(serialised, `leaked ${name}`).not.toContain(distinctive);
      }
    }
  });

  it('masks values while keeping them identifiable', () => {
    const masked = mask(FIXTURES.awsKey);
    expect(masked).toContain('AKI');
    expect(masked).toContain('•');
    expect(masked).not.toContain('IOSFODNN');
    expect(masked).toContain('20 chars');
  });

  it('masks short values completely', () => {
    expect(mask('abc123')).toBe('••••••');
    expect(mask('abc123')).not.toContain('abc');
  });

  it('reports line numbers so a leak can be located', () => {
    const text = `line one\nline two\nAWS=${FIXTURES.awsKey}\nline four`;
    const finding = scanSecrets(text, 'env').findings.find((item) => item.id === 'secret.aws_access_key');
    expect(finding?.evidence[0]).toContain('env:3');
  });

  it('computes Shannon entropy sensibly', () => {
    expect(entropy('aaaaaaaa')).toBeLessThan(1);
    expect(entropy('a1B2c3D4e5F6g7H8')).toBeGreaterThan(3.5);
  });

  it('gives every rule an explanation and a recommendation', () => {
    for (const rule of SECRET_RULES) {
      expect(rule.explanation.fa.length, rule.id).toBeGreaterThan(30);
      expect(rule.explanation.en.length, rule.id).toBeGreaterThan(30);
      expect(rule.recommendation.en.length, rule.id).toBeGreaterThan(10);
    }
  });

  it('suppresses the generic rule when a specific one already matched the line', () => {
    const findings = scanSecrets(`token = "${FIXTURES.githubToken}"`).findings;
    expect(ids(findings)).toContain('secret.github_token');
    expect(ids(findings)).not.toContain('secret.generic_api_key');
  });
});

describe('Secret scan entry point', () => {
  it('rejects empty input', async () => {
    await expect(scanSecretsText('   ')).rejects.toThrow(ToolError);
  });

  it('rates a file full of credentials as critical', async () => {
    const { report } = await scanSecretsText(Object.values(FIXTURES).join('\n'), 'leak.env');
    expect(report.severity).toBe('critical');
    expect(report.findings.length).toBeGreaterThan(4);
  });

  it('rates clean code as safe', async () => {
    const { report } = await scanSecretsText('const x = 1;\nexport default x;\n', 'index.ts');
    expect(report.severity).toBe('safe');
    expect(report.findings).toEqual([]);
  });
});

// ─── File fingerprinting ──────────────────────────────────────────────────

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00]);
const PDF = new TextEncoder().encode('%PDF-1.7\n1 0 obj\n<< /Type /Catalog >>\n');
const ELF = new Uint8Array([0x7f, 0x45, 0x4c, 0x46, 2, 1, 1, 0, 0, 0, 0, 0]);

describe('File fingerprinting', () => {
  it('computes all three digests with the expected lengths', async () => {
    const print = await fingerprint(new TextEncoder().encode('hello world'));
    expect(print.sha256).toHaveLength(64);
    expect(print.sha1).toHaveLength(40);
    expect(print.md5).toHaveLength(32);
    // Known digests for "hello world".
    expect(print.sha256).toBe('b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9');
    expect(print.md5).toBe('5eb63bbbe01eeed093cb22bb8f5acdc3');
  });

  it('identifies common formats from magic bytes', () => {
    expect(detectMagic(PNG)?.type).toBe('png');
    expect(detectMagic(JPEG)?.type).toBe('jpeg');
    expect(detectMagic(PDF)?.type).toBe('pdf');
    expect(detectMagic(ELF)?.type).toBe('elf');
  });

  it('recognises an APK rather than reporting a plain ZIP', () => {
    expect(detectMagic(buildApk(BENIGN_APK))?.type).toBe('apk');
  });

  it('returns null for unrecognised content', () => {
    expect(detectMagic(new Uint8Array([0x11, 0x22, 0x33, 0x44, 0x55, 0x66]))).toBeNull();
  });

  it('treats an executable disguised as a document as high severity', async () => {
    const print = await fingerprint(buildApk(BENIGN_APK), { fileName: 'invoice.pdf', mimeType: 'application/pdf' });
    const finding = integrityFindings(print).find((item) => item.id === 'file.extension.mismatch');
    expect(finding?.severity).toBe('high');
  });

  it('treats a mislabelled image as a minor issue', async () => {
    const print = await fingerprint(JPEG, { fileName: 'photo.png' });
    const finding = integrityFindings(print).find((item) => item.id === 'file.extension.mismatch');
    expect(finding?.severity).toBe('low');
  });

  it('reports no mismatch when the extension is correct', async () => {
    const print = await fingerprint(PNG, { fileName: 'logo.png', mimeType: 'image/png' });
    expect(ids(integrityFindings(print))).not.toContain('file.extension.mismatch');
  });

  it('flags native executables', async () => {
    const print = await fingerprint(ELF, { fileName: 'tool' });
    expect(ids(integrityFindings(print))).toContain('file.executable');
  });

  it('produces identical hashes for identical content', async () => {
    const a = await fingerprint(PNG);
    const b = await fingerprint(PNG.slice());
    expect(a.sha256).toBe(b.sha256);
  });
});

// ─── Metadata privacy ─────────────────────────────────────────────────────

/** Builds a minimal JPEG carrying an EXIF IFD0 with the given ASCII tags. */
function jpegWithExif(tags: { tag: number; value: string }[], gps?: { lat: number; lon: number }): Uint8Array {
  const entries: number[][] = [];
  const dataArea: number[] = [];
  const tiffHeaderSize = 8;
  const entryCount = tags.length + (gps ? 1 : 0);
  const dataStart = tiffHeaderSize + 2 + entryCount * 12 + 4;

  for (const { tag, value } of tags) {
    const bytes = [...new TextEncoder().encode(value), 0];
    const offset = dataStart + dataArea.length;
    entries.push([
      tag & 0xff, tag >> 8,
      2, 0,                                     // ASCII
      bytes.length & 0xff, (bytes.length >> 8) & 0xff, 0, 0,
      offset & 0xff, (offset >> 8) & 0xff, 0, 0,
    ]);
    dataArea.push(...bytes);
  }

  let gpsIfd: number[] = [];
  if (gps) {
    const gpsOffset = dataStart + dataArea.length;
    entries.push([
      0x25, 0x88,                                // GPS IFD pointer (0x8825)
      4, 0,                                      // LONG
      1, 0, 0, 0,
      gpsOffset & 0xff, (gpsOffset >> 8) & 0xff, (gpsOffset >> 16) & 0xff, 0,
    ]);

    const rational = (whole: number): number[] => {
      const deg = Math.floor(whole);
      const minFloat = (whole - deg) * 60;
      const min = Math.floor(minFloat);
      const sec = Math.round((minFloat - min) * 60 * 100);
      return [
        deg, 0, 0, 0, 1, 0, 0, 0,
        min, 0, 0, 0, 1, 0, 0, 0,
        sec & 0xff, (sec >> 8) & 0xff, 0, 0, 100, 0, 0, 0,
      ];
    };

    const gpsEntries: number[][] = [];
    const gpsData: number[] = [];
    const gpsDataStart = gpsOffset + 2 + 4 * 12 + 4;

    const latRef = gps.lat >= 0 ? 'N' : 'S';
    const lonRef = gps.lon >= 0 ? 'E' : 'W';
    gpsEntries.push([1, 0, 2, 0, 2, 0, 0, 0, latRef.charCodeAt(0), 0, 0, 0]);
    const latOffset = gpsDataStart + gpsData.length;
    gpsData.push(...rational(Math.abs(gps.lat)));
    gpsEntries.push([2, 0, 5, 0, 3, 0, 0, 0, latOffset & 0xff, (latOffset >> 8) & 0xff, (latOffset >> 16) & 0xff, 0]);
    gpsEntries.push([3, 0, 2, 0, 2, 0, 0, 0, lonRef.charCodeAt(0), 0, 0, 0]);
    const lonOffset = gpsDataStart + gpsData.length;
    gpsData.push(...rational(Math.abs(gps.lon)));
    gpsEntries.push([4, 0, 5, 0, 3, 0, 0, 0, lonOffset & 0xff, (lonOffset >> 8) & 0xff, (lonOffset >> 16) & 0xff, 0]);

    gpsIfd = [gpsEntries.length, 0, ...gpsEntries.flat(), 0, 0, 0, 0, ...gpsData];
  }

  const tiff = [
    0x49, 0x49, 0x2a, 0x00, 8, 0, 0, 0,        // little-endian, IFD0 at 8
    entryCount, 0,
    ...entries.flat(),
    0, 0, 0, 0,                                 // no IFD1
    ...dataArea,
    ...gpsIfd,
  ];

  const app1Payload = [0x45, 0x78, 0x69, 0x66, 0, 0, ...tiff]; // "Exif\0\0"
  const app1Length = app1Payload.length + 2;

  return new Uint8Array([
    0xff, 0xd8,
    0xff, 0xe1, (app1Length >> 8) & 0xff, app1Length & 0xff,
    ...app1Payload,
    0xff, 0xd9,
  ]);
}

describe('Metadata privacy scanner', () => {
  it('extracts device make and model from EXIF', () => {
    const jpeg = jpegWithExif([
      { tag: 0x010f, value: 'NIKON' },
      { tag: 0x0110, value: 'COOLPIX P6000' },
    ]);
    const result = extractMetadata(jpeg, 'image/jpeg');
    const keys = result.items.map((item) => item.key);
    expect(keys).toContain('Make');
    expect(keys).toContain('Model');
    expect(result.items.find((item) => item.key === 'Model')?.value).toBe('COOLPIX P6000');
  });

  it('decodes GPS coordinates and flags them as high risk', () => {
    const jpeg = jpegWithExif([{ tag: 0x010f, value: 'Canon' }], { lat: 43.4674, lon: 11.8851 });
    const result = extractMetadata(jpeg, 'image/jpeg');

    expect(result.gps).toBeDefined();
    expect(result.gps?.latitude).toBeCloseTo(43.4674, 2);
    expect(result.gps?.longitude).toBeCloseTo(11.8851, 2);

    const finding = result.findings.find((item) => item.id === 'privacy.gps');
    expect(finding?.severity).toBe('high');
    expect(finding?.confidence).toBe(100);
  });

  it('marks author and serial number as sensitive', () => {
    const jpeg = jpegWithExif([
      { tag: 0x013b, value: 'Jane Doe' },
      { tag: 0x0131, value: 'Adobe Photoshop' },
    ]);
    const result = extractMetadata(jpeg, 'image/jpeg');
    expect(ids(result.findings)).toContain('privacy.author');
    expect(ids(result.findings)).toContain('privacy.software');
    expect(result.items.find((item) => item.key === 'Artist')?.sensitive).toBe(true);
  });

  it('reports nothing for a JPEG without EXIF', () => {
    const plain = new Uint8Array([0xff, 0xd8, 0xff, 0xdb, 0x00, 0x43, 0x00, 0xff, 0xd9]);
    const result = extractMetadata(plain, 'image/jpeg');
    expect(result.items).toEqual([]);
    expect(result.findings).toEqual([]);
  });

  it('reads PNG text chunks', () => {
    const encoder = new TextEncoder();
    const keyword = encoder.encode('Author\0Jane Doe');
    const chunk = [
      0, 0, 0, keyword.length,
      0x74, 0x45, 0x58, 0x74, // tEXt
      ...keyword,
      0, 0, 0, 0,
    ];
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...chunk]);
    const result = extractMetadata(png, 'image/png');
    expect(result.items.some((item) => item.value.includes('Jane Doe'))).toBe(true);
  });

  it('extracts PDF document info and flags embedded JavaScript', () => {
    const pdf = new TextEncoder().encode(
      '%PDF-1.7\n/Author (Jane Doe) /Creator (Word) /CreationDate (D:20240101120000)\n/JavaScript 4 0 R\n',
    );
    const result = extractMetadata(pdf, 'application/pdf');
    expect(result.items.find((item) => item.key === 'Author')?.value).toBe('Jane Doe');
    expect(ids(result.findings)).toContain('privacy.pdf_javascript');
  });

  it('rates a GPS-tagged photo as high overall', async () => {
    const jpeg = jpegWithExif([{ tag: 0x010f, value: 'Apple' }], { lat: 35.68, lon: 139.69 });
    const { report } = await scanFile(jpeg, 'holiday.jpg', 'image/jpeg');
    expect(report.severity).toBe('high');
  });

  it('rates a metadata-free file as safe', async () => {
    const { report } = await scanFile(PNG, 'logo.png', 'image/png');
    expect(report.severity).toBe('safe');
  });
});

// ─── IOC engine ───────────────────────────────────────────────────────────

describe('IOC extraction and correlation', () => {
  it('extracts each indicator kind', () => {
    const text = 'Reach us at 203.0.113.5 or https://panel.example.com/api, mail admin@example.com, md5 5eb63bbbe01eeed093cb22bb8f5acdc3';
    const iocs = extractIocs(text, { source: 'test' });
    const kinds = new Set(iocs.map((ioc) => ioc.kind));
    expect(kinds.has('ip')).toBe(true);
    expect(kinds.has('url')).toBe(true);
    expect(kinds.has('email')).toBe(true);
    expect(kinds.has('hash')).toBe(true);
  });

  it('rejects version numbers that look like IP addresses', () => {
    const iocs = extractIocs('version 1.2.3.4 and build 0.0.0.1', { source: 'test' });
    expect(iocs.filter((ioc) => ioc.kind === 'ip')).toEqual([]);
  });

  it('rejects strings that only look like domains', () => {
    const iocs = extractIocs('com.example.MyClass and file.tar.gz', { source: 'test' });
    const domains = iocs.filter((ioc) => ioc.kind === 'domain').map((ioc) => ioc.value);
    expect(domains).not.toContain('com.example.myclass');
  });

  it('classifies risky hosting and abusive TLDs', () => {
    expect(classifyHost('payload.ngrok-free.app').severity).toBe('medium');
    expect(classifyHost('free-prize.tk').severity).toBe('low');
    expect(classifyHost('www.google.com').severity).toBe('safe');
  });

  it('builds a tree that nests URLs under their domain', () => {
    const iocs = extractIocs('see https://c2.example.com/a and https://c2.example.com/b plus c2.example.com', {
      source: 'test',
    });
    const tree = buildIocTree(iocs);
    const parent = tree.find((node) => node.ioc.value === 'c2.example.com');
    expect(parent?.children.length).toBeGreaterThanOrEqual(2);
  });

  it('marks plain HTTP URLs as at least low risk', () => {
    const iocs = extractIocs('http://plain.example.com/login', { source: 'test' });
    expect(iocs.find((ioc) => ioc.kind === 'url')?.severity).toBe('low');
  });

  it('rejects input with no indicators', async () => {
    await expect(scanIocs('just some ordinary words here')).rejects.toThrow(ToolError);
  });

  it('reports risky indicators through the scan entry point', async () => {
    const { report } = await scanIocs('c2 at http://panel.evil-host.tk/gate.php and 198.51.100.23');
    expect(report.iocs.length).toBeGreaterThan(0);
    expect(report.scanType).toBe('ioc');
  });
});
