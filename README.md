<div align="center">

# 💻 DevNet Toolbox

**A production-grade Telegram bot with 45 developer, network, security and utility tools — running entirely on Cloudflare Workers.**

Persian-first UI with full English support · Webhook-only · Zero heavy dependencies

[![CI](https://github.com/amirnikzadcr-code/devnet-toolbox/actions/workflows/ci.yml/badge.svg)](https://github.com/amirnikzadcr-code/devnet-toolbox/actions/workflows/ci.yml)
![Cloudflare Workers](https://img.shields.io/badge/Cloudflare-Workers-F38020)
![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178C6)
![Tests](https://img.shields.io/badge/tests-291%20passing-brightgreen)
![License](https://img.shields.io/badge/license-MIT-blue)

</div>

---

## 📖 Table of contents

- [Overview](#-overview)
- [Features](#-features)
- [Tool catalogue](#-tool-catalogue)
- [Architecture](#-architecture)
- [Installation](#-installation)
- [Environment variables & secrets](#-environment-variables--secrets)
- [Local development](#-local-development)
- [Testing](#-testing)
- [Deployment](#-deployment)
- [Telegram configuration](#-telegram-configuration)
- [Cloudflare configuration](#-cloudflare-configuration)
- [Security model](#-security-model)
- [Project layout](#-project-layout)
- [License](#-license)

---

## 🎯 Overview

DevNet Toolbox is a Telegram bot that puts a developer's everyday toolkit one tap away: format JSON, decode a JWT, hash a string, resolve DNS, inspect TLS certificates, convert units, generate secure passwords — without leaving the chat and without pasting sensitive data into a random website.

It runs as a single **Cloudflare Worker**. There is no server to patch, no container to rebuild, and cold starts are measured in milliseconds. State lives in **Workers KV** (ephemeral: pending input, language cache, rate-limit counters) and **D1** (durable: user profiles and usage statistics).

**Design principles**

| Principle | How it is enforced |
|---|---|
| Webhook only, never polling | The Worker exposes `POST /webhook`; there is no polling loop anywhere in the codebase |
| No secret ever in the repo | All secrets come from `env`; a security test scans the whole source tree on every CI run |
| No raw errors to users | Every failure maps to a short localised message; internals go to structured logs only |
| Defensive tooling only | No exploit, scanner, brute-forcer or credential-theft functionality — by policy and by test |
| Small and fast | Zero runtime dependencies; the whole bundle is ~70 KiB gzipped |

---

## ✨ Features

### Interface

- **Glassmorphism-inspired chat UI** — consistent dividers, iconography and visual hierarchy in every screen.
- **Inline keyboards everywhere.** Every screen has **Back** and **🏠 Home**; nothing is a dead end.
- **`editMessage` instead of message spam** — navigating the menus rewrites one message rather than flooding the chat.
- **Pagination** for long tool lists (8 per page) with page indicators and clamped bounds.
- **Loading → Success / Error states** with toast feedback on every callback.
- **Bilingual**: Persian by default, English one tap away; the choice is cached in KV and persisted in D1.

### Every tool ships with

A professional description, a **real worked example (input → output)**, usage instructions, explicit limitations, input validation, and clean copy-friendly output inside a `<pre>` block.

### Profile & statistics

- **Profile** — name, username, Telegram ID, first seen, last activity, total requests, tool runs, favourite tool, distinct tools used.
- **My Tools** — a personal top-tools leaderboard.
- **Statistics** — global totals, most-used tool, and a 7-day daily usage series, all from indexed D1 queries.

### Safety rails

Per-user rate limits (general / tool / network), a hard daily cap on network tools, input-size limits, outbound-fetch timeouts, response-size caps, an allow-list for port checks, and SSRF protection that blocks loopback, link-local and private ranges.

---

## 🧰 Tool catalogue

**45 tools across 5 categories.** `⚡` marks tools that also appear under Quick Tools.

<details open>
<summary><b>💻 Programming (16)</b></summary>

| ID | Tool | Input |
|---|---|---|
| `json_format` ⚡ | JSON Formatter | text |
| `json_minify` | JSON Minifier | text |
| `json_validate` | JSON Validator | text |
| `base64_encode` ⚡ | Base64 Encode | text |
| `base64_decode` ⚡ | Base64 Decode | text |
| `url_encode` | URL Encode | text |
| `url_decode` | URL Decode | text |
| `html_entities` | HTML Entity Encode/Decode | text |
| `jwt_decode` ⚡ | JWT Decoder (decode only, never verifies) | token |
| `regex_test` | Regex Tester (ReDoS-guarded) | pattern + subject |
| `html_format` | HTML Formatter | text |
| `css_format` | CSS Formatter | text |
| `js_format` | JavaScript Formatter | text |
| `markdown_html` | Markdown → HTML | text |
| `text_stats` | Text Statistics | text |
| `random_string` | Random String Generator | — |

</details>

<details open>
<summary><b>🌐 Network (11)</b></summary>

| ID | Tool | Notes |
|---|---|---|
| `dns_lookup` ⚡ | DNS Lookup (A/AAAA/MX/TXT/NS/CNAME) | Cloudflare DoH, 5-min cache |
| `reverse_dns` | Reverse DNS (PTR) | |
| `ip_info` ⚡ | IP Information | geo/ASN lookup |
| `http_status` ⚡ | HTTP Status Checker | |
| `http_headers` | HTTP Headers + security-header grade (F…A+) | |
| `ssl_info` | SSL/TLS Certificate Information | |
| `url_info` | URL Information | |
| `domain_info` | Domain Information | RDAP |
| `port_check` | Port Check | **allow-list of common ports only** |
| `ping` ⚡ | Connectivity Test | 3 HTTPS probes |
| `my_ip` | My Connection | no outbound request |

> Network tools are deliberately rate-limited (8/min, 120/day per user) and reject private, loopback and link-local targets. Port ranges, comma lists and CIDR notation are rejected — this is a diagnostic aid, not a scanner.

</details>

<details open>
<summary><b>🔐 Security (8)</b></summary>

| ID | Tool |
|---|---|
| `hash_all` ⚡ | Multi-algorithm hash (MD5 / SHA-1 / SHA-256 / SHA-512) |
| `sha256` ⚡ | SHA-256 |
| `sha1` | SHA-1 *(legacy — flagged as insecure)* |
| `md5` | MD5 *(legacy — flagged as insecure)* |
| `uuid_gen` ⚡ | UUID v4 Generator |
| `password_gen` ⚡ | Password Generator with strength meter |
| `secret_gen` | Secure Secret / Token Generator |
| `hmac_gen` | HMAC Generator |

All generators use `crypto.getRandomValues` — never `Math.random`.

</details>

<details open>
<summary><b>🛠 Utilities (10)</b></summary>

| ID | Tool |
|---|---|
| `calculator` ⚡ | Safe expression calculator (custom parser, no `eval`) |
| `timestamp` ⚡ | Unix Timestamp Converter |
| `unit_convert` | Unit Converter |
| `qr_code` ⚡ | QR Code Generator |
| `text_counter` | Text Counter |
| `case_convert` | Case Converter |
| `color_convert` ⚡ | Color Converter (HEX/RGB/HSL) |
| `url_parse` | URL Parser |
| `url_normalize` | URL Cleaner / Normalizer |
| `cron_helper` | Cron Expression Helper |

</details>

---

## 🏗 Architecture

```
                Telegram
                    │  HTTPS webhook (secret token header)
                    ▼
        ┌───────────────────────────┐
        │   Cloudflare Worker       │
        │   src/index.ts            │  routes: / /health /webhook /admin/*
        └────────────┬──────────────┘
                     │  ctx.waitUntil → respond 200 immediately
                     ▼
        ┌───────────────────────────┐
        │   Router  src/bot/router  │  dedupe → private-chat guard →
        │                           │  rate limit → command / callback / input
        └───┬───────────────┬───────┘
            │               │
      ┌─────▼─────┐   ┌─────▼──────┐
      │  Screens  │   │   Runner   │  validate → execute → truncate → record
      │  Pages/UI │   └─────┬──────┘
      └───────────┘         │
                            ▼
                   ┌──────────────────┐
                   │  Tool Registry   │  45 tools, 5 categories
                   └───┬──────────┬───┘
                       │          │
              ┌────────▼───┐  ┌───▼─────────┐
              │  KV STATE  │  │   D1  DB    │
              │  pending   │  │  users      │
              │  lang      │  │  tool_usage │
              │  ratelimit │  │  daily_stats│
              │  net cache │  │  counters   │
              └────────────┘  └─────────────┘
```

**Request lifecycle.** Telegram POSTs an update → the Worker constant-time-compares the secret token → validates size and JSON shape → answers `200 {"ok":true}` within milliseconds and continues processing inside `ctx.waitUntil`. Telegram therefore never retries because of slow tool execution.

**Storage split.** KV holds everything ephemeral and hot (pending-input state, language cache, rate-limit windows, network response cache). D1 holds everything durable and queryable (profiles, per-tool usage, daily aggregates, global counters). **Tool inputs and outputs are never persisted.**

---

## 📦 Installation

**Requirements:** Node.js ≥ 20, npm, a Cloudflare account, a Telegram bot token from [@BotFather](https://t.me/BotFather).

```bash
git clone https://github.com/amirnikzadcr-code/devnet-toolbox.git
cd devnet-toolbox
npm install
```

---

## 🔑 Environment variables & secrets

### Secrets — set with `wrangler secret put`, never committed

| Name | Purpose | Where to get it |
|---|---|---|
| `BOT_TOKEN` | Telegram Bot API token | [@BotFather](https://t.me/BotFather) → `/newbot` |
| `WEBHOOK_SECRET` | Shared token Telegram sends in `X-Telegram-Bot-Api-Secret-Token`; rejects forged updates | Generate: `openssl rand -hex 32` |
| `ADMIN_SECRET` | Guards `/admin/*` maintenance endpoints | Generate: `openssl rand -hex 32` |

```bash
wrangler secret put BOT_TOKEN
wrangler secret put WEBHOOK_SECRET
wrangler secret put ADMIN_SECRET
```

### Plain variables — safe to keep in `wrangler.jsonc`

| Name | Purpose |
|---|---|
| `ENVIRONMENT` | `production` / `development` |
| `BOT_USERNAME` | Shown on the About page (optional) |
| `REPO_URL` | Repository link on the About page (optional) |

### Bindings

| Binding | Type | Notes |
|---|---|---|
| `STATE` | KV Namespace | Pending input, language cache, rate limits, network cache |
| `DB` | D1 Database | `devnet_toolbox` — users, usage, daily stats, counters |

### Local secrets

Create `.dev.vars` (already git-ignored — **never commit it**):

```ini
BOT_TOKEN=123456:your-token-here
WEBHOOK_SECRET=your-local-webhook-secret
ADMIN_SECRET=your-local-admin-secret
```

---

## 💻 Local development

```bash
npm run dev              # wrangler dev — local Worker at http://localhost:8787
npm run db:init:local    # apply the D1 schema to the local database
npm run typecheck        # tsc --noEmit for src/ and for tests/
npm run lint             # eslint, zero warnings tolerated
```

Smoke-test the running Worker:

```bash
curl http://localhost:8787/health
# {"ok":true,"name":"DevNet Toolbox","version":"1.0.0","tools":45,...}
```

To receive real Telegram traffic locally, expose port 8787 with a tunnel (e.g. `cloudflared tunnel --url http://localhost:8787`) and point the webhook at the tunnel URL.

---

## 🧪 Testing

```bash
npm test                       # the whole suite
npx vitest run tests/unit      # pure logic
npx vitest run tests/integration
npx vitest run tests/security
npm run verify                 # typecheck → lint → test → build
```

**291 tests, all passing.**

| Suite | Tests | Covers |
|---|---:|---|
| `tests/unit/` | 178 | JSON, Base64/URL encoding, hashing, JWT, UUID/random, validators, registry, localisation, formatters, calculator & converters |
| `tests/integration/router.test.ts` | 59 | `/start`, all 14 commands, callback navigation, pagination + clamping, the full tool-execution flow, `/cancel`, language switching, update dedupe, group-chat rejection, D1 outage fallback, `editMessageText` → `sendMessage` fallback, and rendering the page of **all 45 tools** |
| `tests/integration/worker.test.ts` | 26 | Health endpoint, webhook auth (missing / wrong / prefix / empty secret), malformed JSON, missing `update_id`, 413 oversized body, admin-endpoint authorisation |
| `tests/security/security.test.ts` | 28 | Source-tree secret scanning, runtime leakage, escaped output, SSRF rejection, SQL-injection resistance, rate-limit enforcement, port allow-list, no-exploit policy, webhook hardening |

Tests run against in-memory fakes (`tests/helpers/fakes.ts`) that emulate KV TTL semantics, D1 statement logging, and the Telegram API — so the suite is deterministic, offline, and never touches a real bot.

---

## 🚀 Deployment

```bash
# 1. Create the KV namespace, then copy the id into wrangler.jsonc
wrangler kv namespace create STATE

# 2. Create the D1 database, then copy the id into wrangler.jsonc
wrangler d1 create devnet_toolbox

# 3. Apply the schema to the remote database
npm run db:init:remote

# 4. Push the secrets
wrangler secret put BOT_TOKEN
wrangler secret put WEBHOOK_SECRET
wrangler secret put ADMIN_SECRET

# 5. Verify, then ship
npm run verify
npm run deploy
```

`wrangler.jsonc` ships with `REPLACE_WITH_KV_NAMESPACE_ID` and `REPLACE_WITH_D1_DATABASE_ID` placeholders — deployment fails loudly until you substitute the real ids.

---

## 🤖 Telegram configuration

Register the webhook using the built-in admin endpoint (it never exposes the token):

```bash
curl -X POST https://devnet-toolbox.<subdomain>.workers.dev/admin/set-webhook \
  -H "x-admin-secret: $ADMIN_SECRET"

curl https://devnet-toolbox.<subdomain>.workers.dev/admin/webhook-info \
  -H "x-admin-secret: $ADMIN_SECRET"
```

The webhook is registered with `allowed_updates: ["message","callback_query"]`, `drop_pending_updates: true`, `max_connections: 40`, and the `secret_token` above.

Suggested BotFather command list:

```
start - 🏠 Home
tools - 🧰 Toolbox
quick - ⚡ Quick tools
profile - 👤 Profile
stats - 📊 Statistics
settings - ⚙️ Settings
help - ❓ Help
about - ℹ️ About
```

---

## ☁️ Cloudflare configuration

| Resource | Value |
|---|---|
| Worker name | `devnet-toolbox` |
| Entry point | `src/index.ts` |
| Compatibility date | `2025-01-15` |
| Compatibility flags | `nodejs_compat` |
| KV binding | `STATE` |
| D1 binding | `DB` → `devnet_toolbox` |

**API token permissions** (Account-scoped, least privilege): `Workers Scripts: Edit`, `Workers KV Storage: Edit`, `D1: Edit`, `Account Settings: Read`.

### D1 schema

| Table | Purpose |
|---|---|
| `users` | Profile, language, first/last seen, request and tool-run counters |
| `tool_usage` | Per-user, per-tool counters — powers "My Tools" |
| `daily_stats` | Per-day, per-tool aggregates — powers the 7-day series |
| `counters` | Global totals: requests, tool runs, errors |

---

## 🔒 Security model

- **Webhook authentication** — the `X-Telegram-Bot-Api-Secret-Token` header is compared in constant time; anything else returns `401` with an identical body, so an attacker learns nothing.
- **Request hardening** — bodies above 200 KB return `413`; non-JSON or `update_id`-less payloads return `400`.
- **Admin endpoints** — `/admin/*` require `x-admin-secret` (constant-time comparison) and are fully disabled when `ADMIN_SECRET` is unset.
- **No secrets in the repo** — enforced by a CI test that greps the entire source tree for token patterns and hardcoded assignments.
- **Output escaping** — every tool HTML-escapes its own output; a test asserts no tool can emit a live `<script>` tag.
- **SSRF protection** — loopback, link-local, private and metadata addresses are rejected by every network tool.
- **SQL safety** — every D1 statement uses bound parameters; a test asserts injected SQL never reaches a statement.
- **Data minimisation** — tool inputs and outputs are never stored. Only identity fields Telegram already sends, plus counters, are persisted.
- **No offensive tooling** — no exploits, malware, scanners, brute-forcers or credential-theft utilities, enforced by policy and by test.

Found a vulnerability? Please open a private security advisory rather than a public issue.

---

## 📁 Project layout

```
src/
├── index.ts              # Worker entry: routing, webhook auth, admin endpoints
├── config/               # Every tunable: limits, rate limits, TTLs, pagination
├── types/                # Env bindings and hand-written Telegram types
├── localization/         # fa.ts / en.ts (82 keys each) + t() helper
├── utils/                # errors, text, validate, encoding, hash, random, format
├── services/             # http (safeFetch), telegram, state (KV), ratelimit
├── db/                   # schema.sql + parameterised queries
├── tools/
│   ├── registry.ts       # Registration, lookup, pagination, search
│   ├── types.ts          # defineTool contract
│   ├── programming/  network/  security/  utilities/
└── bot/
    ├── router.ts         # Update dispatch — never throws
    ├── runner.ts         # Rate limit → validate → execute → record
    ├── screens.ts pages.ts ui.ts context.ts
tests/
├── unit/  integration/  security/  helpers/
docs/
├── ARCHITECTURE.md  DEPLOYMENT.md  TOOLS.md  SECURITY.md
```

---

## 📄 License

[MIT](LICENSE) © DevNet Toolbox contributors

<div align="center">

Built with **Cloudflare Workers**, **TypeScript** and zero runtime dependencies.

</div>
