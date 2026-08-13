/**
 * App shell: routing, catalog loading, optimistic favourites.
 *
 * Routing is a tiny state machine rather than a router library — the app has
 * three tabs and one detail screen, and a 12 KB dependency to model that would
 * be dead weight in a WebView.
 */
import { useCallback, useEffect, useState } from 'react';
import { api, ApiError, type CatalogResponse, type ToolMeta } from './lib/api';
import { boot, backButton, haptic, colorScheme, onEvent, mainButton, inTelegram, hasLaunchData } from './lib/telegram';
import { Screen, motion } from './components/Motion';
import { ToastHost, useToast } from './components/Bits';
import { Icon, type IconName } from './components/Icon';
import { Home } from './screens/Home';
import { ToolView } from './screens/ToolView';
import { Profile } from './screens/Profile';

type Tab = 'home' | 'favorites' | 'profile';

const TABS: { id: Tab; icon: IconName; label: string }[] = [
  { id: 'home', icon: 'toolbox', label: 'ابزارها' },
  { id: 'favorites', icon: 'star', label: 'منتخب' },
  { id: 'profile', icon: 'user', label: 'پروفایل' },
];

export default function App(): React.ReactElement {
  const [catalog, setCatalog] = useState<CatalogResponse | null>(null);
  const [favorites, setFavorites] = useState<Set<string>>(new Set());
  const [tab, setTab] = useState<Tab>('home');
  const [active, setActive] = useState<ToolMeta | null>(null);
  const [direction, setDirection] = useState<1 | -1>(1);
  const [fatal, setFatal] = useState<string | null>(null);
  const { toast, show } = useToast();

  /* ─── Launch ──────────────────────────────────────────────────── */
  useEffect(() => {
    boot();
    const scheme = colorScheme();
    document.documentElement.dataset.scheme = scheme;
    const dispose = onEvent('themeChanged', () => {
      document.documentElement.dataset.scheme = colorScheme();
    });
    return dispose;
  }, []);

  useEffect(() => {
    let alive = true;
    api
      .catalog()
      .then((data) => {
        if (!alive) return;
        setCatalog(data);
        setFavorites(new Set(data.favorites));
        document.documentElement.lang = data.lang;
        document.documentElement.dir = data.lang === 'fa' ? 'rtl' : 'ltr';
      })
      .catch((error: unknown) => {
        if (!alive) return;
        const status = error instanceof ApiError ? error.status : -1;
        if (status === 401) {
          // Distinguish the two very different causes of a 401. If Telegram
          // handed us launch data and the server still rejected it, telling
          // the user to "open from Telegram" is wrong and unactionable — they
          // already did. That case is a stale/expired launch instead.
          setFatal(
            hasLaunchData()
              ? 'نشست شما منقضی شده. اپ را ببندید و دوباره از ربات باز کنید.'
              : 'اطلاعات ورود از تلگرام دریافت نشد. اپ را ببندید و دوباره از منوی ربات باز کنید.',
          );
        } else if (status === 0 || status === 408) {
          setFatal('اتصال به سرور برقرار نشد. اینترنت خود را بررسی کنید.');
        } else if (status === 429) {
          setFatal('درخواست‌ها بیش از حد سریع بود. کمی صبر کنید.');
        } else {
          setFatal('بارگذاری فهرست ابزارها ناموفق بود.');
        }
      });
    return () => {
      alive = false;
    };
  }, []);

  /* ─── Back button mirrors the navigation stack ────────────────── */
  const closeTool = useCallback(() => {
    setDirection(-1);
    setActive(null);
    mainButton.hide();
  }, []);

  useEffect(() => {
    if (!active) {
      backButton.hide();
      return undefined;
    }
    return backButton.show(() => {
      haptic.tap();
      closeTool();
    });
  }, [active, closeTool]);

  /* ─── Optimistic favourite toggle ─────────────────────────────── */
  const toggleStar = useCallback(
    (toolId: string) => {
      const on = !favorites.has(toolId);
      // Paint first, reconcile after: network latency must never be visible.
      setFavorites((previous) => {
        const next = new Set(previous);
        if (on) next.add(toolId);
        else next.delete(toolId);
        return next;
      });
      api
        .favorite(toolId, on)
        .then((response) => setFavorites(new Set(response.favorites)))
        .catch(() => {
          setFavorites((previous) => {
            const next = new Set(previous);
            if (on) next.delete(toolId);
            else next.add(toolId);
            return next;
          });
          show('ذخیره نشد، دوباره تلاش کنید', 'err');
        });
    },
    [favorites, show],
  );

  const openTool = useCallback((tool: ToolMeta) => {
    setDirection(1);
    setActive(tool);
  }, []);

  const switchTab = useCallback(
    (next: Tab) => {
      if (next === tab) return;
      haptic.select();
      setDirection(TABS.findIndex((t) => t.id === next) > TABS.findIndex((t) => t.id === tab) ? 1 : -1);
      setActive(null);
      setTab(next);
    },
    [tab],
  );

  /* ─── Fatal state ─────────────────────────────────────────────── */
  if (fatal) {
    return (
      <>
        <Aurora />
        <div className="shell">
          <div className="scroll" style={{ display: 'grid', placeItems: 'center' }}>
            <motion.div
              initial={{ opacity: 0, scale: 0.94 }}
              animate={{ opacity: 1, scale: 1 }}
              className="card"
              style={{ padding: 30, textAlign: 'center', maxWidth: 320 }}
            >
              <span
                className="badge badge-lg"
                style={{ background: 'var(--grad-warm)', margin: '0 auto 14px' }}
              >
                <Icon name={inTelegram() ? 'alert' : 'phone'} size={26} />
              </span>
              <div className="h2">{fatal}</div>
              <div className="muted" style={{ marginTop: 8 }}>
                {inTelegram() ? 'اگر ادامه داشت، تلگرام را ببندید و دوباره باز کنید.' : 'ربات @Toolsbotxbot را باز کنید و از منو وارد شوید.'}
              </div>
            </motion.div>
          </div>
        </div>
      </>
    );
  }

  const screenKey = active ? `tool:${active.id}` : tab;

  return (
    <>
      <Aurora />
      <div className="grain" />
      <div className="shell">
        <Screen keyName={screenKey} direction={direction}>
          {active ? (
            <ToolView
              tool={active}
              starred={favorites.has(active.id)}
              onStar={() => toggleStar(active.id)}
              onToast={show}
            />
          ) : tab === 'home' ? (
            <Home catalog={catalog} favorites={favorites} onOpen={openTool} onStar={toggleStar} />
          ) : tab === 'favorites' ? (
            <Home
              catalog={
                catalog ? { ...catalog, tools: catalog.tools.filter((tool) => favorites.has(tool.id)) } : null
              }
              favorites={favorites}
              onOpen={openTool}
              onStar={toggleStar}
            />
          ) : (
            <Profile catalog={catalog} favoritesCount={favorites.size} onLang={setLang} onToast={show} />
          )}
        </Screen>

        {!active && (
          <nav className="tabbar">
            {TABS.map((entry) => (
              <button
                key={entry.id}
                type="button"
                data-on={entry.id === tab ? '1' : '0'}
                onClick={() => switchTab(entry.id)}
              >
                {entry.id === tab && (
                  <motion.span
                    layoutId="tab-glow"
                    transition={{ type: 'spring', stiffness: 420, damping: 34 }}
                    style={{
                      position: 'absolute',
                      inset: '2px 10px',
                      borderRadius: 14,
                      background: 'var(--surface-hi)',
                      zIndex: -1,
                    }}
                  />
                )}
                <span className="ico">
                  <Icon name={entry.icon} size={21} filled={entry.id === 'favorites' && entry.id === tab} />
                </span>
                {entry.label}
              </button>
            ))}
          </nav>
        )}
      </div>
      <ToastHost toast={toast} />
    </>
  );

  function setLang(lang: 'fa' | 'en'): void {
    setCatalog((previous) => (previous ? { ...previous, lang } : previous));
    document.documentElement.lang = lang;
    document.documentElement.dir = lang === 'fa' ? 'rtl' : 'ltr';
    api.setLang(lang).catch(() => show('تغییر زبان ذخیره نشد', 'err'));
  }
}

function Aurora(): React.ReactElement {
  return (
    <div className="aurora" aria-hidden="true">
      <span />
      <span />
      <span />
    </div>
  );
}
