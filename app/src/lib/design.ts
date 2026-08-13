/**
 * Visual identity mapping.
 *
 * Colour is information here, not decoration: a user should recognise a tool's
 * family from the tile before reading its label. Each category owns one ramp,
 * and every tile derives a stable hue from its id so two neighbouring tiles in
 * the same family never look identical.
 */

export interface Ramp {
  from: string;
  to: string;
  glow: string;
}

export const CATEGORY_RAMP: Record<string, Ramp> = {
  programming: { from: '#22d3ee', to: '#3b82f6', glow: 'rgba(34,211,238,0.55)' },
  network: { from: '#34d399', to: '#10b981', glow: 'rgba(52,211,153,0.55)' },
  security: { from: '#fb7185', to: '#e11d48', glow: 'rgba(251,113,133,0.55)' },
  everyday: { from: '#a855f7', to: '#7c3aed', glow: 'rgba(168,85,247,0.55)' },
  utilities: { from: '#fbbf24', to: '#f59e0b', glow: 'rgba(251,191,36,0.55)' },
  favorites: { from: '#f472b6', to: '#db2777', glow: 'rgba(244,114,182,0.55)' },
};

export const DEFAULT_RAMP: Ramp = { from: '#818cf8', to: '#6366f1', glow: 'rgba(129,140,248,0.55)' };

export function rampFor(category: string): Ramp {
  return CATEGORY_RAMP[category] ?? DEFAULT_RAMP;
}

export function gradientFor(category: string): string {
  const ramp = rampFor(category);
  return `linear-gradient(135deg, ${ramp.from}, ${ramp.to})`;
}

/** Deterministic hue offset so sibling tiles differ without being random. */
export function hueShift(id: string): number {
  let hash = 0;
  for (let i = 0; i < id.length; i += 1) hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  return (hash % 36) - 18;
}

/**
 * Tile aura. Uses a plain hex stop rather than CSS relative-colour syntax
 * (`hsl(from …)`), which is unsupported in the older WebViews Telegram still
 * ships on Android. Variation comes from mixing the two ramp stops by a
 * deterministic per-id ratio instead.
 */
export function auraFor(category: string, id: string): string {
  const ramp = rampFor(category);
  const stop = (hueShift(id) + 18) / 36; // 0..1, stable per tool
  const colour = mixHex(ramp.from, ramp.to, stop);
  return `radial-gradient(circle, ${colour}, transparent 70%)`;
}

/** Linear interpolation between two #rrggbb colours. */
export function mixHex(a: string, b: string, ratio: number): string {
  const parse = (hex: string): [number, number, number] => [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16),
  ];
  const [r1, g1, b1] = parse(a);
  const [r2, g2, b2] = parse(b);
  const clamp = Math.min(1, Math.max(0, ratio));
  const to2 = (n: number): string => Math.round(n).toString(16).padStart(2, '0');
  return `#${to2(r1 + (r2 - r1) * clamp)}${to2(g1 + (g2 - g1) * clamp)}${to2(b1 + (b2 - b1) * clamp)}`;
}

/** Persian numerals for display; falls back to the input when not numeric. */
const FA_DIGITS = ['۰', '۱', '۲', '۳', '۴', '۵', '۶', '۷', '۸', '۹'];

export function faNum(value: number | string, lang: 'fa' | 'en' = 'fa'): string {
  const text = typeof value === 'number' ? value.toLocaleString('en-US') : value;
  if (lang !== 'fa') return text;
  return text.replace(/\d/g, (digit) => FA_DIGITS[Number(digit)]);
}
