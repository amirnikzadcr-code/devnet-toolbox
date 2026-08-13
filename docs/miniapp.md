# مینی‌اپ تلگرام — DevNet Toolbox

مینی‌اپ گرافیکی که **در کنار** ربات کار می‌کند. هیچ دکمه یا جریان inline ربات
حذف یا جایگزین نشده است؛ اپ فقط یک نقطهٔ ورود اضافه است.

---

## معماری

| جزء | مسیر | آدرس |
|---|---|---|
| ربات (بدون تغییر ساختاری) | `src/` | `devnet-toolbox.nikiaaaaacr.workers.dev` |
| پنل ادمین (بدون تغییر) | `admin/` | `devnet-admin.nikiaaaaacr.workers.dev` |
| **بک‌اند مینی‌اپ** | `app-worker/` | `devnet-app.nikiaaaaacr.workers.dev` |
| **فرانت‌اند مینی‌اپ** | `app/` | همان Worker، از طریق binding `ASSETS` |

مینی‌اپ **Worker چهارم و مستقل** است ولی همان KV (`STATE`) و همان D1
(`devnet_toolbox`) ربات را استفاده می‌کند. یعنی favoriteها، زبان و آمار بین
ربات و اپ کاملاً مشترک‌اند: اگر ابزاری را در ربات ⭐ کنید، در اپ هم ستاره‌دار است.

### چرا Worker جدا؟

درخواست‌های فایل استاتیک در Cloudflare **بدون فراخوانی Worker** از edge سرو
می‌شوند و رایگان و بی‌شمارند. اگر اپ را داخل Worker ربات می‌گذاشتیم، هر بار
باز شدن اپ چند invocation از سهمیهٔ روزانهٔ ربات مصرف می‌کرد. جدا بودن یعنی
بار اپ عملاً روی سهمیهٔ ربات اثری ندارد.

---

## فرانت‌اند

React 19 + TypeScript (strict) + Vite 7 + `motion` برای انیمیشن.

**چرا از Telegram UI Kit استفاده نشد:** بستهٔ `@telegram-apps/telegram-ui`
حجم dist آن **۸.۲ مگابایت** است و عمداً شبیه خود تلگرام طراحی شده. چون
خواستهٔ شما ظاهر اختصاصی و برندشده بود، دیزاین‌سیستم مستقل نوشته شد.

**اندازهٔ بیلد (gzip):**

| chunk | خام | gzip |
|---|---|---|
| `index` | 239.5 kB | **76.4 kB** |
| `motion` | 95.0 kB | 31.4 kB |
| `vendor` | 11.2 kB | 4.0 kB |
| `style` | 10.1 kB | 3.2 kB |
| `index.html` | 0.8 kB | 0.4 kB |
| **مجموع** | | **~115 kB** |

**نکات پیاده‌سازی:**
- فونت **Vazirmatn** self-host شده (`app/public/fonts/`) — بدون وابستگی به CDN
  خارجی هنگام اجرا.
- `hsl(from …)` (relative color) استفاده **نشد**؛ WebView اندروید تلگرام
  پشتیبانی نمی‌کند. رنگ‌ها با `mixHex`/`hueShift` در `src/lib/design.ts` محاسبه
  می‌شوند.
- `overflow:hidden` روی body + `disableVerticalSwipes()` لازم است، وگرنه drag
  رو به پایین باعث بسته شدن اپ می‌شود.
- بازخورد لمسی (haptic) روی همهٔ تعامل‌ها، با version-gate و try/catch تا در
  کلاینت‌های قدیمی خطا ندهد.
- `prefers-reduced-motion` رعایت شده.

---

## امنیت

### احراز هویت
`app-worker/src/auth.ts` — `initData` تلگرام با **HMAC-SHA256** روی Web Crypto
اعتبارسنجی می‌شود (کلید = `HMAC("WebAppData", bot_token)`).

- فیلدهای `hash` و **`signature`** از check string حذف می‌شوند — اگر `signature`
  حذف نشود، اجرا از کلاینت‌های جدید تلگرام شکست می‌خورد.
- مقایسهٔ hash به‌صورت timing-safe.
- سقف عمر ۲۴ ساعت؛ `auth_date` در آینده (skew > ۳۰۰s) رد می‌شود.
- payload بزرگ‌تر از حد، **قبل از** هر عملیات رمزنگاری رد می‌شود.
- نبود `BOT_TOKEN` روی سرور ⇒ fail-closed (نه باز شدن دسترسی).

### XSS
`app-worker/src/sanitize.ts` — خروجی HTML ابزارها با allow-list پاک‌سازی
می‌شود، چون اپ آن را با `dangerouslySetInnerHTML` رندر می‌کند. تگ‌های مجاز
فقط همان‌هایی‌اند که ربات تولید می‌کند (`b/strong/i/em/u/s/code/pre/a/br/…`)؛
هر چیز دیگر به متن escape می‌شود، همهٔ attributeهای رویداد حذف می‌شوند و
`javascript:` / `data:` / `vbscript:` (حتی با control-character مثل
`java<TAB>script:`) رد می‌شوند.

### هدرها
در `app/public/_headers` قرار دارند، نه در کد Worker — چون درخواست asset
اصلاً Worker را صدا نمی‌زند.

⚠️ `frame-ancestors` عمداً دامنه‌های تلگرام را **مجاز** می‌کند. مینی‌اپ در
Desktop و Web داخل iframe متعلق به `telegram.org` اجرا می‌شود، پس
`X-Frame-Options: DENY` باعث صفحهٔ سفید دائمی می‌شد.

### محدودسازی نرخ
هر درخواست API از همان سطل `general` ربات (۴۵ در ۶۰ ثانیه) عبور می‌کند و
`isBanned` هم بررسی می‌شود — کاربر بن‌شده از طریق اپ راه دور نمی‌زند.

---

## تست‌ها

۵۷ تست جدید. مجموع سوییت: **۱۱۲۲ تست در ۴۰ فایل، همه سبز**.

| فایل | تعداد | پوشش |
|---|---|---|
| `tests/unit/miniapp-auth.test.ts` | ۱۶ | امضای معتبر، دستکاری user id، توکن اشتباه، hash گمشده/بدشکل، انقضا، تاریخ آینده، JSON خراب، payload بزرگ، یونیکد فارسی |
| `tests/security/miniapp-sanitize.test.ts` | ۳۴ | ۱۴ payload واقعی XSS، طرح‌های URL خطرناک، nesting مخرب، ورودی خالی/بزرگ |
| `tests/unit/home-keyboard.test.ts` | ۷ | **تضمین حذف‌نشدن دکمه‌های قبلی**، یکتا بودن دکمهٔ web_app، سقف ۶۴ بایت callback |

تست‌های auth امضاها را **واقعاً با Web Crypto می‌سازند** (نه mock)، پس هر
رگرسیون در ساخت HMAC اینجا گیر می‌افتد.

### دو باگ واقعی که همین تست‌ها پیدا کردند

1. **از دست رفتن متن در sanitizer** — محافظ عمق تودرتویی با `break` پیاده شده
   بود و **بقیهٔ ورودی را دور می‌ریخت**. یعنی خروجی یک ابزار می‌توانست بی‌صدا
   ناقص شود. اکنون تگ اضافه نادیده گرفته می‌شود و پردازش ادامه می‌یابد.
2. **هدرهای امنیتی که هرگز اعمال نمی‌شدند** — ابتدا در کد Worker نوشته شده
   بودند، ولی چون asset از edge سرو می‌شود، آن کد هیچ‌وقت اجرا نمی‌شد. با
   `curl` روی production کشف و به `_headers` منتقل شد.

---

## نقاط ورود کاربر

۱. **دکمهٔ منوی چت** (کنار فیلد تایپ) — با `setChatMenuButton` ثبت شد.
۲. **دکمهٔ «🚀 اپلیکیشن»** در بالای کیبورد خانه — بقیهٔ دکمه‌ها سر جای خود.

آدرس اپ از متغیر `APP_URL` در `wrangler.jsonc` خوانده می‌شود؛ اگر تنظیم نباشد
دکمه به‌سادگی نمایش داده نمی‌شود و ربات مثل قبل کار می‌کند.

---

## استقرار

```bash
cd app && npx vite build          # خروجی در app/dist
cd .. && npx wrangler deploy --config app-worker/wrangler.jsonc
```

تنها secret لازم: `BOT_TOKEN` (برای اعتبارسنجی initData).

```bash
npx wrangler secret put BOT_TOKEN --config app-worker/wrangler.jsonc
```
