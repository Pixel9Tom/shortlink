import { describe, expect, it } from 'vitest';
import { decodeCursor, encodeCursor } from '../../src/cursor';

describe('cursor', () => {
  it('encode したものを decode すると元に戻る', () => {
    const cursor = { createdAt: '2026-11-04T05:00:00.000Z', slug: 'a-b_C' };
    const encoded = encodeCursor(cursor);
    expect(encoded).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(decodeCursor(encoded)).toEqual(cursor);
  });

  function raw(value: unknown): string {
    return btoa(JSON.stringify(value)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  it.each([
    ['空文字', ''],
    ['base64url でない', 'not base64!'],
    ['JSON でない', btoa('hello')],
    ['null', raw(null)],
    ['配列', raw([])],
    ['createdAt が無い', raw({ slug: 'a' })],
    ['createdAt の形式が違う', raw({ createdAt: '2026-11-04', slug: 'a' })],
    ['slug の形式が違う', raw({ createdAt: '2026-11-04T05:00:00.000Z', slug: 'a.b' })],
  ])('%s なら null', (_, value) => {
    expect(decodeCursor(value)).toBeNull();
  });
});
