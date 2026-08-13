/**
 * Telegram bridge.
 *
 * Every capability is probed before use: the same bundle runs on Telegram
 * 6.0 desktop and 9.x iOS, and calling a method the client does not implement
 * throws. Outside Telegram entirely (a plain browser during development) the
 * whole module degrades to no-ops so the UI still renders.
 */

interface HapticImpl {
  impactOccurred?: (style: string) => void;
  notificationOccurred?: (type: string) => void;
  selectionChanged?: () => void;
}

interface WebAppImpl {
  initData?: string;
  initDataUnsafe?: { user?: { id: number; first_name?: string; username?: string; language_code?: string } };
  colorScheme?: 'light' | 'dark';
  themeParams?: Record<string, string>;
  version?: string;
  platform?: string;
  isExpanded?: boolean;
  ready?: () => void;
  expand?: () => void;
  close?: () => void;
  requestFullscreen?: () => void;
  disableVerticalSwipes?: () => void;
  enableClosingConfirmation?: () => void;
  setHeaderColor?: (color: string) => void;
  setBackgroundColor?: (color: string) => void;
  HapticFeedback?: HapticImpl;
  BackButton?: { show: () => void; hide: () => void; onClick: (cb: () => void) => void; offClick: (cb: () => void) => void };
  MainButton?: {
    setText: (t: string) => void;
    show: () => void;
    hide: () => void;
    enable: () => void;
    disable: () => void;
    showProgress: (leaveActive?: boolean) => void;
    hideProgress: () => void;
    onClick: (cb: () => void) => void;
    offClick: (cb: () => void) => void;
    setParams: (p: Record<string, unknown>) => void;
  };
  onEvent?: (event: string, cb: () => void) => void;
  offEvent?: (event: string, cb: () => void) => void;
}

declare global {
  interface Window {
    Telegram?: { WebApp?: WebAppImpl };
  }
}

export const tg = (): WebAppImpl | undefined => window.Telegram?.WebApp;
export const inTelegram = (): boolean => Boolean(tg()?.initData);

/** Numeric platform version, for capability gates ("8.0" → 8.0). */
function version(): number {
  const raw = tg()?.version ?? '6.0';
  const [major, minor = '0'] = raw.split('.');
  return Number(`${major}.${minor.padStart(2, '0')}`);
}

const call = (fn: (() => void) | undefined): void => {
  try {
    fn?.();
  } catch {
    /* Older clients throw on unimplemented methods — non-fatal by design. */
  }
};

/* ─── Haptics ───────────────────────────────────────────────────────────
 * The single highest-impact "native feel" primitive. Every tap, toggle and
 * result goes through here.
 */
export const haptic = {
  tap: (): void => call(() => tg()?.HapticFeedback?.impactOccurred?.('light')),
  press: (): void => call(() => tg()?.HapticFeedback?.impactOccurred?.('medium')),
  heavy: (): void => call(() => tg()?.HapticFeedback?.impactOccurred?.('heavy')),
  rigid: (): void => call(() => tg()?.HapticFeedback?.impactOccurred?.('rigid')),
  select: (): void => call(() => tg()?.HapticFeedback?.selectionChanged?.()),
  ok: (): void => call(() => tg()?.HapticFeedback?.notificationOccurred?.('success')),
  warn: (): void => call(() => tg()?.HapticFeedback?.notificationOccurred?.('warning')),
  err: (): void => call(() => tg()?.HapticFeedback?.notificationOccurred?.('error')),
};

/** Telegram's own back arrow — not an HTML button. */
export const backButton = {
  show: (handler: () => void): (() => void) => {
    const button = tg()?.BackButton;
    if (!button) return () => undefined;
    call(() => button.onClick(handler));
    call(() => button.show());
    return () => {
      call(() => button.offClick(handler));
      call(() => button.hide());
    };
  },
  hide: (): void => call(() => tg()?.BackButton?.hide()),
};

/** Bottom-docked primary action rendered by Telegram itself. */
export const mainButton = {
  show: (text: string, handler: () => void, colors?: { bg?: string; text?: string }): (() => void) => {
    const button = tg()?.MainButton;
    if (!button) return () => undefined;
    call(() => button.setText(text));
    if (colors) call(() => button.setParams({ color: colors.bg, text_color: colors.text }));
    call(() => button.onClick(handler));
    call(() => button.show());
    return () => {
      call(() => button.offClick(handler));
      call(() => button.hide());
    };
  },
  busy: (on: boolean): void => call(() => (on ? tg()?.MainButton?.showProgress(true) : tg()?.MainButton?.hideProgress())),
  enabled: (on: boolean): void => call(() => (on ? tg()?.MainButton?.enable() : tg()?.MainButton?.disable())),
  hide: (): void => call(() => tg()?.MainButton?.hide()),
};

export function colorScheme(): 'light' | 'dark' {
  return tg()?.colorScheme ?? 'dark';
}

export function initData(): string {
  return tg()?.initData ?? '';
}

export function tgUser(): { id: number; first_name?: string; username?: string; language_code?: string } | undefined {
  return tg()?.initDataUnsafe?.user;
}

/**
 * One-time launch sequence.
 *
 * `disableVerticalSwipes` matters more than it looks: without it a downward
 * drag inside a scrollable area collapses the Mini App, which is the single
 * most "this is a web page" behaviour users notice.
 */
export function boot(): void {
  const app = tg();
  if (!app) return;
  call(() => app.ready?.());
  call(() => app.expand?.());
  if (version() >= 7.07) call(() => app.disableVerticalSwipes?.());
  const dark = colorScheme() === 'dark';
  const surface = dark ? '#07080f' : '#f4f6fc';
  call(() => app.setHeaderColor?.(surface));
  call(() => app.setBackgroundColor?.(surface));
}

/** Full-screen mode (Telegram 8.0+). Requires a user gesture on some clients. */
export function requestFullscreen(): void {
  if (version() >= 8.0) call(() => tg()?.requestFullscreen?.());
}

export function closeApp(): void {
  call(() => tg()?.close?.());
}

/** Subscribes to a Telegram client event; returns an unsubscribe function. */
export function onEvent(event: string, handler: () => void): () => void {
  const app = tg();
  if (!app?.onEvent) return () => undefined;
  call(() => app.onEvent?.(event, handler));
  return () => call(() => app.offEvent?.(event, handler));
}
