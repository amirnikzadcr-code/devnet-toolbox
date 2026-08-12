/**
 * APK Behavioural Indicators (requirement 2) and Network Intelligence
 * (requirement 3).
 *
 * Works on the printable strings inside `classes*.dex`, native libraries and
 * assets. Every rule is evidence-based: the matched literal is quoted back to
 * the user, so a finding can always be verified rather than trusted.
 *
 * Confidence is intentionally moderate here (55–85). A string match proves the
 * symbol exists in the binary, not that it is reached at runtime — a bundled
 * SDK can drag in `DexClassLoader` without the app ever calling it. The
 * explanations say so, and the risk engine weights the score accordingly.
 */
import type { Finding, Ioc, Severity } from './types.js';
import type { ZipReader } from './zip.js';
import { binaryStrings, extractIocs, isBenignHost } from './ioc.js';
import { SECURITY_LIMITS } from '../config/index.js';

export interface BehaviourRule {
  id: string;
  category: Finding['category'];
  severity: Severity;
  confidence: number;
  /** Literal substrings; a match on any of them triggers the rule. */
  needles: string[];
  /** How many *distinct* needles must match before the rule fires. */
  minDistinct?: number;
  /**
   * Finding ids from the manifest analysis that must also be present.
   *
   * A DEX contains every bundled library, so a string match proves only that
   * *some* dependency references an API — `AccessibilityNodeInfo` ships inside
   * AndroidX and appears in a large share of ordinary apps. Requiring the
   * matching manifest declaration (or permission) turns "a library mentions
   * this" into "this app is actually equipped to do it", which is the
   * difference between a rumour and evidence.
   */
  requiresManifest?: string[];
  title: { fa: string; en: string };
  explanation: { fa: string; en: string };
  recommendation?: { fa: string; en: string };
}

export const BEHAVIOUR_RULES: BehaviourRule[] = [
  // ── Dynamic code loading
  {
    id: 'apk.behaviour.dynamic_load',
    category: 'dynamic-code',
    severity: 'high',
    confidence: 75,
    needles: ['Ldalvik/system/DexClassLoader', 'Ldalvik/system/PathClassLoader', 'Ldalvik/system/InMemoryDexClassLoader', 'Ldalvik/system/BaseDexClassLoader', 'dalvik.system.DexFile', 'loadDex', 'openDexFile'],
    title: { fa: 'بارگذاری کد در زمان اجرا', en: 'Runtime code loading' },
    explanation: {
      fa: 'برنامه از APIهای بارگذاری کلاس پویا استفاده می‌کند. این یعنی بخشی از کد اجرایی می‌تواند خارج از فایل APK باشد و پس از نصب دانلود شود — بنابراین تحلیل ایستا نمی‌تواند رفتار کامل برنامه را ببیند. برخی کتابخانه‌های به‌روزرسانی و افزونه‌ها نیز به‌طور قانونی از این روش استفاده می‌کنند.',
      en: 'The app references dynamic class-loading APIs, meaning part of its executable code can live outside the APK and be fetched after installation — so static analysis cannot see the app’s full behaviour. Some legitimate plug-in and update frameworks also use this.',
    },
    recommendation: {
      fa: 'برای این برنامه تحلیل پویا (اجرا در محیط ایزوله و پایش ترافیک) لازم است.',
      en: 'Dynamic analysis (sandboxed execution with traffic monitoring) is needed for this app.',
    },
  },
  {
    id: 'apk.behaviour.reflection',
    category: 'obfuscation',
    severity: 'low',
    confidence: 55,
    needles: ['Ljava/lang/reflect/Method', 'getDeclaredMethod', 'setAccessible', 'forName', 'invoke'],
    minDistinct: 3,
    title: { fa: 'استفاده گسترده از Reflection', en: 'Heavy use of reflection' },
    explanation: {
      fa: 'برنامه به‌طور گسترده از Reflection استفاده می‌کند تا متدها را با نام فراخوانی کند. این روش در فریم‌ورک‌های رایج طبیعی است، اما همچنین برای پنهان کردن فراخوانی APIهای حساس از ابزارهای تحلیل ایستا به کار می‌رود.',
      en: 'The app makes extensive use of reflection to invoke methods by name. This is normal in mainstream frameworks, but it is also used to hide sensitive API calls from static analysis tools.',
    },
  },
  {
    id: 'apk.behaviour.native_exec',
    category: 'dynamic-code',
    severity: 'medium',
    confidence: 70,
    needles: ['Ljava/lang/Runtime;->exec', 'getRuntime', '/system/bin/sh', '/system/bin/su', 'ProcessBuilder'],
    minDistinct: 2,
    title: { fa: 'اجرای فرمان سیستمی', en: 'System command execution' },
    explanation: {
      fa: 'نشانه‌های اجرای فرمان پوسته (shell) دیده می‌شود. برنامه‌های عادی به‌ندرت به این کار نیاز دارند؛ این قابلیت می‌تواند برای اجرای ابزارهای کمکی یا دستورات دلخواه استفاده شود.',
      en: 'Indicators of shell command execution are present. Ordinary apps rarely need this; the capability can be used to run helper binaries or arbitrary commands.',
    },
  },
  {
    id: 'apk.behaviour.root_check',
    category: 'dynamic-code',
    severity: 'medium',
    confidence: 70,
    needles: ['/system/app/Superuser.apk', 'com.noshufou.android.su', 'eu.chainfire.supersu', 'com.topjohnwu.magisk', 'test-keys', 'busybox', '/sbin/su', '/system/xbin/su'],
    minDistinct: 2,
    title: { fa: 'بررسی روت بودن دستگاه', en: 'Root detection' },
    explanation: {
      fa: 'برنامه بررسی می‌کند که دستگاه روت شده است یا نه. برنامه‌های بانکی این کار را برای محافظت انجام می‌دهند؛ بدافزارها نیز از آن برای تشخیص محیط تحلیل و تغییر رفتار استفاده می‌کنند.',
      en: 'The app checks whether the device is rooted. Banking apps do this defensively; malware also uses it to detect analysis environments and change behaviour.',
    },
  },
  {
    id: 'apk.behaviour.emulator_check',
    category: 'obfuscation',
    severity: 'medium',
    confidence: 70,
    needles: ['generic_x86', 'goldfish', 'ranchu', 'vbox86', 'ro.kernel.qemu', 'Genymotion', 'sdk_gphone', 'isEmulator'],
    minDistinct: 2,
    title: { fa: 'تشخیص شبیه‌ساز (ضد تحلیل)', en: 'Emulator detection (anti-analysis)' },
    explanation: {
      fa: 'برنامه تلاش می‌کند تشخیص دهد در شبیه‌ساز اجرا می‌شود. این یک تکنیک ضد تحلیل رایج است: بدافزار در محیط آزمایشگاهی رفتار بی‌خطر نشان می‌دهد و فقط روی دستگاه واقعی فعال می‌شود.',
      en: 'The app tries to detect whether it runs in an emulator. This is a common anti-analysis technique: malware behaves harmlessly in a lab and only activates on a real device.',
    },
  },
  {
    id: 'apk.behaviour.debugger_check',
    category: 'obfuscation',
    severity: 'low',
    confidence: 60,
    needles: ['isDebuggerConnected', 'Ldalvik/system/VMDebug', 'TracerPid'],
    title: { fa: 'تشخیص اشکال‌زدا', en: 'Debugger detection' },
    explanation: {
      fa: 'برنامه حضور اشکال‌زدا را بررسی می‌کند — هم در محافظت از کد تجاری رایج است و هم در بدافزارها برای مقاومت در برابر تحلیل.',
      en: 'The app checks for an attached debugger — common both in commercial code protection and in malware resisting analysis.',
    },
  },
  // ── Data collection
  {
    id: 'apk.behaviour.device_id',
    category: 'data-collection',
    severity: 'medium',
    confidence: 65,
    needles: ['getDeviceId', 'getSubscriberId', 'getSimSerialNumber', 'getImei', 'ANDROID_ID', 'getMacAddress', 'getSerial'],
    minDistinct: 2,
    title: { fa: 'جمع‌آوری شناسه‌های یکتای دستگاه', en: 'Collection of persistent device identifiers' },
    explanation: {
      fa: 'برنامه شناسه‌های پایدار دستگاه (مانند IMEI، شماره سریال سیم‌کارت یا MAC) را می‌خواند. این شناسه‌ها با پاک کردن داده‌ها یا نصب مجدد تغییر نمی‌کنند و امکان ردیابی دائمی کاربر را فراهم می‌کنند.',
      en: 'The app reads persistent device identifiers (IMEI, SIM serial, MAC). These survive data wipes and reinstalls, enabling permanent user tracking.',
    },
    recommendation: {
      fa: 'برنامه‌های مدرن باید از شناسه‌های قابل بازنشانی مانند Advertising ID استفاده کنند.',
      en: 'Modern apps should use resettable identifiers such as the Advertising ID.',
    },
  },
  {
    id: 'apk.behaviour.contacts_read',
    category: 'data-collection',
    severity: 'medium',
    confidence: 70,
    needles: ['content://com.android.contacts', 'ContactsContract', 'content://sms', 'content://call_log'],
    requiresManifest: ['apk.perm.read_contacts', 'apk.perm.read_sms', 'apk.perm.read_call_log'],
    title: { fa: 'خواندن مستقیم پایگاه‌داده‌های شخصی', en: 'Direct access to personal databases' },
    explanation: {
      fa: 'ارجاع مستقیم به ContentProviderهای مخاطبان، پیامک یا تاریخچه تماس دیده می‌شود. یعنی برنامه فقط مجوز را نگرفته، بلکه کدی برای خواندن واقعی این داده‌ها دارد.',
      en: 'Direct references to the contacts, SMS or call-log content providers are present. The app does not merely hold the permission — it contains code to actually read this data.',
    },
  },
  {
    id: 'apk.behaviour.clipboard',
    category: 'data-collection',
    severity: 'medium',
    confidence: 60,
    needles: ['ClipboardManager', 'OnPrimaryClipChangedListener', 'getPrimaryClip'],
    minDistinct: 2,
    title: { fa: 'پایش کلیپ‌بورد', en: 'Clipboard monitoring' },
    explanation: {
      fa: 'برنامه به محتوای کلیپ‌بورد گوش می‌دهد. کاربران اغلب رمز عبور و آدرس کیف‌پول ارز دیجیتال را کپی می‌کنند؛ پایش کلیپ‌بورد روش شناخته‌شده‌ی سرقت این داده‌ها است.',
      en: 'The app listens to clipboard content. Users routinely copy passwords and crypto-wallet addresses; clipboard monitoring is a known method of stealing them.',
    },
  },
  {
    id: 'apk.behaviour.screen_capture',
    category: 'data-collection',
    severity: 'high',
    confidence: 65,
    needles: ['MediaProjection', 'createVirtualDisplay', 'ImageReader', 'MediaRecorder;->setVideoSource'],
    minDistinct: 3,
    title: { fa: 'ضبط تصویر صفحه', en: 'Screen capture capability' },
    explanation: {
      fa: 'نشانه‌های استفاده از MediaProjection برای ضبط تصویر صفحه دیده می‌شود. این قابلیت در برنامه‌های ضبط صفحه طبیعی است، اما در سایر برنامه‌ها امکان مشاهده‌ی همه‌چیز روی نمایشگر را می‌دهد.',
      en: 'Indicators of MediaProjection screen recording are present. Normal in screen-recorder apps; in anything else it allows watching everything on the display.',
    },
  },
  {
    id: 'apk.behaviour.keylog',
    category: 'data-collection',
    severity: 'high',
    confidence: 60,
    needles: ['TYPE_VIEW_TEXT_CHANGED', 'AccessibilityNodeInfo', 'getRootInActiveWindow', 'ACTION_ACCESSIBILITY_FOCUS'],
    minDistinct: 2,
    requiresManifest: ['apk.service.accessibility'],
    title: { fa: 'خواندن محتوای صفحه از طریق Accessibility', en: 'Reading screen content via accessibility APIs' },
    explanation: {
      fa: 'برنامه از APIهایی استفاده می‌کند که محتوای درخت رابط کاربری و تغییرات متن را می‌خوانند. این دقیقاً مکانیزمی است که یک کی‌لاگر برای ثبت آنچه کاربر تایپ می‌کند به آن نیاز دارد.',
      en: 'The app uses APIs that read the UI tree and text-change events — precisely the mechanism a keylogger needs to record what the user types.',
    },
  },
  // ── Persistence / background execution
  {
    id: 'apk.behaviour.background_work',
    category: 'persistence',
    severity: 'low',
    confidence: 60,
    needles: ['JobScheduler', 'WorkManager', 'AlarmManager', 'setRepeating', 'setExactAndAllowWhileIdle', 'startForegroundService'],
    minDistinct: 2,
    title: { fa: 'زمان‌بندی اجرای پس‌زمینه', en: 'Scheduled background execution' },
    explanation: {
      fa: 'برنامه کارهای زمان‌بندی‌شده در پس‌زمینه اجرا می‌کند. برای همگام‌سازی داده رایج است، اما امکان فعالیت مداوم بدون باز بودن برنامه را نیز فراهم می‌کند.',
      en: 'The app schedules background work. Common for data sync, but it also enables continuous activity while the app is closed.',
    },
  },
  {
    id: 'apk.behaviour.hide_icon',
    category: 'persistence',
    severity: 'high',
    confidence: 70,
    needles: ['setComponentEnabledSetting', 'COMPONENT_ENABLED_STATE_DISABLED'],
    minDistinct: 2,
    title: { fa: 'پنهان‌سازی آیکون برنامه', en: 'App icon hiding' },
    explanation: {
      fa: 'برنامه می‌تواند کامپوننت راه‌انداز خود را غیرفعال کند و آیکونش را از صفحه‌ی برنامه‌ها حذف کند. هیچ برنامه‌ی سالمی نیازی به مخفی شدن از کاربر ندارد؛ این رفتار مشخصه‌ی stalkerware است.',
      en: 'The app can disable its launcher component and disappear from the app drawer. No legitimate app needs to hide from its user; this is a hallmark of stalkerware.',
    },
    recommendation: {
      fa: 'اگر آیکونی پس از نصب ناپدید شد، برنامه را از مسیر تنظیمات ← برنامه‌ها حذف کنید.',
      en: 'If an icon disappears after installation, uninstall the app via Settings → Apps.',
    },
  },
  {
    id: 'apk.behaviour.uninstall_block',
    category: 'persistence',
    severity: 'high',
    confidence: 65,
    needles: ['DevicePolicyManager', 'lockNow', 'resetPassword', 'wipeData', 'addUserRestriction'],
    minDistinct: 2,
    requiresManifest: ['apk.service.device_admin'],
    title: { fa: 'کنترل سیاست دستگاه', en: 'Device policy control' },
    explanation: {
      fa: 'برنامه از APIهای مدیریت سیاست دستگاه استفاده می‌کند که می‌توانند دستگاه را قفل کنند، رمز را بازنشانی کنند یا داده‌ها را پاک کنند. خارج از نرم‌افزارهای مدیریت سازمانی، این سطح از اختیار غیرعادی است.',
      en: 'The app uses device-policy APIs able to lock the device, reset the password, or wipe data. Outside enterprise management software this level of control is abnormal.',
    },
  },
  // ── Obfuscation & packing
  {
    id: 'apk.behaviour.packer',
    category: 'obfuscation',
    severity: 'medium',
    confidence: 80,
    needles: ['libjiagu', 'libDexHelper', 'libsecexe', 'libshella', 'libprotectClass', 'libtup', 'libnesec', 'libapp-protect', 'com.secneo', 'com.qihoo.util', 'libmobisec'],
    title: { fa: 'استفاده از Packer تجاری', en: 'Commercial packer detected' },
    explanation: {
      fa: 'برنامه با یک ابزار تجاری «packing» محافظت شده است؛ کد اصلی رمزنگاری شده و فقط در زمان اجرا باز می‌شود. توسعه‌دهندگان برای محافظت از مالکیت فکری از این ابزارها استفاده می‌کنند، اما همین روش تحلیل ایستا را عملاً ناممکن می‌کند و در بدافزارها بسیار رایج است.',
      en: 'The app is protected by a commercial packer; the real code is encrypted and only unpacked at runtime. Developers use these to protect intellectual property, but the same technique makes static analysis effectively impossible and is very common in malware.',
    },
    recommendation: {
      fa: 'نتایج این تحلیل ایستا برای برنامه‌های packed ناقص است؛ به منبع دانلود بیشتر اتکا کنید.',
      en: 'Static results are incomplete for packed apps; rely more on the download source’s reputation.',
    },
  },
  {
    id: 'apk.behaviour.crypto_strings',
    category: 'obfuscation',
    severity: 'low',
    confidence: 55,
    needles: ['AES/ECB/PKCS5Padding', 'AES/CBC/PKCS5Padding', 'javax/crypto/Cipher', 'SecretKeySpec', 'Base64;->decode'],
    minDistinct: 3,
    title: { fa: 'رمزگشایی رشته‌ها در زمان اجرا', en: 'Runtime string decryption' },
    explanation: {
      fa: 'ترکیب رمزنگاری متقارن و رمزگشایی Base64 معمولاً یعنی رشته‌های حساس (مانند آدرس سرور) در کد رمزنگاری شده‌اند تا در تحلیل ایستا دیده نشوند. البته رمزنگاری داده‌ی کاربر نیز کاملاً مشروع است.',
      en: 'Symmetric crypto combined with Base64 decoding often means sensitive strings (such as server addresses) are encrypted to hide them from static analysis. Legitimate user-data encryption looks the same, though.',
    },
  },
  {
    id: 'apk.behaviour.weak_crypto',
    category: 'integrity',
    severity: 'medium',
    confidence: 70,
    needles: ['AES/ECB', 'DES/', 'MD5', 'SHA-1', 'RC4'],
    minDistinct: 2,
    title: { fa: 'الگوریتم رمزنگاری ضعیف', en: 'Weak cryptographic algorithms' },
    explanation: {
      fa: 'ارجاع به الگوریتم‌های منسوخ (ECB، DES، RC4، MD5) دیده می‌شود. این الگوریتم‌ها امروزه برای محافظت از داده‌ی حساس امن محسوب نمی‌شوند.',
      en: 'References to deprecated algorithms (ECB, DES, RC4, MD5) are present. These are no longer considered safe for protecting sensitive data.',
    },
    recommendation: {
      fa: 'استفاده از AES-GCM و SHA-256 توصیه می‌شود.',
      en: 'AES-GCM and SHA-256 are recommended instead.',
    },
  },
  {
    id: 'apk.behaviour.trust_all_certs',
    category: 'network',
    severity: 'high',
    confidence: 70,
    needles: ['ALLOW_ALL_HOSTNAME_VERIFIER', 'checkServerTrusted', 'X509TrustManager', 'setHostnameVerifier', 'NullHostNameVerifier'],
    minDistinct: 2,
    title: { fa: 'احتمال غیرفعال بودن اعتبارسنجی گواهی TLS', en: 'Possible TLS certificate validation bypass' },
    explanation: {
      fa: 'نشانه‌های پیاده‌سازی سفارشی TrustManager یا HostnameVerifier دیده می‌شود. اگر این پیاده‌سازی همه‌ی گواهی‌ها را بپذیرد، ارتباط برنامه در برابر حمله‌ی مرد میانی آسیب‌پذیر می‌شود. تشخیص قطعی نیازمند بررسی بدنه‌ی متد است.',
      en: 'Indicators of a custom TrustManager or HostnameVerifier are present. If the implementation accepts all certificates, the app’s traffic becomes vulnerable to man-in-the-middle attacks. Confirming this requires inspecting the method body.',
    },
  },
  {
    id: 'apk.behaviour.webview_js',
    category: 'network',
    severity: 'medium',
    confidence: 60,
    needles: ['addJavascriptInterface', 'setJavaScriptEnabled', 'loadUrl', 'shouldOverrideUrlLoading'],
    minDistinct: 3,
    title: { fa: 'پل جاوااسکریپت در WebView', en: 'JavaScript bridge in WebView' },
    explanation: {
      fa: 'برنامه یک رابط جاوااسکریپت در WebView تعریف می‌کند. اگر محتوای بارگذاری‌شده از منبع غیرقابل‌اعتماد یا روی HTTP باشد، صفحه‌ی وب می‌تواند متدهای بومی برنامه را فراخوانی کند.',
      en: 'The app exposes a JavaScript interface in a WebView. If the loaded content is untrusted or served over HTTP, the web page can invoke the app’s native methods.',
    },
  },
  {
    id: 'apk.behaviour.sms_send',
    category: 'data-collection',
    severity: 'high',
    confidence: 70,
    needles: ['SmsManager', 'sendTextMessage', 'sendMultipartTextMessage'],
    minDistinct: 2,
    requiresManifest: ['apk.perm.send_sms'],
    title: { fa: 'ارسال برنامه‌ای پیامک', en: 'Programmatic SMS sending' },
    explanation: {
      fa: 'برنامه کدی برای ارسال پیامک بدون دخالت کاربر دارد. این روش کلاسیک بدافزارهای «SMS premium» برای ایجاد هزینه روی خط کاربر است.',
      en: 'The app contains code to send SMS without user interaction — the classic mechanism of premium-SMS fraud that bills the victim’s line.',
    },
  },
  {
    id: 'apk.behaviour.crypto_wallet',
    category: 'data-collection',
    severity: 'medium',
    confidence: 55,
    needles: ['bitcoin:', 'ethereum:', 'walletconnect', 'metamask', 'seed phrase', 'mnemonic'],
    minDistinct: 3,
    title: { fa: 'ارجاع به کیف‌پول ارز دیجیتال', en: 'Cryptocurrency wallet references' },
    explanation: {
      fa: 'رشته‌های مرتبط با کیف‌پول ارز دیجیتال و عبارات بازیابی دیده می‌شود. در برنامه‌های مالی طبیعی است؛ در سایر برنامه‌ها می‌تواند نشانه‌ی هدف‌گیری دارایی‌های دیجیتال باشد.',
      en: 'Strings related to crypto wallets and recovery phrases are present. Expected in finance apps; elsewhere it can indicate targeting of digital assets.',
    },
  },
];

/** Native library findings are derived from file names, not strings. */
function nativeLibFindings(analysis: { nativeLibs: string[] }): Finding[] {
  if (analysis.nativeLibs.length === 0) return [];
  const abis = [...new Set(analysis.nativeLibs.map((path) => path.split('/')[1] ?? '?'))];
  const names = [...new Set(analysis.nativeLibs.map((path) => path.split('/').pop() ?? path))];
  return [
    {
      id: 'apk.behaviour.native_lib',
      category: 'dynamic-code',
      severity: 'low',
      confidence: 100,
      title: { fa: 'کتابخانه‌های بومی (Native)', en: 'Native libraries bundled' },
      evidence: [`ABIs: ${abis.join(', ')}`, ...names.slice(0, 6)],
      explanation: {
        fa: `${names.length} کتابخانه‌ی بومی برای معماری‌های ${abis.join('، ')} همراه برنامه است. کد بومی خارج از ماشین مجازی اندروید اجرا می‌شود و در تحلیل ایستای Java/DEX دیده نمی‌شود؛ منطق حساس می‌تواند در همین‌جا پنهان شده باشد.`,
        en: `${names.length} native libraries for ${abis.join(', ')} are bundled. Native code runs outside the Android VM and is invisible to Java/DEX static analysis; sensitive logic can be hidden there.`,
      },
    },
  ];
}

export interface StringSweepResult {
  findings: Finding[];
  iocs: Ioc[];
  /** Bytes actually scanned — reported so the user knows the coverage. */
  scannedBytes: number;
  /** True when analysis stopped early because of the size budget. */
  truncated: boolean;
}

/** Files worth sweeping, in priority order. */
const SWEEP_PRIORITY = (name: string): number => {
  if (/^classes\d*\.dex$/.test(name)) return 0;
  if (name.startsWith('assets/') && /\.(json|xml|txt|js|properties|cfg|conf)$/i.test(name)) return 1;
  if (name === 'res/xml/network_security_config.xml') return 1;
  if (name.startsWith('lib/') && name.endsWith('.so')) return 2;
  return 99;
};

/**
 * Reads the interesting entries, extracts strings, applies the rule set and
 * harvests network IOCs.
 *
 * @param budgetBytes total inflated bytes allowed across all entries.
 */
export async function sweepApkStrings(
  zip: ZipReader,
  analysis: { nativeLibs: string[]; files: string[] },
  /** Manifest finding ids, used to corroborate string matches. */
  manifestFindingIds: ReadonlySet<string> = new Set(),
  budgetBytes = SECURITY_LIMITS.apkSweepBudget,
): Promise<StringSweepResult> {
  const candidates = analysis.files
    .map((name) => ({ name, priority: SWEEP_PRIORITY(name) }))
    .filter((item) => item.priority < 99)
    .sort((a, b) => a.priority - b.priority)
    .slice(0, 40);

  const readNames = new Set<string>();
  const hitsById = new Map<string, Set<string>>();
  const sourceById = new Map<string, Set<string>>();
  const iocs: Ioc[] = [];
  const skipped: string[] = [];
  let scanned = 0;
  let truncated = false;

  for (const { name } of candidates) {
    if (scanned >= budgetBytes) {
      truncated = true;
      break;
    }
    // A modern DEX is routinely 8–10 MB inflated, so the per-entry ceiling is
    // the whole remaining budget rather than an arbitrary smaller number.
    // Getting this wrong is silent: the read throws, the catch below swallows
    // it, and the sweep reports "no behavioural indicators" for an app whose
    // code was never actually read.
    let bytes: Uint8Array | null;
    try {
      bytes = await zip.read(name, budgetBytes - scanned);
    } catch {
      // A single unreadable entry must not abort the whole analysis.
      skipped.push(name);
      continue;
    }
    if (!bytes || bytes.length === 0) continue;
    readNames.add(name);
    scanned += bytes.length;

    const text = binaryStrings(bytes);

    for (const rule of BEHAVIOUR_RULES) {
      for (const needle of rule.needles) {
        if (text.includes(needle)) {
          if (!hitsById.has(rule.id)) hitsById.set(rule.id, new Set());
          hitsById.get(rule.id)?.add(needle);
          if (!sourceById.has(rule.id)) sourceById.set(rule.id, new Set());
          sourceById.get(rule.id)?.add(name);
        }
      }
    }

    // Requirement 3: network intelligence extracted from the same strings.
    iocs.push(...extractIocs(text, { source: name, limit: 40, skipBenign: true }));
  }

  const findings: Finding[] = [];
  for (const rule of BEHAVIOUR_RULES) {
    const hits = hitsById.get(rule.id);
    if (!hits) continue;
    const needed = rule.minDistinct ?? 1;
    if (hits.size < needed) continue;
    // Corroboration gate: string evidence alone is not enough for these rules.
    if (rule.requiresManifest && !rule.requiresManifest.some((id) => manifestFindingIds.has(id))) continue;

    const sources = [...(sourceById.get(rule.id) ?? [])].slice(0, 3);
    findings.push({
      id: rule.id,
      category: rule.category,
      severity: rule.severity,
      // More distinct matches → more confidence, capped at +15.
      confidence: Math.min(95, rule.confidence + Math.min(15, (hits.size - needed) * 5)),
      title: rule.title,
      evidence: [...hits].slice(0, 6).map((needle) => `"${needle}"`).concat(sources.map((source) => `in ${source}`)),
      explanation: rule.explanation,
      ...(rule.recommendation ? { recommendation: rule.recommendation } : {}),
    });
  }

  findings.push(...nativeLibFindings(analysis));

  // Endpoint concentration: many distinct non-benign hosts is itself a signal.
  const hosts = new Set(
    iocs
      .filter((ioc) => ioc.kind === 'domain' || ioc.kind === 'url')
      .map((ioc) => {
        if (ioc.kind === 'domain') return ioc.value;
        try {
          return new URL(ioc.value).hostname;
        } catch {
          return '';
        }
      })
      .filter((host) => host && !isBenignHost(host)),
  );

  const risky = iocs.filter((ioc) => ioc.severity === 'medium' || ioc.severity === 'high');
  if (risky.length > 0) {
    findings.push({
      id: 'apk.network.suspicious_endpoint',
      category: 'network',
      severity: 'medium',
      confidence: 70,
      title: { fa: 'نقاط ارتباطی مشکوک در کد', en: 'Suspicious network endpoints in code' },
      evidence: risky.slice(0, 8).map((ioc) => ioc.value.slice(0, 120)),
      explanation: {
        fa: 'آدرس‌هایی با میزبانی موقت، DNS پویا، کوتاه‌کننده‌ی لینک یا دامنه‌ی سطح بالای پرسوءاستفاده در کد برنامه یافت شد. زیرساخت پایدار و شناخته‌شده نشانه‌ی سرویس جدی است؛ زیرساخت یک‌بارمصرف نشانه‌ی خلاف آن.',
        en: 'The code contains addresses on temporary hosting, dynamic DNS, URL shorteners, or high-abuse TLDs. Stable, well-known infrastructure signals a serious service; throwaway infrastructure signals the opposite.',
      },
      recommendation: {
        fa: 'این دامنه‌ها را با ابزارهای شبکه‌ی همین ربات بررسی کنید.',
        en: 'Inspect these domains with this bot’s network tools.',
      },
    });
  }

  if (hosts.size >= 25) {
    findings.push({
      id: 'apk.network.many_endpoints',
      category: 'network',
      severity: 'low',
      confidence: 60,
      title: { fa: 'تعداد زیاد مقصدهای شبکه', en: 'Large number of network destinations' },
      evidence: [`${hosts.size} distinct hosts`],
      explanation: {
        fa: `${hosts.size} میزبان متمایز در کد یافت شد. این معمولاً نتیجه‌ی حضور چند SDK تبلیغاتی و تحلیلی است که هر کدام داده‌ای از کاربر ارسال می‌کنند.`,
        en: `${hosts.size} distinct hosts were found in the code. This usually reflects multiple advertising and analytics SDKs, each sending some user data.`,
      },
    });
  }

  // Honesty about coverage: if the code could not be read, say so instead of
  // letting an empty finding list imply the app is clean.
  const dexTotal = analysis.files.filter((name) => /^classes\d*\.dex$/.test(name)).length;
  // Counted from what was actually read: exhausting the byte budget breaks out
  // of the loop without adding to `skipped`, so deriving this from `skipped`
  // reported unread DEX files as analysed.
  const dexRead = [...readNames].filter((name) => /^classes\d*\.dex$/.test(name)).length;

  if (dexTotal > 0 && dexRead === 0) {
    findings.push({
      id: 'apk.analysis.no_code_read',
      category: 'integrity',
      severity: 'medium',
      confidence: 100,
      title: { fa: 'کد برنامه قابل خواندن نبود', en: 'Application code could not be read' },
      evidence: [`${dexTotal} dex file(s)`, ...skipped.slice(0, 3)],
      explanation: {
        fa: 'هیچ‌کدام از فایل‌های کد (DEX) قابل بازگشایی نبودند، بنابراین تحلیل رفتاری انجام نشده است. نتیجه‌ی این گزارش تنها بر پایه‌ی مانیفست است و نبود یافته‌ی رفتاری به معنی سالم بودن برنامه نیست.',
        en: 'None of the code (DEX) files could be decompressed, so no behavioural analysis was performed. This report is based on the manifest alone; the absence of behavioural findings does not mean the app is clean.',
      },
    });
  } else if (dexRead < dexTotal || truncated) {
    findings.push({
      id: 'apk.analysis.partial_code',
      category: 'integrity',
      severity: 'low',
      confidence: 100,
      title: { fa: 'کد برنامه به‌طور کامل بررسی نشد', en: 'Application code only partially analysed' },
      evidence: [
        `${dexRead}/${dexTotal} dex analysed`,
        ...skipped.filter((name) => /^classes\d*\.dex$/.test(name)).slice(0, 3).map((name) => `skipped: ${name}`),
        ...(truncated ? ['size budget reached'] : []),
      ],
      explanation: {
        fa: 'به دلیل محدودیت حجم، بخشی از کد برنامه بررسی نشد. یافته‌های رفتاری این گزارش کامل نیستند.',
        en: 'Because of size limits, part of the application code was not examined. The behavioural findings in this report are not exhaustive.',
      },
    });
  }

  return { findings, iocs, scannedBytes: scanned, truncated: truncated || dexRead < dexTotal };
}
