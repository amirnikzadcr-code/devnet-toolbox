# گزارش نهایی — DevNet Toolbox

تاریخ: ۱۲ اوت ۲۰۲۶ · وضعیت: **Production / زنده و پایدار**

---

## ۱) مخزن GitHub

**https://github.com/amirnikzadcr-code/devnet-toolbox** — public، برنچ `main`

| Commit | شرح |
|---|---|
| `286caa9` | پیاده‌سازی کامل اولیه |
| `e026bb9` | اتصال KV/D1 واقعی |
| `64e6677` | ارتقای Node رانر CI به ۲۲ |
| **`f38e802`** | **رفع سه باگ production (HEAD فعلی)** |

محتوای مخزن: `README.md`، `LICENSE` (MIT)، `.gitignore`، `package.json`، `wrangler.jsonc`، `src/`، `tests/`، `docs/` (ARCHITECTURE، DEPLOYMENT، SECURITY، TOOLS)، `.github/workflows/ci.yml`.

## ۲) آدرس Worker

**https://devnet-toolbox.nikiaaaaacr.workers.dev**

آخرین Version ID: `692e821e-9e9b-46db-a2ea-7989c6125337`

```
GET /health → {"ok":true,"version":"1.0.0","tools":45,
               "environment":"production","bindings":{"kv":true,"d1":true,"token":true}}
```

## ۳) وضعیت Webhook

| مورد | مقدار |
|---|---|
| Webhook فعال | ✅ بله (Polling استفاده نشده) |
| مسیر | `POST /webhook` |
| `pending_update_count` | ۰ |
| `last_error_message` | هیچ |
| `max_connections` | ۴۰ |
| احراز هویت | هدر `x-telegram-bot-api-secret-token` با مقایسهٔ زمان‌ثابت (`safeEqual`) |

ربات: **@Toolsbotxbot** — `getMe` موفق.

## ۴) تعداد تست‌ها

**۳۱۵ تست در ۱۶ فایل** — همه سبز.

| گروه | فایل‌ها | تست |
|---|---|---|
| Unit | ۱۳ | ۱۹۷ |
| Integration | ۲ | ۹۰ |
| Security | ۱ | ۲۸ |

جزئیات: validate 35 · text-format 31 · security 28 · utilities 26 · worker 26 · registry 21 · random 16 · localization 13 · json 10 · hash 10 · encoding 9 · jwt 7 · **ip-fallback 7** · **ssl-issuer 7** · **cache 5** · router 64.

## ۵) نتایج تست

```
npm run verify
  typecheck  ✅  tsc --noEmit  +  tsc --noEmit -p tsconfig.test.json
  lint       ✅  eslint (۰ خطا، ۰ هشدار)
  test       ✅  315 passed (16 files)
  build      ✅  317.15 KiB / gzip 71.50 KiB
```

**CI (GitHub Actions):** run روی `f38e802` → **success** (جاب‌های `verify`، `secret-scan`، `deploy`).

**تست زندهٔ production** (از طریق webhook واقعی، خروجی پیام‌ها بازخوانی و بررسی شد):

| ابزار | نتیجه |
|---|---|
| `ssl_info` | ✅ «🟢 معتبر • ۶۸ روز باقی‌مانده • Google Trust Services • HSTS ✅» |
| `ip_info` | ✅ «8.8.8.8 • IPv4 • 🇺🇸 US • Ashburn/Virginia • AS15169 Google LLC» |
| `domain_info` | ✅ «MarkMonitor Inc. • ثبت 2007-10-09 • انقضا 2026-10-09» |
| `dns_lookup` | ✅ «github.com — A 20.29.134.23 • TTL 4s» |
| `regex_test` | ✅ «۱ تطبیق: 555-1234 @ 5» |
| `hash_gen` / `calculator` / `color_convert` / `timestamp` | ✅ خروجی صحیح |
| `/start`، منوها، Profile، Back/Home، Pagination | ✅ |

`/admin/self-test` → `toolIds: unique`، `kv: ok`، `d1: ok`، `telegram: ok`.

آمار زندهٔ D1: ۱۷۳ درخواست · ۲۱ اجرای ابزار · ۱۷ ابزار متمایز.

## ۶) قابلیت‌ها

- **۴۵ ابزار** در ۵ دسته: 💻 Programming (۱۶) · 🌐 Network (۱۱) · 🔐 Security (۸) · 🛠 Utilities (۱۰) · ⚡ Quick Tools (دستهٔ مجازی، ۱۶ ابزار).
- UI شبه‌Glassmorphism با Inline Keyboard، سلسله‌مراتب بصری، `editMessageText` به‌جای اسپم پیام، Pagination (۸ آیتم در صفحه)، حالت‌های Loading/Success/Error، دکمهٔ Home + Back در هر صفحه.
- هر ابزار: توضیح، Example با I/O واقعی، Usage، Limitations، Validation و خروجی copy-friendly.
- دو زبانه (فارسی پیش‌فرض + English) با سوییچ در Settings؛ زبان در KV کش و در D1 ذخیره می‌شود.
- Profile و Statistics کامل روی D1 (`users`, `tool_usage`, `daily_stats`, `counters`) با نوشتن اتمیک `db.batch`.
- Rate limiting چندلایه: عمومی ۴۵/۶۰s · ابزار ۲۵/۶۰s · شبکه ۸/۶۰s · سقف روزانهٔ شبکه ۱۲۰.
- سقف‌ها: ورودی ۸۰۰۰ کاراکتر · خروجی ۳۵۰۰ · دانلود ۶۴KB · تایم‌اوت شبکه ۸ ثانیه.
- امنیت: بلاک‌لیست SSRF، رد IPهای خصوصی، dedupe آپدیت‌ها، هیچ خطای خامی به کاربر نمی‌رسد.

## ۷) Secretها (فقط نام)

**Cloudflare Worker Secrets:** `BOT_TOKEN` · `WEBHOOK_SECRET` · `ADMIN_SECRET`

**GitHub Actions Secrets:** `CLOUDFLARE_API_TOKEN` · `CLOUDFLARE_ACCOUNT_ID`

**متغیرهای غیرحساس (`vars` در `wrangler.jsonc`):** `ENVIRONMENT` · `BOT_USERNAME` · `REPO_URL`

هیچ مقداری در سورس، مخزن، مستندات یا این گزارش نوشته نشده است. جاب `secret-scan` در CI روی هر push اجرا می‌شود.

## ۸) مشکلات یافته‌شده و رفع‌شده

**هفت باگ واقعی** پیدا و رفع شد — هرکدام با تست رگرسیون:

| # | باگ | ریشه | رفع |
|---|---|---|---|
| ۱ | دور زدن scheme در `parseHttpUrl` | اعتبارسنجی ناقص | بررسی صریح پروتکل |
| ۲ | شمارش غلط emoji در نوار قدرت رمز | شمارش UTF-16 | شمارش code point |
| ۳ | `detectLang` با دو شاخهٔ یکسان | کپی/پیست | منطق تفکیک‌شده |
| ۴ | پارامترهای پیش‌فرض با تایپ literal | استنتاج `as const` | تایپ صریح |
| ۵ | **کش شدن پاسخ ناموفق upstream** | `cached()` هر پاسخی را ۳۰۰s نگه می‌داشت؛ یک 429 ابزار را برای همه از کار می‌انداخت | پارامتر `shouldCache` |
| ۶ | **ورودی ابزار با `/` بلعیده می‌شد** | هر متن با اسلش، فرمان تلقی می‌شد ⇒ regex، مسیر فایل و JSON pointer هرگز به ابزار نمی‌رسید | تطبیق با فهرست فرمان‌های شناخته‌شده |
| ۷ | **کرش `ssl_info` روی همهٔ دامنه‌ها** | certspotter فیلد `issuer` را آبجکت برمی‌گرداند نه رشته ⇒ `TypeError: trim is not a function` | پذیرش هر دو شکل + کمکی `asString()` برای همهٔ JSONهای بیرونی |

**یک نقص زیرساختی:** `ip_info` از داخل Worker همیشه HTTP 429 می‌گرفت، چون Cloudflare IPهای خروجی را بین همهٔ مشتریان به اشتراک می‌گذارد و سهمیهٔ رایگان `ipwho.is` همیشه مصرف شده است. با یک Worker آزمایشی موقت (که بعداً حذف شد) تأیید و با fallback به `ip-api.com` رفع شد.

باگ‌های ۵ تا ۷ فقط با **تست زندهٔ production و خواندن لاگ Worker** پیدا شدند — سوئیت تست آن‌ها را نمی‌دید. سه مورد از این‌ها ابزار را برای کاربر واقعی از کار انداخته بود.

## ۹) اجرای local

```bash
git clone https://github.com/amirnikzadcr-code/devnet-toolbox.git
cd devnet-toolbox && npm install

cp .dev.vars.example .dev.vars      # BOT_TOKEN, WEBHOOK_SECRET, ADMIN_SECRET
npm run db:init:local               # اعمال schema روی D1 محلی
npm run dev                         # http://localhost:8787

npm run verify                      # typecheck + lint + 315 تست + build
```

## ۱۰) Deploy مجدد

```bash
npx wrangler secret put BOT_TOKEN        # و WEBHOOK_SECRET و ADMIN_SECRET
npm run db:init:remote
npm run deploy
curl -X POST https://<worker>/admin/set-webhook -H "x-admin-secret: <ADMIN_SECRET>"
```

یا فقط `git push origin main` — GitHub Actions پس از سبز شدن `verify` و `secret-scan` به‌صورت خودکار deploy می‌کند.

---

## چک‌لیست نهایی (بخش ۳۱)

| # | مورد | وضعیت |
|---|---|---|
| ۱ | پروژه واقعی و Production-Ready (نه پروتوتایپ) | ✅ |
| ۲ | Cloudflare Workers + TypeScript | ✅ |
| ۳ | Webhook (بدون Polling) | ✅ |
| ۴ | KV + D1 | ✅ |
| ۵ | Secretها فقط در Cloudflare Secrets | ✅ |
| ۶ | ۴۵ ابزار در ۵ دسته | ✅ |
| ۷ | UI حرفه‌ای، Inline Keyboard، Home/Back، Pagination | ✅ |
| ۸ | editMessage به‌جای اسپم پیام | ✅ |
| ۹ | Example/Usage/Limitations برای هر ابزار | ✅ |
| ۱۰ | Profile و Statistics | ✅ |
| ۱۱ | Settings دوزبانه (فارسی/English) | ✅ |
| ۱۲ | Help و About | ✅ |
| ۱۳ | هیچ خطای خامی به کاربر نمی‌رسد | ✅ |
| ۱۴ | Rate limiting قابل تنظیم | ✅ |
| ۱۵ | Validation و سقف حجم ورودی | ✅ |
| ۱۶ | بدون ابزار مخرب یا قابل abuse | ✅ |
| ۱۷ | کد ماژولار (بدون فایل غول‌پیکر) | ✅ |
| ۱۸ | README + LICENSE + docs | ✅ |
| ۱۹ | `.gitignore` حرفه‌ای، بدون نشت secret | ✅ |
| ۲۰ | تست واقعی اجرا شد (۳۱۵ تست) | ✅ |
| ۲۱ | Self-debugging تا سبز شدن کامل | ✅ |
| ۲۲ | Commit + Push | ✅ `f38e802` |
| ۲۳ | Deploy واقعی | ✅ |
| ۲۴ | Webhook تنظیم و تأیید شد | ✅ |
| ۲۵ | تست نهایی زنده روی production | ✅ |
| ۲۶ | CI/CD سبز | ✅ |
