/**
 * Android permission knowledge base.
 *
 * Severity here describes the *capability granted*, not guilt. A messaging app
 * legitimately needs RECORD_AUDIO. Escalation to a serious verdict only happens
 * in the correlation rules, where several capabilities combine into a pattern.
 */
import type { Severity } from './types.js';

export interface PermissionInfo {
  /** Short name without the `android.permission.` prefix. */
  short: string;
  severity: Severity;
  /** Grouping used by the data-collection heuristics. */
  group: 'location' | 'camera' | 'microphone' | 'contacts' | 'sms' | 'phone' | 'storage' | 'calendar' | 'sensors' | 'admin' | 'network' | 'system' | 'accounts';
  fa: string;
  en: string;
}

const P = (
  short: string,
  severity: Severity,
  group: PermissionInfo['group'],
  fa: string,
  en: string,
): [string, PermissionInfo] => [short, { short, severity, group, fa, en }];

/** Permissions Android itself classifies as dangerous, plus notable specials. */
export const PERMISSION_DB = new Map<string, PermissionInfo>([
  // ── Location
  P('ACCESS_FINE_LOCATION', 'medium', 'location', 'دسترسی به موقعیت مکانی دقیق (GPS)', 'Precise GPS location'),
  P('ACCESS_COARSE_LOCATION', 'low', 'location', 'دسترسی به موقعیت مکانی تقریبی', 'Approximate location'),
  P('ACCESS_BACKGROUND_LOCATION', 'high', 'location', 'ردیابی موقعیت مکانی در پس‌زمینه', 'Background location tracking'),
  // ── Camera & microphone
  P('CAMERA', 'medium', 'camera', 'دسترسی به دوربین', 'Camera access'),
  P('RECORD_AUDIO', 'medium', 'microphone', 'ضبط صدا از میکروفون', 'Microphone recording'),
  // ── Contacts & accounts
  P('READ_CONTACTS', 'medium', 'contacts', 'خواندن دفترچه مخاطبان', 'Read contacts'),
  P('WRITE_CONTACTS', 'medium', 'contacts', 'تغییر دفترچه مخاطبان', 'Modify contacts'),
  P('GET_ACCOUNTS', 'medium', 'accounts', 'مشاهده حساب‌های کاربری دستگاه', 'List device accounts'),
  // ── SMS & call
  P('READ_SMS', 'high', 'sms', 'خواندن پیامک‌ها', 'Read SMS messages'),
  P('RECEIVE_SMS', 'high', 'sms', 'دریافت پیامک‌های ورودی', 'Intercept incoming SMS'),
  P('SEND_SMS', 'high', 'sms', 'ارسال پیامک (هزینه‌بر)', 'Send SMS (can incur charges)'),
  P('RECEIVE_MMS', 'medium', 'sms', 'دریافت پیام‌های چندرسانه‌ای', 'Receive MMS'),
  P('READ_CALL_LOG', 'high', 'phone', 'خواندن تاریخچه تماس‌ها', 'Read call history'),
  P('WRITE_CALL_LOG', 'high', 'phone', 'تغییر تاریخچه تماس‌ها', 'Modify call history'),
  P('CALL_PHONE', 'medium', 'phone', 'برقراری تماس بدون تأیید کاربر', 'Place calls without confirmation'),
  P('ANSWER_PHONE_CALLS', 'high', 'phone', 'پاسخ‌گویی خودکار به تماس‌ها', 'Answer calls programmatically'),
  P('PROCESS_OUTGOING_CALLS', 'high', 'phone', 'رهگیری تماس‌های خروجی', 'Intercept outgoing calls'),
  P('READ_PHONE_STATE', 'low', 'phone', 'خواندن وضعیت و شناسه‌های دستگاه', 'Read phone state and identifiers'),
  P('READ_PHONE_NUMBERS', 'medium', 'phone', 'خواندن شماره تلفن دستگاه', 'Read device phone number'),
  // ── Storage
  P('READ_EXTERNAL_STORAGE', 'low', 'storage', 'خواندن حافظه خارجی', 'Read external storage'),
  P('WRITE_EXTERNAL_STORAGE', 'medium', 'storage', 'نوشتن در حافظه خارجی', 'Write to external storage'),
  P('MANAGE_EXTERNAL_STORAGE', 'high', 'storage', 'دسترسی کامل به تمام فایل‌های دستگاه', 'Full access to all device files'),
  P('READ_MEDIA_IMAGES', 'low', 'storage', 'خواندن تصاویر کاربر', 'Read user images'),
  P('READ_MEDIA_VIDEO', 'low', 'storage', 'خواندن ویدیوهای کاربر', 'Read user videos'),
  P('READ_MEDIA_AUDIO', 'low', 'storage', 'خواندن فایل‌های صوتی کاربر', 'Read user audio files'),
  // ── Calendar & sensors
  P('READ_CALENDAR', 'medium', 'calendar', 'خواندن رویدادهای تقویم', 'Read calendar events'),
  P('WRITE_CALENDAR', 'low', 'calendar', 'تغییر رویدادهای تقویم', 'Modify calendar events'),
  P('BODY_SENSORS', 'medium', 'sensors', 'دسترسی به حسگرهای بدن', 'Access body sensors'),
  P('ACTIVITY_RECOGNITION', 'low', 'sensors', 'تشخیص فعالیت بدنی کاربر', 'Detect physical activity'),
  // ── System / persistence
  P('RECEIVE_BOOT_COMPLETED', 'low', 'system', 'اجرای خودکار پس از روشن شدن دستگاه', 'Auto-start after device boot'),
  P('SYSTEM_ALERT_WINDOW', 'high', 'system', 'نمایش پنجره روی سایر برنامه‌ها (Overlay)', 'Draw overlays over other apps'),
  P('REQUEST_INSTALL_PACKAGES', 'high', 'system', 'نصب برنامه‌های دیگر', 'Install other applications'),
  P('REQUEST_DELETE_PACKAGES', 'medium', 'system', 'حذف برنامه‌های دیگر', 'Delete other applications'),
  P('QUERY_ALL_PACKAGES', 'medium', 'system', 'مشاهده فهرست تمام برنامه‌های نصب‌شده', 'Enumerate all installed apps'),
  P('FOREGROUND_SERVICE', 'low', 'system', 'اجرای سرویس در پیش‌زمینه', 'Run a foreground service'),
  P('WAKE_LOCK', 'low', 'system', 'جلوگیری از خواب رفتن دستگاه', 'Keep the device awake'),
  P('REQUEST_IGNORE_BATTERY_OPTIMIZATIONS', 'medium', 'system', 'معافیت از بهینه‌سازی باتری (اجرای دائمی)', 'Exempt from battery optimisation'),
  P('DISABLE_KEYGUARD', 'medium', 'system', 'غیرفعال کردن قفل صفحه', 'Disable the lock screen'),
  P('BIND_DEVICE_ADMIN', 'high', 'admin', 'دریافت اختیارات مدیر دستگاه', 'Obtain device-administrator powers'),
  P('BIND_ACCESSIBILITY_SERVICE', 'high', 'admin', 'سرویس دسترس‌پذیری (خواندن و کنترل صفحه)', 'Accessibility service (read/control screen)'),
  P('BIND_NOTIFICATION_LISTENER_SERVICE', 'high', 'admin', 'خواندن تمام اعلان‌ها', 'Read all notifications'),
  P('PACKAGE_USAGE_STATS', 'medium', 'admin', 'مشاهده آمار استفاده از برنامه‌ها', 'View app usage statistics'),
  P('WRITE_SETTINGS', 'medium', 'system', 'تغییر تنظیمات سیستم', 'Modify system settings'),
  P('WRITE_SECURE_SETTINGS', 'high', 'system', 'تغییر تنظیمات امن سیستم', 'Modify secure system settings'),
  P('MOUNT_UNMOUNT_FILESYSTEMS', 'medium', 'system', 'اتصال و جدا کردن سیستم فایل', 'Mount/unmount filesystems'),
  P('MODIFY_AUDIO_SETTINGS', 'low', 'system', 'تغییر تنظیمات صدا', 'Change audio settings'),
  P('SCHEDULE_EXACT_ALARM', 'low', 'system', 'زمان‌بندی دقیق اجرای وظایف', 'Schedule exact alarms'),
  // ── Network
  P('INTERNET', 'low', 'network', 'دسترسی به اینترنت', 'Internet access'),
  P('ACCESS_NETWORK_STATE', 'low', 'network', 'مشاهده وضعیت شبکه', 'View network state'),
  P('ACCESS_WIFI_STATE', 'low', 'network', 'مشاهده وضعیت Wi-Fi', 'View Wi-Fi state'),
  P('CHANGE_WIFI_STATE', 'medium', 'network', 'تغییر وضعیت Wi-Fi', 'Change Wi-Fi state'),
  P('BLUETOOTH_CONNECT', 'low', 'network', 'اتصال به دستگاه‌های بلوتوث', 'Connect to Bluetooth devices'),
  P('NFC', 'low', 'network', 'استفاده از NFC', 'Use NFC'),
]);

/** Strips the standard prefix so lookups work for any vendor namespace. */
export function shortPermission(name: string): string {
  const parts = name.split('.');
  return parts[parts.length - 1] ?? name;
}

export function lookupPermission(name: string): PermissionInfo | undefined {
  return PERMISSION_DB.get(shortPermission(name));
}

/** True when the permission is not part of the standard `android.permission` tree. */
export function isCustomPermission(name: string): boolean {
  return !name.startsWith('android.permission.') && !name.startsWith('com.android.') && !name.startsWith('android.');
}
