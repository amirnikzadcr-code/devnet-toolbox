import { defineTool } from '../types.js';
import { codeBlock, DIVIDER, isoUtc } from '../../utils/text.js';
import { base64Decode } from '../../utils/encoding.js';
import { errInvalidInput } from '../../utils/errors.js';

export interface DecodedJwt {
  header: Record<string, unknown>;
  payload: Record<string, unknown>;
  signaturePresent: boolean;
  signatureLength: number;
}

/** Decodes (never verifies) a JWT. Verification requires the secret — out of scope by design. */
export function decodeJwt(token: string): DecodedJwt {
  const clean = token.trim().replace(/^Bearer\s+/i, '');
  const parts = clean.split('.');
  if (parts.length < 2 || parts.length > 3) {
    throw errInvalidInput(
      'ساختار JWT معتبر نیست. توکن باید سه بخش جداشده با نقطه داشته باشد.',
      'Invalid JWT structure: expected three dot-separated segments.',
    );
  }
  const parseSegment = (segment: string, label: string): Record<string, unknown> => {
    let json: string;
    try {
      json = base64Decode(segment);
    } catch {
      throw errInvalidInput(
        `بخش ${label} توکن با Base64URL معتبر کدگذاری نشده است.`,
        `The ${label} segment is not valid Base64URL.`,
      );
    }
    try {
      const value: unknown = JSON.parse(json);
      if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        throw new Error('not an object');
      }
      return value as Record<string, unknown>;
    } catch {
      throw errInvalidInput(
        `بخش ${label} توکن یک JSON معتبر نیست.`,
        `The ${label} segment is not valid JSON.`,
      );
    }
  };
  return {
    header: parseSegment(parts[0] ?? '', 'header'),
    payload: parseSegment(parts[1] ?? '', 'payload'),
    signaturePresent: Boolean(parts[2]),
    signatureLength: (parts[2] ?? '').length,
  };
}

const CLAIM_LABELS: Record<string, { fa: string; en: string }> = {
  iss: { fa: 'صادرکننده', en: 'Issuer' },
  sub: { fa: 'موضوع', en: 'Subject' },
  aud: { fa: 'مخاطب', en: 'Audience' },
  exp: { fa: 'انقضا', en: 'Expires' },
  nbf: { fa: 'اعتبار از', en: 'Not before' },
  iat: { fa: 'زمان صدور', en: 'Issued at' },
  jti: { fa: 'شناسه توکن', en: 'JWT ID' },
};

export const jwtDecodeTool = defineTool({
  id: 'jwt_decode',
  category: 'programming',
  icon: '🪪',
  quick: true,
  needsInput: true,
  title: { fa: 'رمزگشای JWT', en: 'JWT Decoder' },
  description: {
    fa: 'Header و Payload یک JSON Web Token را رمزگشایی و claimهای استاندارد (exp/iat/nbf) را با تاریخ خوانا و وضعیت انقضا نمایش می‌دهد. امضا فقط بررسی حضور می‌شود و اعتبارسنجی رمزنگاری انجام نمی‌شود.',
    en: 'Decodes a JWT header and payload and renders standard claims (exp/iat/nbf) as readable dates with expiry status. Signature presence is reported; no cryptographic verification is performed.',
  },
  usage: {
    fa: 'توکن را ارسال کنید (پیشوند Bearer هم پذیرفته می‌شود).',
    en: 'Send the token (a Bearer prefix is accepted).',
  },
  example: {
    fa: 'ورودی: eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjMifQ.sig\nخروجی: header و payload به‌صورت JSON مرتب',
    en: 'Input: eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjMifQ.sig\nOutput: pretty-printed header & payload',
  },
  limitations: {
    fa: '⚠️ امضا اعتبارسنجی نمی‌شود. توکن‌های حساس و فعال را ارسال نکنید — محتوای توکن ذخیره نمی‌شود اما بهتر است از توکن تست استفاده کنید.',
    en: '⚠️ The signature is NOT verified. Avoid sending live/sensitive tokens — content is not stored, but prefer test tokens.',
  },
  run: (input, ctx) => {
    const decoded = decodeJwt(input);
    const fa = ctx.lang === 'fa';
    const now = Math.floor(Date.now() / 1000);
    const lines: string[] = [];

    lines.push(fa ? '🔹 <b>Header</b>' : '🔹 <b>Header</b>');
    lines.push(codeBlock(JSON.stringify(decoded.header, null, 2), 'json'));
    lines.push(fa ? '🔹 <b>Payload</b>' : '🔹 <b>Payload</b>');
    lines.push(codeBlock(JSON.stringify(decoded.payload, null, 2), 'json'));

    const claimLines: string[] = [];
    for (const [key, label] of Object.entries(CLAIM_LABELS)) {
      const value = decoded.payload[key];
      if (value === undefined) continue;
      if (['exp', 'iat', 'nbf'].includes(key) && typeof value === 'number') {
        const when = isoUtc(value * 1000);
        let flag = '';
        if (key === 'exp') flag = value < now ? (fa ? ' ⛔️ منقضی' : ' ⛔️ expired') : (fa ? ' ✅ معتبر' : ' ✅ valid');
        if (key === 'nbf' && value > now) flag = fa ? ' ⏳ هنوز فعال نشده' : ' ⏳ not yet active';
        claimLines.push(`• ${fa ? label.fa : label.en}: <code>${when}</code>${flag}`);
      } else {
        claimLines.push(`• ${fa ? label.fa : label.en}: <code>${String(value).slice(0, 80)}</code>`);
      }
    }
    if (claimLines.length) {
      lines.push(DIVIDER);
      lines.push(fa ? '📋 <b>Claimهای استاندارد</b>' : '📋 <b>Standard claims</b>');
      lines.push(claimLines.join('\n'));
    }

    lines.push(DIVIDER);
    const alg = String(decoded.header['alg'] ?? 'unknown');
    lines.push(
      fa
        ? `🔐 الگوریتم: <code>${alg}</code>\n✍️ امضا: ${decoded.signaturePresent ? `موجود (${decoded.signatureLength} کاراکتر)` : 'ندارد'}\n⚠️ امضا اعتبارسنجی نشد.`
        : `🔐 Algorithm: <code>${alg}</code>\n✍️ Signature: ${decoded.signaturePresent ? `present (${decoded.signatureLength} chars)` : 'missing'}\n⚠️ Signature was not verified.`,
    );
    if (alg.toLowerCase() === 'none') {
      lines.push(fa ? '🚨 هشدار: الگوریتم none ناامن است.' : '🚨 Warning: the "none" algorithm is insecure.');
    }
    return { html: lines.join('\n') };
  },
});
