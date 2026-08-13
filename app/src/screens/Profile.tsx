/**
 * Profile — identity, usage stats and language switch.
 * Stats are fetched lazily on first visit so launch stays a single request.
 */
import { useEffect, useState } from 'react';
import { api, type CatalogResponse } from '../lib/api';
import { faDigits, faNum, gradientFor } from '../lib/design';
import { haptic, closeApp, requestFullscreen } from '../lib/telegram';
import { motion, Stagger, StaggerItem, Press } from '../components/Motion';
import { Segmented, StatCard } from '../components/Bits';
import { Icon, toolIcon } from '../components/Icon';

interface Props {
  catalog: CatalogResponse | null;
  favoritesCount: number;
  onLang: (lang: 'fa' | 'en') => void;
  onToast: (message: string, tone?: 'ok' | 'err') => void;
}

export function Profile({ catalog, favoritesCount, onLang, onToast }: Props): React.ReactElement {
  const [stats, setStats] = useState<{ topTools: { toolId: string; uses: number }[]; totalRuns: number; distinct: number } | null>(
    null,
  );

  useEffect(() => {
    let alive = true;
    api
      .stats()
      .then((data) => {
        if (alive) setStats(data);
      })
      .catch(() => {
        if (alive) setStats({ topTools: [], totalRuns: 0, distinct: 0 });
      });
    return () => {
      alive = false;
    };
  }, []);

  const nameOf = (toolId: string): string =>
    catalog?.tools.find((tool) => tool.id === toolId)?.title ?? toolId;
  const categoryOf = (toolId: string): string =>
    catalog?.tools.find((tool) => tool.id === toolId)?.category ?? 'utilities';

  return (
    <div className="scroll">
      {/* ─── Identity ──────────────────────────────────────────────── */}
      <motion.div
        initial={{ opacity: 0, scale: 0.96 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ type: 'spring', stiffness: 300, damping: 26 }}
        className="card"
        style={{ padding: 22, textAlign: 'center', marginBottom: 16, marginTop: 8, position: 'relative' }}
      >
        <span
          style={{
            position: 'absolute',
            inset: 0,
            background: 'var(--grad-royal)',
            opacity: 0.1,
            pointerEvents: 'none',
          }}
        />
        <motion.div
          animate={{ y: [0, -5, 0] }}
          transition={{ duration: 3.5, repeat: Infinity, ease: 'easeInOut' }}
          style={{
            width: 76,
            height: 76,
            borderRadius: 26,
            margin: '0 auto 12px',
            display: 'grid',
            placeItems: 'center',
            fontSize: 32,
            fontWeight: 700,
            color: '#fff',
            background: 'var(--grad-brand)',
            boxShadow: '0 18px 42px -12px rgba(99,102,241,0.8)',
          }}
        >
          {catalog?.user.name?.trim()?.charAt(0)?.toUpperCase() || <Icon name="user" size={32} />}
        </motion.div>
        <div className="h2">{catalog?.user.name ?? '—'}</div>
        <div className="tiny" style={{ marginTop: 3 }}>
          شناسه: <span className="num">{catalog ? faDigits(catalog.user.id) : '—'}</span>
        </div>
      </motion.div>

      {/* ─── Stats ─────────────────────────────────────────────────── */}
      <Stagger className="grid" >
        <StaggerItem>
          <StatCard
            icon="bolt"
            label="اجرای ابزار"
            value={stats ? faNum(stats.totalRuns) : '…'}
            category="programming"
          />
        </StaggerItem>
        <StaggerItem>
          <StatCard icon="puzzle" label="ابزار متمایز" value={stats ? faNum(stats.distinct) : '…'} category="network" />
        </StaggerItem>
        <StaggerItem>
          <StatCard icon="star" label="منتخب‌ها" value={faNum(favoritesCount)} category="favorites" />
        </StaggerItem>
        <StaggerItem>
          <StatCard
            icon="toolbox"
            label="ابزار در دسترس"
            value={catalog ? faNum(catalog.tools.length) : '…'}
            category="everyday"
          />
        </StaggerItem>
      </Stagger>

      {/* ─── Most used ─────────────────────────────────────────────── */}
      {stats && stats.topTools.length > 0 && (
        <section style={{ marginTop: 22 }}>
          <h2 className="h2" style={{ marginBottom: 11, display: 'flex', alignItems: 'center', gap: 8 }}>
            <Icon name="chart" size={17} />
            پرکاربردترین‌های شما
          </h2>
          <div className="card" style={{ padding: 6 }}>
            {stats.topTools.slice(0, 5).map((row, index) => {
              const max = stats.topTools[0]?.uses || 1;
              return (
                <motion.div
                  key={row.toolId}
                  initial={{ opacity: 0, x: 14 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: index * 0.06 }}
                  style={{ padding: '11px 12px', position: 'relative', borderRadius: 14, overflow: 'hidden' }}
                >
                  <motion.span
                    initial={{ scaleX: 0 }}
                    animate={{ scaleX: row.uses / max }}
                    transition={{ delay: 0.2 + index * 0.06, duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
                    style={{
                      position: 'absolute',
                      inset: 0,
                      transformOrigin: 'right',
                      background: gradientFor('everyday'),
                      opacity: 0.14,
                    }}
                  />
                  <div className="row between" style={{ position: 'relative' }}>
                    <span style={{ fontSize: 13.5, display: 'inline-flex', alignItems: 'center', gap: 9 }}>
                      <Icon name={toolIcon(row.toolId, categoryOf(row.toolId))} size={16} />
                      {nameOf(row.toolId)}
                    </span>
                    <span className="tiny num">{faNum(row.uses)}</span>
                  </div>
                </motion.div>
              );
            })}
          </div>
        </section>
      )}

      {/* ─── Language ──────────────────────────────────────────────── */}
      <section style={{ marginTop: 22 }}>
        <h2 className="h2" style={{ marginBottom: 11, display: 'flex', alignItems: 'center', gap: 8 }}>
          <Icon name="globe" size={17} />
          زبان
        </h2>
        <Segmented
          idPrefix="lang"
          value={catalog?.lang ?? 'fa'}
          options={[
            { id: 'fa', label: 'فارسی' },
            { id: 'en', label: 'English' },
          ]}
          onChange={(lang) => {
            onLang(lang);
            onToast(lang === 'fa' ? 'زبان روی فارسی تنظیم شد' : 'Language set to English');
          }}
        />
      </section>

      {/* ─── Actions ───────────────────────────────────────────────── */}
      <section style={{ marginTop: 22 }} className="stack">
        <Press
          className="btn btn-ghost"
          style={{ width: '100%' }}
          onClick={() => {
            haptic.press();
            requestFullscreen();
          }}
        >
          <Icon name="expand" size={16} />
          حالت تمام‌صفحه
        </Press>
        <Press
          className="btn btn-ghost"
          style={{ width: '100%' }}
          onClick={() => {
            haptic.press();
            closeApp();
          }}
        >
          <Icon name="exit" size={16} />
          بستن اپ
        </Press>
      </section>

      <div className="tiny" style={{ textAlign: 'center', marginTop: 26, opacity: 0.6 }}>
        DevNet Toolbox · ساخته‌شده روی Cloudflare Workers
      </div>
    </div>
  );
}
