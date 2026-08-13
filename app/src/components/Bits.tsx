/**
 * Small shared UI pieces: segmented control, chips, skeletons, toasts, tiles.
 * All of them are haptic-aware — touching anything in this file buzzes.
 */
import { useEffect, useState } from 'react';
import { motion, AnimatePresence, SPRING, Press } from './Motion';
import { haptic } from '../lib/telegram';
import { auraFor, gradientFor } from '../lib/design';
import { Icon, categoryIcon, toolIcon, type IconName } from './Icon';
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
      <span className="badge" style={{ background: gradientFor(tool.category) }}>
        <Icon name={toolIcon(tool.id, tool.category)} size={21} />
      </span>
      <span className="name">{tool.title}</span>
      <span className="flag" data-kind={tool.network ? 'net' : tool.file ? 'file' : 'fast'}>
        <Icon name={tool.network ? 'globe' : tool.file ? 'paperclip' : 'bolt'} size={11} strokeWidth={2} />
        {tool.network ? 'آنلاین' : tool.file ? 'فایل' : 'آفلاین'}
      </span>
      <button
        type="button"
        className="star-btn"
        data-on={starred ? '1' : '0'}
        aria-label={starred ? 'حذف از منتخب‌ها' : 'افزودن به منتخب‌ها'}
        aria-pressed={starred}
        onClick={(event) => {
          event.stopPropagation();
          haptic.press();
          onStar();
        }}
      >
        <Icon name="star" size={16} filled={starred} strokeWidth={1.8} />
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
    <div className="rail" style={{ gap: 8 }}>
      {categories.map((category) => {
        const on = category.id === value;
        return (
          <Press
            key={category.id}
            className="chip"
            data-on={on ? '1' : '0'}
            onClick={() => {
              haptic.select();
              onChange(category.id);
            }}
          >
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <Icon name={categoryIcon(category.id)} size={14} strokeWidth={1.9} />
              {category.title}
              <span
                className="num"
                style={{
                  fontSize: 10.5,
                  padding: '1px 6px',
                  borderRadius: 999,
                  background: on ? 'rgba(255,255,255,0.22)' : 'var(--surface-hi)',
                  color: on ? '#fff' : 'var(--text-3)',
                }}
              >
                {category.count}
              </span>
            </span>
          </Press>
        );
      })}
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
  icon: IconName;
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
      <span className="badge badge-sm" style={{ background: gradientFor(category) }}>
        <Icon name={icon} size={17} />
      </span>
      <div style={{ fontSize: 22, fontWeight: 700, letterSpacing: '-0.02em', marginTop: 8 }} className="num">
        {value}
      </div>
      <div className="tiny">{label}</div>
    </div>
  );
}
