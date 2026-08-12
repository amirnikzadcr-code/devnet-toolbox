/**
 * Advanced Android APK Analysis (requirements 1, 2, 3).
 *
 * Pipeline: ZIP → AndroidManifest.xml (AXML) → structural facts → findings,
 * then a DEX/asset string sweep for behavioural indicators and network IOCs.
 *
 * Guiding rule (explicit user requirement): a single permission never yields a
 * spyware verdict. Serious severity comes only from `APK_CORRELATIONS`, where
 * independent capabilities combine into a recognised pattern.
 */
import { ZipReader } from './zip.js';
import { attr, attrBool, attrInt, findElements, parseAxml, type AxmlElement } from './axml.js';
import { isCustomPermission, lookupPermission, shortPermission } from './permissions.js';
import type { CorrelationRule } from './risk.js';
import type { Finding, Ioc, Severity } from './types.js';
import { errInvalidInput } from '../utils/errors.js';

export interface ApkComponent {
  kind: 'activity' | 'service' | 'receiver' | 'provider';
  name: string;
  exported: boolean;
  /** True when `exported` was inferred from an intent-filter rather than declared. */
  exportInferred: boolean;
  permission: string | null;
  intentActions: string[];
  intentCategories: string[];
  /** `scheme://host` pairs from `<data>` tags — deep links. */
  deepLinks: string[];
}

export interface ApkAnalysis {
  packageName: string;
  versionName: string;
  versionCode: string;
  minSdk: number | null;
  targetSdk: number | null;
  compileSdk: number | null;
  appLabel: string;
  debuggable: boolean;
  allowBackup: boolean | null;
  usesCleartextTraffic: boolean | null;
  hasNetworkSecurityConfig: boolean;
  permissions: string[];
  customPermissions: string[];
  components: ApkComponent[];
  /** Entry names inside the APK. */
  files: string[];
  nativeLibs: string[];
  dexCount: number;
  totalUncompressed: number;
  signatureScheme: string[];
}

const APP_ELEMENT = 'application';

/** Actions that make an exported receiver interesting from a persistence view. */
const BOOT_ACTIONS = new Set([
  'android.intent.action.BOOT_COMPLETED',
  'android.intent.action.LOCKED_BOOT_COMPLETED',
  'android.intent.action.QUICKBOOT_POWERON',
  'com.htc.intent.action.QUICKBOOT_POWERON',
  'android.intent.action.MY_PACKAGE_REPLACED',
  'android.intent.action.PACKAGE_REPLACED',
  'android.intent.action.USER_PRESENT',
]);

const SMS_ACTIONS = new Set([
  'android.provider.Telephony.SMS_RECEIVED',
  'android.provider.Telephony.SMS_DELIVER',
  'android.provider.Telephony.WAP_PUSH_RECEIVED',
]);

/** Parses the APK container and its manifest into structured facts. */
export async function analyseApk(data: Uint8Array): Promise<{ analysis: ApkAnalysis; zip: ZipReader }> {
  const zip = new ZipReader(data);
  const entries = zip.entries();
  const files = entries.map((entry) => entry.name);

  if (!files.includes('AndroidManifest.xml')) {
    throw errInvalidInput(
      'این فایل یک APK معتبر نیست: AndroidManifest.xml در آن یافت نشد.',
      'Not a valid APK: AndroidManifest.xml is missing.',
    );
  }

  const manifestBytes = await zip.read('AndroidManifest.xml');
  if (!manifestBytes || manifestBytes.length === 0) {
    throw errInvalidInput('خواندن AndroidManifest.xml ممکن نشد.', 'AndroidManifest.xml could not be read.');
  }

  const doc = parseAxml(manifestBytes);
  const root = doc.root;
  if (!root || root.name !== 'manifest') {
    throw errInvalidInput(
      'ساختار AndroidManifest.xml معتبر نیست.',
      'AndroidManifest.xml has an unexpected structure.',
    );
  }

  const usesSdk = findElements(root, 'uses-sdk')[0] ?? null;
  const application = findElements(root, APP_ELEMENT)[0] ?? null;

  const permissions = [
    ...new Set(
      findElements(root, 'uses-permission')
        .concat(findElements(root, 'uses-permission-sdk-23'))
        .map((element) => attr(element, 'name') ?? '')
        .filter(Boolean),
    ),
  ].sort();

  const customPermissions = [
    ...new Set(
      findElements(root, 'permission')
        .map((element) => attr(element, 'name') ?? '')
        .filter(Boolean),
    ),
  ].sort();

  const components: ApkComponent[] = [];
  if (application) {
    const kinds: [string, ApkComponent['kind']][] = [
      ['activity', 'activity'],
      ['activity-alias', 'activity'],
      ['service', 'service'],
      ['receiver', 'receiver'],
      ['provider', 'provider'],
    ];
    for (const [tag, kind] of kinds) {
      for (const element of findElements(application, tag)) {
        components.push(readComponent(element, kind));
      }
    }
  }

  const nativeLibs = [...new Set(files.filter((name) => name.startsWith('lib/') && name.endsWith('.so')))];
  const dexCount = files.filter((name) => /^classes\d*\.dex$/.test(name)).length;

  const signatureScheme: string[] = [];
  if (files.some((name) => /^META-INF\/.*\.(RSA|DSA|EC)$/i.test(name))) signatureScheme.push('v1 (JAR signing)');
  if (files.includes('META-INF/MANIFEST.MF') && signatureScheme.length === 0) signatureScheme.push('v1 (manifest only)');

  const analysis: ApkAnalysis = {
    packageName: attr(root, 'package') ?? '(unknown)',
    versionName: attr(root, 'versionName') ?? '(unknown)',
    versionCode: attr(root, 'versionCode') ?? '(unknown)',
    minSdk: usesSdk ? attrInt(usesSdk, 'minSdkVersion') : null,
    targetSdk: usesSdk ? attrInt(usesSdk, 'targetSdkVersion') : null,
    compileSdk: attrInt(root, 'compileSdkVersion'),
    appLabel: application ? (attr(application, 'label') ?? '') : '',
    debuggable: application ? attrBool(application, 'debuggable') === true : false,
    allowBackup: application ? attrBool(application, 'allowBackup') : null,
    usesCleartextTraffic: application ? attrBool(application, 'usesCleartextTraffic') : null,
    hasNetworkSecurityConfig: application ? attr(application, 'networkSecurityConfig') !== null : false,
    permissions,
    customPermissions,
    components,
    files,
    nativeLibs,
    dexCount,
    totalUncompressed: zip.totalUncompressed(),
    signatureScheme,
  };

  return { analysis, zip };
}

function readComponent(element: AxmlElement, kind: ApkComponent['kind']): ApkComponent {
  const filters = element.children.filter((child) => child.name === 'intent-filter');
  const declaredExported = attrBool(element, 'exported');
  const intentActions: string[] = [];
  const intentCategories: string[] = [];
  const deepLinks: string[] = [];

  for (const filter of filters) {
    for (const action of filter.children.filter((child) => child.name === 'action')) {
      const name = attr(action, 'name');
      if (name) intentActions.push(name);
    }
    for (const category of filter.children.filter((child) => child.name === 'category')) {
      const name = attr(category, 'name');
      if (name) intentCategories.push(name);
    }
    for (const data of filter.children.filter((child) => child.name === 'data')) {
      const scheme = attr(data, 'scheme');
      const host = attr(data, 'host');
      if (scheme) deepLinks.push(host ? `${scheme}://${host}` : `${scheme}://`);
    }
  }

  // Android's default: a component with an intent-filter is exported unless
  // it says otherwise. That implicit case is what most audits miss.
  const exported = declaredExported ?? filters.length > 0;

  return {
    kind,
    name: attr(element, 'name') ?? '(unnamed)',
    exported,
    exportInferred: declaredExported === null && filters.length > 0,
    permission: attr(element, 'permission'),
    intentActions,
    intentCategories,
    deepLinks,
  };
}

// ─── Findings from the manifest ───────────────────────────────────────────

export function manifestFindings(analysis: ApkAnalysis): Finding[] {
  const findings: Finding[] = [];

  // ── Dangerous permissions, reported individually but never as a verdict.
  for (const permission of analysis.permissions) {
    const info = lookupPermission(permission);
    if (!info || info.severity === 'safe' || info.severity === 'low') continue;
    findings.push({
      id: `apk.perm.${info.short.toLowerCase()}`,
      category: 'permission',
      severity: info.severity,
      confidence: 100, // the manifest literally declares it
      title: { fa: `مجوز حساس: ${info.fa}`, en: `Sensitive permission: ${info.en}` },
      evidence: [permission],
      explanation: {
        fa: `این برنامه مجوز «${info.fa}» را درخواست کرده است. داشتن این مجوز به‌تنهایی بدافزار بودن را ثابت نمی‌کند؛ بسیاری از برنامه‌های سالم نیز به آن نیاز دارند. آنچه اهمیت دارد، تناسب این مجوز با کارکرد اعلام‌شده‌ی برنامه است.`,
        en: `The app requests "${info.en}". On its own this does not indicate malware — many legitimate apps need it. What matters is whether it fits the app's stated purpose.`,
      },
      recommendation: {
        fa: 'بررسی کنید که این مجوز با عملکرد تبلیغ‌شده‌ی برنامه هم‌خوانی داشته باشد.',
        en: "Check that this permission is consistent with the app's advertised functionality.",
      },
    });
  }

  const dangerousCount = analysis.permissions.filter((permission) => {
    const info = lookupPermission(permission);
    return info && (info.severity === 'medium' || info.severity === 'high');
  }).length;

  if (dangerousCount >= 8) {
    findings.push({
      id: 'apk.perm.excessive',
      category: 'permission',
      severity: 'medium',
      confidence: 70,
      title: { fa: 'تعداد زیاد مجوزهای حساس', en: 'Unusually high number of sensitive permissions' },
      evidence: [`${dangerousCount} sensitive permissions of ${analysis.permissions.length} total`],
      explanation: {
        fa: `این برنامه ${dangerousCount} مجوز حساس درخواست کرده است. تجمیع گسترده‌ی مجوزها سطح دسترسی برنامه به داده‌های شما را به‌شدت افزایش می‌دهد.`,
        en: `The app requests ${dangerousCount} sensitive permissions. Broad permission accumulation greatly widens its access to your data.`,
      },
      recommendation: {
        fa: 'اگر کارکرد برنامه ساده است، این حجم از مجوز توجیه ندارد.',
        en: 'If the app has a simple purpose, this breadth of access is not justified.',
      },
    });
  }

  // ── Custom permissions
  const custom = analysis.customPermissions.filter((permission) => isCustomPermission(permission));
  if (custom.length > 0) {
    findings.push({
      id: 'apk.perm.custom',
      category: 'permission',
      severity: 'low',
      confidence: 85,
      title: { fa: 'تعریف مجوزهای اختصاصی', en: 'Custom permissions declared' },
      evidence: custom.slice(0, 8),
      explanation: {
        fa: 'برنامه مجوزهای اختصاصی خود را تعریف کرده است. اگر سطح حفاظت آن‌ها ضعیف باشد، برنامه‌های دیگر می‌توانند از آن‌ها برای دسترسی به داده‌های این برنامه استفاده کنند.',
        en: 'The app defines its own permissions. With a weak protection level, other apps could use them to reach this app’s data.',
      },
    });
  }

  // ── Exported components
  const exported = analysis.components.filter((component) => component.exported && !component.permission);
  const exportedProviders = exported.filter((component) => component.kind === 'provider');

  if (exportedProviders.length > 0) {
    findings.push({
      id: 'apk.component.exported_provider',
      category: 'component',
      severity: 'high',
      confidence: 85,
      title: { fa: 'ContentProvider در دسترس بدون حفاظت', en: 'Exported ContentProvider without permission' },
      evidence: exportedProviders.slice(0, 6).map((component) => component.name),
      explanation: {
        fa: 'یک ContentProvider بدون الزام مجوز در معرض سایر برنامه‌ها قرار گرفته است. این وضعیت می‌تواند به نشت داده‌های داخلی برنامه منجر شود.',
        en: 'A ContentProvider is exposed to other apps without requiring a permission, which can leak the app’s internal data.',
      },
      recommendation: {
        fa: 'برای Providerهای داخلی باید android:exported="false" تنظیم شود.',
        en: 'Internal providers should set android:exported="false".',
      },
    });
  }

  const otherExported = exported.filter((component) => component.kind !== 'provider');
  if (otherExported.length > 0) {
    const inferred = otherExported.filter((component) => component.exportInferred);
    findings.push({
      id: 'apk.component.exported',
      category: 'component',
      severity: otherExported.length > 12 ? 'medium' : 'low',
      confidence: 80,
      title: { fa: 'کامپوننت‌های در معرض دسترسی خارجی', en: 'Externally reachable components' },
      evidence: otherExported.slice(0, 8).map((component) => `${component.kind}: ${component.name}`),
      explanation: {
        fa: `${otherExported.length} کامپوننت بدون الزام مجوز از سوی برنامه‌های دیگر قابل فراخوانی است${
          inferred.length > 0 ? ` (${inferred.length} مورد به‌صورت ضمنی، چون intent-filter دارند)` : ''
        }. هر کامپوننت در معرض، یک سطح حمله‌ی بالقوه است.`,
        en: `${otherExported.length} components can be invoked by other apps without a permission${
          inferred.length > 0 ? ` (${inferred.length} implicitly, because they declare an intent-filter)` : ''
        }. Each exposed component is a potential attack surface.`,
      },
      recommendation: {
        fa: 'کامپوننت‌هایی که نیازی به دسترسی خارجی ندارند باید exported=false باشند.',
        en: 'Components that do not need external access should be exported=false.',
      },
    });
  }

  // ── Deep links
  const deepLinks = [...new Set(analysis.components.flatMap((component) => component.deepLinks))].filter(
    (link) => !link.startsWith('http'),
  );
  if (deepLinks.length > 0) {
    findings.push({
      id: 'apk.component.deeplinks',
      category: 'component',
      severity: 'low',
      confidence: 90,
      title: { fa: 'لینک‌های عمیق (Deep Link) تعریف‌شده', en: 'Custom deep links registered' },
      evidence: deepLinks.slice(0, 10),
      explanation: {
        fa: 'برنامه این طرح‌های URI را در سیستم ثبت می‌کند. اگر ورودی این لینک‌ها به‌درستی اعتبارسنجی نشود، می‌توانند مسیر ورود داده‌ی غیرقابل‌اعتماد به برنامه باشند.',
        en: 'The app registers these URI schemes. Without proper input validation they can become an entry point for untrusted data.',
      },
    });
  }

  // ── Accessibility / device admin / notification listener
  for (const component of analysis.components) {
    if (component.permission === 'android.permission.BIND_ACCESSIBILITY_SERVICE') {
      findings.push({
        id: 'apk.service.accessibility',
        category: 'data-collection',
        severity: 'high',
        confidence: 95,
        title: { fa: 'سرویس دسترس‌پذیری (Accessibility Service)', en: 'Accessibility service declared' },
        evidence: [component.name],
        explanation: {
          fa: 'سرویس دسترس‌پذیری می‌تواند محتوای صفحه‌ی تمام برنامه‌ها را بخواند و به‌جای کاربر روی آن‌ها عمل کند. این قابلیت برای کاربران کم‌توان ساخته شده، اما پرکاربردترین ابزار بدافزارهای بانکی و کی‌لاگرها نیز هست.',
          en: 'An accessibility service can read the screen of every app and act on the user’s behalf. It exists for users with disabilities, but it is also the single most abused capability in banking malware and keyloggers.',
        },
        recommendation: {
          fa: 'اگر برنامه دلیل روشنی برای این سرویس ندارد، آن را نصب نکنید.',
          en: 'Do not install the app unless it has a clear, stated reason for this service.',
        },
      });
    }
    if (component.permission === 'android.permission.BIND_DEVICE_ADMIN') {
      findings.push({
        id: 'apk.service.device_admin',
        category: 'persistence',
        severity: 'high',
        confidence: 95,
        title: { fa: 'درخواست اختیارات مدیر دستگاه', en: 'Device administrator receiver' },
        evidence: [component.name],
        explanation: {
          fa: 'برنامه اختیارات مدیر دستگاه را می‌خواهد. چنین برنامه‌ای می‌تواند قفل صفحه را تغییر دهد، دستگاه را پاک کند و حذف خود را دشوار سازد.',
          en: 'The app requests device-administrator powers, allowing it to change the lock screen, wipe the device, and resist uninstallation.',
        },
        recommendation: {
          fa: 'این سطح از اختیار فقط برای برنامه‌های مدیریت سازمانی (MDM) پذیرفتنی است.',
          en: 'This level of control is only appropriate for enterprise MDM software.',
        },
      });
    }
    if (component.permission === 'android.permission.BIND_NOTIFICATION_LISTENER_SERVICE') {
      findings.push({
        id: 'apk.service.notification_listener',
        category: 'data-collection',
        severity: 'high',
        confidence: 95,
        title: { fa: 'سرویس خواندن اعلان‌ها', en: 'Notification listener service' },
        evidence: [component.name],
        explanation: {
          fa: 'برنامه می‌تواند محتوای تمام اعلان‌ها را بخواند — از جمله رمزهای یک‌بارمصرف (OTP) و پیام‌های خصوصی.',
          en: 'The app can read the content of every notification, including one-time passcodes and private messages.',
        },
      });
    }
  }

  // ── Boot persistence
  const bootReceivers = analysis.components.filter(
    (component) =>
      component.kind === 'receiver' && component.intentActions.some((action) => BOOT_ACTIONS.has(action)),
  );
  if (bootReceivers.length > 0) {
    findings.push({
      id: 'apk.persistence.boot',
      category: 'persistence',
      severity: 'low',
      confidence: 95,
      title: { fa: 'اجرای خودکار پس از راه‌اندازی دستگاه', en: 'Starts automatically on device boot' },
      evidence: bootReceivers.slice(0, 5).map((component) => `${component.name} ← ${component.intentActions.join(', ')}`),
      explanation: {
        fa: 'برنامه پس از هر بار روشن شدن دستگاه به‌صورت خودکار اجرا می‌شود. این رفتار در پیام‌رسان‌ها و ابزارهای همگام‌سازی طبیعی است، اما در ترکیب با سایر نشانه‌ها می‌تواند نشانه‌ی ماندگاری مخفیانه باشد.',
        en: 'The app runs automatically after every reboot. Normal for messengers and sync tools, but combined with other indicators it can signal covert persistence.',
      },
    });
  }

  // ── SMS interception receivers
  const smsReceivers = analysis.components.filter((component) =>
    component.intentActions.some((action) => SMS_ACTIONS.has(action)),
  );
  if (smsReceivers.length > 0) {
    findings.push({
      id: 'apk.persistence.sms_receiver',
      category: 'data-collection',
      severity: 'medium',
      confidence: 90,
      title: { fa: 'رهگیری پیامک‌های ورودی', en: 'Intercepts incoming SMS' },
      evidence: smsReceivers.slice(0, 5).map((component) => component.name),
      explanation: {
        fa: 'برنامه یک گیرنده برای پیامک‌های ورودی ثبت کرده است. این قابلیت برای برنامه‌های پیام‌رسان و تأیید خودکار کد ضروری است، اما همچنین راه اصلی سرقت رمزهای یک‌بارمصرف است.',
        en: 'The app registers a receiver for incoming SMS. Required for messaging and auto-fill of verification codes, but also the primary route for OTP theft.',
      },
    });
  }

  // ── Background services
  const backgroundServices = analysis.components.filter((component) => component.kind === 'service');
  if (backgroundServices.length > 0) {
    findings.push({
      id: 'apk.persistence.service',
      category: 'persistence',
      severity: 'safe',
      confidence: 95,
      title: { fa: 'سرویس‌های پس‌زمینه', en: 'Background services' },
      evidence: backgroundServices.slice(0, 6).map((component) => component.name),
      explanation: {
        fa: `${backgroundServices.length} سرویس تعریف شده است. سرویس‌ها می‌توانند بدون رابط کاربری در پس‌زمینه اجرا شوند.`,
        en: `${backgroundServices.length} services are declared. Services can run in the background without any UI.`,
      },
    });
  }

  // ── Configuration weaknesses
  if (analysis.debuggable) {
    findings.push({
      id: 'apk.config.debuggable',
      category: 'integrity',
      severity: 'high',
      confidence: 100,
      title: { fa: 'برنامه در حالت اشکال‌زدایی منتشر شده', en: 'Application is debuggable' },
      evidence: ['android:debuggable="true"'],
      explanation: {
        fa: 'پرچم debuggable فعال است. در این حالت هر کسی با دسترسی فیزیکی یا ADB می‌تواند به فرایند برنامه متصل شود، حافظه را بخواند و کد اجرا کند. این پرچم هرگز نباید در نسخه‌ی منتشرشده روشن باشد.',
        en: 'The debuggable flag is set. Anyone with ADB or physical access can attach to the process, read memory and execute code. This must never be enabled in a release build.',
      },
      recommendation: {
        fa: 'نسخه‌ی منتشرشده باید با debuggable=false ساخته شود.',
        en: 'Release builds must set debuggable=false.',
      },
    });
  }

  if (analysis.usesCleartextTraffic === true) {
    findings.push({
      id: 'apk.config.cleartext',
      category: 'network',
      severity: 'medium',
      confidence: 100,
      title: { fa: 'اجازه‌ی ترافیک رمزنگاری‌نشده (HTTP)', en: 'Cleartext HTTP traffic permitted' },
      evidence: ['android:usesCleartextTraffic="true"'],
      explanation: {
        fa: 'برنامه اجازه‌ی ارسال داده روی HTTP بدون رمزنگاری را دارد. چنین ترافیکی در شبکه‌های عمومی قابل شنود و دستکاری است.',
        en: 'The app is allowed to send data over unencrypted HTTP, which can be intercepted and modified on public networks.',
      },
      recommendation: {
        fa: 'تمام ارتباطات باید از HTTPS استفاده کنند.',
        en: 'All communication should use HTTPS.',
      },
    });
  }

  if (analysis.allowBackup === true) {
    findings.push({
      id: 'apk.config.backup',
      category: 'privacy',
      severity: 'low',
      confidence: 95,
      title: { fa: 'پشتیبان‌گیری از داده‌های برنامه مجاز است', en: 'Application backup is allowed' },
      evidence: ['android:allowBackup="true"'],
      explanation: {
        fa: 'داده‌های خصوصی برنامه می‌توانند از طریق ADB یا پشتیبان‌گیری ابری استخراج شوند.',
        en: 'The app’s private data can be extracted via ADB or cloud backup.',
      },
    });
  }

  if (analysis.targetSdk !== null && analysis.targetSdk < 26) {
    findings.push({
      id: 'apk.config.old_target_sdk',
      category: 'integrity',
      severity: 'medium',
      confidence: 100,
      title: { fa: 'targetSdk قدیمی', en: 'Outdated targetSdkVersion' },
      evidence: [`targetSdkVersion = ${analysis.targetSdk}`],
      explanation: {
        fa: `برنامه برای API سطح ${analysis.targetSdk} ساخته شده است. با targetSdk پایین‌تر از ۲۶، اندروید بسیاری از محدودیت‌های مدرن حریم خصوصی و اجرای پس‌زمینه را اعمال نمی‌کند — روشی شناخته‌شده برای دور زدن حفاظت‌های سیستم.`,
        en: `The app targets API level ${analysis.targetSdk}. Below 26, Android relaxes many modern privacy and background-execution restrictions — a known way to sidestep platform protections.`,
      },
    });
  }

  if (analysis.signatureScheme.length === 0) {
    findings.push({
      id: 'apk.integrity.unsigned',
      category: 'integrity',
      severity: 'medium',
      confidence: 70,
      title: { fa: 'امضای v1 در آرشیو یافت نشد', en: 'No v1 signature block found' },
      evidence: ['META-INF/*.RSA|DSA|EC missing'],
      explanation: {
        fa: 'بلوک امضای کلاسیک (v1) در آرشیو دیده نشد. این می‌تواند به معنای استفاده‌ی انحصاری از امضای v2/v3 (که طبیعی است) یا امضا نشدن فایل باشد. تأیید کامل امضا نیازمند بررسی بلوک امضای APK است که خارج از دامنه‌ی این تحلیل ایستا است.',
        en: 'No classic v1 signature block was found. This may mean the APK uses only v2/v3 signing (normal), or that it is unsigned. Full signature verification requires parsing the APK Signing Block, which is outside the scope of this static analysis.',
      },
    });
  }

  return findings;
}

// ─── Correlation rules (the only path to CRITICAL) ────────────────────────

export const APK_CORRELATIONS: CorrelationRule[] = [
  {
    id: 'apk.corr.covert_surveillance',
    requires: ['apk.perm.record_audio', 'apk.persistence.service', 'apk.persistence.boot'],
    severity: 'high',
    confidence: 75,
    title: {
      fa: 'الگوی نظارت پنهان: میکروفون + سرویس پس‌زمینه + اجرای خودکار',
      en: 'Covert surveillance pattern: microphone + background service + auto-start',
    },
    explanation: {
      fa: 'سه قابلیت مستقل کنار هم دیده شده‌اند: دسترسی به میکروفون، سرویسی که بدون رابط کاربری اجرا می‌شود، و اجرای خودکار پس از راه‌اندازی دستگاه. هیچ‌کدام به‌تنهایی نگران‌کننده نیستند، اما ترکیب آن‌ها دقیقاً ساختاری است که یک ابزار شنود برای کار مداوم و بدون اطلاع کاربر به آن نیاز دارد. این یافته یک «الگو» است، نه اثبات؛ برای قضاوت نهایی باید کارکرد اعلام‌شده‌ی برنامه را در نظر گرفت.',
      en: 'Three independent capabilities co-occur: microphone access, a service that runs without UI, and automatic start after boot. None is alarming alone, but together they form exactly the structure an eavesdropping tool needs to operate continuously and unnoticed. This is a pattern, not proof — judge it against the app’s stated purpose.',
    },
    recommendation: {
      fa: 'اگر برنامه ضبط صدا را در کارکرد خود اعلام نکرده است، آن را نصب نکنید و در صورت نصب، مجوز میکروفون را لغو کنید.',
      en: 'If the app does not advertise audio recording, do not install it; if already installed, revoke the microphone permission.',
    },
  },
  {
    id: 'apk.corr.location_tracking',
    requires: ['apk.perm.access_background_location', 'apk.persistence.service'],
    severity: 'high',
    confidence: 80,
    title: {
      fa: 'الگوی ردیابی مداوم موقعیت مکانی',
      en: 'Continuous location-tracking pattern',
    },
    explanation: {
      fa: 'دسترسی به موقعیت مکانی در پس‌زمینه همراه با سرویس پس‌زمینه، امکان ثبت پیوسته‌ی مکان کاربر را فراهم می‌کند، حتی زمانی که برنامه باز نیست.',
      en: 'Background location access combined with a background service enables continuous tracking of the user’s whereabouts even when the app is closed.',
    },
    recommendation: {
      fa: 'دسترسی موقعیت مکانی را به حالت «فقط هنگام استفاده» تغییر دهید.',
      en: 'Change location access to "while using the app" only.',
    },
  },
  {
    id: 'apk.corr.otp_theft',
    requires: ['apk.perm.read_sms', 'apk.persistence.sms_receiver'],
    minMatches: 2,
    severity: 'high',
    confidence: 80,
    title: { fa: 'الگوی دسترسی کامل به پیامک‌ها', en: 'Full SMS access pattern' },
    explanation: {
      fa: 'برنامه هم مجوز خواندن پیامک را دارد و هم گیرنده‌ای برای پیامک‌های ورودی ثبت کرده است. این ترکیب امکان دریافت و خواندن رمزهای یک‌بارمصرف را بدون اطلاع کاربر فراهم می‌کند. برای پیام‌رسان‌های واقعی طبیعی است؛ برای یک بازی یا ابزار ساده، نه.',
      en: 'The app both holds SMS read permission and registers an incoming-SMS receiver. This combination allows silent capture of one-time passcodes. Expected in a real SMS app; not in a game or simple utility.',
    },
    recommendation: {
      fa: 'اگر برنامه پیام‌رسان نیست، این ترکیب را جدی بگیرید.',
      en: 'If the app is not a messaging client, treat this combination seriously.',
    },
  },
  {
    id: 'apk.corr.overlay_accessibility',
    requires: ['apk.perm.system_alert_window', 'apk.service.accessibility'],
    severity: 'critical',
    confidence: 85,
    title: {
      fa: 'الگوی بدافزار بانکی: پنجره روی برنامه‌ها + سرویس دسترس‌پذیری',
      en: 'Banking-malware pattern: screen overlay + accessibility service',
    },
    explanation: {
      fa: 'ترکیب قابلیت نمایش پنجره روی سایر برنامه‌ها با سرویس دسترس‌پذیری، امضای شناخته‌شده‌ی تروجان‌های بانکی است: پنجره‌ی جعلی روی برنامه‌ی بانک نمایش داده می‌شود و سرویس دسترس‌پذیری آنچه را کاربر تایپ می‌کند می‌خواند و می‌تواند به‌جای او دکمه بزند. این دو قابلیت با هم عملاً کنترل کامل رابط کاربری را می‌دهند.',
      en: 'Overlay drawing combined with an accessibility service is the classic signature of banking trojans: a fake window is drawn over the banking app while the accessibility service reads what the user types and can tap on their behalf. Together they grant effective control of the UI.',
    },
    recommendation: {
      fa: 'این برنامه را نصب نکنید. اگر نصب شده است، فوراً حذف کنید و رمزهای بانکی خود را تغییر دهید.',
      en: 'Do not install this app. If already installed, remove it immediately and change your banking credentials.',
    },
  },
  {
    id: 'apk.corr.stealth_admin',
    // Device-admin is the anchor and must be present. With `minMatches: 2` the
    // rule fired on boot+service alone — a combination shared by a large share
    // of ordinary apps (anything using WorkManager plus a boot receiver), which
    // made a legitimate app store look uninstall-resistant.
    requires: ['apk.service.device_admin', 'apk.persistence.boot', 'apk.persistence.service'],
    anchor: 'apk.service.device_admin',
    minMatches: 2,
    severity: 'high',
    confidence: 75,
    title: { fa: 'الگوی ماندگاری مقاوم در برابر حذف', en: 'Uninstall-resistant persistence pattern' },
    explanation: {
      fa: 'اختیارات مدیر دستگاه در کنار اجرای خودکار، حذف برنامه را برای کاربر عادی دشوار می‌کند و بازگشت آن پس از هر راه‌اندازی را تضمین می‌کند.',
      en: 'Device-admin powers together with auto-start make the app hard for a normal user to remove and ensure it returns after every reboot.',
    },
    recommendation: {
      fa: 'برای حذف، ابتدا از تنظیمات، اختیارات مدیر دستگاه را لغو کنید.',
      en: 'To remove it, first revoke device-administrator rights in Settings.',
    },
  },
  {
    id: 'apk.corr.data_exfiltration',
    requires: ['apk.perm.read_contacts', 'apk.perm.read_sms', 'apk.perm.read_call_log', 'apk.perm.access_fine_location'],
    minMatches: 3,
    severity: 'high',
    confidence: 70,
    title: { fa: 'الگوی جمع‌آوری گسترده‌ی داده‌های شخصی', en: 'Broad personal-data harvesting pattern' },
    explanation: {
      fa: 'برنامه هم‌زمان به چند منبع داده‌ی شخصی مستقل (مخاطبان، پیامک، تاریخچه تماس، موقعیت مکانی) دسترسی می‌خواهد. این گستردگی معمولاً با کارکرد یک برنامه‌ی متمرکز هم‌خوانی ندارد و الگوی معمول ابزارهای جمع‌آوری اطلاعات است.',
      en: 'The app simultaneously requests several independent personal-data sources (contacts, SMS, call log, location). Such breadth rarely matches a focused app’s purpose and is typical of data-harvesting tools.',
    },
    recommendation: {
      fa: 'مجوزهایی را که به کارکرد اصلی برنامه مربوط نیستند لغو کنید.',
      en: 'Revoke any permission unrelated to the app’s core function.',
    },
  },
  {
    id: 'apk.corr.dropper',
    requires: ['apk.perm.request_install_packages', 'apk.behaviour.dynamic_load'],
    minMatches: 2,
    severity: 'critical',
    confidence: 80,
    title: { fa: 'الگوی Dropper: نصب برنامه + بارگذاری کد پویا', en: 'Dropper pattern: package installation + dynamic code loading' },
    explanation: {
      fa: 'برنامه هم می‌تواند برنامه‌های دیگر را نصب کند و هم نشانه‌های بارگذاری کد در زمان اجرا در آن دیده می‌شود. این ترکیب مشخصه‌ی «dropper» است: برنامه‌ای که خودش بی‌خطر به نظر می‌رسد اما پس از نصب، بار مخرب اصلی را دانلود و اجرا می‌کند. این الگو تحلیل ایستا را دور می‌زند، چون کد واقعی در فایل APK وجود ندارد.',
      en: 'The app can install other packages and also shows signs of loading code at runtime. This is the hallmark of a dropper: an app that looks harmless but downloads and executes its real payload after installation. The pattern defeats static analysis because the actual code is not in the APK.',
    },
    recommendation: {
      fa: 'این برنامه را از منابع غیررسمی به‌هیچ‌وجه نصب نکنید.',
      en: 'Never install this app from unofficial sources.',
    },
  },
];

/** Severity floor helper used by the string-sweep analyser. */
export const worstOf = (a: Severity, b: Severity): Severity => {
  const order: Severity[] = ['safe', 'low', 'medium', 'high', 'critical'];
  return order.indexOf(a) >= order.indexOf(b) ? a : b;
};

export { shortPermission };

/** Placeholder to keep IOC typing available to callers importing from here. */
export type ApkIoc = Ioc;
