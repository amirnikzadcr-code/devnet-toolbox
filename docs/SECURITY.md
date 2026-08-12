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

**Never stored:** tool input, tool output, message text, chat contents, IP addresses, uploaded files.

Uploaded files (`image_metadata`, `file_hash_compare`) are read into memory, processed and dropped when the request ends. The two-file hash comparison keeps only the first file's three hashes and its declared name and size in KV, for at most 15 minutes — never the bytes.

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

`tests/security/http-builder.test.ts` (53 tests) covers the HTTP Request Builder specifically:

- public URLs succeed, with status, timing, headers and body reported
- 20 classes of internal target are refused **before any socket is opened**:
  localhost, all loopback forms, IPv6 `::1`, RFC 1918 ranges, link-local,
  CGNAT, `0.0.0.0`, AWS/GCP/Alibaba/ECS metadata endpoints, `.internal`,
  `.local`, `.consul`, unique-local IPv6, and decimal- or hex-encoded IP
  literals
- redirects to an internal target are refused on hop 2 and hop 3, proving the
  per-hop revalidation in `security/ssrf.ts` and not merely the initial check
- non-http schemes, URL userinfo and non-web ports are rejected
- `Host`, `X-Forwarded-For`, `CF-Connecting-IP`, `Cookie` and `Content-Length`
  cannot be set; a carriage return anywhere in the request spec is refused
- `Authorization` and `Set-Cookie` values are redacted from the transcript
- request bodies over 8 KB, responses over 32 KB, and timeouts are all bounded,
  and neither a timeout nor a connection failure leaks internal detail

## Tool-specific hardening (Phase 3)

| Tool | Risk | Mitigation |
|---|---|---|
| `http_request` | SSRF, port scanning, header spoofing | `assertSafeUrl` per redirect hop, port allow-list narrower than the port-checker's, header deny-list, CR rejection, 8 s timeout, byte caps, 8/min + 120/day budget |
| `xml_format` | XXE, billion laughs | DOCTYPE with an internal subset is rejected; no entity is ever expanded; depth capped at 100 |
| `yaml_json` | Parser abuse | Anchors/aliases, custom tags, multi-document files and tab indentation are refused; 2 000-line and 8 000-character caps |
| `regex_helper` | ReDoS | Nested quantifiers, alternation inside a repeated group and consecutive `.*` are refused before compilation; pattern 300 chars, subject 4 000 chars, 50 matches |
| `diff_check` | CPU exhaustion | 6 000 chars per side, 1 200 lines total; the LCS degrades to a block diff above 4 M cells |
| `csv_json` | Memory exhaustion | 2 000 rows, 60 columns, 8 000 characters |
| `dedupe_lines` | Memory exhaustion | 3 000 lines |
| `prog_calc` / `base_convert` | Unbounded BigInt | 128-bit ceiling, shift amount bounded by the word width |
| `image_metadata`, `file_hash_compare` | Malicious uploads | 8 MB cap enforced on the declared size *and* while streaming; static parsing only; bytes never persisted |
| `docker_helper`, `readme_gen`, `gitignore_gen` | Credential leakage in generated files | Compose templates reference `${VAR:?}` and never a literal password; databases bind to 127.0.0.1; the README writes variable names only; `.gitignore` always includes a secrets section |
| `git_helper` | Data loss from a suggested command | Every destructive command carries a warning, `--force-with-lease` is preferred over `--force`, and a leaked secret is answered with "revoke first"

## Reporting a vulnerability

Please open a **private security advisory** on the repository rather than a public issue. Include reproduction steps and the affected version or commit. Reports are acknowledged within a few days.

## Hardening checklist for operators

- [ ] `WEBHOOK_SECRET` is at least 32 random bytes and unique to this deployment
- [ ] `ADMIN_SECRET` is set (otherwise `/admin/*` is disabled — which is also safe)
- [ ] Secrets were pushed with `wrangler secret put`, never committed
- [ ] The Cloudflare API token is scoped to the four permissions listed in the deployment guide
- [ ] `webhook-info` shows no `last_error_message`
- [ ] `npm run verify` is green before every deploy
