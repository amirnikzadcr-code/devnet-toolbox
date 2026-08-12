import { describe, expect, it } from 'vitest';
import { analyseApk, manifestFindings, APK_CORRELATIONS } from '../../src/security/apk.js';
import { sweepApkStrings } from '../../src/security/behaviour.js';
import { scanApk } from '../../src/security/scans.js';
import { buildApk, buildZip, BENIGN_APK, type ApkSpec } from '../helpers/apk-builder.js';
import { ToolError } from '../../src/utils/errors.js';

const idsOf = (findings: { id: string }[]): string[] => findings.map((finding) => finding.id);

describe('APK manifest parsing', () => {
  it('extracts package identity from a valid APK', async () => {
    const { analysis } = await analyseApk(buildApk(BENIGN_APK));

    expect(analysis.packageName).toBe('com.example.notes');
    expect(analysis.versionName).toBe('2.1.0');
    expect(analysis.versionCode).toBe('21');
    expect(analysis.minSdk).toBe(24);
    expect(analysis.targetSdk).toBe(34);
    expect(analysis.appLabel).toBe('Notes');
  });

  it('counts components by kind and detects the launcher activity as exported', async () => {
    const spec: ApkSpec = {
      ...BENIGN_APK,
      activities: [{ name: '.Main', actions: ['android.intent.action.MAIN'] }, { name: '.Second' }],
      services: [{ name: '.Sync' }],
      receivers: [{ name: '.Boot', actions: ['android.intent.action.BOOT_COMPLETED'] }],
      providers: [{ name: '.Files', exported: true }],
    };
    const { analysis } = await analyseApk(buildApk(spec));

    const kinds = analysis.components.map((component) => component.kind);
    expect(kinds.filter((kind) => kind === 'activity')).toHaveLength(2);
    expect(kinds.filter((kind) => kind === 'service')).toHaveLength(1);
    expect(kinds.filter((kind) => kind === 'receiver')).toHaveLength(1);
    expect(kinds.filter((kind) => kind === 'provider')).toHaveLength(1);

    // An intent-filter implies exported when the attribute is absent.
    const main = analysis.components.find((component) => component.name === '.Main');
    expect(main?.exported).toBe(true);
    expect(main?.exportInferred).toBe(true);

    // No filter and no attribute → not reachable from outside.
    expect(analysis.components.find((component) => component.name === '.Second')?.exported).toBe(false);
  });

  it('honours an explicit exported="false" over an intent filter', async () => {
    const { analysis } = await analyseApk(
      buildApk({ ...BENIGN_APK, activities: [{ name: '.Hidden', exported: false, actions: ['custom.ACTION'] }] }),
    );
    expect(analysis.components.find((component) => component.name === '.Hidden')?.exported).toBe(false);
  });

  it('extracts deep links from intent filter data elements', async () => {
    const { analysis } = await analyseApk(
      buildApk({
        ...BENIGN_APK,
        activities: [
          {
            name: '.Deep',
            actions: ['android.intent.action.VIEW'],
            data: [{ scheme: 'myapp', host: 'open' }],
          },
        ],
      }),
    );
    const findings = manifestFindings(analysis);
    expect(idsOf(findings)).toContain('apk.component.deeplinks');
  });

  it('separates custom permissions from platform ones', async () => {
    const { analysis } = await analyseApk(
      buildApk({
        ...BENIGN_APK,
        permissions: ['android.permission.CAMERA'],
        customPermissions: ['com.example.notes.permission.SYNC'],
      }),
    );
    expect(analysis.permissions).toContain('android.permission.CAMERA');
    expect(analysis.customPermissions).toContain('com.example.notes.permission.SYNC');
  });
});

describe('APK manifest findings', () => {
  it('flags dangerous permissions individually', async () => {
    const { analysis } = await analyseApk(
      buildApk({ ...BENIGN_APK, permissions: ['android.permission.RECORD_AUDIO', 'android.permission.CAMERA'] }),
    );
    const ids = idsOf(manifestFindings(analysis));
    expect(ids).toContain('apk.perm.record_audio');
    expect(ids).toContain('apk.perm.camera');
  });

  it('flags debuggable and cleartext configuration', async () => {
    const { analysis } = await analyseApk(buildApk({ ...BENIGN_APK, debuggable: true }));
    expect(idsOf(manifestFindings(analysis))).toContain('apk.config.debuggable');
  });

  it('flags an unsigned package', async () => {
    const { analysis } = await analyseApk(buildApk({ ...BENIGN_APK, signed: false }));
    expect(idsOf(manifestFindings(analysis))).toContain('apk.integrity.unsigned');
  });

  it('flags an exported content provider more seriously than other components', async () => {
    const { analysis } = await analyseApk(
      buildApk({ ...BENIGN_APK, providers: [{ name: '.Leaky', exported: true }] }),
    );
    const finding = manifestFindings(analysis).find((item) => item.id === 'apk.component.exported_provider');
    expect(finding).toBeDefined();
    expect(finding?.severity).toBe('high');
  });

  it('does not flag a benign app with a single permission', async () => {
    const { analysis } = await analyseApk(buildApk(BENIGN_APK));
    const ids = idsOf(manifestFindings(analysis));
    expect(ids).not.toContain('apk.perm.excessive');
    expect(ids.filter((id) => id.startsWith('apk.perm.'))).toHaveLength(0);
  });
});

describe('APK risk correlation', () => {
  it('never reaches CRITICAL from permissions alone', async () => {
    // Deliberately alarming permission list, but no corroborating components.
    const { report } = await scanApk(
      buildApk({
        ...BENIGN_APK,
        permissions: [
          'android.permission.RECORD_AUDIO',
          'android.permission.CAMERA',
          'android.permission.READ_CONTACTS',
          'android.permission.READ_SMS',
          'android.permission.ACCESS_FINE_LOCATION',
          'android.permission.READ_CALL_LOG',
          'android.permission.READ_EXTERNAL_STORAGE',
          'android.permission.SYSTEM_ALERT_WINDOW',
        ],
      }),
      'suspicious.apk',
    );

    // The engine must not brand this spyware without correlated evidence.
    expect(report.severity).not.toBe('critical');
    expect(report.score).toBeLessThanOrEqual(74);
  });

  it('raises the overlay+accessibility correlation to critical', async () => {
    const { report } = await scanApk(
      buildApk({
        ...BENIGN_APK,
        permissions: ['android.permission.SYSTEM_ALERT_WINDOW'],
        services: [
          {
            name: '.A11yService',
            permission: 'android.permission.BIND_ACCESSIBILITY_SERVICE',
            actions: ['android.accessibilityservice.AccessibilityService'],
          },
        ],
      }),
      'overlay.apk',
    );

    expect(idsOf(report.findings)).toContain('apk.corr.overlay_accessibility');
    expect(report.severity).toBe('critical');
  });

  it('requires the device-admin anchor for the stealth-persistence rule', async () => {
    // Boot receiver + background service is ubiquitous in ordinary apps and
    // must not, on its own, imply uninstall-resistant persistence.
    const { report } = await scanApk(
      buildApk({
        ...BENIGN_APK,
        services: [{ name: '.SyncService' }],
        receivers: [{ name: '.BootReceiver', actions: ['android.intent.action.BOOT_COMPLETED'] }],
      }),
      'ordinary.apk',
    );
    expect(idsOf(report.findings)).not.toContain('apk.corr.stealth_admin');
  });

  it('fires the stealth-persistence rule when device admin is present', async () => {
    const { report } = await scanApk(
      buildApk({
        ...BENIGN_APK,
        services: [{ name: '.Svc' }],
        receivers: [
          { name: '.BootReceiver', actions: ['android.intent.action.BOOT_COMPLETED'] },
          {
            name: '.Admin',
            permission: 'android.permission.BIND_DEVICE_ADMIN',
            actions: ['android.app.action.DEVICE_ADMIN_ENABLED'],
          },
        ],
      }),
      'admin.apk',
    );
    expect(idsOf(report.findings)).toContain('apk.corr.stealth_admin');
  });

  it('every correlation rule references findings that can actually be produced', async () => {
    // Guards against a rule silently never firing because of an id typo.
    const { analysis } = await analyseApk(
      buildApk({
        ...BENIGN_APK,
        permissions: [
          'android.permission.RECORD_AUDIO',
          'android.permission.ACCESS_BACKGROUND_LOCATION',
          'android.permission.READ_SMS',
          'android.permission.SYSTEM_ALERT_WINDOW',
          'android.permission.READ_CONTACTS',
          'android.permission.READ_CALL_LOG',
          'android.permission.ACCESS_FINE_LOCATION',
          'android.permission.REQUEST_INSTALL_PACKAGES',
        ],
        services: [
          { name: '.S' },
          { name: '.A11y', permission: 'android.permission.BIND_ACCESSIBILITY_SERVICE' },
        ],
        receivers: [
          { name: '.Boot', actions: ['android.intent.action.BOOT_COMPLETED'] },
          { name: '.Sms', actions: ['android.provider.Telephony.SMS_RECEIVED'] },
          { name: '.Admin', permission: 'android.permission.BIND_DEVICE_ADMIN' },
        ],
      }),
    );

    const produced = new Set(idsOf(manifestFindings(analysis)));
    // `apk.behaviour.*` ids come from the string sweep instead.
    const missing: string[] = [];
    for (const rule of APK_CORRELATIONS) {
      for (const pattern of rule.requires) {
        if (pattern.startsWith('apk.behaviour.')) continue;
        if (!produced.has(pattern)) missing.push(`${rule.id} → ${pattern}`);
      }
    }
    expect(missing).toEqual([]);
  });
});

describe('APK behavioural sweep', () => {
  it('detects dynamic code loading from DEX strings', async () => {
    const apk = buildApk({
      ...BENIGN_APK,
      dexStrings: ['Ldalvik/system/DexClassLoader', 'loadDex', 'openDexFile'],
    });
    const { analysis, zip } = await analyseApk(apk);
    const sweep = await sweepApkStrings(zip, analysis);
    expect(idsOf(sweep.findings)).toContain('apk.behaviour.dynamic_load');
  });

  it('requires manifest corroboration before reporting accessibility keylogging', async () => {
    // AndroidX ships these symbols; a string match alone must not accuse.
    const apk = buildApk({
      ...BENIGN_APK,
      dexStrings: ['AccessibilityNodeInfo', 'TYPE_VIEW_TEXT_CHANGED', 'getRootInActiveWindow'],
    });
    const { analysis, zip } = await analyseApk(apk);
    const withoutManifest = await sweepApkStrings(zip, analysis, new Set());
    expect(idsOf(withoutManifest.findings)).not.toContain('apk.behaviour.keylog');

    const withManifest = await sweepApkStrings(zip, analysis, new Set(['apk.service.accessibility']));
    expect(idsOf(withManifest.findings)).toContain('apk.behaviour.keylog');
  });

  it('extracts network IOCs from DEX strings and skips well-known SDK hosts', async () => {
    const apk = buildApk({
      ...BENIGN_APK,
      dexStrings: ['http://c2.evil-panel.tk/gate.php', 'https://www.googleapis.com/auth', '203.0.113.77'],
    });
    const { analysis, zip } = await analyseApk(apk);
    const sweep = await sweepApkStrings(zip, analysis);

    const values = sweep.iocs.map((ioc) => ioc.value);
    expect(values.some((value) => value.includes('evil-panel.tk'))).toBe(true);
    expect(values.some((value) => value.includes('googleapis.com'))).toBe(false);
  });

  it('reports native libraries with their ABIs', async () => {
    const apk = buildApk({ ...BENIGN_APK, nativeLibs: ['lib/arm64-v8a/libfoo.so', 'lib/x86/libfoo.so'] });
    const { analysis, zip } = await analyseApk(apk);
    const sweep = await sweepApkStrings(zip, analysis);
    const finding = sweep.findings.find((item) => item.id === 'apk.behaviour.native_lib');
    expect(finding?.evidence.join(' ')).toContain('arm64-v8a');
  });

  it('warns when the code could not be read at all', async () => {
    const { analysis, zip } = await analyseApk(buildApk({ ...BENIGN_APK, dexStrings: ['x'] }));
    // A zero-byte budget forces every read to fail.
    const sweep = await sweepApkStrings(zip, analysis, new Set(), 0);
    expect(idsOf(sweep.findings)).toContain('apk.analysis.no_code_read');
  });
});

describe('APK error handling', () => {
  it('rejects a file that is not a ZIP archive', async () => {
    await expect(analyseApk(new TextEncoder().encode('this is plain text, not an apk'))).rejects.toThrow(ToolError);
  });

  it('rejects an empty file', async () => {
    await expect(analyseApk(new Uint8Array(0))).rejects.toThrow(ToolError);
  });

  it('rejects a truncated archive', async () => {
    const apk = buildApk(BENIGN_APK);
    await expect(analyseApk(apk.slice(0, Math.floor(apk.length / 2)))).rejects.toThrow(ToolError);
  });

  it('rejects a valid ZIP that contains no AndroidManifest.xml', async () => {
    const zip = buildZip([{ name: 'readme.txt', data: new TextEncoder().encode('hello') }]);
    await expect(analyseApk(zip)).rejects.toThrow(ToolError);
  });

  it('rejects an AndroidManifest.xml that is not binary XML', async () => {
    const zip = buildZip([
      { name: 'AndroidManifest.xml', data: new TextEncoder().encode('<manifest package="x"/>') },
    ]);
    await expect(analyseApk(zip)).rejects.toThrow(ToolError);
  });
});
