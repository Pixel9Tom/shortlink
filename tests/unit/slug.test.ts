import { describe, expect, it } from 'vitest';
import { GENERATED_SLUG_ALPHABET, generateSlug, isReservedSlug, isValidSlug } from '../../src/slug';

describe('isValidSlug', () => {
  it.each(['a', 'docs', 'A-b_9', 'x'.repeat(32), 'api', 'API'])('%s は形式に合う', (slug) => {
    expect(isValidSlug(slug)).toBe(true);
  });

  it.each(['', 'x'.repeat(33), 'a.b', 'a/b', 'favicon.ico', 'robots.txt', 'あ', 'a b', '%41'])(
    '%j は形式に合わない',
    (slug) => {
      expect(isValidSlug(slug)).toBe(false);
    },
  );
});

describe('isReservedSlug', () => {
  it('api は予約語、大文字を含むものは予約語でない', () => {
    expect(isReservedSlug('api')).toBe(true);
    expect(isReservedSlug('API')).toBe(false);
    expect(isReservedSlug('Api')).toBe(false);
  });
});

describe('generateSlug', () => {
  it('誤読しやすい文字を除いた 56 文字から 6 文字を作る', () => {
    expect(GENERATED_SLUG_ALPHABET).toHaveLength(56);
    expect(GENERATED_SLUG_ALPHABET).not.toMatch(/[0Oo1lI]/);
    for (let i = 0; i < 200; i++) {
      const slug = generateSlug();
      expect(slug).toMatch(/^[23456789abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ]{6}$/);
      expect(isValidSlug(slug)).toBe(true);
    }
  });

  it('偏りを避けるため 224 以上のバイトは捨てる', () => {
    // 1 回目は全部 255（捨てられる）、2 回目は 0〜11
    let call = 0;
    const slug = generateSlug((bytes) => {
      bytes.forEach((_, i) => (bytes[i] = call === 0 ? 255 : i));
      call++;
    });
    expect(slug).toBe(GENERATED_SLUG_ALPHABET.slice(0, 6));
    expect(call).toBe(2);
  });

  it('224 未満のバイトは 56 で割った余りで文字を選ぶ', () => {
    const slug = generateSlug((bytes) => bytes.fill(56 + 3));
    expect(slug).toBe(GENERATED_SLUG_ALPHABET.charAt(3).repeat(6));
  });
});
