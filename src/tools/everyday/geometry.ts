/**
 * 📐 Everyday Tools → Area/Volume and Construction calculators.
 *
 * `geometry_calc` handles pure shapes; `construction_calc` layers real-world
 * building maths (concrete, brick, tile, paint) on top of the same area and
 * volume primitives so the two tools never disagree about, say, the area of a
 * wall.
 *
 * Every construction answer prints the coverage rates it assumed. Those rates
 * vary by material and region, so they are inputs with documented defaults —
 * never silent constants.
 */
import { defineTool, type ToolRunContext } from '../types.js';
import { DIVIDER } from '../../utils/text.js';
import { errInvalidInput } from '../../utils/errors.js';
import { fmt, numberField, parseFields, textField } from './fields.js';

const FA = (ctx: ToolRunContext): boolean => ctx.lang === 'fa';

function assumptions(fa: boolean, lines: string[]): string {
  const title = fa ? '📌 فرضیات و فرمول' : '📌 Assumptions & formula';
  return `${DIVIDER}\n<b>${title}</b>\n${lines.map((line) => `• ${line}`).join('\n')}`;
}

// ─── Shape catalogue ───────────────────────────────────────
interface Shape {
  aliases: readonly string[];
  fa: string;
  en: string;
  /** Field names the shape needs, in order. */
  params: readonly string[];
  /** Returns area (2-D) or surface area (3-D), plus volume for solids. */
  compute(values: Record<string, number>): { area: number; volume?: number; extra: { fa: string; en: string }[] };
  formula: string;
}

const TAU = Math.PI;

export const SHAPES: Shape[] = [
  {
    aliases: ['rectangle', 'rect', 'مستطیل'],
    fa: 'مستطیل', en: 'Rectangle',
    params: ['width', 'height'],
    formula: 'A = w × h',
    compute: (v) => {
      const w = v['width'] ?? 0;
      const h = v['height'] ?? 0;
      return { area: w * h, extra: [{ fa: `محیط: ${fmt(2 * (w + h))}`, en: `Perimeter: ${fmt(2 * (w + h))}` }] };
    },
  },
  {
    aliases: ['square', 'مربع'],
    fa: 'مربع', en: 'Square',
    params: ['side'],
    formula: 'A = a²',
    compute: (v) => {
      const a = v['side'] ?? 0;
      return { area: a * a, extra: [{ fa: `محیط: ${fmt(4 * a)}`, en: `Perimeter: ${fmt(4 * a)}` }] };
    },
  },
  {
    aliases: ['circle', 'دایره'],
    fa: 'دایره', en: 'Circle',
    params: ['radius'],
    formula: 'A = π r²',
    compute: (v) => {
      const r = v['radius'] ?? 0;
      return {
        area: TAU * r * r,
        extra: [{ fa: `محیط: ${fmt(2 * TAU * r)}`, en: `Circumference: ${fmt(2 * TAU * r)}` }],
      };
    },
  },
  {
    aliases: ['triangle', 'مثلث'],
    fa: 'مثلث', en: 'Triangle',
    params: ['base', 'height'],
    formula: 'A = ½ b × h',
    compute: (v) => ({ area: ((v['base'] ?? 0) * (v['height'] ?? 0)) / 2, extra: [] }),
  },
  {
    aliases: ['cube', 'مکعب'],
    fa: 'مکعب', en: 'Cube',
    params: ['side'],
    formula: 'V = a³ · A = 6a²',
    compute: (v) => {
      const a = v['side'] ?? 0;
      return { area: 6 * a * a, volume: a ** 3, extra: [] };
    },
  },
  {
    aliases: ['box', 'cuboid', 'مکعبمستطیل'],
    fa: 'مکعب مستطیل', en: 'Cuboid',
    params: ['width', 'height', 'depth'],
    formula: 'V = w × h × d',
    compute: (v) => {
      const w = v['width'] ?? 0;
      const h = v['height'] ?? 0;
      const d = v['depth'] ?? 0;
      return { area: 2 * (w * h + w * d + h * d), volume: w * h * d, extra: [] };
    },
  },
  {
    aliases: ['cylinder', 'استوانه'],
    fa: 'استوانه', en: 'Cylinder',
    params: ['radius', 'height'],
    formula: 'V = π r² h · A = 2πr(r+h)',
    compute: (v) => {
      const r = v['radius'] ?? 0;
      const h = v['height'] ?? 0;
      return { area: 2 * TAU * r * (r + h), volume: TAU * r * r * h, extra: [] };
    },
  },
  {
    aliases: ['sphere', 'کره'],
    fa: 'کره', en: 'Sphere',
    params: ['radius'],
    formula: 'V = 4/3 π r³ · A = 4π r²',
    compute: (v) => {
      const r = v['radius'] ?? 0;
      return { area: 4 * TAU * r * r, volume: (4 / 3) * TAU * r ** 3, extra: [] };
    },
  },
  {
    aliases: ['cone', 'مخروط'],
    fa: 'مخروط', en: 'Cone',
    params: ['radius', 'height'],
    formula: 'V = ⅓ π r² h',
    compute: (v) => {
      const r = v['radius'] ?? 0;
      const h = v['height'] ?? 0;
      const slant = Math.sqrt(r * r + h * h);
      return {
        area: TAU * r * (r + slant),
        volume: (TAU * r * r * h) / 3,
        extra: [{ fa: `ارتفاع مایل: ${fmt(slant)}`, en: `Slant height: ${fmt(slant)}` }],
      };
    },
  },
];

export function findShape(name: string): Shape | undefined {
  const key = name.trim().toLowerCase().replace(/[\s_-]/g, '');
  return SHAPES.find((shape) => shape.aliases.includes(key));
}

export const geometryTool = defineTool({
  id: 'geometry_calc',
  category: 'everyday',
  group: 'calculators',
  icon: '📐',
  needsInput: true,
  title: { fa: 'مساحت و حجم', en: 'Area & Volume' },
  description: {
    fa: 'مساحت، محیط، مساحت سطح و حجم اشکال هندسی رایج را محاسبه می‌کند: مستطیل، مربع، دایره، مثلث، مکعب، مکعب‌مستطیل، استوانه، کره و مخروط.',
    en: 'Computes area, perimeter, surface area and volume for common shapes: rectangle, square, circle, triangle, cube, cuboid, cylinder, sphere and cone.',
  },
  usage: {
    fa:
      '<code>shape: rectangle\nwidth: 4\nheight: 3</code>\n\n' +
      'اشکال: rectangle، square، circle، triangle، cube، box، cylinder، sphere، cone\n' +
      'واحدها دلخواه‌اند و به همان صورت گزارش می‌شوند.',
    en:
      '<code>shape: rectangle\nwidth: 4\nheight: 3</code>\n\n' +
      'Shapes: rectangle, square, circle, triangle, cube, box, cylinder, sphere, cone\n' +
      'Units are arbitrary and reported back unchanged.',
  },
  example: {
    fa: 'ورودی: shape: circle / radius: 5\nخروجی: مساحت 78.54 • محیط 31.42',
    en: 'Input: shape: circle / radius: 5\nOutput: area 78.54 • circumference 31.42',
  },
  limitations: {
    fa: 'ابعاد باید مثبت و کمتر از 1e7 باشند. واحد تبدیل نمی‌شود؛ همه‌ی ابعاد باید هم‌واحد باشند.',
    en: 'Dimensions must be positive and below 1e7. No unit conversion is performed; all dimensions must share one unit.',
  },
  run: (input, ctx) => {
    const fa = FA(ctx);
    const fields = parseFields(input);
    const shapeName = textField(fields, ['shape', 'type', 'شکل']);
    if (!shapeName) {
      throw errInvalidInput(
        'فیلد shape الزامی است. مثال: shape: circle',
        'Field "shape" is required. Example: shape: circle',
      );
    }
    const shape = findShape(shapeName);
    if (!shape) {
      const names = SHAPES.map((s) => s.aliases[0]).join(', ');
      throw errInvalidInput(`شکل «${shapeName}» شناخته نشد. اشکال مجاز: ${names}`, `Unknown shape "${shapeName}". Allowed: ${names}`);
    }

    const values: Record<string, number> = {};
    for (const param of shape.params) {
      values[param] = numberField(fields, [param, param[0] ?? param], { min: 0, max: 1e7, label: param });
      if ((values[param] ?? 0) <= 0) {
        throw errInvalidInput(`مقدار «${param}» باید بزرگ‌تر از صفر باشد.`, `"${param}" must be greater than zero.`);
      }
    }

    const result = shape.compute(values);
    const unit = textField(fields, ['unit', 'units', 'واحد'], '');
    const u = unit ? ` ${unit}` : '';

    const lines = [`📐 <b>${fa ? shape.fa : shape.en}</b>`, DIVIDER];
    if (result.volume !== undefined) {
      lines.push(`${fa ? '📦 حجم' : '📦 Volume'}: <b>${fmt(result.volume, 4)}</b>${u ? `${u}³` : ''}`);
      lines.push(`${fa ? '🧱 مساحت سطح' : '🧱 Surface area'}: ${fmt(result.area, 4)}${u ? `${u}²` : ''}`);
    } else {
      lines.push(`${fa ? '⬛ مساحت' : '⬛ Area'}: <b>${fmt(result.area, 4)}</b>${u ? `${u}²` : ''}`);
    }
    for (const extra of result.extra) lines.push(fa ? extra.fa : extra.en);

    return {
      html:
        `${lines.join('\n')}\n` +
        assumptions(fa, [
          shape.formula,
          ...shape.params.map((p) => `${p} = ${fmt(values[p] ?? 0)}`),
          fa ? 'همه‌ی ابعاد هم‌واحد فرض شدند' : 'All dimensions assumed to share one unit',
        ]),
      toast: result.volume !== undefined ? `V = ${fmt(result.volume, 2)}` : `A = ${fmt(result.area, 2)}`,
    };
  },
});

// ─── Construction ──────────────────────────────────────────
/**
 * Default coverage rates. These are conventional industry figures, not laws of
 * physics — every one of them is overridable from the input and is echoed back
 * in the assumptions block so the user can sanity-check them against their
 * own materials.
 */
export const CONSTRUCTION_DEFAULTS = {
  /** Bricks per m² of wall for a standard 20×10×5 cm brick, single leaf. */
  bricksPerM2: 52,
  /** Litres of paint per m² per coat, typical emulsion. */
  paintPerM2: 0.12,
  /** Cement bags (50 kg) per m³ of concrete at a 1:2:4 mix. */
  cementBagsPerM3: 7,
  /** Sand and gravel tonnes per m³ at a 1:2:4 mix. */
  sandPerM3: 0.5,
  gravelPerM3: 0.8,
  /** Default wastage allowance. */
  wastePct: 10,
} as const;

type Mode = 'area' | 'volume' | 'concrete' | 'wall' | 'brick' | 'tile' | 'paint';

const MODES: Record<string, Mode> = {
  area: 'area', مساحت: 'area',
  volume: 'volume', حجم: 'volume',
  concrete: 'concrete', بتن: 'concrete',
  wall: 'wall', دیوار: 'wall',
  brick: 'brick', آجر: 'brick',
  tile: 'tile', کاشی: 'tile', سرامیک: 'tile',
  paint: 'paint', رنگ: 'paint',
};

export const constructionTool = defineTool({
  id: 'construction_calc',
  category: 'everyday',
  group: 'calculators',
  icon: '🏗',
  needsInput: true,
  title: { fa: 'محاسبات ساختمانی', en: 'Construction Calculator' },
  description: {
    fa: 'مساحت، حجم، بتن، دیوار، آجر، کاشی و رنگ را با درصد پرت قابل تنظیم محاسبه می‌کند و همه‌ی نرخ‌های مصرف را شفاف نشان می‌دهد.',
    en: 'Calculates area, volume, concrete, walls, bricks, tiles and paint with a configurable wastage percentage, printing every coverage rate it used.',
  },
  usage: {
    fa:
      '<code>mode: concrete\nlength: 5\nwidth: 4\nthickness: 0.15\nwaste: 10</code>\n\n' +
      'حالت‌ها: area، volume، concrete، wall، brick، tile، paint\n' +
      'نرخ‌های قابل تنظیم: <code>bricks per m2</code>، <code>paint per m2</code>، <code>cement bags per m3</code>، <code>tile size</code>، <code>coats</code>',
    en:
      '<code>mode: concrete\nlength: 5\nwidth: 4\nthickness: 0.15\nwaste: 10</code>\n\n' +
      'Modes: area, volume, concrete, wall, brick, tile, paint\n' +
      'Overridable rates: <code>bricks per m2</code>, <code>paint per m2</code>, <code>cement bags per m3</code>, <code>tile size</code>, <code>coats</code>',
  },
  example: {
    fa: 'ورودی: mode: concrete / length: 5 / width: 4 / thickness: 0.15\nخروجی: حجم 3 m³ + پرت ۱۰٪ → 3.3 m³',
    en: 'Input: mode: concrete / length: 5 / width: 4 / thickness: 0.15\nOutput: 3 m³ + 10% waste → 3.3 m³',
  },
  limitations: {
    fa:
      'همه‌ی ابعاد بر حسب متر است. نرخ‌های مصرف پیش‌فرض، مقادیر رایج صنعتی‌اند و بسته به مصالح تغییر می‌کنند؛ برای پروژه‌ی واقعی با نرخ‌های تأمین‌کننده‌ی خودتان جایگزین کنید. این ابزار جایگزین محاسبات مهندسی سازه نیست.',
    en:
      'All dimensions are in metres. Default coverage rates are common industry figures that vary by material; override them with your supplier’s figures for real projects. This is not a substitute for structural engineering.',
  },
  run: (input, ctx) => {
    const fa = FA(ctx);
    const fields = parseFields(input);
    const modeRaw = textField(fields, ['mode', 'type', 'حالت'], 'area').toLowerCase().replace(/[\s_-]/g, '');
    const mode = MODES[modeRaw];
    if (!mode) {
      throw errInvalidInput(
        `حالت «${modeRaw}» شناخته نشد. حالت‌های مجاز: area, volume, concrete, wall, brick, tile, paint`,
        `Unknown mode "${modeRaw}". Allowed: area, volume, concrete, wall, brick, tile, paint`,
      );
    }

    const waste = numberField(fields, ['waste', 'wastage', 'پرت'], {
      min: 0, max: 100, fallback: CONSTRUCTION_DEFAULTS.wastePct, label: 'waste',
    });
    const withWaste = (value: number): number => value * (1 + waste / 100);

    const notes: string[] = [];
    const lines: string[] = [];
    let toast = '';

    // Shared geometry: every mode starts from length × width (× height/thickness).
    const length = numberField(fields, ['length', 'l', 'طول'], { min: 0, max: 1e5, fallback: 0 });
    const width = numberField(fields, ['width', 'w', 'عرض'], { min: 0, max: 1e5, fallback: 0 });
    const height = numberField(fields, ['height', 'h', 'ارتفاع'], { min: 0, max: 1e5, fallback: 0 });
    const thickness = numberField(fields, ['thickness', 'depth', 'ضخامت'], { min: 0, max: 100, fallback: 0 });
    const openings = numberField(fields, ['openings', 'doors', 'windows', 'بازشو'], { min: 0, fallback: 0 });

    const requireDims = (...need: [string, number][]): void => {
      for (const [name, value] of need) {
        if (value <= 0) {
          throw errInvalidInput(
            `برای این حالت فیلد «${name}» با مقدار مثبت لازم است.`,
            `This mode requires a positive "${name}".`,
          );
        }
      }
    };

    if (mode === 'area') {
      requireDims(['length', length], ['width', width]);
      const area = length * width;
      lines.push(`${fa ? '⬛ مساحت' : '⬛ Area'}: <b>${fmt(area, 3)} m²</b>`);
      lines.push(`${fa ? '➕ با پرت' : '➕ With waste'}: <b>${fmt(withWaste(area), 3)} m²</b>`);
      notes.push(`A = ${fmt(length)} × ${fmt(width)} = ${fmt(area, 3)} m²`);
      toast = `${fmt(area, 2)} m²`;
    } else if (mode === 'volume' || mode === 'concrete') {
      const depth = thickness > 0 ? thickness : height;
      requireDims(['length', length], ['width', width], ['thickness/height', depth]);
      const volume = length * width * depth;
      const total = withWaste(volume);
      lines.push(`${fa ? '📦 حجم' : '📦 Volume'}: <b>${fmt(volume, 3)} m³</b>`);
      lines.push(`${fa ? '➕ با پرت' : '➕ With waste'}: <b>${fmt(total, 3)} m³</b>`);
      notes.push(`V = ${fmt(length)} × ${fmt(width)} × ${fmt(depth)} = ${fmt(volume, 3)} m³`);
      toast = `${fmt(total, 2)} m³`;

      if (mode === 'concrete') {
        const cementRate = numberField(fields, ['cementbagsperm3', 'cementrate'], {
          min: 0.1, max: 30, fallback: CONSTRUCTION_DEFAULTS.cementBagsPerM3,
        });
        const bags = Math.ceil(total * cementRate);
        const sand = total * CONSTRUCTION_DEFAULTS.sandPerM3;
        const gravel = total * CONSTRUCTION_DEFAULTS.gravelPerM3;
        lines.push(
          DIVIDER,
          `${fa ? '🧱 سیمان' : '🧱 Cement'}: <b>${bags} ${fa ? 'کیسه‌ی ۵۰ کیلویی' : '× 50 kg bags'}</b>`,
          `${fa ? '⏳ ماسه' : '⏳ Sand'}: ${fmt(sand, 2)} m³`,
          `${fa ? '🪨 شن' : '🪨 Gravel'}: ${fmt(gravel, 2)} m³`,
        );
        notes.push(
          fa
            ? `نرخ سیمان: ${fmt(cementRate)} کیسه در هر متر مکعب (نسبت ۱:۲:۴)`
            : `Cement rate: ${fmt(cementRate)} bags per m³ (1:2:4 mix)`,
          fa
            ? `ماسه ${CONSTRUCTION_DEFAULTS.sandPerM3} m³ و شن ${CONSTRUCTION_DEFAULTS.gravelPerM3} m³ به ازای هر متر مکعب بتن`
            : `Sand ${CONSTRUCTION_DEFAULTS.sandPerM3} m³ and gravel ${CONSTRUCTION_DEFAULTS.gravelPerM3} m³ per m³ of concrete`,
        );
      }
    } else {
      // wall / brick / tile / paint all work from a wall or floor area.
      const explicitArea = numberField(fields, ['area', 'مساحت'], { min: 0, fallback: 0 });
      let area: number;
      if (explicitArea > 0) {
        area = explicitArea;
        notes.push(`${fa ? 'مساحت از ورودی گرفته شد' : 'Area taken from input'} = ${fmt(area, 3)} m²`);
      } else {
        const second = mode === 'tile' ? width : height;
        requireDims(['length', length], [mode === 'tile' ? 'width' : 'height', second]);
        area = length * second;
        notes.push(`A = ${fmt(length)} × ${fmt(second)} = ${fmt(area, 3)} m²`);
      }
      if (openings > 0) {
        area = Math.max(0, area - openings);
        notes.push(
          fa ? `${fmt(openings, 2)} m² بازشو (در و پنجره) کسر شد` : `${fmt(openings, 2)} m² of openings subtracted`,
        );
      }
      const areaWithWaste = withWaste(area);
      lines.push(`${fa ? '⬛ مساحت خالص' : '⬛ Net area'}: <b>${fmt(area, 3)} m²</b>`);
      lines.push(`${fa ? '➕ با پرت' : '➕ With waste'}: ${fmt(areaWithWaste, 3)} m²`);
      toast = `${fmt(areaWithWaste, 2)} m²`;

      if (mode === 'wall' || mode === 'brick') {
        const rate = numberField(fields, ['bricksperm2', 'brickrate', 'آجردرمترمربع'], {
          min: 1, max: 500, fallback: CONSTRUCTION_DEFAULTS.bricksPerM2,
        });
        const bricks = Math.ceil(areaWithWaste * rate);
        lines.push(DIVIDER, `${fa ? '🧱 تعداد آجر' : '🧱 Bricks'}: <b>${bricks.toLocaleString('en-US')}</b>`);
        notes.push(
          fa
            ? `نرخ آجر: ${fmt(rate)} عدد در هر متر مربع (آجر ۲۰×۱۰×۵ سانتی‌متر، دیوار یک‌لایه)`
            : `Brick rate: ${fmt(rate)} per m² (20×10×5 cm brick, single leaf)`,
        );
        toast = `${bricks} ${fa ? 'آجر' : 'bricks'}`;
      } else if (mode === 'tile') {
        const tileW = numberField(fields, ['tilewidth', 'tilesize', 'عرضکاشی'], { min: 0.01, max: 5, fallback: 0.3 });
        const tileH = numberField(fields, ['tileheight', 'طولکاشی'], { min: 0.01, max: 5, fallback: tileW });
        const perTile = tileW * tileH;
        const tiles = Math.ceil(areaWithWaste / perTile);
        lines.push(DIVIDER, `${fa ? '🔲 تعداد کاشی' : '🔲 Tiles'}: <b>${tiles.toLocaleString('en-US')}</b>`);
        notes.push(
          fa
            ? `ابعاد کاشی: ${fmt(tileW * 100, 0)}×${fmt(tileH * 100, 0)} سانتی‌متر = ${fmt(perTile, 4)} m² هر عدد`
            : `Tile size: ${fmt(tileW * 100, 0)}×${fmt(tileH * 100, 0)} cm = ${fmt(perTile, 4)} m² each`,
          fa ? 'عرض بندکشی در محاسبه لحاظ نشده است' : 'Grout width is not accounted for',
        );
        toast = `${tiles} ${fa ? 'کاشی' : 'tiles'}`;
      } else if (mode === 'paint') {
        const coats = numberField(fields, ['coats', 'لایه'], { min: 1, max: 10, fallback: 2 });
        const rate = numberField(fields, ['paintperm2', 'paintrate'], {
          min: 0.01, max: 2, fallback: CONSTRUCTION_DEFAULTS.paintPerM2,
        });
        const litres = areaWithWaste * rate * coats;
        lines.push(
          DIVIDER,
          `${fa ? '🎨 رنگ لازم' : '🎨 Paint required'}: <b>${fmt(litres, 2)} ${fa ? 'لیتر' : 'L'}</b> (${coats} ${fa ? 'لایه' : 'coats'})`,
        );
        notes.push(
          fa
            ? `نرخ رنگ: ${fmt(rate, 3)} لیتر در هر متر مربع برای هر لایه`
            : `Paint rate: ${fmt(rate, 3)} L per m² per coat`,
          fa ? 'جذب سطح و آستری در نظر گرفته نشده است' : 'Substrate absorption and primer are not included',
        );
        toast = `${fmt(litres, 1)} L`;
      }
    }

    notes.push(
      fa ? `درصد پرت: ${fmt(waste)}٪ (قابل تنظیم با فیلد waste)` : `Wastage: ${fmt(waste)}% (set via the "waste" field)`,
      fa ? 'همه‌ی ابعاد بر حسب متر فرض شدند' : 'All dimensions assumed to be in metres',
    );

    return { html: `🏗 <b>${fa ? 'محاسبات ساختمانی' : 'Construction'}</b>\n${lines.join('\n')}\n${assumptions(fa, notes)}`, toast };
  },
});

export const geometryTools = [geometryTool, constructionTool];
