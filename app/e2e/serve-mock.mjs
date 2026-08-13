/**
 * Local harness for the Mini App UI checks.
 *
 * Serves the real production build from `app/dist` and stubs `/api/*` with a
 * catalog large enough that the tool grid must overflow the viewport — which
 * is the whole point: the scroll bug only reproduces when content exceeds the
 * shell height. No bot token and no network calls are involved.
 */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';

const ROOT = new URL('../dist/', import.meta.url).pathname;
const PORT = Number(process.env.PORT ?? 4173);

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.woff2': 'font/woff2',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
};

const CATEGORIES = [
  { id: 'programming', icon: 'x', title: 'برنامه‌نویسی', count: 26 },
  { id: 'network', icon: 'x', title: 'شبکه', count: 12 },
  { id: 'security', icon: 'x', title: 'امنیت', count: 9 },
  { id: 'everyday', icon: 'x', title: 'روزمره', count: 12 },
  { id: 'utilities', icon: 'x', title: 'کاربردی', count: 18 },
];

const IDS = {
  programming: ['json_format', 'json_minify', 'json_validate', 'base64_encode', 'base64_decode', 'url_encode',
    'url_decode', 'html_entities', 'jwt_decode', 'regex_test', 'html_format', 'css_format', 'js_format',
    'markdown_html', 'text_stats', 'random_string', 'yaml_json', 'xml_format', 'base_convert', 'prog_calc',
    'diff_check', 'regex_helper', 'docker_helper', 'git_helper', 'gitignore_gen', 'readme_gen'],
  network: ['dns_lookup', 'reverse_dns', 'ip_info', 'http_status', 'http_headers', 'ssl_info', 'url_info',
    'domain_info', 'port_check', 'ping', 'my_ip', 'http_request'],
  security: ['hash_all', 'sha256', 'sha1', 'md5', 'uuid_gen', 'password_gen', 'secret_gen', 'hmac_gen',
    'file_hash_compare'],
  everyday: ['percent_calc', 'bmi_calc', 'tip_calc', 'installment_calc', 'compound_calc', 'profit_calc',
    'tax_calc', 'fuel_calc', 'electricity_calc', 'geometry_calc', 'construction_calc', 'currency_convert'],
  utilities: ['calculator', 'timestamp', 'unit_convert', 'qr_code', 'text_counter', 'case_convert',
    'color_convert', 'url_parse', 'url_normalize', 'cron_helper', 'datetime_convert', 'timezone_convert',
    'text_transform', 'dedupe_lines', 'csv_json', 'image_metadata', 'url_parse_pro', 'cron_builder'],
};

const tools = [];
for (const [category, ids] of Object.entries(IDS)) {
  for (const id of ids) {
    tools.push({
      id,
      category,
      icon: '🔧',
      title: id.replace(/_/g, ' '),
      description: 'توضیح نمونه برای این ابزار.',
      usage: 'ورودی نمونه',
      example: 'نمونه',
      limitations: 'محدودیت نمونه.',
      needsInput: true,
      network: category === 'network',
      file: id === 'file_hash_compare' || id === 'image_metadata',
      quick: false,
    });
  }
}

const CATALOG = {
  tools,
  categories: CATEGORIES,
  groups: [],
  favorites: ['json_format', 'sha256', 'qr_code', 'percent_calc'],
  user: { id: 7951577342, name: 'Amir', lang: 'fa', runs: 42, joined: 1700000000 },
  lang: 'fa',
};

const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const path = url.pathname;

  if (path.startsWith('/api/')) {
    res.setHeader('content-type', 'application/json; charset=utf-8');
    if (path === '/api/catalog') return res.end(JSON.stringify(CATALOG));
    if (path === '/api/stats') {
      return res.end(JSON.stringify({
        topTools: [
          { toolId: 'json_format', uses: 31 },
          { toolId: 'sha256', uses: 22 },
          { toolId: 'qr_code', uses: 14 },
          { toolId: 'ping', uses: 9 },
          { toolId: 'bmi_calc', uses: 4 },
        ],
        totalRuns: 80,
        distinct: 5,
      }));
    }
    if (path === '/api/run') {
      return res.end(JSON.stringify({ ok: true, html: '<b>نتیجه</b><br>' + 'خط نمونه<br>'.repeat(40), ms: 12 }));
    }
    if (path === '/api/favorite') return res.end(JSON.stringify({ favorites: CATALOG.favorites }));
    if (path === '/api/lang') return res.end(JSON.stringify({ ok: true }));
    res.statusCode = 404;
    return res.end('{}');
  }

  const rel = normalize(path === '/' ? '/index.html' : path).replace(/^(\.\.[/\\])+/, '');
  let file = join(ROOT, rel);
  if (!existsSync(file)) file = join(ROOT, 'index.html');
  try {
    const body = await readFile(file);
    res.setHeader('content-type', TYPES[extname(file)] ?? 'application/octet-stream');
    res.end(body);
  } catch {
    res.statusCode = 500;
    res.end('error');
  }
});

server.listen(PORT, '127.0.0.1', () => console.log(`mock harness on http://127.0.0.1:${PORT}`));
