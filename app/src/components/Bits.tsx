/**
 * Small shared UI pieces: segmented control, chips, skeletons, toasts, tiles.
 * All of them are haptic-aware — touching anything in this file buzzes.
 */
import { useEffect, useState } from 'react';
import { motion, AnimatePresence, SPRING, Press } from './Motion';
import { haptic } from '../lib/telegram';
import { auraFor, gradientFor } from '../lib/design';
import type { ToolMeta } from '../lib/api';

/* ─── Segmented control with a sliding pill ──────────────────────────── */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  idPrefix,
}: {
  options: { id: T; label: string }[];
  value: T;
  onChange: (id: T) => void;
  idPrefix: string;
}): React.ReactElement {
  return (
    <div className="seg">
      {options.map((option) => {
        const on = option.id === value;
        return (
          <button
            key={option.id}
            type="button"
            data-on={on ? '1' : '0'}
            onClick={() => {
              if (on) return;
              haptic.select();
              onChange(option.id);
            }}
          >
            {on && (
              <motion.span
                layoutId={`${idPrefix}-pill`}
                transition={SPRING}
                style={{
                  position: 'absolute',
                  inset: 0,
                  borderRadius: 13,
                  background: 'var(--grad-brand)',
                  boxShadow: '0 6px 18px -8px rgba(99,102,241,0.9)',
                  zIndex: -1,
                }}
              />
            )}
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

/* ─── Tool tile ──────────────────────────────────────────────────────── */
export function ToolTile({
  tool,
  onOpen,
  starred,
  onStar,
}: {
  tool: ToolMeta;
  onOpen: () => void;
  starred: boolean;
  onStar: () => void;
}): React.ReactElement {
  return (
    <motion.div
      className="tile"
      whileTap={{ scale: 0.96 }}
      transition={SPRING}
      onClick={() => {
        haptic.tap();
        onOpen();
      }}
      role="button"
      tabIndex={0}
    >
      <span className="aura" style={{ background: auraFor(tool.category, tool.id) }} />
      <span className="emoji">{tool.icon}</span>
      <span className="name">{tool.title}</span>
      <span className="tiny" style={{ marginTop: 'auto', opacity: 0.75 }}>
        {tool.network ? '🌐 آنلاین' : tool.file ? '📎 فایل' : '⚡ آفلاین'}
      </span>
      <button
        type="button"
        aria-label="favorite"
        onClick={(event) => {
          event.stopPropagation();
          haptic.press();
          onStar();
        }}
        style={{
          position: 'absolute',
          top: 8,
          insetInlineEnd: 8,
          width: 30,
          height: 30,
          border: 0,
          borderRadius: 10,
          background: starred ? 'rgba(251,191,36,0.16)' : 'transparent',
          color: starred ? '#fbbf24' : 'var(--text-3)',
          fontSize: 15,
          cursor: 'pointer',
          display: 'grid',
          placeItems: 'center',
          transition: 'background .2s, color .2s',
        }}
      >
        {starred ? '★' : '☆'}
      </button>
    </motion.div>
  );
}

/* ─── Category pill row ──────────────────────────────────────────────── */
export function CategoryChips({
  categories,
  value,
  onChange,
}: {
  categories: { id: string; icon: string; title: string; count: number }[];
  value: string;
  onChange: (id: string) => void;
}): React.ReactElement {
  return (
    <div
      className="row wrap"
      style={{ gap: 8, overflowX: 'auto', flexWrap: 'nowrap', paddingBottom: 4, scrollbarWidth: 'none' }}
    >
      {categories.map((category) => (
        <Press
          key={category.id}
          className="chip"
          data-on={category.id === value ? '1' : '0'}
          onClick={() => {
            haptic.select();
            onChange(category.id);
          }}
        >
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            {category.icon} {category.title}
          </span>
        </Press>
      ))}
    </div>
  );
}

/* ─── Skeletons ──────────────────────────────────────────────────────── */
export function TileSkeletons({ count = 8 }: { count?: number }): React.ReactElement {
  return (
    <div className="grid">
      {Array.from({ length: count }, (_, index) => (
        <div key={index} className="skeleton" style={{ height: 112 }} />
      ))}
    </div>
  );
}

/* ─── Toast ──────────────────────────────────────────────────────────── */
export function Toast({ message, tone }: { message: string; tone: 'ok' | 'err' }): React.ReactElement {
  return (
    <motion.div
      initial={{ opacity: 0, y: -22, scale: 0.94 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -18, scale: 0.94 }}
      transition={SPRING}
      style={{
        position: 'fixed',
        top: 'calc(var(--safe-top) + 14px)',
        insetInline: 20,
        zIndex: 90,
        padding: '12px 16px',
        borderRadius: 16,
        background: tone === 'ok' ? 'rgba(52,211,153,0.14)' : 'rgba(251,113,133,0.14)',
        border: `1px solid ${tone === 'ok' ? 'rgba(52,211,153,0.4)' : 'rgba(251,113,133,0.4)'}`,
        backdropFilter: 'blur(20px)',
        WebkitBackdropFilter: 'blur(20px)',
        color: tone === 'ok' ? 'var(--ok)' : 'var(--err)',
        fontSize: 13.5,
        fontWeight: 500,
        textAlign: 'center',
        boxShadow: 'var(--sh-lg)',
      }}
    >
      {message}
    </motion.div>
  );
}

export function useToast(): {
  toast: { message: string; tone: 'ok' | 'err' } | null;
  show: (message: string, tone?: 'ok' | 'err') => void;
} {
  const [toast, setToast] = useState<{ message: string; tone: 'ok' | 'err' } | null>(null);
  useEffect(() => {
    if (!toast) return undefined;
    const timer = setTimeout(() => setToast(null), 2600);
    return () => clearTimeout(timer);
  }, [toast]);
  return {
    toast,
    show: (message, tone = 'ok') => {
      if (tone === 'ok') haptic.ok();
      else haptic.err();
      setToast({ message, tone });
    },
  };
}

export function ToastHost({ toast }: { toast: { message: string; tone: 'ok' | 'err' } | null }): React.ReactElement {
  return <AnimatePresence>{toast && <Toast key="toast" {...toast} />}</AnimatePresence>;
}

/* ─── Gradient stat card ─────────────────────────────────────────────── */
export function StatCard({
  label,
  value,
  icon,
  category,
}: {
  label: string;
  value: string;
  icon: string;
  category: string;
}): React.ReactElement {
  return (
    <div className="card" style={{ padding: 14, position: 'relative' }}>
      <span
        style={{
          position: 'absolute',
          width: 76,
          height: 76,
          borderRadius: '50%',
          filter: 'blur(26px)',
          opacity: 0.45,
          top: -24,
          insetInlineEnd: -18,
          background: gradientFor(category),
        }}
      />
      <div style={{ fontSize: 19 }}>{icon}</div>
      <div style={{ fontSize: 22, fontWeight: 700, letterSpacing: '-0.02em', marginTop: 2 }} className="num">
        {value}
      </div>
      <div className="tiny">{label}</div>
    </div>
  );
}
