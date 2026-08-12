/**
 * Phase 3 — DevOps helpers: Dockerfile / docker-compose generators, the Git
 * error advisor, the .gitignore generator and the README generator.
 *
 * Every generated artefact is a hardened template: non-root users, pinned
 * base image tags, multi-stage builds, no secrets baked into layers. The Git
 * advisor never proposes a destructive command without an explicit warning.
 */
import { defineTool } from '../types.js';
import { codeBlock, DIVIDER, escapeHtml, mono, truncate } from '../../utils/text.js';
import { errInvalidInput } from '../../utils/errors.js';
import { TOOL_LIMITS } from '../../config/index.js';

// ─── 17. Docker helper ────────────────────────────────────────────────────

export interface DockerTemplate {
  id: string;
  label: string;
  dockerfile: string;
  dockerignore: string;
}

/**
 * Hardened Dockerfiles.
 *
 * Shared rules: a pinned slim/alpine base, a multi-stage build so build
 * tooling never ships, a non-root runtime user, and no `latest` tag anywhere.
 */
export const DOCKER_TEMPLATES: Record<string, DockerTemplate> = {
  node: {
    id: 'node',
    label: 'Node.js',
    dockerfile: `# syntax=docker/dockerfile:1
# ---- build stage -------------------------------------------------------
FROM node:22-alpine AS build
WORKDIR /app

# Copy manifests first so the dependency layer is cached independently.
COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build --if-present && npm prune --omit=dev

# ---- runtime stage -----------------------------------------------------
FROM node:22-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app

# Run as an unprivileged user; the node image already ships one.
USER node

COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --from=build --chown=node:node /app/package.json ./package.json

EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s \\
  CMD node -e "fetch('http://127.0.0.1:3000/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "dist/index.js"]`,
    dockerignore: 'node_modules\nnpm-debug.log\ndist\n.git\n.env\n.env.*\ncoverage\n.DS_Store',
  },
  python: {
    id: 'python',
    label: 'Python',
    dockerfile: `# syntax=docker/dockerfile:1
# ---- build stage -------------------------------------------------------
FROM python:3.12-slim AS build
WORKDIR /app

ENV PIP_NO_CACHE_DIR=1 \\
    PIP_DISABLE_PIP_VERSION_CHECK=1

COPY requirements.txt .
RUN pip install --prefix=/install -r requirements.txt

# ---- runtime stage -----------------------------------------------------
FROM python:3.12-slim AS runtime
WORKDIR /app

ENV PYTHONDONTWRITEBYTECODE=1 \\
    PYTHONUNBUFFERED=1 \\
    PATH="/usr/local/bin:$PATH"

# Create a dedicated unprivileged user rather than running as root.
RUN useradd --create-home --uid 10001 appuser

COPY --from=build /install /usr/local
COPY --chown=appuser:appuser . .

USER appuser
EXPOSE 8000

CMD ["python", "-m", "app"]`,
    dockerignore: '__pycache__\n*.pyc\n.venv\nvenv\n.git\n.env\n.pytest_cache\n.mypy_cache\ndist\nbuild',
  },
  php: {
    id: 'php',
    label: 'PHP',
    dockerfile: `# syntax=docker/dockerfile:1
# ---- dependency stage --------------------------------------------------
FROM composer:2 AS vendor
WORKDIR /app
COPY composer.json composer.lock ./
RUN composer install --no-dev --no-scripts --prefer-dist --no-interaction

# ---- runtime stage -----------------------------------------------------
FROM php:8.3-fpm-alpine AS runtime
WORKDIR /var/www/html

RUN docker-php-ext-install pdo pdo_mysql opcache \\
 && addgroup -g 10001 app \\
 && adduser -D -u 10001 -G app app

COPY --from=vendor --chown=app:app /app/vendor ./vendor
COPY --chown=app:app . .

# Production OPcache settings; comment out for local development.
RUN { \\
      echo 'opcache.enable=1'; \\
      echo 'opcache.validate_timestamps=0'; \\
      echo 'opcache.max_accelerated_files=20000'; \\
    } > /usr/local/etc/php/conf.d/opcache.ini

USER app
EXPOSE 9000
CMD ["php-fpm"]`,
    dockerignore: 'vendor\n.git\n.env\nstorage/logs/*\nnode_modules\ntests',
  },
  go: {
    id: 'go',
    label: 'Go',
    dockerfile: `# syntax=docker/dockerfile:1
# ---- build stage -------------------------------------------------------
FROM golang:1.23-alpine AS build
WORKDIR /src

COPY go.mod go.sum ./
RUN go mod download

COPY . .
# CGO off + static linking so the binary runs on a scratch image.
RUN CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags="-s -w" -o /out/app ./cmd/app

# ---- runtime stage -----------------------------------------------------
FROM gcr.io/distroless/static-debian12:nonroot AS runtime
COPY --from=build /out/app /app

USER nonroot:nonroot
EXPOSE 8080
ENTRYPOINT ["/app"]`,
    dockerignore: '.git\n.env\nbin\ndist\n*.test\nvendor',
  },
  rust: {
    id: 'rust',
    label: 'Rust',
    dockerfile: `# syntax=docker/dockerfile:1
# ---- build stage -------------------------------------------------------
FROM rust:1.82-slim AS build
WORKDIR /src

# Pre-build dependencies so source edits do not invalidate the cargo layer.
COPY Cargo.toml Cargo.lock ./
RUN mkdir src && echo "fn main() {}" > src/main.rs && cargo build --release && rm -rf src

COPY . .
RUN touch src/main.rs && cargo build --release

# ---- runtime stage -----------------------------------------------------
FROM debian:bookworm-slim AS runtime
RUN apt-get update \\
 && apt-get install -y --no-install-recommends ca-certificates \\
 && rm -rf /var/lib/apt/lists/* \\
 && useradd --create-home --uid 10001 appuser

COPY --from=build /src/target/release/app /usr/local/bin/app

USER appuser
EXPOSE 8080
CMD ["app"]`,
    dockerignore: 'target\n.git\n.env\n*.rs.bk',
  },
  java: {
    id: 'java',
    label: 'Java',
    dockerfile: `# syntax=docker/dockerfile:1
# ---- build stage -------------------------------------------------------
FROM maven:3.9-eclipse-temurin-21 AS build
WORKDIR /src

COPY pom.xml .
RUN mvn -B dependency:go-offline

COPY src ./src
RUN mvn -B clean package -DskipTests

# ---- runtime stage -----------------------------------------------------
FROM eclipse-temurin:21-jre-alpine AS runtime
WORKDIR /app

RUN addgroup -g 10001 app && adduser -D -u 10001 -G app app

COPY --from=build --chown=app:app /src/target/*.jar app.jar

USER app
EXPOSE 8080
# Let the JVM see the container's cgroup memory limit.
ENTRYPOINT ["java", "-XX:MaxRAMPercentage=75", "-jar", "app.jar"]`,
    dockerignore: 'target\n.git\n.env\n.idea\n*.iml',
  },
};

export interface ComposeService {
  id: string;
  label: string;
  yaml: string;
  /** Environment variables the user must supply themselves. */
  secrets: string[];
}

/**
 * Compose fragments.
 *
 * No password is ever hard-coded: every credential is referenced through
 * `${VAR:?...}`, which makes Compose refuse to start until the user provides
 * the value. Database ports are bound to 127.0.0.1 so a dev database is not
 * silently exposed to the internet.
 */
export const COMPOSE_SERVICES: Record<string, ComposeService> = {
  app: {
    id: 'app',
    label: 'Application',
    secrets: [],
    yaml: `  app:
    build:
      context: .
      dockerfile: Dockerfile
    restart: unless-stopped
    env_file:
      - .env
    ports:
      - "127.0.0.1:3000:3000"
    depends_on:
      db:
        condition: service_healthy
    healthcheck:
      test: ["CMD", "wget", "-qO-", "http://127.0.0.1:3000/health"]
      interval: 30s
      timeout: 3s
      retries: 3
    security_opt:
      - no-new-privileges:true`,
  },
  postgres: {
    id: 'postgres',
    label: 'PostgreSQL',
    secrets: ['POSTGRES_PASSWORD', 'POSTGRES_USER', 'POSTGRES_DB'],
    yaml: `  db:
    image: postgres:16-alpine
    restart: unless-stopped
    environment:
      POSTGRES_USER: \${POSTGRES_USER:?set POSTGRES_USER in .env}
      POSTGRES_PASSWORD: \${POSTGRES_PASSWORD:?set POSTGRES_PASSWORD in .env}
      POSTGRES_DB: \${POSTGRES_DB:?set POSTGRES_DB in .env}
    volumes:
      - pgdata:/var/lib/postgresql/data
    # Bound to loopback: never expose a database straight to the internet.
    ports:
      - "127.0.0.1:5432:5432"
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U $\${POSTGRES_USER}"]
      interval: 10s
      timeout: 5s
      retries: 5
    security_opt:
      - no-new-privileges:true`,
  },
  mysql: {
    id: 'mysql',
    label: 'MySQL',
    secrets: ['MYSQL_ROOT_PASSWORD', 'MYSQL_DATABASE', 'MYSQL_USER', 'MYSQL_PASSWORD'],
    yaml: `  db:
    image: mysql:8.4
    restart: unless-stopped
    command: --default-authentication-plugin=caching_sha2_password
    environment:
      MYSQL_ROOT_PASSWORD: \${MYSQL_ROOT_PASSWORD:?set MYSQL_ROOT_PASSWORD in .env}
      MYSQL_DATABASE: \${MYSQL_DATABASE:?set MYSQL_DATABASE in .env}
      MYSQL_USER: \${MYSQL_USER:?set MYSQL_USER in .env}
      MYSQL_PASSWORD: \${MYSQL_PASSWORD:?set MYSQL_PASSWORD in .env}
    volumes:
      - mysqldata:/var/lib/mysql
    ports:
      - "127.0.0.1:3306:3306"
    healthcheck:
      test: ["CMD", "mysqladmin", "ping", "-h", "127.0.0.1"]
      interval: 10s
      timeout: 5s
      retries: 5
    security_opt:
      - no-new-privileges:true`,
  },
  redis: {
    id: 'redis',
    label: 'Redis',
    secrets: ['REDIS_PASSWORD'],
    yaml: `  cache:
    image: redis:7-alpine
    restart: unless-stopped
    command: ["redis-server", "--requirepass", "\${REDIS_PASSWORD:?set REDIS_PASSWORD in .env}", "--appendonly", "yes"]
    volumes:
      - redisdata:/data
    ports:
      - "127.0.0.1:6379:6379"
    healthcheck:
      test: ["CMD", "redis-cli", "--no-auth-warning", "-a", "$\${REDIS_PASSWORD}", "ping"]
      interval: 10s
      timeout: 3s
      retries: 5
    security_opt:
      - no-new-privileges:true`,
  },
  nginx: {
    id: 'nginx',
    label: 'Nginx',
    secrets: [],
    yaml: `  proxy:
    image: nginx:1.27-alpine
    restart: unless-stopped
    ports:
      - "80:80"
      - "443:443"
    volumes:
      # Read-only mounts: the container must not rewrite its own config.
      - ./nginx.conf:/etc/nginx/nginx.conf:ro
      - ./certs:/etc/nginx/certs:ro
    depends_on:
      - app
    healthcheck:
      test: ["CMD", "nginx", "-t"]
      interval: 30s
      timeout: 5s
      retries: 3
    security_opt:
      - no-new-privileges:true`,
  },
};

const VOLUME_FOR: Record<string, string> = {
  postgres: 'pgdata',
  mysql: 'mysqldata',
  redis: 'redisdata',
};

export function buildCompose(services: string[]): { yaml: string; secrets: string[] } {
  const chosen = services.filter((id) => COMPOSE_SERVICES[id]);
  if (chosen.length === 0) {
    throw errInvalidInput(
      'حداقل یک سرویس انتخاب کنید: app، postgres، mysql، redis، nginx',
      'Pick at least one service: app, postgres, mysql, redis, nginx',
    );
  }
  const blocks = chosen.map((id) => (COMPOSE_SERVICES[id] as ComposeService).yaml);
  const volumes = chosen.map((id) => VOLUME_FOR[id]).filter(Boolean) as string[];
  const secrets = chosen.flatMap((id) => (COMPOSE_SERVICES[id] as ComposeService).secrets);

  const yaml =
    `# Generated by DevNet Toolbox — review before deploying.\n` +
    `# Every credential is read from .env; nothing is hard-coded here.\n` +
    `services:\n${blocks.join('\n\n')}\n` +
    (volumes.length ? `\nvolumes:\n${volumes.map((v) => `  ${v}:`).join('\n')}\n` : '');

  return { yaml, secrets };
}

export const dockerTool = defineTool({
  id: 'docker_helper',
  category: 'programming',
  icon: '🐳',
  needsInput: true,
  title: { fa: 'دستیار Docker', en: 'Docker Helper' },
  description: {
    fa: 'برای Node.js، Python، PHP، Go، Rust و Java یک Dockerfile چندمرحله‌ای و امن می‌سازد (کاربر غیر-root، تگ ثابت، بدون ابزار build در ایمیج نهایی) و می‌تواند docker-compose برای App، PostgreSQL، MySQL، Redis و Nginx تولید کند.',
    en: 'Generates a hardened multi-stage Dockerfile for Node.js, Python, PHP, Go, Rust and Java (non-root user, pinned tags, no build tooling in the final image) and can produce a docker-compose file for App, PostgreSQL, MySQL, Redis and Nginx.',
  },
  usage: {
    fa:
      '• Dockerfile: <code>node</code> • <code>python</code> • <code>php</code> • <code>go</code> • <code>rust</code> • <code>java</code>\n' +
      '• Compose: <code>compose: app postgres redis</code>\n' +
      '• فایل .dockerignore هم همراه Dockerfile ارائه می‌شود.',
    en:
      '• Dockerfile: <code>node</code> • <code>python</code> • <code>php</code> • <code>go</code> • <code>rust</code> • <code>java</code>\n' +
      '• Compose: <code>compose: app postgres redis</code>\n' +
      '• A matching .dockerignore is included with every Dockerfile.',
  },
  example: {
    fa: 'ورودی: compose: app postgres\nخروجی: فایل docker-compose با سرویس app و PostgreSQL',
    en: 'Input: compose: app postgres\nOutput: a docker-compose file with the app and PostgreSQL services',
  },
  limitations: {
    fa: 'قالب‌ها نقطه‌ی شروع امن هستند، نه پیکربندی نهایی: نسخه‌ی زبان، مسیر build و پورت‌ها را با پروژه‌ی خود تطبیق دهید. هیچ رمزی در فایل‌ها نوشته نمی‌شود؛ همه از فایل .env خوانده می‌شوند.',
    en: 'The templates are a safe starting point, not a finished configuration: adapt the language version, build path and ports to your project. No credential is written into the files; all are read from .env.',
  },
  run: (input, ctx) => {
    const fa = ctx.lang === 'fa';
    const text = input.trim().toLowerCase();

    const composeMatch = /^(?:compose|docker-compose)\s*[:=]?\s*(.*)$/.exec(text);
    if (composeMatch) {
      const requested = (composeMatch[1] ?? '').split(/[\s,]+/).filter(Boolean);
      const services = requested.length ? requested : ['app', 'postgres'];
      const unknown = services.filter((id) => !COMPOSE_SERVICES[id]);
      if (unknown.length) {
        throw errInvalidInput(
          `سرویس ناشناخته: ${unknown.join('، ')}. سرویس‌های موجود: app، postgres، mysql، redis، nginx`,
          `Unknown service: ${unknown.join(', ')}. Available: app, postgres, mysql, redis, nginx`,
        );
      }
      const { yaml, secrets } = buildCompose(services);
      const envHint = secrets.length
        ? `\n${DIVIDER}\n${fa ? '🔑 <b>متغیرهایی که باید در فایل <code>.env</code> بگذارید</b>' : '🔑 <b>Variables you must set in <code>.env</code></b>'}\n` +
          secrets.map((s) => `• ${mono(s)}`).join('\n') +
          `\n<i>${fa ? 'هیچ رمزی در فایل تولیدشده نوشته نشده است؛ Compose تا زمانی که این‌ها را ندهید بالا نمی‌آید.' : 'No credential is written into the generated file; Compose refuses to start until you provide these.'}</i>`
        : '';

      return {
        html:
          `${fa ? '🐳 <b>docker-compose.yml</b>' : '🐳 <b>docker-compose.yml</b>'} — ${services.map((s) => escapeHtml((COMPOSE_SERVICES[s] as ComposeService).label)).join(' + ')}\n` +
          codeBlock(truncate(yaml, 1400), 'yaml') +
          (yaml.length > 1400 ? (fa ? '\n📎 فایل کامل پیوست شد.' : '\n📎 The full file is attached.') : '') +
          envHint,
        attachment: {
          name: 'docker-compose.yml',
          content: yaml,
          caption: { fa: '🐳 docker-compose.yml', en: '🐳 docker-compose.yml' },
        },
      };
    }

    const alias: Record<string, string> = {
      node: 'node', nodejs: 'node', js: 'node', typescript: 'node', ts: 'node',
      python: 'python', py: 'python', django: 'python', flask: 'python', fastapi: 'python',
      php: 'php', laravel: 'php',
      go: 'go', golang: 'go',
      rust: 'rust',
      java: 'java', spring: 'java', kotlin: 'java',
    };
    const key = alias[text.replace(/[^a-z]/g, '')];
    const template = key ? DOCKER_TEMPLATES[key] : undefined;
    if (!template) {
      throw errInvalidInput(
        'زبان پشتیبانی‌شده را انتخاب کنید: node، python، php، go، rust، java\nیا برای Compose بنویسید: <code>compose: app postgres</code>',
        'Pick a supported language: node, python, php, go, rust, java\nOr for Compose: <code>compose: app postgres</code>',
      );
    }

    const full = `${template.dockerfile}\n\n# ─── .dockerignore ───\n# Save the block below as .dockerignore\n${template.dockerignore
      .split('\n')
      .map((line) => `# ${line}`)
      .join('\n')}\n`;

    return {
      html:
        `${fa ? '🐳 <b>Dockerfile</b> برای' : '🐳 <b>Dockerfile</b> for'} ${escapeHtml(template.label)}\n` +
        codeBlock(truncate(template.dockerfile, 1500), 'dockerfile') +
        (template.dockerfile.length > 1500 ? (fa ? '\n📎 فایل کامل پیوست شد.' : '\n📎 The full file is attached.') : '') +
        `\n${DIVIDER}\n${fa ? '🚫 <b>.dockerignore پیشنهادی</b>' : '🚫 <b>Suggested .dockerignore</b>'}\n${codeBlock(template.dockerignore)}` +
        `\n<i>${
          fa
            ? '🔐 قالب امن: کاربر غیر-root، تگ ثابت به‌جای latest، ساخت چندمرحله‌ای و بدون هیچ Secret در لایه‌ها.'
            : '🔐 Hardened template: non-root user, pinned tag instead of latest, multi-stage build and no secret baked into any layer.'
        }</i>`,
      attachment: {
        name: 'Dockerfile',
        content: full,
        caption: { fa: '🐳 Dockerfile کامل', en: '🐳 Full Dockerfile' },
      },
    };
  },
});

// ─── 18. Git helper ───────────────────────────────────────────────────────

export interface GitAdvice {
  id: string;
  match: RegExp;
  title: { fa: string; en: string };
  cause: { fa: string; en: string };
  fix: { fa: string; en: string };
  commands: string[];
  /** Set when the suggested command can lose work. */
  warning?: { fa: string; en: string };
}

/**
 * Diagnoses common Git failures.
 *
 * Anything that can lose work — `reset --hard`, `push --force`, `clean -fd` —
 * carries a mandatory warning, and the safer alternative is always offered
 * first (`--force-with-lease`, `git stash`, `git revert`).
 */
export const GIT_ADVICE: GitAdvice[] = [
  {
    id: 'rejected-non-fast-forward',
    match: /non-fast-forward|rejected.*fetch first|updates were rejected/i,
    title: { fa: 'Push رد شد: شاخه‌ی راه دور جلوتر است', en: 'Push rejected: the remote branch is ahead' },
    cause: {
      fa: 'کسی (یا خود شما از دستگاهی دیگر) بعد از آخرین fetch شما commit تازه‌ای روی همان شاخه فرستاده است.',
      en: 'Someone — possibly you from another machine — pushed new commits to the same branch after your last fetch.',
    },
    fix: {
      fa: 'ابتدا تغییرات راه دور را بگیرید و روی آن rebase کنید، سپس دوباره push کنید.',
      en: 'Fetch the remote work, rebase your commits on top of it, then push again.',
    },
    commands: ['git fetch origin', 'git rebase origin/<branch>', 'git push origin <branch>'],
    warning: {
      fa: 'اگر به‌جای این کار از <code>git push --force</code> استفاده کنید، کار دیگران پاک می‌شود. در صورت اجبار، از <code>--force-with-lease</code> استفاده کنید که اگر شاخه از زمان fetch شما تغییر کرده باشد، متوقف می‌شود.',
      en: 'Using <code>git push --force</code> instead would erase other people\'s commits. If you must force, use <code>--force-with-lease</code>, which aborts when the branch moved since your fetch.',
    },
  },
  {
    id: 'merge-conflict',
    match: /conflict|automatic merge failed|fix conflicts/i,
    title: { fa: 'تعارض ادغام (Merge conflict)', en: 'Merge conflict' },
    cause: {
      fa: 'دو شاخه همان خط‌ها را تغییر داده‌اند و Git نمی‌تواند خودکار تصمیم بگیرد کدام نسخه درست است.',
      en: 'Two branches changed the same lines and Git cannot decide which version is correct.',
    },
    fix: {
      fa: 'فایل‌های متعارض را باز کنید، نشانه‌های <<<<<<< و >>>>>>> را با نسخه‌ی نهایی جایگزین کنید، سپس فایل را add و ادامه دهید.',
      en: 'Open the conflicting files, replace the <<<<<<< / >>>>>>> markers with the final content, then add the file and continue.',
    },
    commands: ['git status', 'git diff --name-only --diff-filter=U', 'git add <file>', 'git rebase --continue   # or: git merge --continue'],
    warning: {
      fa: '<code>git checkout --theirs</code> یا <code>--ours</code> کل تغییرات یک طرف را دور می‌ریزد؛ فقط وقتی به کار ببرید که مطمئن باشید آن نسخه اضافی است.',
      en: '<code>git checkout --theirs</code> or <code>--ours</code> discards one side entirely; use it only when you are sure that side is redundant.',
    },
  },
  {
    id: 'detached-head',
    match: /detached head/i,
    title: { fa: 'HEAD جداشده (detached HEAD)', en: 'Detached HEAD' },
    cause: {
      fa: 'روی یک commit مشخص هستید، نه روی یک شاخه؛ هر commit تازه‌ای به هیچ شاخه‌ای وصل نمی‌شود.',
      en: 'You are on a specific commit rather than a branch, so new commits belong to no branch.',
    },
    fix: {
      fa: 'اگر کار تازه‌ای انجام داده‌اید، برای آن شاخه بسازید؛ در غیر این صورت به شاخه‌ی قبلی برگردید.',
      en: 'If you made new work, create a branch for it; otherwise switch back to your branch.',
    },
    commands: ['git switch -c rescue-branch   # keep the work', 'git switch -   # or just go back'],
    warning: {
      fa: 'اگر بدون ساختن شاخه جابه‌جا شوید، commitهای این حالت با garbage collection پاک می‌شوند. قبل از هر جابه‌جایی هش commit را با <code>git log -1</code> یادداشت کنید.',
      en: 'Switching away without creating a branch leaves those commits to be garbage-collected. Note the commit hash with <code>git log -1</code> first.',
    },
  },
  {
    id: 'permission-denied',
    match: /permission denied \(publickey\)|could not read from remote repository|authentication failed/i,
    title: { fa: 'خطای احراز هویت هنگام اتصال به مخزن', en: 'Authentication failure when reaching the repository' },
    cause: {
      fa: 'کلید SSH بارگذاری نشده، به حساب شما اضافه نشده، یا توکن HTTPS منقضی/بدون دسترسی لازم است.',
      en: 'The SSH key is not loaded or not registered on your account, or the HTTPS token expired or lacks the required scope.',
    },
    fix: {
      fa: 'اتصال SSH را آزمایش کنید و در صورت استفاده از HTTPS، توکن را با دسترسی repo تازه کنید.',
      en: 'Test the SSH connection, and if you use HTTPS refresh the token with the repo scope.',
    },
    commands: ['ssh -T git@github.com', 'ssh-add -l', 'git remote -v'],
    warning: {
      fa: '⚠️ هرگز توکن یا کلید خصوصی را در commit، پیام یا issue قرار ندهید. اگر چنین شد، توکن را فوراً باطل (revoke) کنید.',
      en: '⚠️ Never put a token or private key in a commit, message or issue. If that happens, revoke the token immediately.',
    },
  },
  {
    id: 'wrong-commit-message',
    match: /wrong (commit )?message|amend|پیام کامیت|اصلاح پیام/i,
    title: { fa: 'اصلاح پیام آخرین commit', en: 'Fixing the last commit message' },
    cause: {
      fa: 'پیام commit اشتباه یا ناقص نوشته شده است.',
      en: 'The commit message is wrong or incomplete.',
    },
    fix: {
      fa: 'اگر هنوز push نکرده‌اید، پیام را amend کنید. اگر push شده، تیم را در جریان بگذارید.',
      en: 'If you have not pushed yet, amend the message. If it is already pushed, tell your team first.',
    },
    commands: ['git commit --amend -m "correct message"'],
    warning: {
      fa: 'amend کردن یک commit پوش‌شده تاریخچه را بازنویسی می‌کند و push بعدی نیاز به <code>--force-with-lease</code> دارد؛ روی شاخه‌های مشترک این کار را نکنید.',
      en: 'Amending a pushed commit rewrites history and the next push needs <code>--force-with-lease</code>; do not do this on shared branches.',
    },
  },
  {
    id: 'undo-commit',
    match: /undo (last )?commit|revert|بازگرداندن|لغو کامیت/i,
    title: { fa: 'برگرداندن یک commit', en: 'Undoing a commit' },
    cause: {
      fa: 'می‌خواهید تغییرات یک commit را خنثی کنید.',
      en: 'You want to undo the effect of a commit.',
    },
    fix: {
      fa: 'روش امن: <code>git revert</code> که یک commit معکوس می‌سازد و تاریخچه را دست‌نخورده می‌گذارد. برای commit پوش‌نشده، <code>reset --soft</code> تغییرات را در staging نگه می‌دارد.',
      en: 'The safe route is <code>git revert</code>, which adds an inverse commit and leaves history intact. For an unpushed commit, <code>reset --soft</code> keeps your changes staged.',
    },
    commands: ['git revert <commit>   # safe, keeps history', 'git reset --soft HEAD~1   # unpushed only, keeps changes staged'],
    warning: {
      fa: '⚠️ <code>git reset --hard</code> تغییرات ذخیره‌نشده را برای همیشه پاک می‌کند. قبل از آن حتماً <code>git stash</code> بزنید.',
      en: '⚠️ <code>git reset --hard</code> destroys uncommitted changes permanently. Run <code>git stash</code> first.',
    },
  },
  {
    id: 'accidental-secret',
    match: /secret|token|password|api.?key|\.env/i,
    title: { fa: 'یک Secret به‌اشتباه commit شده است', en: 'A secret was committed by mistake' },
    cause: {
      fa: 'فایل یا مقدار حساس وارد تاریخچه‌ی Git شده و با حذف ساده در commit بعدی، همچنان در تاریخچه باقی می‌ماند.',
      en: 'A sensitive file or value entered the Git history; simply deleting it in a later commit leaves it in history.',
    },
    fix: {
      fa: '۱) توکن را فوراً باطل و جایگزین کنید — این مهم‌ترین قدم است. ۲) فایل را به .gitignore بیفزایید. ۳) در صورت نیاز تاریخچه را با ابزار اختصاصی پاک‌سازی کنید.',
      en: '1) Revoke and rotate the token immediately — that is the step that matters. 2) Add the file to .gitignore. 3) If needed, scrub history with a dedicated tool.',
    },
    commands: ['git rm --cached .env', 'echo ".env" >> .gitignore', 'git commit -m "chore: stop tracking .env"'],
    warning: {
      fa: '⚠️ بازنویسی تاریخچه (filter-repo یا BFG) هش همه‌ی commitهای بعدی را عوض می‌کند و کلون‌های موجود را می‌شکند؛ با تیم هماهنگ کنید. حتی پس از پاک‌سازی، فرض کنید Secret لو رفته است و آن را عوض کنید.',
      en: '⚠️ Rewriting history (filter-repo or BFG) changes every later commit hash and breaks existing clones; coordinate with your team. Even after scrubbing, assume the secret is compromised and rotate it.',
    },
  },
  {
    id: 'large-file',
    match: /file is (\d|too large)|exceeds github's file size limit|gh001|large file/i,
    title: { fa: 'فایل بیش از حد بزرگ برای push', en: 'File too large to push' },
    cause: {
      fa: 'GitHub فایل‌های بزرگ‌تر از ۱۰۰ مگابایت را رد می‌کند و فایل همچنان در تاریخچه است، حتی اگر حالا حذفش کنید.',
      en: 'GitHub rejects files over 100 MB, and the file stays in history even if you delete it now.',
    },
    fix: {
      fa: 'فایل را از تاریخچه بردارید و در صورت نیاز از Git LFS استفاده کنید.',
      en: 'Remove the file from history and use Git LFS if you genuinely need it versioned.',
    },
    commands: ['git rm --cached path/to/large-file', 'echo "path/to/large-file" >> .gitignore', 'git lfs track "*.psd"   # if the file is really needed'],
    warning: {
      fa: 'اگر فایل چند commit قبل اضافه شده، حذف ساده کافی نیست و باید تاریخچه بازنویسی شود که هش‌ها را تغییر می‌دهد.',
      en: 'If the file was added several commits ago, deleting it is not enough — history must be rewritten, which changes commit hashes.',
    },
  },
  {
    id: 'detect-branch-diverged',
    match: /diverged|have diverged/i,
    title: { fa: 'شاخه‌ی محلی و راه دور از هم جدا شده‌اند', en: 'Local and remote branches have diverged' },
    cause: {
      fa: 'هر دو طرف commitهایی دارند که طرف دیگر ندارد.',
      en: 'Both sides have commits the other does not have.',
    },
    fix: {
      fa: 'تصمیم بگیرید تاریخچه‌ی خطی می‌خواهید (rebase) یا commit ادغام (merge).',
      en: 'Decide whether you want a linear history (rebase) or a merge commit.',
    },
    commands: ['git fetch origin', 'git rebase origin/<branch>   # linear', 'git merge origin/<branch>    # merge commit'],
    warning: {
      fa: 'rebase روی شاخه‌ای که دیگران هم از آن استفاده می‌کنند تاریخچه‌ی مشترک را بازنویسی می‌کند؛ برای شاخه‌های مشترک merge امن‌تر است.',
      en: 'Rebasing a branch others also use rewrites shared history; merge is safer for shared branches.',
    },
  },
  {
    id: 'untracked-overwrite',
    match: /untracked working tree files would be overwritten|local changes.*would be overwritten/i,
    title: { fa: 'تغییرات محلی مانع checkout یا pull می‌شوند', en: 'Local changes block the checkout or pull' },
    cause: {
      fa: 'Git نمی‌خواهد کاری را که ذخیره نکرده‌اید بازنویسی کند.',
      en: 'Git refuses to overwrite work you have not saved.',
    },
    fix: {
      fa: 'تغییرات را stash یا commit کنید، سپس عملیات را تکرار کنید و در صورت نیاز stash را برگردانید.',
      en: 'Stash or commit your changes, redo the operation, then restore the stash if needed.',
    },
    commands: ['git stash push -u -m "wip"', 'git pull --rebase', 'git stash pop'],
    warning: {
      fa: '⚠️ <code>git checkout -f</code> و <code>git clean -fd</code> فایل‌های ذخیره‌نشده را بدون امکان بازیابی پاک می‌کنند. اول <code>git clean -nd</code> را اجرا کنید تا فقط فهرست را ببینید.',
      en: '⚠️ <code>git checkout -f</code> and <code>git clean -fd</code> delete unsaved files irrecoverably. Run <code>git clean -nd</code> first to preview the list.',
    },
  },
];

export const gitTool = defineTool({
  id: 'git_helper',
  category: 'programming',
  icon: '🌿',
  needsInput: true,
  title: { fa: 'دستیار خطاهای Git', en: 'Git Error Helper' },
  description: {
    fa: 'پیام خطای Git را می‌گیرد، علت آن را توضیح می‌دهد، راه‌حل گام‌به‌گام و دستور پیشنهادی می‌دهد و هرجا دستوری بتواند کار شما را از بین ببرد، هشدار صریح نشان می‌دهد.',
    en: 'Takes a Git error message, explains the cause, gives a step-by-step fix with the suggested command, and shows an explicit warning wherever a command could destroy your work.',
  },
  usage: {
    fa: 'متن خطای Git را همان‌طور که در ترمینال دیده‌اید بفرستید؛ یا موضوع را بنویسید (مثلاً <code>merge conflict</code>، <code>undo commit</code>، <code>secret in commit</code>).',
    en: 'Paste the Git error exactly as your terminal printed it, or describe the topic (e.g. <code>merge conflict</code>, <code>undo commit</code>, <code>secret in commit</code>).',
  },
  example: {
    fa: 'ورودی: ! [rejected] main -> main (non-fast-forward)\nخروجی: علت + git fetch/rebase + هشدار درباره‌ی force push',
    en: 'Input: ! [rejected] main -> main (non-fast-forward)\nOutput: cause + git fetch/rebase + a warning about force pushing',
  },
  limitations: {
    fa: 'پایگاه دانش شامل ۱۰ خطای پرتکرار است و جایگزین بررسی وضعیت واقعی مخزن شما نیست. هیچ دستوری به‌صورت خودکار اجرا نمی‌شود — فقط پیشنهاد می‌شود.',
    en: 'The knowledge base covers 10 frequent errors and does not replace inspecting your actual repository. No command is ever executed — only suggested.',
  },
  run: (input, ctx) => {
    const fa = ctx.lang === 'fa';
    const text = input.trim();
    if (!text) {
      throw errInvalidInput(
        'متن خطای Git را ارسال کنید.',
        'Send the Git error message.',
      );
    }

    const advice = GIT_ADVICE.find((entry) => entry.match.test(text));
    if (!advice) {
      const topics = GIT_ADVICE.map((entry) => `• ${escapeHtml(fa ? entry.title.fa : entry.title.en)}`).join('\n');
      return {
        html:
          `${fa ? '🤔 <b>این خطا در پایگاه دانش پیدا نشد.</b>' : '🤔 <b>That error is not in the knowledge base.</b>'}\n` +
          `<i>${fa ? 'برای تشخیص وضعیت، این دستورها بی‌خطر و فقط خواندنی هستند:' : 'These read-only commands are safe and help you diagnose:'}</i>\n` +
          codeBlock('git status\ngit log --oneline -10\ngit remote -v\ngit branch -vv') +
          `${DIVIDER}\n${fa ? '📚 <b>موضوعات پوشش‌داده‌شده</b>' : '📚 <b>Covered topics</b>'}\n${topics}`,
      };
    }

    const commands = advice.commands.join('\n');
    return {
      html:
        `${fa ? '🌿 <b>تشخیص</b>' : '🌿 <b>Diagnosis</b>'}: ${escapeHtml(fa ? advice.title.fa : advice.title.en)}\n` +
        `${DIVIDER}\n${fa ? '🔍 <b>چرا رخ داد</b>' : '🔍 <b>Why it happened</b>'}\n${escapeHtml(fa ? advice.cause.fa : advice.cause.en)}\n\n` +
        `${fa ? '🛠 <b>راه‌حل</b>' : '🛠 <b>How to fix it</b>'}\n${escapeHtml(fa ? advice.fix.fa : advice.fix.en)}\n` +
        `${fa ? '⌨️ <b>دستورها</b>' : '⌨️ <b>Commands</b>'}\n${codeBlock(commands, 'bash')}` +
        (advice.warning
          ? `${fa ? '⚠️ <b>هشدار</b>' : '⚠️ <b>Warning</b>'}\n${fa ? advice.warning.fa : advice.warning.en}`
          : ''),
      toast: fa ? 'تشخیص داده شد' : 'Diagnosed',
    };
  },
});

// ─── 19. .gitignore generator ─────────────────────────────────────────────

export const GITIGNORE_TEMPLATES: Record<string, { label: string; entries: string[] }> = {
  node: {
    label: 'Node.js',
    entries: ['node_modules/', 'npm-debug.log*', 'yarn-error.log*', 'pnpm-debug.log*', '.npm/', 'dist/', 'build/', 'coverage/', '.eslintcache', '*.tsbuildinfo'],
  },
  python: {
    label: 'Python',
    entries: ['__pycache__/', '*.py[cod]', '*.egg-info/', '.eggs/', 'build/', 'dist/', '.venv/', 'venv/', 'env/', '.pytest_cache/', '.mypy_cache/', '.ruff_cache/', '.coverage', 'htmlcov/'],
  },
  flutter: {
    label: 'Flutter',
    entries: ['.dart_tool/', '.flutter-plugins', '.flutter-plugins-dependencies', '.packages', 'build/', '.pub-cache/', '.pub/', 'ios/Pods/', 'ios/.symlinks/', 'android/.gradle/', '*.iml'],
  },
  dart: {
    label: 'Dart',
    entries: ['.dart_tool/', '.packages', 'build/', 'pubspec.lock', 'doc/api/'],
  },
  android: {
    label: 'Android',
    entries: ['*.apk', '*.aab', '*.ap_', '*.dex', 'bin/', 'gen/', 'out/', 'build/', '.gradle/', 'local.properties', 'captures/', '.externalNativeBuild/', '.cxx/', '*.keystore', '*.jks'],
  },
  java: {
    label: 'Java',
    entries: ['*.class', '*.jar', '*.war', '*.ear', 'target/', 'build/', '.gradle/', 'hs_err_pid*', '.mvn/timing.properties'],
  },
  c: {
    label: 'C / C++',
    entries: ['*.o', '*.obj', '*.so', '*.dylib', '*.dll', '*.a', '*.lib', '*.exe', '*.out', 'build/', 'cmake-build-*/', 'CMakeFiles/', 'CMakeCache.txt', 'compile_commands.json'],
  },
  go: {
    label: 'Go',
    entries: ['bin/', 'dist/', '*.exe', '*.test', '*.out', 'vendor/', 'go.work', 'go.work.sum'],
  },
  rust: {
    label: 'Rust',
    entries: ['target/', '**/*.rs.bk', 'Cargo.lock  # keep this for binaries, ignore for libraries'],
  },
  react: {
    label: 'React',
    entries: ['node_modules/', 'build/', 'dist/', '.cache/', 'coverage/', '.eslintcache', '*.local'],
  },
  next: {
    label: 'Next.js',
    entries: ['node_modules/', '.next/', 'out/', 'build/', '.vercel', '.turbo', 'next-env.d.ts', '*.tsbuildinfo'],
  },
  laravel: {
    label: 'Laravel',
    entries: ['vendor/', 'node_modules/', 'public/hot', 'public/storage', 'storage/*.key', 'storage/framework/cache/*', 'storage/logs/*', 'bootstrap/cache/*', '.phpunit.result.cache', 'Homestead.yaml'],
  },
  wordpress: {
    label: 'WordPress',
    entries: ['wp-config.php', 'wp-content/uploads/', 'wp-content/cache/', 'wp-content/upgrade/', 'wp-content/backup-db/', 'wp-content/advanced-cache.php', 'wp-content/wp-cache-config.php', '*.log'],
  },
  unity: {
    label: 'Unity',
    entries: ['Library/', 'Temp/', 'Obj/', 'Build/', 'Builds/', 'Logs/', 'UserSettings/', '*.csproj', '*.unityproj', '*.sln'],
  },
};

/** Entries that belong in every repository regardless of stack. */
const UNIVERSAL_ENTRIES = [
  '# ─── Secrets — never commit these ───',
  '.env',
  '.env.*',
  '!.env.example',
  '*.pem',
  '*.key',
  'id_rsa',
  'credentials.json',
  'secrets.yml',
  '',
  '# ─── Editors & OS ───',
  '.vscode/',
  '.idea/',
  '*.swp',
  '.DS_Store',
  'Thumbs.db',
  'desktop.ini',
  '',
  '# ─── Logs & temporary files ───',
  '*.log',
  'tmp/',
  'temp/',
  '*.bak',
];

export function buildGitignore(stacks: string[]): string {
  const known = stacks.filter((id) => GITIGNORE_TEMPLATES[id]);
  if (known.length === 0) {
    throw errInvalidInput(
      `پشته‌ی موردنظر شناخته نشد. گزینه‌ها: ${Object.keys(GITIGNORE_TEMPLATES).join('، ')}`,
      `Unknown stack. Options: ${Object.keys(GITIGNORE_TEMPLATES).join(', ')}`,
    );
  }
  const sections = known.map((id) => {
    const template = GITIGNORE_TEMPLATES[id] as { label: string; entries: string[] };
    return `# ─── ${template.label} ───\n${template.entries.join('\n')}`;
  });
  return `# .gitignore — generated by DevNet Toolbox\n# Stacks: ${known
    .map((id) => (GITIGNORE_TEMPLATES[id] as { label: string }).label)
    .join(', ')}\n\n${sections.join('\n\n')}\n\n${UNIVERSAL_ENTRIES.join('\n')}\n`;
}

export const gitignoreTool = defineTool({
  id: 'gitignore_gen',
  category: 'programming',
  icon: '🚫',
  needsInput: true,
  title: { fa: 'سازنده‌ی .gitignore', en: '.gitignore Generator' },
  description: {
    fa: 'برای Node.js، Python، Flutter، Dart، Android، Java، C/C++، Go، Rust، React، Next.js، Laravel، WordPress و Unity فایل .gitignore می‌سازد و همیشه بخش «Secrets» را اضافه می‌کند تا .env و کلیدها به مخزن نروند.',
    en: 'Builds a .gitignore for Node.js, Python, Flutter, Dart, Android, Java, C/C++, Go, Rust, React, Next.js, Laravel, WordPress and Unity, always adding a "secrets" section so .env files and keys never reach the repository.',
  },
  usage: {
    fa: 'یک یا چند پشته را نام ببرید: <code>node react next</code> یا <code>python</code>. خروجی هم پیش‌نمایش می‌شود و هم به‌صورت فایل قابل دانلود ارسال می‌شود.',
    en: 'Name one or more stacks: <code>node react next</code> or <code>python</code>. The output is previewed and also sent as a downloadable file.',
  },
  example: {
    fa: 'ورودی: node next\nخروجی: فایل .gitignore شامل بخش‌های Node.js، Next.js و Secrets',
    en: 'Input: node next\nOutput: a .gitignore containing the Node.js, Next.js and secrets sections',
  },
  limitations: {
    fa: 'قالب‌ها عمومی هستند؛ مسیرهای خاص پروژه‌ی خودتان را دستی بیفزایید. اگر فایلی از قبل ردیابی شده باشد، .gitignore آن را نادیده نمی‌گیرد و باید <code>git rm --cached</code> بزنید.',
    en: 'The templates are generic; add your project-specific paths yourself. A file that is already tracked is not ignored by .gitignore — you must run <code>git rm --cached</code> first.',
  },
  run: (input, ctx) => {
    const fa = ctx.lang === 'fa';
    const alias: Record<string, string> = {
      nodejs: 'node', node: 'node', js: 'node', typescript: 'node', ts: 'node',
      python: 'python', py: 'python', django: 'python', flask: 'python',
      flutter: 'flutter', dart: 'dart', android: 'android', kotlin: 'android',
      java: 'java', maven: 'java', gradle: 'java',
      c: 'c', cpp: 'c', 'c++': 'c', cmake: 'c',
      go: 'go', golang: 'go', rust: 'rust', cargo: 'rust',
      react: 'react', nextjs: 'next', next: 'next',
      laravel: 'laravel', php: 'laravel',
      wordpress: 'wordpress', wp: 'wordpress',
      unity: 'unity',
    };

    const requested = input
      .trim()
      .toLowerCase()
      .split(/[\s,+]+/)
      .filter(Boolean)
      .map((token) => alias[token] ?? token);

    const unknown = requested.filter((id) => !GITIGNORE_TEMPLATES[id]);
    if (unknown.length) {
      throw errInvalidInput(
        `پشته‌ی ناشناخته: ${unknown.join('، ')}\nگزینه‌ها: ${Object.keys(GITIGNORE_TEMPLATES).join('، ')}`,
        `Unknown stack: ${unknown.join(', ')}\nOptions: ${Object.keys(GITIGNORE_TEMPLATES).join(', ')}`,
      );
    }

    const content = buildGitignore(requested);
    return {
      html:
        `${fa ? '🚫 <b>.gitignore</b>' : '🚫 <b>.gitignore</b>'} — ${requested
          .map((id) => escapeHtml((GITIGNORE_TEMPLATES[id] as { label: string }).label))
          .join(' + ')}\n` +
        codeBlock(truncate(content, 1400)) +
        (content.length > 1400 ? (fa ? '\n📎 فایل کامل پیوست شد.' : '\n📎 The full file is attached.') : '') +
        `\n<i>${
          fa
            ? '🔐 بخش Secrets همیشه اضافه می‌شود تا .env، کلیدهای خصوصی و credential به مخزن نروند.'
            : '🔐 The secrets section is always included so .env files, private keys and credentials never reach the repository.'
        }</i>`,
      attachment: {
        name: '.gitignore',
        content,
        caption: { fa: '🚫 فایل .gitignore', en: '🚫 .gitignore file' },
      },
    };
  },
});

// ─── 20. README generator ─────────────────────────────────────────────────

export interface ReadmeSpec {
  name: string;
  description: string;
  language: string;
  framework: string;
  features: string[];
  install: string[];
  usage: string;
  env: string[];
  api: string[];
  license: string;
  repo: string;
}

const FIELD_ALIASES: Record<string, keyof ReadmeSpec> = {
  name: 'name', project: 'name', title: 'name', نام: 'name',
  description: 'description', desc: 'description', about: 'description', توضیح: 'description',
  language: 'language', lang: 'language', زبان: 'language',
  framework: 'framework', فریمورک: 'framework',
  features: 'features', feature: 'features', امکانات: 'features', ویژگی: 'features',
  install: 'install', installation: 'install', setup: 'install', نصب: 'install',
  usage: 'usage', run: 'usage', استفاده: 'usage',
  env: 'env', environment: 'env', 'env vars': 'env', variables: 'env', متغیرها: 'env',
  api: 'api', endpoints: 'api',
  license: 'license', مجوز: 'license',
  repo: 'repo', repository: 'repo', github: 'repo',
};

/** Parses the `key: value` block the user sends. */
export function parseReadmeSpec(input: string): ReadmeSpec {
  const spec: ReadmeSpec = {
    name: '', description: '', language: '', framework: '',
    features: [], install: [], usage: '', env: [], api: [],
    license: 'MIT', repo: '',
  };

  let currentKey: keyof ReadmeSpec | null = null;
  for (const rawLine of input.split('\n')) {
    const line = rawLine.trim();
    if (!line) continue;

    const listItem = /^[-*•]\s+(.*)$/.exec(line);
    if (listItem && currentKey && Array.isArray(spec[currentKey])) {
      (spec[currentKey] as string[]).push((listItem[1] ?? '').trim());
      continue;
    }

    const pair = /^([A-Za-z\u0600-\u06FF ]{2,20})\s*[:=]\s*(.*)$/.exec(line);
    if (pair) {
      const key = FIELD_ALIASES[(pair[1] ?? '').trim().toLowerCase()];
      if (key) {
        currentKey = key;
        const value = (pair[2] ?? '').trim();
        if (Array.isArray(spec[key])) {
          if (value) {
            (spec[key] as string[]).push(...value.split(/\s*[,،]\s*/).filter(Boolean));
          }
        } else {
          (spec[key] as string) = value;
        }
        continue;
      }
    }

    // Continuation of a free-text field.
    if (currentKey && !Array.isArray(spec[currentKey])) {
      const existing = spec[currentKey] as string;
      (spec[currentKey] as string) = existing ? `${existing} ${line}` : line;
    }
  }

  if (!spec.name) {
    throw errInvalidInput(
      'حداقل نام پروژه لازم است. نمونه:\n<code>name: My API\ndescription: A small REST service\nlanguage: TypeScript</code>',
      'At least the project name is required. Example:\n<code>name: My API\ndescription: A small REST service\nlanguage: TypeScript</code>',
    );
  }
  return spec;
}

const INSTALL_HINTS: Record<string, string[]> = {
  typescript: ['npm install', 'npm run build'],
  javascript: ['npm install'],
  node: ['npm install'],
  python: ['python -m venv .venv', 'source .venv/bin/activate', 'pip install -r requirements.txt'],
  go: ['go mod download', 'go build ./...'],
  rust: ['cargo build --release'],
  php: ['composer install'],
  java: ['./mvnw clean package'],
  dart: ['dart pub get'],
  flutter: ['flutter pub get'],
};

export function buildReadme(spec: ReadmeSpec): string {
  const slug = spec.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'project';
  const install = spec.install.length
    ? spec.install
    : (INSTALL_HINTS[spec.language.toLowerCase()] ?? ['# add your installation steps here']);

  const badges = [
    spec.license ? `![license](https://img.shields.io/badge/license-${encodeURIComponent(spec.license)}-blue)` : '',
    spec.language ? `![language](https://img.shields.io/badge/language-${encodeURIComponent(spec.language)}-informational)` : '',
  ].filter(Boolean);

  const lines: string[] = [
    `# ${spec.name}`,
    '',
    ...(badges.length ? [badges.join(' '), ''] : []),
    ...(spec.description ? [spec.description, ''] : []),
    '## Table of contents',
    '',
    '- [Features](#features)',
    '- [Requirements](#requirements)',
    '- [Installation](#installation)',
    '- [Usage](#usage)',
    ...(spec.env.length ? ['- [Environment variables](#environment-variables)'] : []),
    ...(spec.api.length ? ['- [API](#api)'] : []),
    '- [Contributing](#contributing)',
    '- [License](#license)',
    '',
    '## Features',
    '',
    ...(spec.features.length ? spec.features.map((f) => `- ${f}`) : ['- _Describe what this project does._']),
    '',
    '## Requirements',
    '',
    ...(spec.language ? [`- ${spec.language}`] : []),
    ...(spec.framework ? [`- ${spec.framework}`] : []),
    ...(!spec.language && !spec.framework ? ['- _List the runtimes and tools needed._'] : []),
    '',
    '## Installation',
    '',
    '```bash',
    `git clone ${spec.repo || `https://github.com/<user>/${slug}.git`}`,
    `cd ${slug}`,
    ...install,
    '```',
    '',
    '## Usage',
    '',
    '```bash',
    spec.usage || '# describe how to run the project',
    '```',
    '',
  ];

  if (spec.env.length) {
    lines.push(
      '## Environment variables',
      '',
      'Copy `.env.example` to `.env` and fill in the values. **Never commit the real `.env`.**',
      '',
      '| Variable | Required | Description |',
      '|---|---|---|',
      ...spec.env.map((entry) => {
        const [name = entry, ...rest] = entry.split(/\s*[-–—:]\s*/);
        return `| \`${name.trim()}\` | yes | ${rest.join(' ').trim() || '_describe this value_'} |`;
      }),
      '',
    );
  }

  if (spec.api.length) {
    lines.push(
      '## API',
      '',
      '| Method & path | Description |',
      '|---|---|',
      ...spec.api.map((entry) => {
        const [route = entry, ...rest] = entry.split(/\s*[-–—]\s*/);
        return `| \`${route.trim()}\` | ${rest.join(' ').trim() || '_describe this endpoint_'} |`;
      }),
      '',
    );
  }

  lines.push(
    '## Contributing',
    '',
    '1. Fork the repository and create a branch: `git switch -c feature/my-change`',
    '2. Commit with a clear message: `git commit -m "feat: add my change"`',
    '3. Push the branch and open a pull request.',
    '',
    '## License',
    '',
    `Released under the ${spec.license || 'MIT'} license. See [LICENSE](LICENSE) for details.`,
    '',
  );

  return lines.join('\n');
}

export const readmeTool = defineTool({
  id: 'readme_gen',
  category: 'programming',
  icon: '📘',
  needsInput: true,
  title: { fa: 'سازنده‌ی README', en: 'README Generator' },
  description: {
    fa: 'از روی مشخصات پروژه یک README استاندارد به Markdown می‌سازد: عنوان، توضیح، نشان‌ها، فهرست مطالب، امکانات، پیش‌نیازها، نصب، نحوه‌ی استفاده، جدول متغیرهای محیطی، جدول API، مشارکت و مجوز.',
    en: 'Builds a standard Markdown README from your project details: title, description, badges, table of contents, features, requirements, installation, usage, an environment-variable table, an API table, contributing and license.',
  },
  usage: {
    fa:
      'مشخصات را خط‌به‌خط بنویسید:\n' +
      '<code>name: My API\ndescription: سرویس کوتاه REST\nlanguage: TypeScript\nframework: Hono\nfeatures: احراز هویت, صفحه‌بندی\ninstall: npm ci\nusage: npm start\nenv: DATABASE_URL - رشته اتصال\napi: GET /users - فهرست کاربران\nlicense: MIT</code>',
    en:
      'Write the details line by line:\n' +
      '<code>name: My API\ndescription: A small REST service\nlanguage: TypeScript\nframework: Hono\nfeatures: auth, pagination\ninstall: npm ci\nusage: npm start\nenv: DATABASE_URL - connection string\napi: GET /users - list users\nlicense: MIT</code>',
  },
  example: {
    fa: 'ورودی: name: My API\nlanguage: Go\nخروجی: فایل README.md آماده با همه‌ی بخش‌های استاندارد',
    en: 'Input: name: My API\nlanguage: Go\nOutput: a ready README.md with every standard section',
  },
  limitations: {
    fa: 'فقط نام پروژه اجباری است؛ بخش‌های خالی با متن راهنما پر می‌شوند. مقدار واقعی هیچ متغیر محیطی را ننویسید — فقط نام آن را.',
    en: 'Only the project name is mandatory; empty sections are filled with placeholder guidance. Never write the real value of an environment variable — only its name.',
  },
  run: (input, ctx) => {
    const fa = ctx.lang === 'fa';
    const spec = parseReadmeSpec(input);
    const markdown = buildReadme(spec);

    if (markdown.length > TOOL_LIMITS.maxGeneratedDocChars) {
      throw errInvalidInput(
        'مشخصات واردشده بیش از حد طولانی است.',
        'The supplied specification is too long.',
      );
    }

    const sections = [
      spec.features.length ? (fa ? 'امکانات' : 'features') : '',
      spec.env.length ? (fa ? 'متغیرهای محیطی' : 'env vars') : '',
      spec.api.length ? 'API' : '',
    ].filter(Boolean);

    return {
      html:
        `${fa ? '📘 <b>README.md ساخته شد</b>' : '📘 <b>README.md generated</b>'} — ${escapeHtml(spec.name)}\n` +
        codeBlock(truncate(markdown, 1300), 'markdown') +
        `\n📎 ${fa ? 'فایل کامل پیوست شد.' : 'The full file is attached.'}` +
        (sections.length
          ? `\n${DIVIDER}\n${fa ? '📑 بخش‌های اختیاری واردشده:' : '📑 Optional sections included:'} ${sections.join(' • ')}`
          : '') +
        `\n<i>${
          fa
            ? '🔐 فقط نام متغیرهای محیطی در README نوشته می‌شود، هرگز مقدارشان.'
            : '🔐 Only the names of environment variables are written into the README, never their values.'
        }</i>`,
      attachment: {
        name: 'README.md',
        content: markdown,
        caption: { fa: '📘 README.md', en: '📘 README.md' },
      },
    };
  },
});
