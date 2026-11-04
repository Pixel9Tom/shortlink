// スラッグの形式（SPEC.md §5）

/** 指定できるスラッグ：1〜32 文字の英数字・ハイフン・アンダースコア */
export const SLUG_PATTERN = /^[A-Za-z0-9_-]{1,32}$/;

export function isValidSlug(value: string): boolean {
  return SLUG_PATTERN.test(value);
}
