/**
 * Tool detail + runner.
 *
 * The primary action lives on Telegram's own MainButton rather than an HTML
 * button: it docks above the keyboard, matches the client's theme, and is the
 * clearest single signal that this is an app and not a page.
 */
import { useEffect, useRef, useState } from 'react';
import { api, ApiError, type ToolMeta } from '../lib/api';
import { gradientFor } from '../lib/design';
import { haptic, mainButton } from '../lib/telegram';
import { motion, AnimatePresence, Reveal, Press } from '../components/Motion';
import { Icon, toolIcon } from '../components/Icon';

interface Props {
  tool: ToolMeta;
  starred: boolean;
  onStar: () => void;
  onToast: (message: string, tone?: 'ok' | 'err') => void;
}

export function ToolView({ tool, starred, onStar, onToast }: Props): React.ReactElement {
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState<number | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Keep the latest input in a ref: MainButton's handler is registered once,
  // so reading React state directly inside it would capture a stale value.
  const inputLive = useRef(input);
  inputLive.current = input;

  const run = async (): Promise<void> => {
    const value = inputLive.current.trim();
    if (tool.needsInput && !value) {
      haptic.warn();
      setError('لطفاً ورودی را وارد کنید.');
      return;
    }
    setBusy(true);
    setError(null);
    mainButton.busy(true);
    const started = performance.now();
    try {
      const response = await api.run(tool.id, value);
      if (response.ok && response.html) {
        setResult(response.html);
        setElapsed(Math.round(performance.now() - started));
        haptic.ok();
      } else {
        setError(response.error ?? 'اجرا ناموفق بود.');
        haptic.err();
      }
    } catch (caught) {
      const message = caught instanceof ApiError ? caught.message : 'خطای غیرمنتظره.';
      setError(message);
      haptic.err();
    } finally {
      setBusy(false);
      mainButton.busy(false);
    }
  };

  const runRef = useRef(run);
  runRef.current = run;

  useEffect(() => {
    const dispose = mainButton.show(tool.file ? 'ارسال فایل در ربات' : 'اجرا کن', () => {
      haptic.press();
      void runRef.current();
    });
    return dispose;
  }, [tool.id, tool.file]);

  useEffect(() => {
    setInput('');
    setResult(null);
    setError(null);
    setElapsed(null);
    if (tool.needsInput && !tool.file) {
      // Small delay: focusing during the screen transition fights the animation.
      const timer = setTimeout(() => inputRef.current?.focus(), 320);
      return () => clearTimeout(timer);
    }
    return undefined;
  }, [tool.id, tool.needsInput, tool.file]);

  const copy = async (): Promise<void> => {
    if (!result) return;
    const plain = result.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '');
    try {
      await navigator.clipboard.writeText(plain);
      onToast('در کلیپ‌بورد کپی شد');
    } catch {
      onToast('کپی ممکن نشد', 'err');
    }
  };

  return (
    <div className="scroll">
      {/* ─── Header ────────────────────────────────────────────────── */}
      <motion.div
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        className="card"
        style={{ padding: 18, marginBottom: 16, position: 'relative' }}
      >
        <span
          style={{
            position: 'absolute',
            width: 130,
            height: 130,
            borderRadius: '50%',
            filter: 'blur(44px)',
            opacity: 0.4,
            top: -54,
            insetInlineEnd: -38,
            background: gradientFor(tool.category),
            pointerEvents: 'none',
          }}
        />
        <div className="row" style={{ gap: 13, alignItems: 'flex-start' }}>
          <motion.span
            initial={{ scale: 0.7, rotate: -12 }}
            animate={{ scale: 1, rotate: 0 }}
            transition={{ type: 'spring', stiffness: 380, damping: 20 }}
            className="badge badge-lg"
            style={{ background: gradientFor(tool.category), boxShadow: 'var(--sh-md)' }}
          >
            <Icon name={toolIcon(tool.id, tool.category)} size={25} />
          </motion.span>
          <div className="grow">
            <h2 className="h2">{tool.title}</h2>
            <p className="muted" style={{ margin: '4px 0 0' }}>
              {tool.description}
            </p>
          </div>
          <Press
            onClick={onStar}
            style={{
              border: 0,
              background: starred ? 'rgba(251,191,36,0.16)' : 'var(--surface-hi)',
              color: starred ? '#fbbf24' : 'var(--text-3)',
              width: 36,
              height: 36,
              borderRadius: 12,
              cursor: 'pointer',
              flexShrink: 0,
              display: 'grid',
              placeItems: 'center',
            }}
            aria-label={starred ? 'حذف از منتخب‌ها' : 'افزودن به منتخب‌ها'}
          >
            <Icon name="star" size={17} filled={starred} />
          </Press>
        </div>
      </motion.div>

      {/* ─── File tools: honest limitation notice ──────────────────── */}
      {tool.file && (
        <Reveal>
          <div
            className="card"
            style={{ padding: 16, marginBottom: 16, borderColor: 'rgba(251,191,36,0.3)' }}
          >
            <div className="row" style={{ gap: 10 }}>
              <span className="badge badge-sm" style={{ background: 'var(--grad-warm)' }}>
                <Icon name="paperclip" size={16} />
              </span>
              <div>
                <div className="h3">این ابزار فایل می‌گیرد</div>
                <div className="muted" style={{ marginTop: 3 }}>
                  آپلود فایل فعلاً در خود ربات انجام می‌شود. اپ را ببندید و فایل را برای ربات بفرستید.
                </div>
              </div>
            </div>
          </div>
        </Reveal>
      )}

      {/* ─── Input ─────────────────────────────────────────────────── */}
      {tool.needsInput && !tool.file && (
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.05 }}
          style={{ marginBottom: 14 }}
        >
          <label className="tiny" style={{ display: 'block', marginBottom: 7, paddingInlineStart: 4 }}>
            ورودی
          </label>
          <textarea
            ref={inputRef}
            className="field"
            value={input}
            onChange={(event) => setInput(event.target.value)}
            placeholder={tool.usage || 'ورودی را اینجا بنویسید…'}
            spellCheck={false}
          />
          {tool.example && (
            <Press
              className="chip"
              style={{ marginTop: 9 }}
              onClick={() => {
                haptic.tap();
                setInput(tool.example);
              }}
            >
              <Icon name="bulb" size={13} strokeWidth={1.9} />
              نمونه را امتحان کن
            </Press>
          )}
        </motion.div>
      )}

      {/* ─── Error ─────────────────────────────────────────────────── */}
      <AnimatePresence>
        {error && (
          <motion.div
            key="err"
            initial={{ opacity: 0, height: 0, marginBottom: 0 }}
            animate={{ opacity: 1, height: 'auto', marginBottom: 14 }}
            exit={{ opacity: 0, height: 0, marginBottom: 0 }}
            style={{ overflow: 'hidden' }}
          >
            <div
              style={{
                padding: 14,
                borderRadius: 16,
                background: 'rgba(251,113,133,0.1)',
                border: '1px solid rgba(251,113,133,0.32)',
                color: 'var(--err)',
                fontSize: 13.5,
                display: 'flex',
                alignItems: 'flex-start',
                gap: 9,
              }}
            >
              <Icon name="alert" size={16} style={{ marginTop: 2 }} />
              <span>{error}</span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ─── Busy skeleton ─────────────────────────────────────────── */}
      <AnimatePresence mode="wait">
        {busy && (
          <motion.div
            key="busy"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="stack"
          >
            <div className="skeleton" style={{ height: 18, width: '45%' }} />
            <div className="skeleton" style={{ height: 14 }} />
            <div className="skeleton" style={{ height: 14, width: '82%' }} />
            <div className="skeleton" style={{ height: 14, width: '60%' }} />
          </motion.div>
        )}
      </AnimatePresence>

      {/* ─── Result ────────────────────────────────────────────────── */}
      <AnimatePresence>
        {result && !busy && (
          <Reveal key="result">
            <div className="row between" style={{ marginBottom: 9 }}>
              <h3 className="h3">نتیجه</h3>
              <div className="row" style={{ gap: 7 }}>
                {elapsed !== null && <span className="tiny num">{elapsed}ms</span>}
                <Press className="chip" onClick={() => void copy()}>
                  <Icon name="copy" size={13} strokeWidth={1.9} />
                  کپی
                </Press>
              </div>
            </div>
            {/* Server-rendered Telegram HTML: a fixed, escaped subset produced
                by the same tool code the bot uses. */}
            <div className="result" dangerouslySetInnerHTML={{ __html: result }} />
          </Reveal>
        )}
      </AnimatePresence>

      {/* ─── Meta ──────────────────────────────────────────────────── */}
      {tool.limitations && (
        <div
          className="tiny"
          style={{ marginTop: 18, padding: '0 4px', lineHeight: 1.8, display: 'flex', gap: 8 }}
        >
          <Icon name="info" size={14} style={{ marginTop: 3, flexShrink: 0 }} />
          <span>{tool.limitations}</span>
        </div>
      )}
    </div>
  );
}
