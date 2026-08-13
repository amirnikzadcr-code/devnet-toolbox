/**
 * Home — hero, quick actions, favourites and the searchable tool grid.
 *
 * Search and category filtering happen entirely on the client against the
 * catalog fetched once at launch. That is deliberate: navigation must cost
 * zero Worker requests, which is what makes the Mini App cheaper to run than
 * the bot's button flow.
 */
import { useMemo, useState } from 'react';
import type { CatalogResponse, ToolMeta } from '../lib/api';
import { faNum, gradientFor } from '../lib/design';
import { haptic } from '../lib/telegram';
import { motion, Stagger, StaggerItem, Press } from '../components/Motion';
import { CategoryChips, ToolTile, TileSkeletons } from '../components/Bits';

interface Props {
  catalog: CatalogResponse | null;
  favorites: Set<string>;
  onOpen: (tool: ToolMeta) => void;
  onStar: (toolId: string) => void;
}

export function Home({ catalog, favorites, onOpen, onStar }: Props): React.ReactElement {
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('all');

  const categories = useMemo(() => {
    const base = [{ id: 'all', icon: '✨', title: 'همه', count: catalog?.tools.length ?? 0 }];
    return base.concat(catalog?.categories ?? []);
  }, [catalog]);

  const visible = useMemo(() => {
    const tools = catalog?.tools ?? [];
    const needle = query.trim().toLowerCase();
    return tools.filter((tool) => {
      if (category !== 'all' && tool.category !== category) return false;
      if (!needle) return true;
      return (
        tool.title.toLowerCase().includes(needle) ||
        tool.description.toLowerCase().includes(needle) ||
        tool.id.toLowerCase().includes(needle)
      );
    });
  }, [catalog, query, category]);

  const starred = useMemo(
    () => (catalog?.tools ?? []).filter((tool) => favorites.has(tool.id)),
    [catalog, favorites],
  );

  return (
    <div className="scroll">
      {/* ─── Hero ──────────────────────────────────────────────────── */}
      <motion.div
        initial={{ opacity: 0, y: -12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
        style={{ padding: '10px 2px 18px' }}
      >
        <div className="row between" style={{ alignItems: 'flex-start' }}>
          <div>
            <div className="tiny" style={{ marginBottom: 2 }}>
              {catalog ? `سلام ${catalog.user.name} 👋` : '\u00a0'}
            </div>
            <h1 className="h1">
              <span className="gradient-text">DevNet</span> Toolbox
            </h1>
            <div className="muted" style={{ marginTop: 2 }}>
              {catalog ? (
                <>
                  <span className="num">{faNum(catalog.tools.length)}</span> ابزار حرفه‌ای، یک‌جا
                </>
              ) : (
                'در حال بارگذاری…'
              )}
            </div>
          </div>
          <motion.div
            animate={{ rotate: [0, 8, -6, 0], scale: [1, 1.06, 1] }}
            transition={{ duration: 5, repeat: Infinity, ease: 'easeInOut' }}
            style={{
              width: 54,
              height: 54,
              borderRadius: 18,
              display: 'grid',
              placeItems: 'center',
              fontSize: 27,
              background: 'var(--grad-brand)',
              boxShadow: '0 14px 34px -10px rgba(99,102,241,0.75)',
              flexShrink: 0,
            }}
          >
            🧰
          </motion.div>
        </div>
      </motion.div>

      {/* ─── Search ────────────────────────────────────────────────── */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.06, duration: 0.45 }}
        style={{ position: 'relative', marginBottom: 14 }}
      >
        <input
          className="field"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="جستجو در ابزارها…"
          style={{ paddingInlineStart: 42 }}
          inputMode="search"
        />
        <span
          style={{
            position: 'absolute',
            insetInlineStart: 14,
            top: '50%',
            transform: 'translateY(-50%)',
            fontSize: 16,
            opacity: 0.6,
            pointerEvents: 'none',
          }}
        >
          🔍
        </span>
        {query && (
          <Press
            onClick={() => {
              haptic.tap();
              setQuery('');
            }}
            style={{
              position: 'absolute',
              insetInlineEnd: 10,
              top: '50%',
              transform: 'translateY(-50%)',
              border: 0,
              background: 'var(--surface-hi)',
              color: 'var(--text-2)',
              width: 26,
              height: 26,
              borderRadius: 9,
              cursor: 'pointer',
              fontSize: 13,
            }}
          >
            ✕
          </Press>
        )}
      </motion.div>

      {/* ─── Categories ────────────────────────────────────────────── */}
      <div style={{ marginBottom: 18 }}>
        <CategoryChips categories={categories} value={category} onChange={setCategory} />
      </div>

      {/* ─── Favourites shelf ──────────────────────────────────────── */}
      {starred.length > 0 && !query && category === 'all' && (
        <motion.section
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          style={{ marginBottom: 22 }}
        >
          <div className="row between" style={{ marginBottom: 10 }}>
            <h2 className="h2">⭐ منتخب‌های شما</h2>
            <span className="tiny num">{faNum(starred.length)}</span>
          </div>
          <div className="row" style={{ gap: 10, overflowX: 'auto', paddingBottom: 4, scrollbarWidth: 'none' }}>
            {starred.map((tool) => (
              <motion.button
                key={tool.id}
                whileTap={{ scale: 0.94 }}
                onClick={() => {
                  haptic.tap();
                  onOpen(tool);
                }}
                style={{
                  flexShrink: 0,
                  width: 96,
                  padding: '14px 10px',
                  borderRadius: 18,
                  border: '1px solid var(--stroke)',
                  background: 'var(--surface)',
                  color: 'var(--text-1)',
                  font: 'inherit',
                  cursor: 'pointer',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: 7,
                }}
              >
                <span
                  style={{
                    width: 40,
                    height: 40,
                    borderRadius: 13,
                    display: 'grid',
                    placeItems: 'center',
                    fontSize: 20,
                    background: gradientFor(tool.category),
                  }}
                >
                  {tool.icon}
                </span>
                <span style={{ fontSize: 11, fontWeight: 500, textAlign: 'center', lineHeight: 1.35 }}>
                  {tool.title}
                </span>
              </motion.button>
            ))}
          </div>
        </motion.section>
      )}

      {/* ─── Grid ──────────────────────────────────────────────────── */}
      <div className="row between" style={{ marginBottom: 11 }}>
        <h2 className="h2">
          {query ? 'نتایج جستجو' : category === 'all' ? 'همهٔ ابزارها' : categories.find((c) => c.id === category)?.title}
        </h2>
        <span className="tiny num">{faNum(visible.length)}</span>
      </div>

      {!catalog ? (
        <TileSkeletons />
      ) : visible.length === 0 ? (
        <motion.div
          initial={{ opacity: 0, scale: 0.96 }}
          animate={{ opacity: 1, scale: 1 }}
          className="card"
          style={{ padding: 32, textAlign: 'center' }}
        >
          <div style={{ fontSize: 38, marginBottom: 8 }}>🔍</div>
          <div className="h3">چیزی پیدا نشد</div>
          <div className="muted" style={{ marginTop: 4 }}>
            عبارت دیگری را امتحان کنید.
          </div>
        </motion.div>
      ) : (
        <Stagger className="grid">
          {visible.map((tool) => (
            <StaggerItem key={tool.id}>
              <ToolTile
                tool={tool}
                starred={favorites.has(tool.id)}
                onOpen={() => onOpen(tool)}
                onStar={() => onStar(tool.id)}
              />
            </StaggerItem>
          ))}
        </Stagger>
      )}
    </div>
  );
}
