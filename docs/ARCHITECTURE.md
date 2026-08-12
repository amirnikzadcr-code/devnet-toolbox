# Architecture

## Why a single Worker

The bot is one Cloudflare Worker with no origin server behind it. Telegram delivers updates over HTTPS to `POST /webhook`; the Worker answers immediately and finishes the work in the background. There is nothing to keep warm, nothing to scale manually, and no long-lived process that can drift out of sync with the repository.

## Request lifecycle

1. **Transport check** — `src/index.ts` matches the method and path.
2. **Authentication** — the `X-Telegram-Bot-Api-Secret-Token` header is compared to `env.WEBHOOK_SECRET` with a constant-time comparison. A mismatch returns `401` with a body identical to the missing-header case.
3. **Size guard** — bodies over 200 KB return `413` before any parsing happens.
4. **Shape guard** — the body must parse as a JSON object containing a numeric `update_id`; otherwise `400`.
5. **Fast acknowledgement** — the Worker returns `200 {"ok":true}` and hands the update to `ctx.waitUntil(handleUpdate(...))`. Telegram never sees a slow response, so it never retries a still-running tool.
6. **Dispatch** — `src/bot/router.ts` deduplicates the update, rejects non-private chats and bot senders, applies the general rate limit, resolves the user's language, and routes to a command, a callback query, or pending free-text input.

`handleUpdate` is total: it catches everything and always resolves. A crash inside a tool can never turn into an unhandled rejection at the Worker level.

## Layers

| Layer | Files | Responsibility |
|---|---|---|
| Entry | `src/index.ts` | HTTP routing, webhook auth, admin endpoints, health |
| Routing | `src/bot/router.ts` | Update dispatch, dedupe, guards, language resolution |
| Execution | `src/bot/runner.ts` | Rate limits, input validation, tool invocation, output truncation, usage recording |
| Presentation | `src/bot/{screens,pages,ui}.ts` | Screen composition, page bodies, inline keyboards |
| Domain | `src/tools/**` | The 45 tools plus the registry |
| Services | `src/services/**` | Telegram client, safe outbound fetch, KV state, rate limiting |
| Persistence | `src/db/**` | D1 schema and parameterised queries |
| Cross-cutting | `src/utils/**`, `src/config/**`, `src/localization/**` | Helpers, tunables, translations |

Each layer only depends downwards. Tools know nothing about Telegram; they receive a string and return HTML.

## The tool contract

```ts
defineTool({
  id: 'base64_encode',
  category: 'programming',
  title:       { fa: '…', en: '…' },
  description: { fa: '…', en: '…' },
  usage:       { fa: '…', en: '…' },
  example:     { input: '…', output: '…' },
  limitations: { fa: '…', en: '…' },
  needsInput: true,
  quick: true,
  network: false,
  run(input, ctx) { return { html, toast? }; },
});
```

- `run` may be sync or async; the runner awaits either.
- A tool escapes its **own** output. The runner never re-escapes, because tools legitimately emit `<pre>` and `<b>`.
- Invalid input throws `ToolError` via `errInvalidInput(fa, en)`; the runner turns that into a localised error page plus usage hint. Any other exception becomes a generic error and increments the global error counter.
- `network: true` costs an extra, much stricter rate-limit token.

Adding a tool means creating it in the right category folder and exporting it — the registry picks it up, and `assertUniqueToolIds` fails the build on a duplicate id.

## Storage split

**KV (`STATE`) — ephemeral, hot path**

| Key | TTL | Purpose |
|---|---|---|
| `pending:<userId>` | 900 s | Which tool is waiting for input, and which message to edit |
| `lang:<userId>` | 1 h | Language cache, so navigation avoids a D1 read |
| `rl:<bucket>:<userId>:<window>` | window | Rate-limit counters |
| `dedupe:<updateId>` | short | Duplicate-delivery suppression |
| `net:<hash>` | 300 s | Network tool response cache |

**D1 (`DB`) — durable, queryable**

| Table | Key | Purpose |
|---|---|---|
| `users` | `user_id` | Profile, language, timestamps, request/run counters |
| `tool_usage` | `(user_id, tool_id)` | Per-user tool leaderboard |
| `daily_stats` | `(day, tool_id)` | Daily aggregates for the 7-day series |
| `counters` | `key` | Global totals: `requests`, `tool_runs`, `errors` |

Writes are batched: recording one tool run is a single 4-statement `batch()`, and the global statistics page is a single 5-statement `batch()`. **Tool inputs and outputs are never written to either store.**

## Navigation and callback data

Telegram caps callback data at 64 bytes, so the scheme is deliberately terse:

| Data | Screen |
|---|---|
| `home` `tb` `quick` `prof` `mytools` `stats` `set` `help` `about` | Top-level screens |
| `cat:<category>:<page>` | Paginated category listing |
| `tool:<id>` | Tool detail page |
| `run:<id>` | Start execution (or ask for input) |
| `lang:<fa\|en>` | Language switch |
| `cancel` `noop` | Cancel pending input / inert button |

Unknown or malformed callback data is answered with a toast rather than an error, so an old keyboard from a previous deployment degrades gracefully.

## Rendering strategy

Navigation edits the existing message via `editMessageText`; only genuinely new interactions send a message. When an edit fails — for example the message is too old, or unchanged — the router transparently falls back to `sendMessage`. That fallback is covered by an integration test.

## Failure behaviour

| Failure | Result |
|---|---|
| D1 unavailable | Language falls back to the default, the screen still renders, the error is logged |
| KV unavailable | Rate limiting fails open, pending state is lost, navigation still works |
| Tool throws `ToolError` | Localised message plus usage hint |
| Tool throws anything else | Generic localised error; details logged; `errors` counter incremented |
| Telegram API error | Logged with the method name and code; never surfaced to the user |
| Outbound fetch timeout | 8 s `AbortController` cap, reported as a friendly timeout message |

## Performance

- Zero runtime dependencies; ~70 KiB gzipped.
- One KV read on the hot path for language (D1 only on a cache miss).
- Network tool responses cached for 5 minutes; DNS answers likewise.
- Outbound responses capped at 64 KB so a huge remote body cannot exhaust the isolate.
- All statistics writes happen inside `ctx.waitUntil`, off the response path.
