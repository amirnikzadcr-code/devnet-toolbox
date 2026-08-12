# Deployment guide

A complete walkthrough from an empty Cloudflare account to a bot answering `/start`.

## 0. Prerequisites

- Node.js ≥ 20 and npm
- A Cloudflare account (the free plan is enough)
- A Telegram bot token from [@BotFather](https://t.me/BotFather)

```bash
git clone https://github.com/amirnikzadcr-code/devnet-toolbox.git
cd devnet-toolbox
npm install
npx wrangler login      # or export CLOUDFLARE_API_TOKEN
```

If you prefer a scoped API token over `wrangler login`, create one with **Account** permissions: `Workers Scripts: Edit`, `Workers KV Storage: Edit`, `D1: Edit`, `Account Settings: Read`. Export it as `CLOUDFLARE_API_TOKEN`, and export your account id as `CLOUDFLARE_ACCOUNT_ID`.

## 1. Create the KV namespace

```bash
npx wrangler kv namespace create STATE
```

Copy the returned id into `wrangler.jsonc`, replacing `REPLACE_WITH_KV_NAMESPACE_ID`.

## 2. Create the D1 database

```bash
npx wrangler d1 create devnet_toolbox
```

Copy the returned `database_id` into `wrangler.jsonc`, replacing `REPLACE_WITH_D1_DATABASE_ID`.

## 3. Apply the schema

```bash
npm run db:init:remote     # remote D1
npm run db:init:local      # local dev database
```

The schema is idempotent (`CREATE TABLE IF NOT EXISTS`, `INSERT OR IGNORE` seeds), so re-running it is safe.

## 4. Push the secrets

```bash
npx wrangler secret put BOT_TOKEN         # from @BotFather
npx wrangler secret put WEBHOOK_SECRET    # openssl rand -hex 32
npx wrangler secret put ADMIN_SECRET      # openssl rand -hex 32
```

Never place these in `wrangler.jsonc`, a `.env` committed to git, or a CI log.

## 5. Verify and deploy

```bash
npm run verify     # typecheck → lint → test → build
npm run deploy
```

Wrangler prints the Worker URL, e.g. `https://devnet-toolbox.<subdomain>.workers.dev`.

## 6. Health check

```bash
curl https://devnet-toolbox.<subdomain>.workers.dev/health
```

```json
{"ok":true,"name":"DevNet Toolbox","version":"1.0.0","tools":45,"environment":"production"}
```

## 7. Register the webhook

```bash
export WORKER_URL=https://devnet-toolbox.<subdomain>.workers.dev
export ADMIN_SECRET=<the value you set in step 4>

curl -X POST "$WORKER_URL/admin/set-webhook" -H "x-admin-secret: $ADMIN_SECRET"
curl     "$WORKER_URL/admin/webhook-info"    -H "x-admin-secret: $ADMIN_SECRET"
```

`webhook-info` should show your URL, `pending_update_count: 0`, and no `last_error_message`. The endpoint registers `allowed_updates: ["message","callback_query"]`, `drop_pending_updates: true`, `max_connections: 40` and the secret token — so the token itself never appears in your shell history.

## 8. Smoke test in Telegram

Open the bot and check:

- [ ] `/start` renders the home page with the tool count
- [ ] 🧰 Toolbox → each of the five categories opens
- [ ] Pagination works inside a category
- [ ] One tool from each category returns a correct result
- [ ] 👤 Profile shows your id, first-seen and counters
- [ ] 📊 Statistics renders
- [ ] Back and 🏠 Home work from every screen
- [ ] ⚙️ Settings switches the language and it survives a restart
- [ ] Invalid input produces a friendly error, never a stack trace

## Continuous deployment

`.github/workflows/ci.yml` runs typecheck, lint, tests and a dry-run build on every push and pull request, then deploys automatically when `main` is green.

Add two repository secrets:

| Secret | Value |
|---|---|
| `CLOUDFLARE_API_TOKEN` | The scoped token from step 0 |
| `CLOUDFLARE_ACCOUNT_ID` | Your Cloudflare account id |

The deploy job is skipped on pull requests and on forks.

## Rolling back

```bash
npx wrangler deployments list
npx wrangler rollback [--message "reason"]
```

Secrets and bindings survive a rollback; only the code reverts.

## Operations

**Live logs**

```bash
npx wrangler tail
```

Logs are structured JSON (`{scope, message, kind, ...}`) and never contain secrets or tool input.

**Rotating a secret**

```bash
npx wrangler secret put WEBHOOK_SECRET     # new value
curl -X POST "$WORKER_URL/admin/set-webhook" -H "x-admin-secret: $ADMIN_SECRET"
```

Re-register the webhook immediately after rotating `WEBHOOK_SECRET`, or Telegram's updates will be rejected until you do.

**Inspecting the database**

```bash
npx wrangler d1 execute devnet_toolbox --remote --command "SELECT key, value FROM counters;"
```

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| Bot silent, `webhook-info` shows `401` | `WEBHOOK_SECRET` differs from the registered one | Re-run `/admin/set-webhook` |
| `Couldn't find a D1 DB` on deploy | Placeholder id still in `wrangler.jsonc` | Paste the real `database_id` |
| `no such table: users` | Schema not applied remotely | `npm run db:init:remote` |
| `401` from every `/admin/*` call | `ADMIN_SECRET` unset or mismatched | `wrangler secret put ADMIN_SECRET` |
| Bot replies only in a private chat | By design — group chats are rejected | Message the bot directly |
| Network tools time out | Target unreachable within 8 s | Expected; try another host |
