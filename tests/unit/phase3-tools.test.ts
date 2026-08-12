/**
 * Behavioural tests for the 20 tools added in Phase 3.
 *
 * Each tool is exercised through the registry the same way the bot calls it,
 * with at least one valid, invalid, empty and oversized/edge case.
 */
import { describe, expect, it } from 'vitest';
import { getTool } from '../../src/tools/registry.js';
import { ToolError } from '../../src/utils/errors.js';
import type { ToolDefinition, ToolRunContext } from '../../src/tools/types.js';

const fa: ToolRunContext = { lang: 'fa', userId: 1 };
const en: ToolRunContext = { lang: 'en', userId: 1 };

const tool = (id: string): ToolDefinition => {
  const found = getTool(id);
  if (!found) throw new Error(`tool ${id} is not registered`);
  return found;
};

const run = async (id: string, input: string, ctx: ToolRunContext = en): Promise<string> =>
  (await Promise.resolve(tool(id).run(input, ctx))).html;

const rejects = async (id: string, input: string): Promise<void> => {
  await expect(async () => Promise.resolve(tool(id).run(input, en))).rejects.toBeInstanceOf(ToolError);
};

// ─── 1. YAML ↔ JSON ───────────────────────────────────────────────────────

describe('yaml_json', () => {
  it('converts YAML to JSON automatically', async () => {
    const html = await run('yaml_json', 'name: app\nport: 8080');
    expect(html).toContain('&quot;name&quot;');
    expect(html).toContain('8080');
  });

  it('converts JSON to YAML automatically', async () => {
    const html = await run('yaml_json', '{"name":"app","port":8080}');
    expect(html).toContain('name: app');
    expect(html).toContain('port: 8080');
  });

  it('honours an explicit mode directive', async () => {
    const html = await run('yaml_json', 'mode: minify\n{"a": 1, "b": 2}');
    expect(html).toContain('{&quot;a&quot;:1,&quot;b&quot;:2}');
  });

  it('validates without converting', async () => {
    const html = await run('yaml_json', 'mode: validate\nkey: value');
    expect(html).toContain('valid');
  });

  it('reports the failing line for malformed YAML', async () => {
    try {
      await run('yaml_json', 'a: 1\nb: 2\n\tc: 3');
      throw new Error('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(ToolError);
      expect((error as ToolError).en).toContain('Line');
    }
  });

  it('rejects empty and oversized documents', async () => {
    await rejects('yaml_json', '   ');
    await rejects('yaml_json', `key: ${'x'.repeat(9000)}`);
  });

  it('attaches a file when the output is large', async () => {
    const many = Array.from({ length: 300 }, (_, i) => `key_${i}: value_${i}`).join('\n');
    const result = await Promise.resolve(tool('yaml_json').run(many, en));
    expect(result.attachment?.name).toBe('converted.json');
    expect(result.attachment?.content.length).toBeGreaterThan(1000);
  });
});

// ─── 2. XML formatter ─────────────────────────────────────────────────────

describe('xml_format', () => {
  it('pretty-prints a document', async () => {
    const html = await run('xml_format', '<a><b x="1"/></a>');
    expect(html).toContain('&lt;b x=&quot;1&quot;/&gt;');
  });

  it('minifies on request', async () => {
    const html = await run('xml_format', 'mode: minify\n<a>\n  <b>t</b>\n</a>');
    expect(html).toContain('&lt;a&gt;&lt;b&gt;t&lt;/b&gt;&lt;/a&gt;');
  });

  it('validates and reports element statistics', async () => {
    const html = await run('xml_format', 'mode: validate\n<r><a/><b/></r>');
    expect(html).toContain('Valid XML');
    expect(html).toContain('3');
  });

  it('renders the element tree', async () => {
    const html = await run('xml_format', 'mode: tree\n<root><child a="1"/></root>');
    expect(html).toContain('root');
    expect(html).toContain('child');
  });

  it('rejects malformed XML with a line and column', async () => {
    try {
      await run('xml_format', '<a><b></a>');
      throw new Error('should have thrown');
    } catch (error) {
      expect((error as ToolError).en).toMatch(/[Ll]ine \d+/);
    }
  });

  it('refuses a DOCTYPE with an internal subset (XXE)', async () => {
    await rejects('xml_format', '<!DOCTYPE f [<!ENTITY x SYSTEM "file:///etc/passwd">]><f>&x;</f>');
  });

  it('rejects empty and oversized input', async () => {
    await rejects('xml_format', '  ');
    await rejects('xml_format', `<a>${'x'.repeat(9000)}</a>`);
  });
});

// ─── 3. Number base converter ─────────────────────────────────────────────

describe('base_convert', () => {
  it('shows all four bases for a prefixed hex number', async () => {
    const html = await run('base_convert', '0xFF');
    expect(html).toContain('255');
    expect(html).toContain('377');
    expect(html).toContain('1111 1111');
  });

  it('reads an explicit source base', async () => {
    expect(await run('base_convert', '1010 bin')).toContain('10');
    expect(await run('base_convert', '777 oct')).toContain('511');
  });

  it('performs a targeted conversion', async () => {
    expect(await run('base_convert', '255 dec to hex')).toContain('FF');
    expect(await run('base_convert', '255 dec to bin')).toContain('11111111');
  });

  it('handles zero and negative values', async () => {
    expect(await run('base_convert', '0')).toContain('0');
    const negative = await run('base_convert', '-5');
    expect(negative).toContain('-5');
    expect(negative).toContain('FFFFFFFB');
  });

  it('rejects digits that do not belong to the base', async () => {
    await rejects('base_convert', '0b1012');
    await rejects('base_convert', '99 oct');
    await rejects('base_convert', 'ZZ hex');
  });

  it('rejects empty input and numbers past the bit cap', async () => {
    await rejects('base_convert', '   ');
    await rejects('base_convert', '9'.repeat(60));
  });
});

// ─── 4. Programmer calculator ─────────────────────────────────────────────

describe('prog_calc', () => {
  it('computes the bitwise operators', async () => {
    expect(await run('prog_calc', '0xFF AND 0x0F')).toContain('15');
    expect(await run('prog_calc', '12 OR 3')).toContain('15');
    expect(await run('prog_calc', '12 XOR 10')).toContain('6');
    expect(await run('prog_calc', '1 SHL 8')).toContain('256');
    expect(await run('prog_calc', '256 SHR 4')).toContain('16');
    expect(await run('prog_calc', '17 MOD 5')).toContain('2');
  });

  it('supports symbolic operators without spaces', async () => {
    expect(await run('prog_calc', '0xFF&0x0F')).toContain('15');
  });

  it('masks NOT to the requested word width', async () => {
    expect(await run('prog_calc', 'NOT 0 :8')).toContain('255');
    expect(await run('prog_calc', 'NOT 0 :16')).toContain('65535');
  });

  it('rejects division and modulo by zero', async () => {
    await rejects('prog_calc', '1 MOD 0');
    await rejects('prog_calc', '1 / 0');
  });

  it('rejects unknown operators, bad widths and empty input', async () => {
    await rejects('prog_calc', '1 FOO 2');
    await rejects('prog_calc', '1 AND 2 :7');
    await rejects('prog_calc', '   ');
  });

  it('rejects an out-of-range shift', async () => {
    await rejects('prog_calc', '1 SHL 200');
  });
});

// ─── 5. Date & time converter ─────────────────────────────────────────────

describe('datetime_convert', () => {
  it('recognises a 10-digit epoch as seconds', async () => {
    const html = await run('datetime_convert', '1700000000');
    expect(html).toContain('2023-11-14');
    expect(html).toContain('10-digit');
  });

  it('recognises a 13-digit epoch as milliseconds', async () => {
    const html = await run('datetime_convert', '1700000000000');
    expect(html).toContain('2023-11-14');
    expect(html).toContain('13-digit');
  });

  it('parses an ISO 8601 string back to epoch seconds', async () => {
    expect(await run('datetime_convert', '2023-11-14T22:13:20Z')).toContain('1700000000');
  });

  it('renders the time in a requested zone', async () => {
    const html = await run('datetime_convert', '1700000000 @ Asia/Tehran');
    expect(html).toContain('Asia/Tehran');
    expect(html).toContain('2023-11-15 01:43:20');
  });

  it('accepts the word now', async () => {
    expect(await run('datetime_convert', 'now')).toContain('UTC');
  });

  it('rejects garbage, empty input and unknown zones', async () => {
    await rejects('datetime_convert', 'not-a-date');
    await rejects('datetime_convert', '  ');
    await rejects('datetime_convert', '1700000000 @ Mars/Olympus');
  });
});

// ─── 6. Timezone converter ────────────────────────────────────────────────

describe('timezone_convert', () => {
  it('converts a wall-clock time between two zones', async () => {
    // Berlin is UTC+2 in July; Iran dropped DST in 2022 and stays at UTC+3:30.
    const html = await run('timezone_convert', '2024-07-01 14:30 Europe/Berlin to Asia/Tehran');
    expect(html).toContain('Asia/Tehran');
    expect(html).toContain('2024-07-01 16:00');
    expect(html).toContain('+1:30');
  });

  it('reports DST as active in a European summer', async () => {
    const html = await run('timezone_convert', '2024-07-01 12:00 Europe/Berlin to UTC');
    expect(html).toContain('DST active');
    expect(html).toContain('UTC+02:00');
  });

  it('reports standard time in a European winter', async () => {
    const html = await run('timezone_convert', '2024-01-15 12:00 Europe/Berlin to UTC');
    expect(html).toContain('standard time');
    expect(html).toContain('UTC+01:00');
  });

  it('handles a zone without DST', async () => {
    const html = await run('timezone_convert', '2024-07-01 12:00 Asia/Dubai to UTC');
    expect(html).toContain('UTC+04:00');
  });

  it('lists the common zones when no target is given', async () => {
    const html = await run('timezone_convert', 'now Europe/Berlin');
    expect(html).toContain('America/New_York');
    expect(html).toContain('Asia/Tehran');
  });

  it('rejects an unknown zone, an abbreviation and empty input', async () => {
    await rejects('timezone_convert', 'now Nowhere/Nothing');
    await rejects('timezone_convert', '2024-01-01 10:00 CET to PST');
    await rejects('timezone_convert', '   ');
  });

  it('rejects an out-of-range clock time', async () => {
    await rejects('timezone_convert', '2024-01-01 99:00 UTC to UTC');
  });
});

// ─── 7. Diff checker ──────────────────────────────────────────────────────

describe('diff_check', () => {
  it('reports identical inputs', async () => {
    const html = await run('diff_check', 'same\n---\nsame');
    expect(html).toContain('identical');
  });

  it('reports added, removed and changed counts', async () => {
    const html = await run('diff_check', 'a\nb\nc\n---\na\nX\nc\nd');
    expect(html).toContain('Added');
    expect(html).toContain('Changed');
    expect(html).toContain('Similarity');
  });

  it('honours the ignorecase flag', async () => {
    const html = await run('diff_check', 'flags: ignorecase\nHELLO\n---\nhello');
    expect(html).toContain('identical');
  });

  it('requires a separator line', async () => {
    await rejects('diff_check', 'just one text with no divider');
  });

  it('rejects empty input and an oversized side', async () => {
    await rejects('diff_check', '   ');
    await rejects('diff_check', `${'x'.repeat(7000)}\n---\ny`);
  });

  it('rejects more lines than the cap allows', async () => {
    const many = Array.from({ length: 1400 }, (_, i) => `l${i}`).join('\n');
    await rejects('diff_check', `${many}\n---\n${many}`);
  });

  it('delivers a full report as an attachment when long', async () => {
    const a = Array.from({ length: 120 }, (_, i) => `line ${i}`).join('\n');
    const b = Array.from({ length: 120 }, (_, i) => `LINE ${i}`).join('\n');
    const result = await Promise.resolve(tool('diff_check').run(`${a}\n---\n${b}`, en));
    expect(result.attachment?.name).toBe('diff-report.txt');
    expect(result.attachment?.content).toContain('similarity');
  });
});

// ─── 8. Duplicate line remover ────────────────────────────────────────────

describe('dedupe_lines', () => {
  it('keeps the first occurrence and preserves order', async () => {
    const html = await run('dedupe_lines', 'b\na\nb\nc\na');
    expect(html).toContain('Original lines: <b>5</b>');
    expect(html).toContain('Unique: <b>3</b>');
    expect(html).toContain('Removed: <b>2</b>');
    expect(html).toMatch(/b\na\nc/);
  });

  it('is case-insensitive by default and case-sensitive on request', async () => {
    expect(await run('dedupe_lines', 'A\na')).toContain('Unique: <b>1</b>');
    expect(await run('dedupe_lines', 'flags: casesensitive\nA\na')).toContain('Unique: <b>2</b>');
  });

  it('drops blank lines unless told to keep them', async () => {
    expect(await run('dedupe_lines', 'a\n\n\nb')).toContain('Original lines: <b>2</b>');
    expect(await run('dedupe_lines', 'flags: keepempty\na\n\nb')).toContain('Original lines: <b>3</b>');
  });

  it('supports sorting and duplicates-only mode', async () => {
    expect(await run('dedupe_lines', 'flags: sort\nc\na\nb')).toMatch(/a\nb\nc/);
    const onlyDup = await run('dedupe_lines', 'flags: onlydup\na\nb\na');
    expect(onlyDup).toContain('a');
  });

  it('reports the most repeated lines', async () => {
    expect(await run('dedupe_lines', 'x\nx\nx\ny')).toContain('× 3');
  });

  it('rejects empty input and too many lines', async () => {
    await rejects('dedupe_lines', '   ');
    await rejects('dedupe_lines', Array.from({ length: 3100 }, (_, i) => `l${i}`).join('\n'));
  });
});

// ─── 9. CSV ↔ JSON ────────────────────────────────────────────────────────

describe('csv_json', () => {
  it('converts CSV with a header to JSON', async () => {
    const html = await run('csv_json', 'name,age\nada,36\nbob,40');
    expect(html).toContain('&quot;name&quot;');
    expect(html).toContain('&quot;ada&quot;');
    expect(html).toContain('detected');
  });

  it('auto-names columns when there is no header', async () => {
    const html = await run('csv_json', '1,2\n3,4');
    expect(html).toContain('column_1');
  });

  it('detects a semicolon delimiter', async () => {
    const html = await run('csv_json', 'a;b\n1;2');
    expect(html).toContain(';');
  });

  it('handles quoted fields containing the delimiter and newlines', async () => {
    const html = await run('csv_json', 'name,note\n"Smith, J","line1\nline2"');
    expect(html).toContain('Smith, J');
  });

  it('converts JSON back to CSV', async () => {
    const html = await run('csv_json', '[{"a":1,"b":2},{"a":3,"b":4}]');
    expect(html).toContain('a,b');
    expect(html).toContain('1,2');
  });

  it('rejects a JSON shape that is not an array of flat objects', async () => {
    await rejects('csv_json', '[1,2,3]');
  });

  it('rejects an unterminated quoted field', async () => {
    await rejects('csv_json', 'a,b\n"unclosed,2');
  });

  it('rejects empty and oversized input', async () => {
    await rejects('csv_json', '   ');
    await rejects('csv_json', `a\n${'x'.repeat(9000)}`);
  });
});

// ─── 10. Text transformer ─────────────────────────────────────────────────

describe('text_transform', () => {
  it('produces all nine naming conventions', async () => {
    const html = await run('text_transform', 'hello dev world');
    expect(html).toContain('helloDevWorld');
    expect(html).toContain('HelloDevWorld');
    expect(html).toContain('hello_dev_world');
    expect(html).toContain('hello-dev-world');
    expect(html).toContain('HELLO_DEV_WORLD');
    expect(html).toContain('hello.dev.world');
  });

  it('removes and normalises whitespace', async () => {
    const html = await run('text_transform', 'a  b   c');
    expect(html).toContain('abc');
    expect(html).toContain('a b c');
  });

  it('returns a single variant when a mode is given', async () => {
    const html = await run('text_transform', 'mode: snake\nHello World');
    expect(html).toContain('hello_world');
    expect(html).not.toContain('camelCase');
  });

  it('slugifies text', async () => {
    expect(await run('text_transform', 'mode: slug\nHello, World!')).toContain('hello-world');
  });

  it('rejects empty input', async () => {
    await rejects('text_transform', '   ');
    await rejects('text_transform', 'mode: snake\n');
  });
});

// ─── 13. Advanced URL parser ──────────────────────────────────────────────

describe('url_parse_pro', () => {
  it('splits every component of a full URL', async () => {
    const html = await run('url_parse_pro', 'https://user@api.example.co.uk:8443/v1/items?q=a%20b&page=2#top');
    expect(html).toContain('https');
    expect(html).toContain('api');
    expect(html).toContain('example');
    expect(html).toContain('co.uk');
    expect(html).toContain('8443');
    expect(html).toContain('/v1/items');
    expect(html).toContain('#top');
  });

  it('lists query parameters individually', async () => {
    const html = await run('url_parse_pro', 'https://a.io/?x=1&y=2');
    expect(html).toContain('x');
    expect(html).toContain('y');
  });

  it('never echoes a password from the URL', async () => {
    const html = await run('url_parse_pro', 'https://user:hunter2@example.com/');
    expect(html).not.toContain('hunter2');
    expect(html).toContain('redacted');
  });

  it('warns when the URL points at an internal host', async () => {
    expect(await run('url_parse_pro', 'http://127.0.0.1:8080/admin')).toContain('internal');
    expect(await run('url_parse_pro', 'http://169.254.169.254/latest/meta-data/')).toContain('internal');
  });

  it('confirms a public host', async () => {
    expect(await run('url_parse_pro', 'https://example.com')).toContain('public');
  });

  it('rejects an invalid URL and empty input', async () => {
    await rejects('url_parse_pro', 'ht!tp://%%%');
    await rejects('url_parse_pro', '   ');
  });
});

// ─── 15. Regex generator & explainer ──────────────────────────────────────

describe('regex_helper', () => {
  it('explains a pattern token by token', async () => {
    const html = await run('regex_helper', '/^\\d{3}-\\d{4}$/');
    expect(html).toContain('start of the string');
    expect(html).toContain('digit');
    expect(html).toContain('exactly 3 times');
    expect(html).toContain('end of the string');
  });

  it('explains flags', async () => {
    const html = await run('regex_helper', '/abc/gi');
    expect(html).toContain('global');
    expect(html).toContain('case-insensitive');
  });

  it('tests the pattern against a supplied subject', async () => {
    const html = await run('regex_helper', '/\\d+/g\nab 12 cd 345');
    expect(html).toContain('12');
    expect(html).toContain('345');
  });

  it('generates a validated pattern from a description', async () => {
    const html = await run('regex_helper', 'generate: email');
    expect(html).toContain('@');
    expect(html).toContain('Generated pattern');
  });

  it('refuses ReDoS-prone patterns', async () => {
    await rejects('regex_helper', '/(a+)+$/');
    await rejects('regex_helper', '/(a|a)*$/');
  });

  it('rejects an invalid pattern, an unknown description and empty input', async () => {
    await rejects('regex_helper', '/[unclosed/');
    await rejects('regex_helper', 'generate: something nobody has heard of');
    await rejects('regex_helper', '   ');
  });

  it('rejects an oversized pattern', async () => {
    await rejects('regex_helper', `/${'a'.repeat(400)}/`);
  });
});

// ─── 16. Cron generator & explainer ───────────────────────────────────────

describe('cron_builder', () => {
  it('explains a standard expression', async () => {
    const html = await run('cron_builder', '*/5 * * * *');
    expect(html).toContain('Every 5 minutes');
    expect(html).toContain('Next five runs');
  });

  it('breaks the expression into fields', async () => {
    const html = await run('cron_builder', '0 9 * * 1-5');
    expect(html).toContain('Minute');
    expect(html).toContain('Day of week');
    expect(html).toContain('Monday');
  });

  it('predicts runs in a requested timezone', async () => {
    const html = await run('cron_builder', '0 0 * * * @ Asia/Tehran');
    expect(html).toContain('Asia/Tehran');
    expect(html).toMatch(/\d{4}-\d{2}-\d{2} 00:00:00/);
  });

  it('generates an expression from a description', async () => {
    expect(await run('cron_builder', 'generate: every 5 minutes')).toContain('*/5 * * * *');
    expect(await run('cron_builder', 'generate: daily at 3:30')).toContain('30 3 * * *');
    expect(await run('cron_builder', 'generate: weekdays at 9')).toContain('0 9 * * 1-5');
  });

  it('warns about the POSIX day-field ambiguity', async () => {
    expect(await run('cron_builder', '0 0 1 * 1')).toContain('either');
  });

  it('accepts month and day names', async () => {
    expect(await run('cron_builder', '0 0 * JAN MON')).toContain('January');
  });

  it('rejects malformed expressions and empty input', async () => {
    await rejects('cron_builder', '* * *');
    await rejects('cron_builder', '99 * * * *');
    await rejects('cron_builder', '* * * * 9');
    await rejects('cron_builder', '   ');
  });

  it('rejects an unrecognised generator description', async () => {
    await rejects('cron_builder', 'generate: whenever I feel like it');
  });

  it('predicts sparse schedules fast enough for a Worker', async () => {
    // A once-a-year schedule used to walk every minute of two years.
    // The day/hour skipping must keep this in the millisecond range.
    const started = Date.now();
    await run('cron_builder', '0 0 29 2 * @ Europe/Berlin');
    await run('cron_builder', '0 0 * JAN MON');
    expect(Date.now() - started).toBeLessThan(2000);
  });
});

// ─── 17. Docker helper ────────────────────────────────────────────────────

describe('docker_helper', () => {
  it('generates a hardened Dockerfile per language', async () => {
    for (const [language, marker] of [
      ['node', 'node:22-alpine'],
      ['python', 'python:3.12-slim'],
      ['php', 'php:8.3-fpm-alpine'],
      ['go', 'golang:1.23-alpine'],
      ['rust', 'rust:1.82-slim'],
      ['java', 'eclipse-temurin'],
    ] as const) {
      const result = await Promise.resolve(tool('docker_helper').run(language, en));
      expect(result.attachment?.content, language).toContain(marker);
      // Hardening invariants that must hold for every template.
      expect(result.attachment?.content, language).toMatch(/USER |nonroot/);
      expect(result.attachment?.content, language).not.toMatch(/FROM \S+:latest/);
    }
  });

  it('includes a .dockerignore', async () => {
    expect(await run('docker_helper', 'node')).toContain('node_modules');
  });

  it('generates a compose file with the requested services', async () => {
    const result = await Promise.resolve(tool('docker_helper').run('compose: app postgres redis', en));
    const yaml = result.attachment?.content ?? '';
    expect(yaml).toContain('postgres:16-alpine');
    expect(yaml).toContain('redis:7-alpine');
    expect(yaml).toContain('volumes:');
  });

  it('never hard-codes a credential in a compose file', async () => {
    const result = await Promise.resolve(tool('docker_helper').run('compose: postgres mysql redis', en));
    const yaml = result.attachment?.content ?? '';
    expect(yaml).toMatch(/POSTGRES_PASSWORD: \$\{POSTGRES_PASSWORD:\?/);
    expect(yaml).not.toMatch(/PASSWORD:\s*["']?[a-zA-Z0-9]{6,}["']?\s*$/m);
    // Databases must not be published on every interface.
    expect(yaml).not.toMatch(/^\s+- "\d+:\d+"$/m);
  });

  it('rejects an unknown language or service and empty input', async () => {
    await rejects('docker_helper', 'cobol');
    await rejects('docker_helper', 'compose: notaservice');
    await rejects('docker_helper', '   ');
  });
});

// ─── 18. Git helper ───────────────────────────────────────────────────────

describe('git_helper', () => {
  it('diagnoses a non-fast-forward rejection', async () => {
    const html = await run('git_helper', '! [rejected] main -> main (non-fast-forward)');
    expect(html).toContain('remote branch is ahead');
    expect(html).toContain('git fetch origin');
  });

  it('always pairs a destructive suggestion with a warning', async () => {
    for (const input of [
      '! [rejected] main -> main (non-fast-forward)',
      'CONFLICT (content): Automatic merge failed',
      'undo last commit',
      'I committed a secret token',
      'error: Your local changes would be overwritten',
    ]) {
      const html = await run('git_helper', input);
      expect(html, input).toContain('Warning');
    }
  });

  it('tells the user to rotate a leaked secret', async () => {
    const html = await run('git_helper', 'I accidentally committed my .env with an api key');
    expect(html).toMatch(/[Rr]evoke|rotate/);
  });

  it('prefers force-with-lease over a bare force push', async () => {
    const html = await run('git_helper', 'updates were rejected because the remote contains work');
    expect(html).toContain('--force-with-lease');
  });

  it('falls back to read-only diagnostics for an unknown error', async () => {
    const html = await run('git_helper', 'some error nobody has ever seen before xyzzy');
    expect(html).toContain('git status');
    expect(html).not.toContain('reset --hard');
  });

  it('rejects empty input', async () => {
    await rejects('git_helper', '   ');
  });
});

// ─── 19. .gitignore generator ─────────────────────────────────────────────

describe('gitignore_gen', () => {
  it('generates entries for a single stack', async () => {
    const result = await Promise.resolve(tool('gitignore_gen').run('node', en));
    expect(result.attachment?.content).toContain('node_modules/');
  });

  it('combines several stacks', async () => {
    const result = await Promise.resolve(tool('gitignore_gen').run('node next python', en));
    const content = result.attachment?.content ?? '';
    expect(content).toContain('node_modules/');
    expect(content).toContain('.next/');
    expect(content).toContain('__pycache__/');
  });

  it('always adds the secrets section', async () => {
    for (const stack of ['node', 'python', 'flutter', 'android', 'java', 'c', 'go', 'rust', 'react', 'next', 'laravel', 'wordpress', 'dart']) {
      const result = await Promise.resolve(tool('gitignore_gen').run(stack, en));
      const content = result.attachment?.content ?? '';
      expect(content, stack).toContain('.env');
      expect(content, stack).toContain('*.key');
    }
  });

  it('rejects an unknown stack and empty input', async () => {
    await rejects('gitignore_gen', 'brainfuck');
    await rejects('gitignore_gen', '   ');
  });
});

// ─── 20. README generator ─────────────────────────────────────────────────

describe('readme_gen', () => {
  it('builds a README with the standard sections', async () => {
    const result = await Promise.resolve(
      tool('readme_gen').run(
        'name: My API\ndescription: A small service\nlanguage: TypeScript\nframework: Hono\nfeatures: auth, pagination\ninstall: npm ci\nusage: npm start\nenv: DATABASE_URL - connection string\napi: GET /users - list users\nlicense: MIT',
        en,
      ),
    );
    const md = result.attachment?.content ?? '';
    expect(md).toContain('# My API');
    expect(md).toContain('## Features');
    expect(md).toContain('- auth');
    expect(md).toContain('## Installation');
    expect(md).toContain('npm ci');
    expect(md).toContain('## Environment variables');
    expect(md).toContain('`DATABASE_URL`');
    expect(md).toContain('## API');
    expect(md).toContain('GET /users');
    expect(md).toContain('MIT license');
  });

  it('accepts bullet lists for repeated fields', async () => {
    const result = await Promise.resolve(
      tool('readme_gen').run('name: X\nfeatures:\n- one\n- two\n- three', en),
    );
    const md = result.attachment?.content ?? '';
    expect(md).toContain('- one');
    expect(md).toContain('- three');
  });

  it('infers installation steps from the language', async () => {
    const result = await Promise.resolve(tool('readme_gen').run('name: X\nlanguage: Python', en));
    expect(result.attachment?.content).toContain('pip install -r requirements.txt');
  });

  it('requires a project name', async () => {
    await rejects('readme_gen', 'description: only a description');
    await rejects('readme_gen', '   ');
  });

  it('never writes an environment variable value', async () => {
    const result = await Promise.resolve(
      tool('readme_gen').run('name: X\nenv: API_KEY - the key', en),
    );
    const md = result.attachment?.content ?? '';
    expect(md).toContain('`API_KEY`');
    expect(md).toContain('Never commit the real');
  });
});

// ─── Cross-cutting checks ─────────────────────────────────────────────────

describe('every Phase 3 tool', () => {
  const PHASE3_IDS = [
    'yaml_json', 'xml_format', 'base_convert', 'prog_calc', 'datetime_convert',
    'timezone_convert', 'diff_check', 'dedupe_lines', 'csv_json', 'text_transform',
    'file_hash_compare', 'image_metadata', 'url_parse_pro', 'http_request',
    'regex_helper', 'cron_builder', 'docker_helper', 'git_helper', 'gitignore_gen',
    'readme_gen',
  ];

  it('registers exactly the 20 promised tools', () => {
    for (const id of PHASE3_IDS) expect(getTool(id), id).toBeDefined();
    expect(PHASE3_IDS).toHaveLength(20);
  });

  it('documents each one in both languages', () => {
    for (const id of PHASE3_IDS) {
      const definition = tool(id);
      for (const field of ['title', 'description', 'usage', 'example', 'limitations'] as const) {
        expect(definition[field].fa.trim(), `${id}.${field}.fa`).not.toBe('');
        expect(definition[field].en.trim(), `${id}.${field}.en`).not.toBe('');
      }
    }
  });

  it('answers in Persian when the context asks for it', async () => {
    const html = await run('base_convert', '0xFF', fa);
    expect(html).toMatch(/[\u0600-\u06FF]/);
  });

  it('marks only the HTTP builder as a network tool', () => {
    expect(tool('http_request').network).toBe(true);
    for (const id of PHASE3_IDS.filter((x) => x !== 'http_request')) {
      expect(tool(id).network ?? false, id).toBe(false);
    }
  });

  it('declares a file spec exactly for the two file-based tools', () => {
    expect(tool('file_hash_compare').file).toBeDefined();
    expect(tool('image_metadata').file).toBeDefined();
    for (const id of PHASE3_IDS.filter((x) => !['file_hash_compare', 'image_metadata'].includes(x))) {
      expect(tool(id).file, id).toBeUndefined();
    }
  });

  it('escapes HTML so a hostile input cannot inject markup', async () => {
    const payload = '<script>alert(1)</script>';
    const outputs = await Promise.all([
      run('text_transform', payload),
      run('dedupe_lines', payload),
      run('git_helper', payload),
    ]);
    for (const html of outputs) {
      expect(html).not.toContain('<script>');
    }
  });
});
