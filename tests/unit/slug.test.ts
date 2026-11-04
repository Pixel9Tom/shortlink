import { describe, expect, it } from 'vitest';
import { isValidSlug } from '../../src/slug';

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
