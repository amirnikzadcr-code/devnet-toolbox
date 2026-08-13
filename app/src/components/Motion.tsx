/**
 * Motion primitives.
 *
 * Rules that keep this feeling native rather than "web page with animations":
 *  - Only `transform` and `opacity` are animated (compositor-only, 60fps).
 *  - Screen transitions are directional: forward slides in from the leading
 *    edge, back reverses it. Direction is RTL-aware.
 *  - Springs, not durations, for anything the finger touches.
 */
import { AnimatePresence, motion, type Variants } from 'motion/react';
import type { ReactNode } from 'react';

export const SPRING = { type: 'spring', stiffness: 420, damping: 34, mass: 0.85 } as const;
export const SPRING_SOFT = { type: 'spring', stiffness: 260, damping: 30 } as const;

/** Staggered list entrance — children cascade in instead of popping at once. */
export const listVariants: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.035, delayChildren: 0.04 } },
};

export const itemVariants: Variants = {
  hidden: { opacity: 0, y: 16, scale: 0.97 },
  show: { opacity: 1, y: 0, scale: 1, transition: SPRING },
};

export function Stagger({ children, className }: { children: ReactNode; className?: string }): React.ReactElement {
  return (
    <motion.div className={className} variants={listVariants} initial="hidden" animate="show">
      {children}
    </motion.div>
  );
}

export function StaggerItem({ children, className }: { children: ReactNode; className?: string }): React.ReactElement {
  return (
    <motion.div className={className} variants={itemVariants}>
      {children}
    </motion.div>
  );
}

/**
 * Screen container: slides according to navigation direction.
 *
 * The layout contract matters as much as the animation. `.shell` is a flex
 * column and each screen's `.scroll` claims the leftover space with `flex:1`.
 * This wrapper sits between them, so it must forward the constraint rather
 * than break it: it is itself a flex column with `min-height:0`. Without that,
 * `.scroll` has no bounded parent, grows to its content height, overflows the
 * shell, and `body{overflow:hidden}` silently clips it — the app looks frozen
 * because nothing can scroll.
 */
export function Screen({
  children,
  keyName,
  direction,
}: {
  children: ReactNode;
  keyName: string;
  direction: 1 | -1;
}): React.ReactElement {
  return (
    <AnimatePresence mode="popLayout" initial={false} custom={direction}>
      <motion.div
        key={keyName}
        className="screen"
        custom={direction}
        initial={{ opacity: 0, x: direction * 26 }}
        animate={{ opacity: 1, x: 0 }}
        exit={{ opacity: 0, x: direction * -22 }}
        transition={{ ...SPRING_SOFT, opacity: { duration: 0.18 } }}
      >
        {children}
      </motion.div>
    </AnimatePresence>
  );
}

/** Pressable wrapper with a spring squash — the tactile core of the UI. */
export function Press({
  children,
  onClick,
  className,
  style,
  disabled,
  ...rest
}: {
  children: ReactNode;
  onClick?: () => void;
  className?: string;
  style?: React.CSSProperties;
  disabled?: boolean;
} & Record<`data-${string}`, string | undefined>): React.ReactElement {
  return (
    <motion.button
      type="button"
      className={className}
      style={style}
      disabled={disabled}
      onClick={onClick}
      whileTap={{ scale: 0.955 }}
      transition={SPRING}
      {...rest}
    >
      {children}
    </motion.button>
  );
}

/** Fades + lifts content in place, for results appearing after a run. */
export function Reveal({ children, delay = 0 }: { children: ReactNode; delay?: number }): React.ReactElement {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12, filter: 'blur(6px)' }}
      animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
      transition={{ ...SPRING_SOFT, delay }}
    >
      {children}
    </motion.div>
  );
}

export { motion, AnimatePresence };
