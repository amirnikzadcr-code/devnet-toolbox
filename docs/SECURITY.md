# Security policy and model

## Scope

DevNet Toolbox is a **defensive** developer utility. It deliberately contains no exploits, malware, scanners, brute-forcers, credential-theft utilities or attack automation. Feature requests in those directions will be declined.

## Threat model

| Threat | Mitigation |
|---|---|
| Forged webhook updates | Constant-time comparison of `X-Telegram-Bot-Api-Secret-Token`; identical `401` for missing and wrong secrets |
| Secret exfiltration via the repo | No secret literal anywhere; a CI test greps the whole source tree on every run |
| Secret exfiltration via output | Tests assert no user-facing message contains a token; the token only ever appears in the `api.telegram.org` URL |
| Information disclosure via errors | Users see short localised messages; stack traces and driver errors stay in logs |
| SSRF through network tools | Loopback, link-local, private and metadata addresses rejected before any fetch |
| Turning the bot into a scanner | Port checks limited to an allow-list; ranges, comma lists and CIDR rejected; 8/min and 120/day network caps |
| Resource exhaustion | 200 KB request cap, 8 000-character input cap, 64 KB response cap, 8 s fetch timeout, ReDoS-guarded regex tool |
| SQL injection | Every D1 statement uses bound parameters; asserted by test |
| HTML injection in chat | Every tool escapes its own output; asserted across all tools by test |
| Unauthorised administration | `/admin/*` requires `x-admin-secret`, constant-time compared, and is disabled entirely when unset |
| Spam and abuse | Per-user rate limits on general actions, tool runs and network tools |

## Secret handling

Secrets live only in Cloudflare Secrets (`wrangler secret put`) and, locally, in the git-ignored `.dev.vars`. They are read exclusively through the `Env` binding.

| Secret | Purpose |
|---|---|
| `BOT_TOKEN` | Authenticates the bot to the Telegram API |
| `WEBHOOK_SECRET` | Proves an incoming update really came from Telegram |
| `ADMIN_SECRET` | Guards the maintenance endpoints |

Rules enforced in code and in CI:

- No secret is ever logged, echoed in a response, or included in an error message.
- No secret appears in the README, the docs, commit messages, or CI output.
- `.gitignore` covers `.dev.vars`, `.env*`, `.wrangler/` and build output.
- Rotating `WEBHOOK_SECRET` requires re-registering the webhook.

## Data collected

Only what is needed to render a profile and usage statistics:

- Telegram user id, first name, last name, username
- Language preference
- First-seen and last-activity timestamps
- Request count, tool-run count, per-tool counters, daily aggregates

**Never stored:** tool input, tool output, message text, chat contents, IP addresses.

Because inputs are not persisted, pasting a JWT or a hash into the bot leaves no copy behind — it lives only in Telegram's own chat history.

## Rate limits

| Bucket | Window | Max |
|---|---|---|
| General actions | 60 s | 45 |
| Tool runs | 60 s | 25 |
| Network tools | 60 s | 8 |
| Network tools (daily) | 24 h | 120 |

All values live in `src/config/index.ts`. Limits fail **open** if KV is unavailable — availability is preferred over hard enforcement for a utility bot, and the strict network caps are the ones that matter for abuse.

## Automated verification

`tests/security/security.test.ts` (28 tests) runs on every CI build and covers:

1. Source-tree scanning for token patterns and hardcoded secret assignments
2. `.gitignore` and `wrangler.jsonc` hygiene
3. Runtime output leakage across the home, about, help and profile screens
4. Internal error messages never reaching users
5. Oversized input rejection and the 4 096-character Telegram cap
6. HTML escaping across every input-taking tool
7. SSRF rejection across every network tool
8. SQL injection resistance
9. Rate-limit enforcement and per-user isolation
10. Port allow-list, and rejection of range/list/CIDR syntax
11. The no-offensive-tooling policy, checked against the registry
12. JWT tooling advertising decode-only, and MD5/SHA-1 carrying deprecation warnings
13. End-to-end webhook hardening, including that missing and wrong secrets are indistinguishable

## Reporting a vulnerability

Please open a **private security advisory** on the repository rather than a public issue. Include reproduction steps and the affected version or commit. Reports are acknowledged within a few days.

## Hardening checklist for operators

- [ ] `WEBHOOK_SECRET` is at least 32 random bytes and unique to this deployment
- [ ] `ADMIN_SECRET` is set (otherwise `/admin/*` is disabled — which is also safe)
- [ ] Secrets were pushed with `wrangler secret put`, never committed
- [ ] The Cloudflare API token is scoped to the four permissions listed in the deployment guide
- [ ] `webhook-info` shows no `last_error_message`
- [ ] `npm run verify` is green before every deploy
