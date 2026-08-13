/**
 * 📐 Everyday Tools → Calculators
 *
 * Percentage, BMI, tip, installment, compound interest, profit/loss and tax.
 * These are pure functions of their inputs: no network, no storage, no state.
 *
 * A deliberate rule across this file: every result screen states the formula
 * and the assumptions it used. A financial number without its assumptions is
 * worse than no number at all, so `assumptions()` output is never optional.
 */
import { defineTool, type ToolRunContext } from '../types.js';
import { DIVIDER } from '../../utils/text.js';
import { errInvalidInput } from '../../utils/errors.js';
import { fmt, numberField, parseFields, pct, textField } from './fields.js';

const FA = (ctx: ToolRunContext): boolean => ctx.lang === 'fa';

/** Renders the "assumptions" block shared by every financial calculator. */
function assumptions(fa: boolean, lines: string[]): string {
  const title = fa ? '📌 فرضیات و فرمول' : '📌 Assumptions & formula';
  return `${DIVIDER}\n<b>${title}</b>\n${lines.map((line) => `• ${line}`).join('\n')}`;
}

// ─── 1. Percentage Calculator ──────────────────────────────
export const percentageTool = defineTool({
  id: 'percent_calc',
  category: 'everyday',
  group: 'calculators',
  icon: '💯',
  quick: true,
  needsInput: true,
  title: { fa: 'ماشین‌حساب درصد', en: 'Percentage Calculator' },
  description: {
    fa: 'درصد یک عدد، درصد تغییر، افزایش و کاهش درصدی، مقدار اولیه از روی درصد و اختلاف درصدی را محاسبه می‌کند.',
    en: 'Computes percentage of a number, percent change, increase/decrease, the original value behind a percentage, and percentage difference.',
  },
  usage: {
    fa:
      'یکی از حالت‌ها را بنویسید:\n' +
      '<code>15% of 200</code> — درصد یک عدد\n' +
      '<code>120 to 150</code> — درصد تغییر\n' +
      '<code>200 + 15%</code> یا <code>200 - 15%</code> — افزایش/کاهش\n' +
      '<code>30 is 15% of what</code> — مقدار اولیه\n' +
      '<code>diff 40 60</code> — اختلاف درصدی',
    en:
      'Pick a mode:\n' +
      '<code>15% of 200</code> — percentage of a number\n' +
      '<code>120 to 150</code> — percent change\n' +
      '<code>200 + 15%</code> or <code>200 - 15%</code> — increase/decrease\n' +
      '<code>30 is 15% of what</code> — original value\n' +
      '<code>diff 40 60</code> — percentage difference',
  },
  example: { fa: 'ورودی: 15% of 200\nخروجی: 30', en: 'Input: 15% of 200\nOutput: 30' },
  limitations: {
    fa: 'اعداد تا 1e15. تقسیم بر صفر و مقدار اولیه‌ی صفر با خطای واضح رد می‌شوند.',
    en: 'Values up to 1e15. Division by zero and a zero baseline are rejected with a clear error.',
  },
  run: (input, ctx) => {
    const fa = FA(ctx);
    const text = input.trim().replace(/[٪]/g, '%').replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0));
    const num = (s: string): number => {
      const value = Number(s.replace(/,/g, ''));
      if (!Number.isFinite(value)) throw errInvalidInput('عدد نامعتبر است.', 'Invalid number.');
      return value;
    };

    // Mode: X is P% of what  → original value
    const original = /^(-?[\d.,]+)\s*(?:is|=)\s*(-?[\d.,]+)\s*%\s*of\s*what\s*\??$/i.exec(text);
    if (original) {
      const part = num(original[1] ?? '');
      const percent = num(original[2] ?? '');
      if (percent === 0) {
        throw errInvalidInput('درصد نمی‌تواند صفر باشد.', 'The percentage cannot be zero.');
      }
      const whole = (part / percent) * 100;
      return {
        html:
          `${fa ? '🔎 مقدار اولیه' : '🔎 Original value'}\n<b>${fmt(whole)}</b>\n` +
          assumptions(fa, [
            fa ? `${fmt(part)} برابر ${fmt(percent)}٪ از X است` : `${fmt(part)} is ${fmt(percent)}% of X`,
            `X = ${fmt(part)} ÷ ${fmt(percent)} × 100 = ${fmt(whole)}`,
          ]),
        toast: fmt(whole),
      };
    }

    // Mode: P% of X
    const of = /^(-?[\d.,]+)\s*%\s*of\s*(-?[\d.,]+)$/i.exec(text);
    if (of) {
      const percent = num(of[1] ?? '');
      const whole = num(of[2] ?? '');
      const value = (percent / 100) * whole;
      return {
        html:
          `${fa ? '💯 درصد یک عدد' : '💯 Percentage of a number'}\n<b>${fmt(value)}</b>\n` +
          assumptions(fa, [`${fmt(percent)}% × ${fmt(whole)} ÷ 100 = ${fmt(value)}`]),
        toast: fmt(value),
      };
    }

    // Mode: X ± P%
    const delta = /^(-?[\d.,]+)\s*([+-])\s*(-?[\d.,]+)\s*%$/.exec(text);
    if (delta) {
      const base = num(delta[1] ?? '');
      const sign = delta[2] === '-' ? -1 : 1;
      const percent = num(delta[3] ?? '');
      const change = (base * percent) / 100;
      const result = base + sign * change;
      return {
        html:
          `${sign > 0 ? (fa ? '📈 افزایش درصدی' : '📈 Percentage increase') : fa ? '📉 کاهش درصدی' : '📉 Percentage decrease'}\n` +
          `<b>${fmt(result)}</b>\n` +
          assumptions(fa, [
            `${fa ? 'مقدار تغییر' : 'Change'} = ${fmt(base)} × ${fmt(percent)}% = ${fmt(change)}`,
            `${fmt(base)} ${sign > 0 ? '+' : '−'} ${fmt(change)} = ${fmt(result)}`,
          ]),
        toast: fmt(result),
      };
    }

    // Mode: diff A B  → percentage difference (relative to the mean)
    const diff = /^diff\s+(-?[\d.,]+)\s+(-?[\d.,]+)$/i.exec(text);
    if (diff) {
      const a = num(diff[1] ?? '');
      const b = num(diff[2] ?? '');
      const mean = (Math.abs(a) + Math.abs(b)) / 2;
      if (mean === 0) throw errInvalidInput('هر دو مقدار صفر هستند.', 'Both values are zero.');
      const value = (Math.abs(a - b) / mean) * 100;
      return {
        html:
          `${fa ? '↔️ اختلاف درصدی' : '↔️ Percentage difference'}\n<b>${fmt(value)}%</b>\n` +
          assumptions(fa, [
            fa ? 'اختلاف درصدی نسبت به میانگین دو مقدار سنجیده می‌شود' : 'Difference is measured against the mean of both values',
            `|${fmt(a)} − ${fmt(b)}| ÷ ${fmt(mean)} × 100 = ${fmt(value)}%`,
          ]),
        toast: `${fmt(value)}%`,
      };
    }

    // Mode: A to B  → percent change
    const change = /^(-?[\d.,]+)\s*(?:to|→|->)\s*(-?[\d.,]+)$/i.exec(text);
    if (change) {
      const from = num(change[1] ?? '');
      const to = num(change[2] ?? '');
      if (from === 0) {
        throw errInvalidInput(
          'مقدار اولیه صفر است؛ درصد تغییر تعریف نمی‌شود.',
          'The starting value is zero, so percent change is undefined.',
        );
      }
      const value = ((to - from) / Math.abs(from)) * 100;
      return {
        html:
          `${value >= 0 ? (fa ? '📈 رشد' : '📈 Increase') : fa ? '📉 افت' : '📉 Decrease'}\n<b>${pct(value)}</b>\n` +
          assumptions(fa, [
            `(${fmt(to)} − ${fmt(from)}) ÷ |${fmt(from)}| × 100 = ${pct(value)}`,
            `${fa ? 'مقدار تغییر' : 'Absolute change'} = ${fmt(to - from)}`,
          ]),
        toast: pct(value),
      };
    }

    throw errInvalidInput(
      'قالب شناخته نشد. نمونه‌ها: «15% of 200» • «120 to 150» • «200 + 15%» • «30 is 15% of what» • «diff 40 60»',
      'Unrecognised format. Examples: "15% of 200" • "120 to 150" • "200 + 15%" • "30 is 15% of what" • "diff 40 60"',
    );
  },
});

// ─── 2. BMI Calculator ─────────────────────────────────────
interface BmiBand {
  maxExclusive: number;
  fa: string;
  en: string;
  icon: string;
}

// WHO adult BMI classification.
const BMI_BANDS: BmiBand[] = [
  { maxExclusive: 16, fa: 'لاغری شدید', en: 'Severe thinness', icon: '🔴' },
  { maxExclusive: 17, fa: 'لاغری متوسط', en: 'Moderate thinness', icon: '🟠' },
  { maxExclusive: 18.5, fa: 'کم‌وزنی خفیف', en: 'Mild thinness', icon: '🟡' },
  { maxExclusive: 25, fa: 'وزن طبیعی', en: 'Normal weight', icon: '🟢' },
  { maxExclusive: 30, fa: 'اضافه‌وزن', en: 'Overweight', icon: '🟡' },
  { maxExclusive: 35, fa: 'چاقی درجه ۱', en: 'Obese class I', icon: '🟠' },
  { maxExclusive: 40, fa: 'چاقی درجه ۲', en: 'Obese class II', icon: '🔴' },
  { maxExclusive: Infinity, fa: 'چاقی درجه ۳', en: 'Obese class III', icon: '🔴' },
];

export function bmiBand(bmi: number): BmiBand {
  return BMI_BANDS.find((band) => bmi < band.maxExclusive) ?? (BMI_BANDS[BMI_BANDS.length - 1] as BmiBand);
}

export const bmiTool = defineTool({
  id: 'bmi_calc',
  category: 'everyday',
  group: 'calculators',
  icon: '📊',
  needsInput: true,
  title: { fa: 'محاسبه‌گر BMI', en: 'BMI Calculator' },
  description: {
    fa: 'شاخص توده‌ی بدنی را از وزن و قد محاسبه می‌کند، دسته‌بندی WHO و محدوده‌ی وزن سالم را نشان می‌دهد. واحدهای متریک و امپریال پشتیبانی می‌شوند.',
    en: 'Computes Body Mass Index from weight and height, shows the WHO classification and the healthy weight range. Metric and imperial units are supported.',
  },
  usage: {
    fa:
      'متریک:\n<code>weight: 70\nheight: 175</code>\n\n' +
      'امپریال:\n<code>weight: 154 lb\nheight: 5ft 9in</code>',
    en:
      'Metric:\n<code>weight: 70\nheight: 175</code>\n\n' +
      'Imperial:\n<code>weight: 154 lb\nheight: 5ft 9in</code>',
  },
  example: {
    fa: 'ورودی: weight: 70 / height: 175\nخروجی: BMI 22.9 — وزن طبیعی',
    en: 'Input: weight: 70 / height: 175\nOutput: BMI 22.9 — Normal weight',
  },
  limitations: {
    fa: 'BMI برای بزرگسالان است و توده‌ی عضلانی، جنسیت و سن را در نظر نمی‌گیرد؛ جایگزین نظر پزشک نیست. قد ۵۰ تا ۲۵۰ سانتی‌متر و وزن ۲ تا ۵۰۰ کیلوگرم.',
    en: 'BMI targets adults and ignores muscle mass, sex and age; it is not medical advice. Height 50–250 cm, weight 2–500 kg.',
  },
  run: (input, ctx) => {
    const fa = FA(ctx);
    const fields = parseFields(input);
    const rawWeight = textField(fields, ['weight', 'w', 'وزن']);
    const rawHeight = textField(fields, ['height', 'h', 'قد']);
    if (!rawWeight || !rawHeight) {
      throw errInvalidInput(
        'هر دو فیلد weight و height لازم است.',
        'Both "weight" and "height" are required.',
      );
    }

    // Weight → kg
    let kg: number;
    if (/lb|pound|پوند/i.test(rawWeight)) {
      kg = numberField(fields, ['weight', 'w', 'وزن'], { label: 'weight' }) * 0.45359237;
    } else {
      kg = numberField(fields, ['weight', 'w', 'وزن'], { label: 'weight' });
    }

    // Height → metres. Accepts 175, 1.75, "5ft 9in", "5'9", 69in.
    let metres: number;
    const feetInch = /(-?[\d.]+)\s*(?:ft|'|فوت)\s*(?:(-?[\d.]+)\s*(?:in|"|اینچ)?)?/i.exec(rawHeight);
    if (feetInch) {
      const feet = Number(feetInch[1] ?? '0');
      const inches = Number(feetInch[2] ?? '0');
      metres = (feet * 12 + inches) * 0.0254;
    } else if (/in\b|اینچ/i.test(rawHeight)) {
      metres = numberField(fields, ['height', 'h', 'قد'], { label: 'height' }) * 0.0254;
    } else {
      const raw = numberField(fields, ['height', 'h', 'قد'], { label: 'height' });
      // A bare number under 3 is metres; otherwise centimetres.
      metres = raw < 3 ? raw : raw / 100;
    }

    if (!(kg >= 2 && kg <= 500)) {
      throw errInvalidInput('وزن باید بین ۲ تا ۵۰۰ کیلوگرم باشد.', 'Weight must be between 2 and 500 kg.');
    }
    if (!(metres >= 0.5 && metres <= 2.5)) {
      throw errInvalidInput('قد باید بین ۵۰ تا ۲۵۰ سانتی‌متر باشد.', 'Height must be between 50 and 250 cm.');
    }

    const bmi = kg / (metres * metres);
    const band = bmiBand(bmi);
    const healthyMin = 18.5 * metres * metres;
    const healthyMax = 24.9 * metres * metres;

    return {
      html:
        `${band.icon} <b>BMI = ${fmt(bmi, 1)}</b>\n` +
        `${fa ? band.fa : band.en}\n${DIVIDER}\n` +
        `${fa ? '⚖️ وزن' : '⚖️ Weight'}: ${fmt(kg, 1)} kg\n` +
        `${fa ? '📏 قد' : '📏 Height'}: ${fmt(metres * 100, 1)} cm\n` +
        `${fa ? '🎯 محدوده‌ی وزن سالم' : '🎯 Healthy weight range'}: ${fmt(healthyMin, 1)}–${fmt(healthyMax, 1)} kg\n` +
        assumptions(fa, [
          'BMI = kg ÷ m²',
          fa ? 'دسته‌بندی بر پایه‌ی استاندارد WHO برای بزرگسالان' : 'Classification follows the WHO adult standard',
          fa
            ? 'توده‌ی عضلانی، سن، جنسیت و ترکیب بدن لحاظ نمی‌شود — جایگزین نظر پزشک نیست'
            : 'Muscle mass, age, sex and body composition are not considered — not medical advice',
        ]),
      toast: `BMI ${fmt(bmi, 1)}`,
    };
  },
});

// ─── 3. Tip Calculator ─────────────────────────────────────
export const tipTool = defineTool({
  id: 'tip_calc',
  category: 'everyday',
  group: 'calculators',
  icon: '🧾',
  needsInput: true,
  title: { fa: 'محاسبه‌گر انعام', en: 'Tip Calculator' },
  description: {
    fa: 'انعام، مبلغ کل و سهم هر نفر را حساب می‌کند و در صورت نیاز سهم‌ها را رند می‌کند.',
    en: 'Calculates the tip, the total and the share per person, with optional rounding of each share.',
  },
  usage: {
    fa: '<code>bill: 480\ntip: 15\npeople: 3</code>\nفیلد اختیاری: <code>round: up</code>',
    en: '<code>bill: 480\ntip: 15\npeople: 3</code>\nOptional: <code>round: up</code>',
  },
  example: {
    fa: 'ورودی: bill: 480 / tip: 15 / people: 3\nخروجی: انعام 72 • کل 552 • هر نفر 184',
    en: 'Input: bill: 480 / tip: 15 / people: 3\nOutput: tip 72 • total 552 • 184 each',
  },
  limitations: {
    fa: 'تعداد افراد ۱ تا ۱۰۰۰. درصد انعام ۰ تا ۱۰۰. واحد پول نمایشی است و تبدیل ارز انجام نمی‌شود.',
    en: 'People 1–1000, tip 0–100%. The currency label is cosmetic; no FX conversion is performed.',
  },
  run: (input, ctx) => {
    const fa = FA(ctx);
    const fields = parseFields(input);
    const bill = numberField(fields, ['bill', 'amount', 'مبلغ', 'صورتحساب'], { min: 0, label: 'bill' });
    const tipPct = numberField(fields, ['tip', 'tippercentage', 'percent', 'انعام'], {
      min: 0, max: 100, fallback: 15, label: 'tip',
    });
    const people = numberField(fields, ['people', 'persons', 'split', 'نفر', 'افراد'], {
      min: 1, max: 1000, fallback: 1, label: 'people',
    });
    if (!Number.isInteger(people)) {
      throw errInvalidInput('تعداد افراد باید عدد صحیح باشد.', 'The number of people must be a whole number.');
    }
    const rounding = textField(fields, ['round', 'rounding', 'رند']).toLowerCase();

    const tip = (bill * tipPct) / 100;
    const total = bill + tip;
    let perPerson = total / people;
    let roundNote = '';
    if (rounding === 'up' || rounding === 'بالا') {
      perPerson = Math.ceil(perPerson);
      roundNote = fa ? 'سهم هر نفر به بالا رند شد' : 'Each share rounded up';
    } else if (rounding === 'down' || rounding === 'پایین') {
      perPerson = Math.floor(perPerson);
      roundNote = fa ? 'سهم هر نفر به پایین رند شد' : 'Each share rounded down';
    }
    const collected = perPerson * people;

    return {
      html:
        `${fa ? '🧾 انعام' : '🧾 Tip'}: <b>${fmt(tip)}</b>\n` +
        `${fa ? '💰 مبلغ کل' : '💰 Total'}: <b>${fmt(total)}</b>\n` +
        `${fa ? '👤 سهم هر نفر' : '👤 Per person'}: <b>${fmt(perPerson)}</b>` +
        (people > 1 ? ` × ${people}` : '') +
        `\n` +
        assumptions(fa, [
          `${fa ? 'انعام' : 'Tip'} = ${fmt(bill)} × ${fmt(tipPct)}% = ${fmt(tip)}`,
          `${fa ? 'کل' : 'Total'} = ${fmt(bill)} + ${fmt(tip)} = ${fmt(total)}`,
          ...(roundNote ? [`${roundNote} — ${fa ? 'مجموع جمع‌آوری‌شده' : 'collected'} ${fmt(collected)}`] : []),
        ]),
      toast: `${fa ? 'هر نفر' : 'Each'} ${fmt(perPerson)}`,
    };
  },
});

// ─── 4. Installment / loan calculator ──────────────────────
export interface AmortisationResult {
  monthlyPayment: number;
  totalPayment: number;
  totalInterest: number;
  principal: number;
  months: number;
  monthlyRate: number;
}

/**
 * Standard annuity (equal-payment) amortisation.
 * A zero interest rate is handled separately — the annuity formula divides by
 * zero there, which would silently produce NaN.
 */
export function amortise(principal: number, annualRatePct: number, months: number): AmortisationResult {
  const monthlyRate = annualRatePct / 100 / 12;
  const monthlyPayment =
    monthlyRate === 0
      ? principal / months
      : (principal * monthlyRate) / (1 - Math.pow(1 + monthlyRate, -months));
  const totalPayment = monthlyPayment * months;
  return {
    monthlyPayment,
    totalPayment,
    totalInterest: totalPayment - principal,
    principal,
    months,
    monthlyRate,
  };
}

export const installmentTool = defineTool({
  id: 'installment_calc',
  category: 'everyday',
  group: 'calculators',
  icon: '💳',
  needsInput: true,
  title: { fa: 'محاسبه‌گر اقساط', en: 'Installment Calculator' },
  description: {
    fa: 'قسط ماهانه، مبلغ کل بازپرداخت و مجموع سود را با روش اقساط مساوی (Annuity) محاسبه می‌کند.',
    en: 'Computes the monthly payment, total repayment and total interest using the standard equal-payment (annuity) method.',
  },
  usage: {
    fa: '<code>principal: 100000\nrate: 18\nmonths: 36</code>\nنرخ سالانه است. برای پرداخت‌های سالانه از <code>payments: 36</code> هم می‌توان استفاده کرد.',
    en: '<code>principal: 100000\nrate: 18\nmonths: 36</code>\nRate is annual. <code>payments: 36</code> is accepted as an alias.',
  },
  example: {
    fa: 'ورودی: principal: 100000 / rate: 18 / months: 36\nخروجی: قسط ماهانه ≈ 3,615',
    en: 'Input: principal: 100000 / rate: 18 / months: 36\nOutput: monthly ≈ 3,615',
  },
  limitations: {
    fa: 'روش اقساط مساوی با نرخ ثابت. کارمزد، بیمه، جریمه‌ی تأخیر و نرخ شناور لحاظ نمی‌شود. تعداد اقساط ۱ تا ۶۰۰.',
    en: 'Fixed-rate annuity only. Fees, insurance, late penalties and variable rates are not modelled. 1–600 payments.',
  },
  run: (input, ctx) => {
    const fa = FA(ctx);
    const fields = parseFields(input);
    const principal = numberField(fields, ['principal', 'amount', 'loan', 'اصل', 'مبلغ'], {
      min: 1, label: 'principal',
    });
    const rate = numberField(fields, ['rate', 'interest', 'apr', 'نرخ', 'سود'], {
      min: 0, max: 200, fallback: 0, label: 'rate',
    });
    const months = numberField(fields, ['months', 'payments', 'numberofpayments', 'term', 'اقساط', 'ماه'], {
      min: 1, max: 600, label: 'months',
    });
    if (!Number.isInteger(months)) {
      throw errInvalidInput('تعداد اقساط باید عدد صحیح باشد.', 'The number of payments must be a whole number.');
    }

    const result = amortise(principal, rate, months);
    const interestShare = result.totalPayment > 0 ? (result.totalInterest / result.totalPayment) * 100 : 0;

    return {
      html:
        `${fa ? '💳 قسط ماهانه' : '💳 Monthly payment'}: <b>${fmt(result.monthlyPayment)}</b>\n${DIVIDER}\n` +
        `${fa ? '🏦 اصل وام' : '🏦 Principal'}: ${fmt(principal)}\n` +
        `${fa ? '📆 تعداد اقساط' : '📆 Payments'}: ${months}\n` +
        `${fa ? '💰 کل بازپرداخت' : '💰 Total payment'}: <b>${fmt(result.totalPayment)}</b>\n` +
        `${fa ? '📈 کل سود' : '📈 Total interest'}: <b>${fmt(result.totalInterest)}</b> (${fmt(interestShare, 1)}٪ ${fa ? 'از کل' : 'of total'})\n` +
        assumptions(fa, [
          fa ? 'روش: اقساط مساوی (Annuity) با نرخ ثابت' : 'Method: fixed-rate annuity (equal payments)',
          `${fa ? 'نرخ سالانه' : 'Annual rate'} ${fmt(rate)}% → ${fa ? 'نرخ ماهانه' : 'monthly'} ${fmt(result.monthlyRate * 100, 4)}%`,
          rate === 0
            ? fa ? 'نرخ صفر: اصل وام به‌طور مساوی تقسیم شد' : 'Zero rate: principal divided evenly'
            : 'P = A · i ÷ (1 − (1+i)⁻ⁿ)',
          fa
            ? 'کارمزد، بیمه و جریمه‌ی تأخیر محاسبه نشده است'
            : 'Fees, insurance and late penalties are not included',
        ]),
      toast: `${fmt(result.monthlyPayment)}/mo`,
    };
  },
});

// ─── 5. Compound interest ──────────────────────────────────
const FREQUENCIES: Record<string, { perYear: number; fa: string; en: string }> = {
  daily: { perYear: 365, fa: 'روزانه', en: 'daily' },
  weekly: { perYear: 52, fa: 'هفتگی', en: 'weekly' },
  monthly: { perYear: 12, fa: 'ماهانه', en: 'monthly' },
  quarterly: { perYear: 4, fa: 'سه‌ماهه', en: 'quarterly' },
  semiannual: { perYear: 2, fa: 'شش‌ماهه', en: 'semi-annual' },
  yearly: { perYear: 1, fa: 'سالانه', en: 'yearly' },
  annually: { perYear: 1, fa: 'سالانه', en: 'yearly' },
};

export const compoundTool = defineTool({
  id: 'compound_calc',
  category: 'everyday',
  group: 'calculators',
  icon: '📈',
  needsInput: true,
  title: { fa: 'سود مرکب', en: 'Compound Interest' },
  description: {
    fa: 'مبلغ نهایی، مجموع واریزها و سود کسب‌شده را با احتساب واریز دوره‌ای و تناوب مرکب‌شدن محاسبه می‌کند.',
    en: 'Computes the final amount, total contributions and interest earned, including periodic contributions and the compounding frequency.',
  },
  usage: {
    fa:
      '<code>principal: 10000\nrate: 12\nyears: 5\nfrequency: monthly\ncontribution: 500</code>\n' +
      'تناوب: daily / weekly / monthly / quarterly / semiannual / yearly',
    en:
      '<code>principal: 10000\nrate: 12\nyears: 5\nfrequency: monthly\ncontribution: 500</code>\n' +
      'Frequency: daily / weekly / monthly / quarterly / semiannual / yearly',
  },
  example: {
    fa: 'ورودی: principal: 10000 / rate: 12 / years: 5\nخروجی: مبلغ نهایی ≈ 18,167',
    en: 'Input: principal: 10000 / rate: 12 / years: 5\nOutput: final ≈ 18,167',
  },
  limitations: {
    fa: 'مدت ۱ ماه تا ۱۰۰ سال. مالیات و تورم لحاظ نمی‌شود. واریز در انتهای هر دوره فرض می‌شود.',
    en: 'Duration 1 month to 100 years. Taxes and inflation are ignored. Contributions are assumed at period end.',
  },
  run: (input, ctx) => {
    const fa = FA(ctx);
    const fields = parseFields(input);
    const principal = numberField(fields, ['principal', 'initial', 'amount', 'اصل', 'سرمایه'], {
      min: 0, label: 'principal',
    });
    const rate = numberField(fields, ['rate', 'interest', 'apr', 'نرخ'], { min: 0, max: 200, label: 'rate' });
    const yearsRaw = numberField(fields, ['years', 'duration', 'سال', 'مدت'], { min: 0, max: 100, fallback: 0 });
    const monthsRaw = numberField(fields, ['months', 'ماه'], { min: 0, max: 1200, fallback: 0 });
    const years = yearsRaw > 0 ? yearsRaw : monthsRaw / 12;
    if (years <= 0) {
      throw errInvalidInput('مدت زمان را با years یا months مشخص کنید.', 'Specify the duration with "years" or "months".');
    }
    const freqKey = textField(fields, ['frequency', 'compounding', 'تناوب'], 'monthly')
      .toLowerCase()
      .replace(/[\s_-]/g, '');
    const freq = FREQUENCIES[freqKey];
    if (!freq) {
      throw errInvalidInput(
        `تناوب «${freqKey}» شناخته نشد. مقادیر مجاز: daily, weekly, monthly, quarterly, semiannual, yearly`,
        `Unknown frequency "${freqKey}". Allowed: daily, weekly, monthly, quarterly, semiannual, yearly`,
      );
    }
    const contribution = numberField(fields, ['contribution', 'deposit', 'monthly', 'واریز'], {
      min: 0, fallback: 0, label: 'contribution',
    });

    const n = freq.perYear;
    const periods = Math.round(n * years);
    if (periods < 1) {
      throw errInvalidInput('مدت زمان برای این تناوب بسیار کوتاه است.', 'The duration is too short for this frequency.');
    }
    const i = rate / 100 / n;

    // Future value of the lump sum plus an ordinary annuity of contributions.
    const fvPrincipal = principal * Math.pow(1 + i, periods);
    const fvContrib =
      contribution === 0 ? 0 : i === 0 ? contribution * periods : contribution * ((Math.pow(1 + i, periods) - 1) / i);
    const finalAmount = fvPrincipal + fvContrib;
    const totalContributions = principal + contribution * periods;
    const interestEarned = finalAmount - totalContributions;

    return {
      html:
        `${fa ? '📈 مبلغ نهایی' : '📈 Final amount'}: <b>${fmt(finalAmount)}</b>\n${DIVIDER}\n` +
        `${fa ? '💵 مجموع واریزها' : '💵 Total contributions'}: ${fmt(totalContributions)}\n` +
        `${fa ? '✨ سود کسب‌شده' : '✨ Interest earned'}: <b>${fmt(interestEarned)}</b>\n` +
        `${fa ? '🔁 تعداد دوره' : '🔁 Periods'}: ${periods} (${fa ? freq.fa : freq.en})\n` +
        assumptions(fa, [
          'FV = P(1+i)ⁿ + C · ((1+i)ⁿ − 1) ÷ i',
          `i = ${fmt(rate)}% ÷ ${n} = ${fmt(i * 100, 4)}% ${fa ? 'در هر دوره' : 'per period'}`,
          contribution > 0
            ? fa
              ? `واریز ${fmt(contribution)} در انتهای هر دوره فرض شد`
              : `Contribution of ${fmt(contribution)} assumed at the end of each period`
            : fa ? 'بدون واریز دوره‌ای' : 'No periodic contribution',
          fa ? 'مالیات و تورم لحاظ نشده است' : 'Taxes and inflation are not modelled',
        ]),
      toast: fmt(finalAmount),
    };
  },
});

// ─── 6. Profit / loss ──────────────────────────────────────
export const profitLossTool = defineTool({
  id: 'profit_calc',
  category: 'everyday',
  group: 'calculators',
  icon: '💰',
  needsInput: true,
  title: { fa: 'سود و زیان', en: 'Profit / Loss Calculator' },
  description: {
    fa: 'سود یا زیان ناخالص و خالص، درصد بازده و بهای تمام‌شده را با احتساب کارمزد محاسبه می‌کند.',
    en: 'Computes gross and net profit or loss, return percentage and total cost, including fees.',
  },
  usage: {
    fa: '<code>buy: 100\nsell: 130\nquantity: 10\nfees: 25</code>\nکارمزد می‌تواند درصدی باشد: <code>fees: 1.5%</code>',
    en: '<code>buy: 100\nsell: 130\nquantity: 10\nfees: 25</code>\nFees may be a percentage: <code>fees: 1.5%</code>',
  },
  example: {
    fa: 'ورودی: buy: 100 / sell: 130 / quantity: 10\nخروجی: سود خالص 300 (+30٪)',
    en: 'Input: buy: 100 / sell: 130 / quantity: 10\nOutput: net profit 300 (+30%)',
  },
  limitations: {
    fa: 'مالیات، اسپرد و نرخ ارز لحاظ نمی‌شود. کارمزد درصدی روی مجموع خرید و فروش اعمال می‌شود.',
    en: 'Taxes, spread and FX are not modelled. A percentage fee is applied to the combined buy and sell value.',
  },
  run: (input, ctx) => {
    const fa = FA(ctx);
    const fields = parseFields(input);
    const buy = numberField(fields, ['buy', 'buyprice', 'cost', 'خرید'], { min: 0, label: 'buy' });
    const sell = numberField(fields, ['sell', 'sellprice', 'فروش'], { min: 0, label: 'sell' });
    const quantity = numberField(fields, ['quantity', 'qty', 'amount', 'تعداد'], {
      min: 0, fallback: 1, label: 'quantity',
    });
    const rawFees = textField(fields, ['fees', 'fee', 'commission', 'کارمزد'], '0');

    const buyValue = buy * quantity;
    const sellValue = sell * quantity;
    // Without a cost basis the return percentage is undefined, and printing
    // "0%" next to a real profit would be actively misleading.
    if (buyValue <= 0) {
      throw errInvalidInput(
        'بهای خرید باید بزرگ‌تر از صفر باشد؛ در غیر این صورت درصد بازده تعریف‌شده نیست.',
        'The buy value must be greater than zero, otherwise the return percentage is undefined.',
      );
    }
    let fees: number;
    let feeNote: string;
    if (/[%٪]/.test(rawFees)) {
      const feePct = numberField(fields, ['fees', 'fee', 'commission', 'کارمزد'], { min: 0, max: 100, label: 'fees' });
      fees = ((buyValue + sellValue) * feePct) / 100;
      feeNote = fa
        ? `کارمزد ${fmt(feePct)}٪ روی مجموع خرید و فروش = ${fmt(fees)}`
        : `Fee ${fmt(feePct)}% on combined buy+sell = ${fmt(fees)}`;
    } else {
      fees = numberField(fields, ['fees', 'fee', 'commission', 'کارمزد'], { min: 0, fallback: 0, label: 'fees' });
      feeNote = fa ? `کارمزد ثابت ${fmt(fees)}` : `Flat fee ${fmt(fees)}`;
    }

    const gross = sellValue - buyValue;
    const net = gross - fees;
    const totalCost = buyValue + fees;
    const percentage = totalCost > 0 ? (net / totalCost) * 100 : 0;
    const win = net >= 0;

    return {
      html:
        `${win ? '🟢' : '🔴'} <b>${win ? (fa ? 'سود' : 'Profit') : fa ? 'زیان' : 'Loss'}: ${fmt(Math.abs(net))}</b> (${pct(percentage)})\n${DIVIDER}\n` +
        `${fa ? '📥 ارزش خرید' : '📥 Buy value'}: ${fmt(buyValue)}\n` +
        `${fa ? '📤 ارزش فروش' : '📤 Sell value'}: ${fmt(sellValue)}\n` +
        `${fa ? '📊 سود/زیان ناخالص' : '📊 Gross P/L'}: ${fmt(gross)}\n` +
        `${fa ? '💸 کارمزد' : '💸 Fees'}: ${fmt(fees)}\n` +
        `${fa ? '🧾 بهای تمام‌شده' : '🧾 Total cost'}: ${fmt(totalCost)}\n` +
        assumptions(fa, [
          `${fa ? 'ناخالص' : 'Gross'} = (${fmt(sell)} − ${fmt(buy)}) × ${fmt(quantity)} = ${fmt(gross)}`,
          feeNote,
          `${fa ? 'درصد بازده نسبت به بهای تمام‌شده سنجیده شد' : 'Return is measured against total cost'}`,
        ]),
      toast: `${win ? '+' : ''}${fmt(net)}`,
    };
  },
});

// ─── 7. Tax calculator ─────────────────────────────────────
export const taxTool = defineTool({
  id: 'tax_calc',
  category: 'everyday',
  group: 'calculators',
  icon: '🧾',
  needsInput: true,
  title: { fa: 'محاسبه‌گر مالیات', en: 'Tax Calculator' },
  description: {
    fa: 'مالیات، مبلغ خالص و ناخالص را با نرخ دلخواه شما محاسبه می‌کند — هم افزودن مالیات و هم جدا کردن آن از مبلغ ناخالص.',
    en: 'Computes tax, net and gross amounts at a rate you provide — both adding tax and extracting it from a gross amount.',
  },
  usage: {
    fa:
      'افزودن مالیات به مبلغ خالص:\n<code>amount: 1000\nrate: 9</code>\n\n' +
      'جدا کردن مالیات از مبلغ ناخالص:\n<code>amount: 1090\nrate: 9\nmode: inclusive</code>',
    en:
      'Add tax to a net amount:\n<code>amount: 1000\nrate: 9</code>\n\n' +
      'Extract tax from a gross amount:\n<code>amount: 1090\nrate: 9\nmode: inclusive</code>',
  },
  example: {
    fa: 'ورودی: amount: 1000 / rate: 9\nخروجی: مالیات 90 • ناخالص 1090',
    en: 'Input: amount: 1000 / rate: 9\nOutput: tax 90 • gross 1090',
  },
  limitations: {
    fa: 'نرخ مالیات را شما تعیین می‌کنید؛ هیچ نرخ کشوری در ربات ثابت نشده است. نرخ ۰ تا ۱۰۰٪.',
    en: 'You supply the rate; no country rate is hardcoded in the bot. Rate 0–100%.',
  },
  run: (input, ctx) => {
    const fa = FA(ctx);
    const fields = parseFields(input);
    const amount = numberField(fields, ['amount', 'value', 'مبلغ'], { min: 0, label: 'amount' });
    const rate = numberField(fields, ['rate', 'tax', 'taxrate', 'vat', 'نرخ', 'مالیات'], {
      min: 0, max: 100, label: 'rate',
    });
    const mode = textField(fields, ['mode', 'type', 'حالت'], 'exclusive').toLowerCase();
    const inclusive = mode.startsWith('in') || mode === 'gross' || mode === 'ناخالص';

    let net: number;
    let tax: number;
    let gross: number;
    if (inclusive) {
      gross = amount;
      net = amount / (1 + rate / 100);
      tax = gross - net;
    } else {
      net = amount;
      tax = (amount * rate) / 100;
      gross = net + tax;
    }

    return {
      html:
        `${fa ? '🧾 مالیات' : '🧾 Tax'}: <b>${fmt(tax)}</b>\n${DIVIDER}\n` +
        `${fa ? '💵 مبلغ خالص' : '💵 Net amount'}: ${fmt(net)}\n` +
        `${fa ? '💰 مبلغ ناخالص' : '💰 Gross amount'}: ${fmt(gross)}\n` +
        `${fa ? '📊 نرخ' : '📊 Rate'}: ${fmt(rate)}%\n` +
        assumptions(fa, [
          inclusive
            ? fa
              ? `حالت «شامل مالیات»: خالص = ناخالص ÷ (1 + ${fmt(rate)}%)`
              : `Inclusive mode: net = gross ÷ (1 + ${fmt(rate)}%)`
            : fa
              ? `حالت «بدون مالیات»: مالیات = خالص × ${fmt(rate)}%`
              : `Exclusive mode: tax = net × ${fmt(rate)}%`,
          fa
            ? 'نرخ توسط شما تعیین شد؛ ربات هیچ نرخ مالیاتی پیش‌فرضی ندارد'
            : 'The rate came from your input; the bot hardcodes no tax rate',
        ]),
      toast: `${fa ? 'مالیات' : 'Tax'} ${fmt(tax)}`,
    };
  },
});

// ─── 8. Fuel cost ──────────────────────────────────────────
export const fuelTool = defineTool({
  id: 'fuel_calc',
  category: 'everyday',
  group: 'calculators',
  icon: '⛽',
  needsInput: true,
  title: { fa: 'هزینه‌ی سوخت', en: 'Fuel Cost Calculator' },
  description: {
    fa: 'مقدار سوخت لازم، هزینه‌ی کل و هزینه به ازای هر کیلومتر را حساب می‌کند. مصرف را می‌توان به L/100km، km/L یا MPG داد.',
    en: 'Computes fuel required, total cost and cost per kilometre. Consumption may be given as L/100km, km/L or MPG.',
  },
  usage: {
    fa:
      '<code>distance: 450\nconsumption: 7.5\nprice: 30000</code>\n' +
      'واحد مصرف پیش‌فرض L/100km است. جایگزین‌ها:\n' +
      '<code>consumption: 13 km/l</code> • <code>consumption: 31 mpg</code>\n' +
      'مسافت به مایل: <code>distance: 300 mi</code>',
    en:
      '<code>distance: 450\nconsumption: 7.5\nprice: 1.85</code>\n' +
      'Consumption defaults to L/100km. Alternatives:\n' +
      '<code>consumption: 13 km/l</code> • <code>consumption: 31 mpg</code>\n' +
      'Miles: <code>distance: 300 mi</code>',
  },
  example: {
    fa: 'ورودی: distance: 450 / consumption: 7.5 / price: 30000\nخروجی: 33.75 لیتر • هزینه 1,012,500',
    en: 'Input: distance: 450 / consumption: 7.5 / price: 1.85\nOutput: 33.75 L • cost 62.44',
  },
  limitations: {
    fa: 'مصرف ثابت فرض می‌شود؛ ترافیک، شیب جاده و سبک رانندگی لحاظ نمی‌شود. واحد پول نمایشی است.',
    en: 'Constant consumption is assumed; traffic, gradient and driving style are ignored. The currency label is cosmetic.',
  },
  run: (input, ctx) => {
    const fa = FA(ctx);
    const fields = parseFields(input);
    const rawDistance = textField(fields, ['distance', 'مسافت'], '');
    const rawConsumption = textField(fields, ['consumption', 'usage', 'مصرف'], '');
    if (!rawDistance || !rawConsumption) {
      throw errInvalidInput(
        'فیلدهای distance و consumption الزامی هستند.',
        'Fields "distance" and "consumption" are required.',
      );
    }

    let km = numberField(fields, ['distance', 'مسافت'], { min: 0, label: 'distance' });
    if (/\bmi\b|mile|مایل/i.test(rawDistance)) km *= 1.609344;

    const consumptionValue = numberField(fields, ['consumption', 'usage', 'مصرف'], { min: 0.01, label: 'consumption' });
    let litresPer100: number;
    let consumptionNote: string;
    if (/mpg/i.test(rawConsumption)) {
      // US MPG → L/100km
      litresPer100 = 235.214583 / consumptionValue;
      consumptionNote = `${fmt(consumptionValue)} MPG → ${fmt(litresPer100)} L/100km`;
    } else if (/km\s*\/\s*l|kmpl/i.test(rawConsumption)) {
      litresPer100 = 100 / consumptionValue;
      consumptionNote = `${fmt(consumptionValue)} km/L → ${fmt(litresPer100)} L/100km`;
    } else {
      litresPer100 = consumptionValue;
      consumptionNote = `${fmt(litresPer100)} L/100km`;
    }

    const price = numberField(fields, ['price', 'fuelprice', 'قیمت'], { min: 0, fallback: 0, label: 'price' });
    const litres = (km / 100) * litresPer100;
    const totalCost = litres * price;
    const costPerKm = km > 0 ? totalCost / km : 0;

    return {
      html:
        `${fa ? '⛽ سوخت لازم' : '⛽ Fuel required'}: <b>${fmt(litres)} ${fa ? 'لیتر' : 'L'}</b>\n` +
        (price > 0
          ? `${fa ? '💰 هزینه‌ی کل' : '💰 Total cost'}: <b>${fmt(totalCost)}</b>\n` +
            `${fa ? '📏 هزینه‌ی هر کیلومتر' : '📏 Cost per km'}: ${fmt(costPerKm, 4)}\n`
          : `${fa ? 'ℹ️ برای محاسبه‌ی هزینه، فیلد price را اضافه کنید.' : 'ℹ️ Add a "price" field to compute cost.'}\n`) +
        assumptions(fa, [
          `${fa ? 'مسافت' : 'Distance'} = ${fmt(km)} km`,
          `${fa ? 'مصرف' : 'Consumption'} = ${consumptionNote}`,
          `${fa ? 'سوخت' : 'Fuel'} = ${fmt(km)} ÷ 100 × ${fmt(litresPer100)} = ${fmt(litres)} L`,
          fa ? 'مصرف ثابت فرض شد' : 'Constant consumption assumed',
        ]),
      toast: `${fmt(litres)} L`,
    };
  },
});

// ─── 9. Electricity ────────────────────────────────────────
export const electricityTool = defineTool({
  id: 'electricity_calc',
  category: 'everyday',
  group: 'calculators',
  icon: '💡',
  needsInput: true,
  title: { fa: 'محاسبه‌گر برق', en: 'Electricity Calculator' },
  description: {
    fa: 'توان، ولتاژ و جریان را از روی یکدیگر حساب می‌کند و مصرف انرژی و هزینه‌ی تقریبی را نشان می‌دهد.',
    en: 'Derives power, voltage and current from one another, then estimates energy consumption and cost.',
  },
  usage: {
    fa:
      'هر دو مورد از سه‌تای زیر را بدهید:\n<code>power: 1500\nvoltage: 220</code>\n\n' +
      'برای مصرف و هزینه:\n<code>power: 1500\nhours: 4\ndays: 30\nprice: 1200</code>',
    en:
      'Provide any two of the three:\n<code>power: 1500\nvoltage: 220</code>\n\n' +
      'For consumption and cost:\n<code>power: 1500\nhours: 4\ndays: 30\nprice: 0.32</code>',
  },
  example: {
    fa: 'ورودی: power: 1500 / voltage: 220\nخروجی: جریان ≈ 6.82 آمپر',
    en: 'Input: power: 1500 / voltage: 220\nOutput: current ≈ 6.82 A',
  },
  limitations: {
    fa: 'مدار DC یا AC با ضریب توان ۱ فرض می‌شود. برای بار سلفی، ضریب توان را با power factor بدهید. تعرفه‌ی پلکانی لحاظ نمی‌شود.',
    en: 'Assumes DC or AC at power factor 1. For inductive loads supply "power factor". Tiered tariffs are not modelled.',
  },
  run: (input, ctx) => {
    const fa = FA(ctx);
    const fields = parseFields(input);
    const pf = numberField(fields, ['powerfactor', 'pf', 'ضریبتوان'], { min: 0.01, max: 1, fallback: 1 });
    const hasPower = textField(fields, ['power', 'watt', 'w', 'توان']) !== '';
    const hasVoltage = textField(fields, ['voltage', 'volt', 'v', 'ولتاژ']) !== '';
    const hasCurrent = textField(fields, ['current', 'amp', 'ampere', 'a', 'جریان']) !== '';

    const known = [hasPower, hasVoltage, hasCurrent].filter(Boolean).length;
    if (known < 2) {
      throw errInvalidInput(
        'حداقل دو مورد از power، voltage و current لازم است.',
        'At least two of "power", "voltage" and "current" are required.',
      );
    }

    let power = hasPower ? numberField(fields, ['power', 'watt', 'w', 'توان'], { min: 0, label: 'power' }) : 0;
    let voltage = hasVoltage ? numberField(fields, ['voltage', 'volt', 'v', 'ولتاژ'], { min: 0, label: 'voltage' }) : 0;
    let current = hasCurrent ? numberField(fields, ['current', 'amp', 'ampere', 'a', 'جریان'], { min: 0, label: 'current' }) : 0;

    let derived: string;
    if (!hasPower) {
      power = voltage * current * pf;
      derived = `P = V × I${pf < 1 ? ' × PF' : ''} = ${fmt(voltage)} × ${fmt(current)}${pf < 1 ? ` × ${fmt(pf)}` : ''} = ${fmt(power)} W`;
    } else if (!hasCurrent) {
      if (voltage === 0) throw errInvalidInput('ولتاژ نمی‌تواند صفر باشد.', 'Voltage cannot be zero.');
      current = power / (voltage * pf);
      derived = `I = P ÷ (V${pf < 1 ? ' × PF' : ''}) = ${fmt(power)} ÷ ${fmt(voltage * pf)} = ${fmt(current)} A`;
    } else {
      if (current === 0) throw errInvalidInput('جریان نمی‌تواند صفر باشد.', 'Current cannot be zero.');
      voltage = power / (current * pf);
      derived = `V = P ÷ (I${pf < 1 ? ' × PF' : ''}) = ${fmt(power)} ÷ ${fmt(current * pf)} = ${fmt(voltage)} V`;
    }

    const hours = numberField(fields, ['hours', 'hoursperday', 'ساعت'], { min: 0, max: 24, fallback: 0 });
    const days = numberField(fields, ['days', 'روز'], { min: 0, max: 366, fallback: 1 });
    const price = numberField(fields, ['price', 'tariff', 'قیمت', 'تعرفه'], { min: 0, fallback: 0 });

    const kwh = (power / 1000) * hours * days;
    const cost = kwh * price;

    const lines = [
      `${fa ? '⚡ توان' : '⚡ Power'}: <b>${fmt(power)} W</b>`,
      `${fa ? '🔌 ولتاژ' : '🔌 Voltage'}: ${fmt(voltage)} V`,
      `${fa ? '🔋 جریان' : '🔋 Current'}: ${fmt(current)} A`,
    ];
    if (hours > 0) {
      lines.push(
        `${DIVIDER}`,
        `${fa ? '📊 مصرف انرژی' : '📊 Energy'}: <b>${fmt(kwh, 3)} kWh</b>` +
          (days > 1 ? ` (${hours} ${fa ? 'ساعت' : 'h'} × ${days} ${fa ? 'روز' : 'days'})` : ''),
      );
      if (price > 0) lines.push(`${fa ? '💰 هزینه‌ی تقریبی' : '💰 Estimated cost'}: <b>${fmt(cost)}</b>`);
    }

    return {
      html:
        `${lines.join('\n')}\n` +
        assumptions(fa, [
          derived,
          pf < 1
            ? `${fa ? 'ضریب توان' : 'Power factor'} = ${fmt(pf)}`
            : fa ? 'ضریب توان ۱ (بار مقاومتی یا DC) فرض شد' : 'Power factor 1 assumed (resistive or DC load)',
          ...(hours > 0 ? [`kWh = ${fmt(power)} W ÷ 1000 × ${hours} h × ${days} = ${fmt(kwh, 3)}`] : []),
          ...(price > 0 ? [fa ? 'تعرفه‌ی پلکانی و آبونمان لحاظ نشده است' : 'Tiered tariffs and standing charges are not included' ] : []),
        ]),
      toast: `${fmt(power)} W`,
    };
  },
});

export const calculatorTools = [
  percentageTool,
  bmiTool,
  tipTool,
  installmentTool,
  compoundTool,
  profitLossTool,
  taxTool,
  fuelTool,
  electricityTool,
];

