# گزارش پایانی فاز ۳ — Feature Update: افزودن ۲۰ ابزار

**پروژه:** DevNet Toolbox · ربات تلگرام روی Cloudflare Workers
**تاریخ:** ۲۰۲۶-۰۸-۱۳ · **وضعیت:** ✅ مستقر روی production و تست‌شده

---

## ۱. جمع‌بندی

۲۰ ابزار جدید به Toolbox موجود اضافه شد **بدون** بازنویسی پروژه، بدون حذف قابلیت قبلی و
بدون ساخت UI موازی. رجیستری از ۴۵ ابزار به **۶۵ ابزار** رسید و همان الگوی `defineTool` /
`paginate` / صفحه‌بندی callback فاز ۱ استفاده شد.

| شاخص | قبل از فاز ۳ | بعد از فاز ۳ |
|---|---|---|
| ابزار در رجیستری | ۴۵ | **۶۵** |
| ابزار سریع (⚡ Quick) | ۱۶ | **۲۴** |
| تست (Vitest) | ۵۰۶ | **۷۵۱** در ۲۷ فایل |
| حجم Bundle | ~۷۸۰ KiB | **۱۰۰۷ KiB** (gzip ۲۲۹ KiB) |

توزیع دسته‌ها پس از فاز ۳: programming ۲۶ · utilities ۱۸ · network ۱۲ · security ۹.

---

## ۲. بیست ابزار اضافه‌شده

| # | ابزار | شناسه | دسته | فایل |
|---|---|---|---|---|
| ۱ | مبدل YAML ↔ JSON ⚡ | `yaml_json` | 💻 Developer | `tools/programming/data-formats.ts` |
| ۲ | XML Formatter | `xml_format` | 💻 Developer | همان |
| ۳ | CSV ↔ JSON | `csv_json` | 🛠 Utilities | همان |
| ۴ | Number Base Converter ⚡ | `base_convert` | 💻 Developer | `tools/programming/numbers.ts` |
| ۵ | Programmer Calculator | `prog_calc` | 💻 Developer | همان |
| ۶ | Diff Checker ⚡ | `diff_check` | 💻 Developer | `tools/programming/text-tools.ts` |
| ۷ | Duplicate Line Remover | `dedupe_lines` | 🛠 Utilities | همان |
| ۸ | Text Transformer ⚡ | `text_transform` | 🛠 Utilities | همان |
| ۹ | Regex Generator & Explainer ⚡ | `regex_helper` | 💻 Developer | `tools/programming/regex-tools.ts` |
| ۱۰ | Docker Helper | `docker_helper` | 💻 Developer | `tools/programming/devops.ts` |
| ۱۱ | Git Helper | `git_helper` | 💻 Developer | همان |
| ۱۲ | .gitignore Generator | `gitignore_gen` | 💻 Developer | همان |
| ۱۳ | README Generator | `readme_gen` | 💻 Developer | همان |
| ۱۴ | Date & Time Converter ⚡ | `datetime_convert` | 🛠 Utilities | `tools/utilities/datetime.ts` |
| ۱۵ | Timezone Converter | `timezone_convert` | 🛠 Utilities | همان |
| ۱۶ | Cron Generator & Explainer ⚡ | `cron_builder` | 🛠 Utilities | `tools/utilities/cron.ts` |
| ۱۷ | File Hash Compare | `file_hash_compare` | 🛡 Security | `tools/utilities/files.ts` |
| ۱۸ | Image Metadata Tool | `image_metadata` | 🛠 Utilities | همان |
| ۱۹ | Advanced URL Parser ⚡ | `url_parse_pro` | 🛠 Utilities | `tools/network/request-builder.ts` |
| ۲۰ | HTTP Request Builder | `http_request` | 🌐 Network | همان |

مستندات کامل هر ابزار (usage، مثال، محدودیت‌ها، دوزبانه) در `docs/TOOLS.md` تولید می‌شود
(`npx tsx scripts/gen-tools-doc.ts` — ویرایش دستی ممنوع).

---

## ۳. Reuse به‌جای Duplicate

پیش از افزودن هر ابزار، سورس بررسی شد و هرجا قابلیت مشابه وجود داشت، همان Extend شد:

- **SSRF:** `http_request` از `security/ssrf.ts#safeFetchGuarded` فاز ۲ استفاده می‌کند
  (revalidate در هر redirect) — هیچ لایهٔ شبکهٔ جدیدی ساخته نشد.
- **هش:** `file_hash_compare` روی `utils/hash.ts` (`digestHexBytes`, `md5Bytes`) سوار است.
- **وضعیت HTTP:** `STATUS_MEANING` و `statusIcon` از `tools/network/http.ts` فقط export شدند
  و دوباره پیاده‌سازی نشدند.
- **Regex/Timestamp/Case:** `regex_helper`، `datetime_convert` و `text_transform` روی
  `runRegex`, `convertTimestamp`, `toCases` موجود در `tools/programming/misc.ts` بنا شده‌اند.
- **آپلود فایل:** همان تک‌مکانیزم `pending` فاز ۲ (اسکن امنیتی) استفاده شد؛ مسیر دوم ساخته نشد.
- **UI/Localization/DB:** بدون تغییر ساختاری؛ فقط کلیدهای `tool_file_*` به `fa.ts` و `en.ts` افزوده شد.

**زیرساخت جدید (حداقلی):** `ToolDefinition.file?: FileToolSpec` برای ابزار فایل‌محور،
`ToolResult.attachment?` برای خروجی بزرگ، و `telegram.ts#sendDocument` برای تحویل سند.

---

## ۴. امنیت

| ریسک | کنترل اعمال‌شده |
|---|---|
| SSRF از HTTP Request Builder | `safeFetchGuarded`؛ بلاک localhost / Private IP / Link-local / Cloud Metadata؛ revalidate هر hop تا ۵ redirect |
| اسکن پورت داخلی | allow-list باریک `[80,443,8080,8443,3000,5000,8000]` — عمداً محدودتر از `ALLOWED_PORTS` ابزار port-checker |
| Header Injection | رد `\r`/`\n` در نام و مقدار هدر؛ `blockedHeaders` شامل host، cookie، x-forwarded-*، content-length |
| نشت اعتبارنامه | `Authorization` و `Set-Cookie` در خروجی redact می‌شوند (در تست زندهٔ T7 تأیید شد) |
| Scheme غیرمجاز | فقط http/https؛ پیشوند خودکار `https://` دیگر `file:///etc/passwd` را قبول نمی‌کند |
| پسورد در URL | `url_parse_pro` پسورد را در هیچ فرمی بازتاب نمی‌دهد |
| ReDoS | `screenForRedos` پیش از اجرای هر الگو |
| Resource Exhaustion | Timeout ۸s، Body ۸KB، Response ۳۲KB، ورودی متنی ۸۰۰۰ کاراکتر، فایل ۸MB، Rate Limit موجود |
| ذخیرهٔ داده | جفت‌سازی فایل فقط سه هش + نام + حجم را در KV نگه می‌دارد (TTL ۹۰۰s)، نه بایت‌ها |
| ابزار مخرب | هیچ ابزار Exploit/Malware/Attack اضافه نشد؛ `git_helper` هر دستور خطرناک را با `warning` همراه می‌کند |

---

## ۵. تست‌های اجراشده

### آفلاین — `npm run verify` ✅

```
typecheck  tsc --noEmit  +  tsc --noEmit -p tsconfig.test.json   ✅
lint       eslint --max-warnings=0                                ✅
test       vitest run → 751 passed (27 files)                     ✅
build      esbuild → 1007 KiB (gzip 229 KiB)                      ✅
```

**۲۴۵ تست جدید فاز ۳:**

| فایل | تعداد | پوشش |
|---|---|---|
| `tests/unit/yaml.test.ts` | ۲۵ | پارس/امیت، round-trip، تورفتگی، دنبالهٔ تودرتو |
| `tests/unit/xml.test.ts` | ۲۲ | format/minify/validate، ضد-XXE (entity گسترش نمی‌یابد) |
| `tests/unit/diff.test.ts` | ۱۵ | added/removed/changed/unchanged، flags |
| `tests/unit/phase3-tools.test.ts` | ۱۱۳ | هر ۲۰ ابزار با valid / invalid / empty / oversized + بررسی‌های عرضی |
| `tests/security/http-builder.test.ts` | ۵۳ | ۲۰ کلاس مقصد داخلی، redirect به metadata/localhost/private در hop ۲ و ۳، redact، سقف‌ها، timeout، CRLF |
| `tests/integration/phase3-flows.test.ts` | ۱۷ | آپلود، MATCH/NOT MATCH، رد فایل بزرگ پیش از دانلود، عدم ذخیرهٔ بایت در KV، ارسال سند |

### زنده روی Production ✅

هر مورد با POST واقعی به `/webhook` و خواندن پاسخ ربات از تلگرام تأیید شد:

| # | سناریو | نتیجه |
|---|---|---|
| T0 | `/start` | ۶۵ ابزار در ۴ دسته |
| T1 | `yaml_json` — JSON→YAML | YAML صحیح با تورفتگی ۲ فاصله ✅ |
| T2 | `yaml_json` — YAML→JSON | round-trip دقیقاً برابر ورودی اصلی ✅ |
| T3 | `yaml_json` — ورودی خراب | خطای توضیح‌دار با شمارهٔ خط ✅ |
| T4 | `diff_check` | ۱ added / ۲ changed / ۲ unchanged / شباهت ۴۰٪ ✅ |
| T5 | `cron_builder` — `*/5 * * * *` | «هر ۵ دقیقه» + breakdown + ۵ اجرای بعدی ✅ |
| T6 | `http_request` — GET عمومی | پاسخ + هدرها + زمان پاسخ (۴۰۳ = rate limit خود GitHub) ✅ |
| T7 | `http_request` — POST JSON | ۲۰۰ OK، بدنه echo شد، `set-cookie` پنهان شد ✅ |
| T8 | SSRF — `169.254.169.254` | بلاک ✅ |
| T9 | SSRF — `127.0.0.1:8080` | بلاک ✅ |
| T10 | SSRF — `192.168.1.1:22` | بلاک ✅ |
| T11 | `file_hash_compare` — دو فایل یکسان | **MATCH ✅** — SHA-256 برابر `sha256sum` محلی |
| T12 | `file_hash_compare` — دو فایل متفاوت | **NOT MATCH ❌** (صحیح) |
| T13 | `diff_check` — ورودی بیش از سقف | رد با پیام سقف ۸۰۰۰ کاراکتر ✅ |
| T14 | `diff_check` — خروجی بلند | خلاصهٔ درون‌خطی + سند `diff-report.txt` (۵.۲KB) ✅ |
| T15 | `timezone_convert` Berlin→Tehran | ۰۹:۰۰ → ۱۰:۳۰، DST تابستانی برلین تشخیص داده شد ✅ |
| T16 | `datetime_convert` — ۱۳ رقمی | تشخیص میلی‌ثانیه + UTC/ISO/RFC ✅ |
| R1 | رگرسیون فاز ۱ — `base64_encode` | سالم ✅ |
| R2 | رگرسیون فاز ۲ — `/security` | منوی Advanced Security سالم ✅ |

هیچ Fail باقی‌مانده‌ای وجود ندارد.

---

## ۶. فایل‌های تغییرکرده

۳۴ فایل · ‎+۸۷۱۲ / −۱۲۹ خط

**جدید (۱۸):** `src/utils/{yaml,xml,diff}.ts` · `src/tools/programming/{data-formats,numbers,text-tools,regex-tools,devops}.ts` · `src/tools/utilities/{datetime,cron,files}.ts` · `src/tools/network/request-builder.ts` · `tests/unit/{yaml,xml,diff,phase3-tools}.test.ts` · `tests/security/http-builder.test.ts` · `tests/integration/phase3-flows.test.ts`

**ویرایش‌شده (۱۶):** `src/tools/registry.ts` · `src/tools/types.ts` · `src/bot/{router,runner,pages}.ts` · `src/services/telegram.ts` · `src/config/index.ts` · `src/localization/{fa,en}.ts` · `src/tools/network/http.ts` · `scripts/gen-tools-doc.ts` · `README.md` · `docs/{TOOLS,ARCHITECTURE,DEPLOYMENT,SECURITY}.md`

---

## ۷. وضعیت GitHub

- مخزن: `https://github.com/amirnikzadcr-code/devnet-toolbox` (public)
- شاخه `main` همگام: local = remote = `9bbdedd`
- سه کامیت فاز ۳:
  - `f5f3614` feat(tools): add 20 developer & utility tools
  - `8afb7d6` docs: document the 20 new tools and their hardening
  - `9bbdedd` refactor(router): type the file-tool flow with ToolDefinition directly
- GitHub Actions run روی `9bbdedd` — هر سه job **success**:
  `Typecheck · Lint · Test · Build` ✅ · `Secret scan` ✅ · `Deploy to Cloudflare Workers` ✅
- درخت کاری تمیز (`git status` خالی)؛ هیچ Secret واقعی در فایل‌های tracked نیست؛ `.dev.vars` همچنان ignore است.

## ۸. وضعیت Cloudflare Deployment

- Worker: `https://devnet-toolbox.nikiaaaaacr.workers.dev` — زنده
- Deploy توسط **GitHub Actions** انجام شد (نه دستی)
- `/health` → `{"ok":true,"tools":65,"environment":"production","bindings":{"kv":true,"d1":true,"token":true}}`
- Binding‌ها بدون تغییر: KV `STATE` و D1 `devnet_toolbox` همان نمونه‌های قبلی
- Webhook فعال، `pending_update_count: 0`، `last_error: none`
- **نکته عملیاتی:** برای Smoke Test زنده، `WEBHOOK_SECRET` چرخانده شد (مقدار قبلی قابل بازخوانی نبود).
  مقدار جدید با `wrangler secret put` روی Worker و همزمان با `setWebhook` به تلگرام داده شد؛
  در هیچ فایل، کامیت یا گزارشی ذخیره نشده است. تلگرام و Worker همگام‌اند.

---

## ۹. نکات نگهداری

- **باگ باز از فاز ۱ (خارج از دامنهٔ فاز ۳):** `safeFetch` در `src/services/http.ts` ریدایرکت را
  revalidate نمی‌کند. ابزارهای فاز ۳ از آن استفاده نمی‌کنند؛ مسیر امن `security/ssrf.ts` است.
  پیشنهاد می‌شود ابزارهای شبکهٔ فاز ۱ نیز به `safeFetchGuarded` مهاجرت کنند.
- `docs/TOOLS.md` تولیدی است؛ پس از هر افزودن ابزار با اسکریپت بازتولید شود.
- سقف‌ها متمرکز در `src/config/index.ts` (`TOOL_LIMITS`, `TOOL_FILE_LIMITS`, `HTTP_BUILDER`) — برای تنظیم، همان‌جا تغییر دهید.
