import { describe, expect, it } from 'vitest';
import { MAX_URL_LENGTH, selfHostnames, validateTargetUrl } from '../../src/url';

const self = selfHostnames(
  'https://short.example/api/links',
  'shortlink.pixel9tom.workers.dev, Go.Example.COM ,',
);

describe('selfHostnames', () => {
  it('リクエストのホスト名と SELF_HOSTNAMES を小文字でまとめる', () => {
    expect([...self].sort()).toEqual([
      'go.example.com',
      'short.example',
      'shortlink.pixel9tom.workers.dev',
    ]);
  });
});

describe('selfHostnames（日本語ドメイン）', () => {
  it('SELF_HOSTNAMES に Unicode で書いたドメインも punycode にそろえて比べる', () => {
    const names = selfHostnames('https://short.example/', '短縮.example');
    expect(names.has('xn--s7y86k.example')).toBe(true);
    expect(validateTargetUrl('https://短縮.example/x', names).ok).toBe(false);
  });
});

describe('validateTargetUrl', () => {
  it('http / https の絶対 URL を正規化して受け付ける', () => {
    expect(validateTargetUrl('https://Example.com/a b?q=あ', self)).toEqual({
      ok: true,
      href: 'https://example.com/a%20b?q=%E3%81%82',
    });
    expect(validateTargetUrl('http://example.com', self)).toEqual({
      ok: true,
      href: 'http://example.com/',
    });
  });

  it('日本語のドメインは ASCII（punycode）にする', () => {
    const result = validateTargetUrl('https://例え.jp/', self);
    expect(result).toEqual({ ok: true, href: 'https://xn--r8jz45g.jp/' });
  });

  it.each([
    'example.com',
    '/relative',
    '',
    'javascript:alert(1)',
    'data:text/html,hi',
    'ftp://example.com/',
    'mailto:a@example.com',
  ])('%j は受け付けない', (input) => {
    expect(validateTargetUrl(input, self).ok).toBe(false);
  });

  it(`正規化後に ${MAX_URL_LENGTH} 文字を超えたら受け付けない`, () => {
    const base = 'https://example.com/';
    expect(validateTargetUrl(base + 'a'.repeat(MAX_URL_LENGTH - base.length), self).ok).toBe(true);
    expect(validateTargetUrl(base + 'a'.repeat(MAX_URL_LENGTH - base.length + 1), self).ok).toBe(
      false,
    );
    // 正規化で長くなる（あ → %E3%81%82）ものも、正規化後の長さで判断する
    expect(validateTargetUrl(base + 'あ'.repeat(700), self).ok).toBe(false);
  });

  it.each([
    'https://short.example/x',
    'https://SHORTLINK.pixel9tom.workers.dev/x',
    'http://go.example.com/',
    'https://shortlink.pixel9tom.workers.dev./x',
    'https://user:pass@go.example.com:8443/x',
  ])('自分自身への転送 %s は受け付けない', (input) => {
    expect(validateTargetUrl(input, self)).toEqual({
      ok: false,
      message: '自分自身への転送は登録できません',
    });
  });

  it('サブドメインは自分自身ではない', () => {
    expect(validateTargetUrl('https://sub.short.example/', self).ok).toBe(true);
  });
});
