// スラッグの形式と自動生成（SPEC.md §5）

/** 指定できるスラッグ：1〜32 文字の英数字・ハイフン・アンダースコア */
export const SLUG_PATTERN = /^[A-Za-z0-9_-]{1,32}$/;

/** /api 以下と衝突させないため、登録できないスラッグ（大文字小文字は区別する） */
export const RESERVED_SLUGS: ReadonlySet<string> = new Set(['api']);

/** 誤読しやすい 0 O o 1 l I を除いた 56 文字 */
export const GENERATED_SLUG_ALPHABET = '23456789abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ';
export const GENERATED_SLUG_LENGTH = 6;

export function isValidSlug(value: string): boolean {
  return SLUG_PATTERN.test(value);
}

export function isReservedSlug(value: string): boolean {
  return RESERVED_SLUGS.has(value);
}

/**
 * ランダムなスラッグを作る。偏りが出ないよう、56 の倍数（224）以上のバイトは捨てて引き直す
 */
export function generateSlug(
  random: (bytes: Uint8Array) => void = (b) => crypto.getRandomValues(b),
): string {
  const alphabet = GENERATED_SLUG_ALPHABET;
  const limit = Math.floor(256 / alphabet.length) * alphabet.length;
  let slug = '';
  const buffer = new Uint8Array(GENERATED_SLUG_LENGTH * 2);
  while (slug.length < GENERATED_SLUG_LENGTH) {
    random(buffer);
    for (const byte of buffer) {
      if (byte < limit) {
        slug += alphabet[byte % alphabet.length];
        if (slug.length === GENERATED_SLUG_LENGTH) break;
      }
    }
  }
  return slug;
}
