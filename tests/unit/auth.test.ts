import { describe, expect, it } from 'vitest';
import { authenticate, timingSafeEqualString } from '../../src/auth';

function request(authorization?: string): Request {
  const headers = new Headers();
  if (authorization !== undefined) headers.set('Authorization', authorization);
  return new Request('https://shortlink.example/api/links', { headers });
}

describe('timingSafeEqualString', () => {
  it('同じ文字列なら一致', () => {
    expect(timingSafeEqualString('secret', 'secret')).toBe(true);
  });

  it.each([
    ['secret', 'secreT'],
    ['secret', 'secret2'],
    ['', 'secret'],
    ['あ', 'a'],
  ])('%j と %j は不一致', (a, b) => {
    expect(timingSafeEqualString(a, b)).toBe(false);
  });
});

describe('authenticate', () => {
  it('正しい Bearer トークンなら ok', () => {
    expect(authenticate(request('Bearer secret'), 'secret')).toBe('ok');
  });

  it.each([
    undefined,
    '',
    'secret',
    'Basic secret',
    'Bearer',
    'Bearer ',
    'Bearer wrong',
    'Bearer secret extra',
  ])('Authorization が %j なら unauthorized', (header) => {
    expect(authenticate(request(header), 'secret')).toBe('unauthorized');
  });

  it.each(['bearer secret', 'BEARER secret'])('方式名 %j は大文字小文字を区別しない', (header) => {
    expect(authenticate(request(header), 'secret')).toBe('ok');
  });

  it.each([undefined, ''])('トークンが %j（未設定）なら not_configured', (token) => {
    expect(authenticate(request('Bearer secret'), token)).toBe('not_configured');
  });
});
