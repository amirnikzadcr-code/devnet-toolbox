# 🛡️ Advanced Security — گزارش پایانی فاز ۲

پروژه: **DevNet Toolbox** · مخزن: `amirnikzadcr-code/devnet-toolbox` · commit نهایی: `62edf01`
تاریخ: ۲۰۲۶-۰۸-۱۲ · وضعیت: **مستقر و تأییدشده روی Production**

---

## ۱. قابلیت‌های جدید

بخش «🛡️ امنیت پیشرفته» به Toolbox موجود اضافه شد. هیچ قابلیت قبلی بازنویسی یا duplicate نشد و هیچ Secret تازه‌ای لازم نبود.

| # | قابلیت | شرح |
|---|--------|-----|
| ۱ | **تحلیل پیشرفته APK** | Package/Version/SDK، شمارش و نوع Componentها، Exported، Deep Link، Intent Filter، مجوزهای حساس و سفارشی، نشانه‌های Accessibility / Device Admin / Notification Listener / Overlay / Boot / Background Service |
| ۲ | **اندیکاتورهای رفتاری** | ۲۱ قانون روی رشته‌های `classes*.dex`، assets و کتابخانه‌های بومی. خروجی هر مورد: Finding / Evidence / Risk / Confidence / Explanation / Recommendation |
| ۳ | **هوش شبکه APK** | استخراج Domain/URL/IP/Endpoint از کد و اتصال به ماژول شبکه موجود |
| ۴ | **اثر انگشت فایل** | SHA-256 / SHA-1 / MD5 + Size + MIME + Magic Bytes؛ اسکن تکراری با همان هش، نتیجه‌ی قبلی را نشان می‌دهد |
| ۵ | **موتور همبستگی IOC** | نمایش درختی: URLها زیر دامنه‌ی خودشان گروه می‌شوند، با Risk و Confidence برای هر نشانه |
| ۶ | **موتور ریسک مرکزی** | امتیاز explainable با وزن‌دهی بر پایه‌ی Confidence و کاهش تدریجی تکرارها؛ سطوح 🟢🟡🟠🔴⚫ |
| ۷ | **تحلیل فیشینگ** | Punycode، Homograph، Brand Impersonation، Typosquatting، ترفند `@`، Redirect بین‌دامنه‌ای، تنزل HTTPS، فرم ورود، پارامتر حساس، TLD پرریسک |
| ۸ | **اسکنر حریم خصوصی متادیتا** | EXIF/PNG/PDF: GPS، مدل دستگاه، شماره سریال، پدیدآورنده، نرم‌افزار، زمان‌ها |
| ۹ | **اسکنر اعتبارنامه** | ۱۸ الگو (Private Key، Cloud، DB URL، JWT، Bearer، Webhook، npm، Stripe…) — مقدار واقعی **هرگز** نمایش داده نمی‌شود |
| ۱۰ | **ریسک وابستگی‌ها** | پارس ۵ قالب + استعلام زنده از OSV.dev و محاسبه‌ی CVSS v3.1 |
| ۱۱ | **مشاور Hardening** | توصیه‌های دفاعی متناسب با یافته‌ها |
| ۱۲ | **گزارش حرفه‌ای** | Telegram HTML + خروجی Markdown (`renderMarkdown`) |
| ۱۳ | **تاریخچه اسکن** | جدول `security_scans`: Scan ID، Type، Date، Risk، Score، Target Hash |
| ۱۴ | **هشدار امنیتی** | بنر واضح برای HIGH/CRITICAL، با متن متناسب با نوع هدف |
| ۱۵ | **حفاظت از حریم خصوصی** | Mask، عدم ذخیره‌ی فایل/URL/Secret، نگهداری ۹۰ روزه‌ی خلاصه |
| ۱۶ | **حفاظت SSRF** | بلاک localhost/127/10/172.16/192.168/link-local/IPv6/Cloud Metadata + **اعتبارسنجی مجدد هر Redirect** |
| ۱۷ | **داشبورد امنیتی** | شمارش به تفکیک نوع و شدت، ۷ روز اخیر، آخرین اسکن‌ها |

**اصل طراحی:** هرگز صرفاً بر پایه‌ی یک مجوز برچسب Spyware زده نمی‌شود. رسیدن به CRITICAL فقط از راه **همبستگی چند اندیکاتور** ممکن است؛ این قاعده در کد اجرا می‌شود، نه فقط توصیه شده باشد.

---

## ۲. فایل‌های تغییرکرده

**جدید — هسته (`src/security/`, ۴٬۷۹۵ خط):**
`types.ts` · `risk.ts` · `apk.ts` · `behaviour.ts` · `permissions.ts` · `axml.ts` · `zip.ts` · `fingerprint.ts` · `ssrf.ts` · `phishing.ts` · `secrets.ts` · `metadata.ts` · `dependency.ts` · `ioc.ts` · `report.ts` · `scans.ts`

**جدید — یکپارچه‌سازی:** `src/bot/security-ui.ts` · `src/bot/security-flow.ts` · `src/db/scans.ts`

**ویرایش‌شده:** `src/bot/router.ts` (مسیر فایل و callbackها) · `src/bot/ui.ts` (دکمه در Home/Toolbox) · `src/config/index.ts` (`SECURITY_LIMITS` + بودجه‌ی اسکن) · `src/db/schema.sql` (جدول `security_scans`) · `src/localization/{fa,en}.ts` (۴۳ کلید در هر دو زبان) · `src/services/telegram.ts` (`getFile`/`downloadFile`) · `src/services/ratelimit.ts` · `src/types/telegram.ts` (`TgDocument`/`TgPhotoSize`/`TgFile`) · `src/utils/hash.ts`

بدون هیچ وابستگی جدید: پارسر ZIP، دیکودر AXML، دیکودر Punycode و پارسر EXIF همگی از صفر نوشته شدند.

---

## ۳. تست‌ها

| فایل | تعداد |
|------|-------|
| `tests/security/apk-analysis.test.ts` | ۲۵ |
| `tests/security/url-phishing.test.ts` | ۵۱ |
| `tests/security/secrets-metadata.test.ts` | ۴۷ |
| `tests/security/risk-engine.test.ts` | ۴۰ |
| `tests/integration/security-flow.test.ts` | ۲۸ |
| `tests/helpers/apk-builder.ts` | سازنده‌ی APK/AXML مصنوعی |

**نتیجه: ۵۰۶ تست سبز در ۲۱ فایل** (۳۱۵ تست فاز ۱ + ۱۹۱ تست جدید) — typecheck و lint بدون خطا، build موفق (۷۰۹ KiB / gzip ۱۵۹ KiB).

پوشش خواسته‌شده در بند ۱۸: APK معتبر/خراب/خالی/بدون مانیفست/با مجوز حساس/با Component خارجی/بزرگ‌تر از حد · URL معتبر/خراب/redirect/punycode/IP خصوصی/localhost/cloud metadata · فایل با EXIF/بدون متادیتا/MIME جعلی/عدم تطابق magic bytes · Secret شامل private key/JWT/API key/بدون secret · IOC شامل IP/Domain/URL/Hash.

علاوه بر تست‌های خودکار، تحلیلگر روی **APKهای واقعی** (F-Droid ۱۲ مگابایت، Termux ۱۱۵ مگابایت) و **عکس‌های واقعی دارای EXIF/GPS** اجرا شد و استعلام وابستگی روی API زنده‌ی OSV.dev انجام گرفت.

---

## ۴. باگ‌های پیداشده و رفع‌شده

همه‌ی موارد زیر در جریان تست واقعی کشف و رفع شدند:

1. **کد هیچ APK واقعی خوانده نمی‌شد** — سقف ۸ مگابایتی برای هر فایل باعث می‌شد DEXهای ۸.۷ و ۹ مگابایتی خطا بدهند و خطا در `catch` بلعیده شود؛ تحلیل رفتاری عملاً روی هیچ برنامه‌ی واقعی اجرا نمی‌شد.
2. **استخراج رشته در ۴ مگابایت قطع می‌شد** — مخزن رشته‌های DEX *بعد* از بایت‌کد قرار دارد؛ اندازه‌گیری روی فایل واقعی: ۲۹ کیلوبایت رشته به‌جای ۱.۹ مگابایت، و صفر اندیکاتور API.
3. **تشخیص Homograph کد مرده بود** — `new URL()` دامنه را به Punycode تبدیل می‌کند، پس کاراکترهای هم‌شکل هرگز در `hostname` دیده نمی‌شدند. دیکودر کامل RFC 3492 نوشته شد (`аррӏе.com` اکنون تشخیص داده می‌شود).
4. **F-Droid به‌عنوان CRITICAL برچسب می‌خورد** — قانون «ماندگاری مقاوم» با boot+service به‌تنهایی فعال می‌شد (ترکیبی که در بسیاری از برنامه‌های عادی هست). مفهوم `anchor` اضافه شد: مؤلفه‌ی اصلی قانون باید حتماً حاضر باشد.
5. **فهرست بلند مجوزها به‌تنهایی به CRITICAL می‌رسید** — سقف امتیاز برای حالت بدون همبستگی اعمال شد و کاهش تدریجی امتیاز از «شدت» به «دسته+شدت» تغییر کرد.
6. **APK جا زده‌شده به‌جای `invoice.pdf` فقط LOW بود** — شدت اکنون به *ماهیت واقعی* فایل بستگی دارد: کد اجرایی با نام سند = HIGH.
7. **فایل‌های DEX خوانده‌نشده «تحلیل‌شده» شمرده می‌شدند** — شمارش از روی فهرست واقعی خوانده‌شده‌ها انجام شد.
8. **درخت IOC دامنه‌ی مشترک را حذف می‌کرد** — چند URL هم‌دامنه به‌صورت یتیم نمایش داده می‌شدند و همان ارتباطی که هدف این درخت است پنهان می‌شد.
9. **گزارش IOC متناقض بود** — نشانه‌های 🟡 فهرست می‌شدند اما حکم کلی 🟢 SAFE بود.
10. **هشدار بحرانی برای کلید AWS می‌گفت «نصب نکنید»** — متن هشدار اکنون متناسب با نوع هدف است (کلید را باطل کنید، لینک را باز نکنید…).
11. **`ExposureTime` به‌عنوان زمان ساخت فایل گزارش می‌شد** — regex بیش از حد عمومی بود.
12. **الگوهای تست شبیه Secret واقعی، push را بلاک کردند** — GitHub Push Protection درست عمل کرد؛ fixtureها اکنون در زمان اجرا از قطعات ساخته می‌شوند.
13. سه خطای typecheck (`TextDecoder`, `ScoreStep.detail`, `chain`) و یک خطای lint (عبارت مرده در `axml.ts`).

**نکته‌ی مثبت:** یک دانلود ناقص ۴۳ مگابایتی از Termux توسط پارسر ZIP رد شد — `zipfile` پایتون هم همان فایل را نامعتبر دانست، یعنی رد کردن **درست** بود، نه باگ.

---

## ۵. وضعیت استقرار

| مرحله | نتیجه |
|-------|-------|
| Run Tests | ✅ ۵۰۶ تست در ۲۱ فایل |
| Type Check | ✅ بدون خطا (`src` و `tests`) |
| Lint | ✅ `--max-warnings=0` |
| Security Tests | ✅ SSRF (۳۰ حالت) + عدم نشت Secret |
| Build | ✅ ۷۰۹ KiB / gzip ۱۵۹ KiB |
| بررسی نشت Secret | ✅ هیچ‌کدام از مقادیر واقعی در سورس/گزارش/commit نیست |
| Git Commit + Push | ✅ `62edf01` روی `main` |
| GitHub Actions | ✅ success |
| Deploy به همان محیط Cloudflare | ✅ Version `04259ddd` |
| Production Test | ✅ زیر |

پیکربندی Cloudflare، Webhook، KV و D1 دست‌نخورده باقی ماند؛ تنها تغییر زیرساختی، افزودن جدول `security_scans` بود.

### تست زنده روی Production

- **APK:** فایل واقعی از طریق Telegram آپلود و دانلود شد → `com.suspicious.tracker` با حکم ⚫ CRITICAL و همبستگی «تروجان بانکی» (Overlay + Accessibility).
- **URL:** `xn--80ak6aa92e.com` دیکود شد به `аррӏе.com` با توضیح «در نگاه اول apple.com خوانده می‌شود» → ⚫ CRITICAL.
- **SSRF:** `169.254.169.254` رد شد با پیام روشن، بدون نشان دادن نتیجه‌ی جعلی سالم.
- **Secret:** کلید AWS با ماسک `AKI•••••••••••••••LE (20 chars)` گزارش شد؛ مقدار کامل در پیام و در پایگاه‌داده وجود ندارد.
- **Metadata:** عکس واقعی Nikon → مختصات `43.467448, 11.885127` استخراج شد (🔴 HIGH).
- **Dependency:** `lodash@4.17.11` و `minimist@0.0.8` با شناسه‌های واقعی GHSA از OSV.dev.
- **History/Dashboard:** ۷ اسکن، توزیع ریسک و آخرین موارد به‌درستی نمایش داده شد.
- بررسی مستقیم D1 تأیید کرد ذخیره‌سازی فقط شامل هش و برچسب کوتاه است (`*.jpg`، `text input`) — نه URL، نه نام فایل، نه Secret.

---

*در این گزارش هیچ Token، API Key یا Secret درج نشده است.*
