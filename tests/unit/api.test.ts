import { env } from 'cloudflare:test';
import { exports } from 'cloudflare:workers';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MAX_BODY_BYTES, PAGE_SIZE } from '../../src/api';
import { handleRequest } from '../../src/index';

const ORIGIN = 'https://shortlink.example';
const TOKEN = 'test-token'; // vitest.config.ts の API_TOKEN

function fetchWorker(path: string, init: RequestInit = {}): Promise<Response> {
  return exports.default.fetch(new Request(`${ORIGIN}${path}`, { redirect: 'manual', ...init }));
}

function api(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  if (!headers.has('Authorization')) headers.set('Authorization', `Bearer ${TOKEN}`);
  return fetchWorker(path, { ...init, headers });
}

function post(body: unknown): Promise<Response> {
  return api('/api/links', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

async function expectError(response: Response, status: number, error: string): Promise<void> {
  expect(response.status).toBe(status);
  expect(response.headers.get('Content-Type')).toMatch(/^application\/json/);
  expect(response.headers.get('Cache-Control')).toBe('no-store');
  const body = await response.json<{ error: string; message: string }>();
  expect(body.error).toBe(error);
  expect(typeof body.message).toBe('string');
}

async function insertLink(slug: string, url: string, createdAt: string): Promise<void> {
  await env.DB.prepare('INSERT INTO links (slug, url, created_at) VALUES (?, ?, ?)')
    .bind(slug, url, createdAt)
    .run();
}

beforeEach(async () => {
  await env.DB.prepare('DELETE FROM links').run();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('認証', () => {
  it.each([
    ['ヘッダーが無い', undefined],
    ['形式が違う', 'Basic dGVzdA=='],
    ['値が違う', 'Bearer wrong-token'],
  ])('%s と 401 と WWW-Authenticate', async (_, authorization) => {
    const headers = new Headers();
    if (authorization) headers.set('Authorization', authorization);
    const response = await fetchWorker('/api/links', { headers });
    expect(response.headers.get('WWW-Authenticate')).toBe('Bearer');
    await expectError(response, 401, 'unauthorized');
  });

  it('存在しない API のパスでも、先に認証を求める', async () => {
    await expectError(await fetchWorker('/api/unknown'), 401, 'unauthorized');
  });

  it('API_TOKEN が未設定なら、どの API も 503', async () => {
    const request = new Request(`${ORIGIN}/api/links`, {
      headers: { Authorization: 'Bearer ' },
    });
    const response = await handleRequest(request, { ...env, API_TOKEN: '' });
    await expectError(response, 503, 'not_configured');
  });

  it('API_TOKEN が未設定でも、転送は動く', async () => {
    await insertLink('docs', 'https://example.com/', '2026-11-04T05:00:00.000Z');
    const response = await handleRequest(new Request(`${ORIGIN}/docs`), { ...env, API_TOKEN: '' });
    expect(response.status).toBe(302);
  });
});

describe('POST /api/links', () => {
  it('スラッグを指定して登録し、転送できる', async () => {
    const response = await post({ url: 'https://example.com/very/long/path', slug: 'docs' });
    expect(response.status).toBe(201);
    expect(response.headers.get('Location')).toBe(`${ORIGIN}/docs`);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    const body = await response.json<Record<string, string>>();
    expect(body).toEqual({
      slug: 'docs',
      url: 'https://example.com/very/long/path',
      shortUrl: `${ORIGIN}/docs`,
      createdAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/),
    });

    const redirect = await fetchWorker('/docs');
    expect(redirect.status).toBe(302);
    expect(redirect.headers.get('Location')).toBe('https://example.com/very/long/path');
  });

  it.each([{}, { slug: null }])('slug が %j なら自動生成する', async (extra) => {
    const response = await post({ url: 'https://example.com/', ...extra });
    expect(response.status).toBe(201);
    const { slug } = await response.json<{ slug: string }>();
    expect(slug).toMatch(/^[23456789abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ]{6}$/);
  });

  it('自動生成のスラッグが重複したら作り直す', async () => {
    // 1 回目と 2 回目は同じスラッグ（777777）、3 回目は別のスラッグ（888888）になるよう乱数を固定する
    const values = [5, 5, 6];
    vi.spyOn(crypto, 'getRandomValues').mockImplementation((array) => {
      new Uint8Array(array.buffer, array.byteOffset, array.byteLength).fill(values.shift() ?? 0);
      return array;
    });
    expect(
      ((await (await post({ url: 'https://example.com/1' })).json()) as { slug: string }).slug,
    ).toBe('777777');
    const second = await post({ url: 'https://example.com/2' });
    expect(second.status).toBe(201);
    expect(((await second.json()) as { slug: string }).slug).toBe('888888');
  });

  it('自動生成が 5 回とも重複したら 500', async () => {
    const spy = vi.spyOn(crypto, 'getRandomValues').mockImplementation((array) => {
      new Uint8Array(array.buffer, array.byteOffset, array.byteLength).fill(5);
      return array;
    });
    expect((await post({ url: 'https://example.com/1' })).status).toBe(201);
    spy.mockClear();
    await expectError(await post({ url: 'https://example.com/2' }), 500, 'slug_generation_failed');
    expect(spy).toHaveBeenCalledTimes(5);
  });

  it('正規化した URL を保存して返す', async () => {
    const response = await post({ url: 'https://Example.com/日本語?q=a b', slug: 'jp' });
    const body = await response.json<{ url: string }>();
    expect(body.url).toBe('https://example.com/%E6%97%A5%E6%9C%AC%E8%AA%9E?q=a%20b');
    const redirect = await fetchWorker('/jp');
    expect(redirect.headers.get('Location')).toBe(body.url);
  });

  it('知らないフィールドは無視する', async () => {
    const response = await post({ url: 'https://example.com/', slug: 'x', extra: true });
    expect(response.status).toBe(201);
  });

  it('大文字小文字は別のスラッグ。API などは登録できる', async () => {
    expect((await post({ url: 'https://example.com/1', slug: 'abc' })).status).toBe(201);
    expect((await post({ url: 'https://example.com/2', slug: 'ABC' })).status).toBe(201);
    expect((await post({ url: 'https://example.com/3', slug: 'API' })).status).toBe(201);
  });

  it('登録済みのスラッグは 409', async () => {
    await post({ url: 'https://example.com/', slug: 'docs' });
    await expectError(
      await post({ url: 'https://example.com/other', slug: 'docs' }),
      409,
      'slug_taken',
    );
  });

  it('予約語 api は 400', async () => {
    await expectError(
      await post({ url: 'https://example.com/', slug: 'api' }),
      400,
      'reserved_slug',
    );
  });

  it.each(['', 'a.b', 'x'.repeat(33), 123, true, {}, []])(
    'slug が %j なら 400 invalid_slug',
    async (slug) => {
      await expectError(await post({ url: 'https://example.com/', slug }), 400, 'invalid_slug');
    },
  );

  it.each([
    ['url が無い', {}],
    ['url が文字列でない', { url: 1 }],
    ['相対 URL', { url: '/path' }],
    ['javascript:', { url: 'javascript:alert(1)' }],
    ['長すぎる', { url: `https://example.com/${'a'.repeat(2048)}` }],
    ['自分自身（リクエストのホスト名）', { url: `${ORIGIN}/docs` }],
    ['自分自身（SELF_HOSTNAMES）', { url: 'https://shortlink.pixel9tom.workers.dev/x' }],
  ])('%s なら 400 invalid_url', async (_, body) => {
    await expectError(await post(body), 400, 'invalid_url');
  });

  it.each(['{', 'null', '[]', '"https://example.com/"'])(
    '本文が %s なら 400 invalid_json',
    async (body) => {
      await expectError(await post(body), 400, 'invalid_json');
    },
  );

  it('Content-Type が JSON でなければ 415', async () => {
    const response = await api('/api/links', {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify({ url: 'https://example.com/' }),
    });
    await expectError(response, 415, 'unsupported_media_type');
  });

  it('Content-Type に charset が付いていてもよい', async () => {
    const response = await api('/api/links', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify({ url: 'https://example.com/' }),
    });
    expect(response.status).toBe(201);
  });

  it(`本文が ${MAX_BODY_BYTES} バイトを超えたら 413`, async () => {
    const padding = 'x'.repeat(MAX_BODY_BYTES);
    await expectError(
      await post({ url: 'https://example.com/', padding }),
      413,
      'payload_too_large',
    );
  });

  it('Content-Length が上限を超えていれば、本文を読む前に 413', async () => {
    // 本文は 2 バイトなので、実際の長さの確認では 413 にならない
    const body = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('{}'));
        controller.close();
      },
    });
    const response = await api('/api/links', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': String(MAX_BODY_BYTES + 1) },
      body,
    });
    await expectError(response, 413, 'payload_too_large');
  });

  it('Content-Length の無い（ストリームの）本文も長さで確かめる', async () => {
    const chunk = new TextEncoder().encode('x'.repeat(MAX_BODY_BYTES + 1));
    const body = new ReadableStream({
      start(controller) {
        controller.enqueue(chunk);
        controller.close();
      },
    });
    const response = await api('/api/links', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    });
    await expectError(response, 413, 'payload_too_large');
  });
});

describe('GET /api/links', () => {
  it('新しい順、同じ時刻ならスラッグの昇順で返す', async () => {
    await insertLink('old', 'https://example.com/old', '2026-11-01T00:00:00.000Z');
    await insertLink('b', 'https://example.com/b', '2026-11-02T00:00:00.000Z');
    await insertLink('a', 'https://example.com/a', '2026-11-02T00:00:00.000Z');
    const response = await api('/api/links');
    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    const body = await response.json<{ links: { slug: string }[]; nextCursor: string | null }>();
    expect(body.links.map((link) => link.slug)).toEqual(['a', 'b', 'old']);
    expect(body.links[0]).toEqual({
      slug: 'a',
      url: 'https://example.com/a',
      shortUrl: `${ORIGIN}/a`,
      createdAt: '2026-11-02T00:00:00.000Z',
    });
    expect(body.nextCursor).toBeNull();
  });

  it(`${PAGE_SIZE} 件を超えたら cursor で続きを取れ、重複も抜けも無い`, async () => {
    // 同じ時刻のものを多く混ぜ、ページの境目が同じ時刻の途中に来るようにする
    const expected: string[] = [];
    const statements = [];
    for (let i = 0; i < 250; i++) {
      const slug = `s${String(i).padStart(3, '0')}`;
      const createdAt = `2026-11-0${1 + Math.floor(i / 60)}T00:00:00.000Z`;
      statements.push(
        env.DB.prepare('INSERT INTO links (slug, url, created_at) VALUES (?, ?, ?)').bind(
          slug,
          `https://example.com/${slug}`,
          createdAt,
        ),
      );
      expected.push(slug);
    }
    await env.DB.batch(statements);
    expected.sort((x, y) => {
      const day = (s: string) => Math.floor(Number(s.slice(1)) / 60);
      return day(y) - day(x) || x.localeCompare(y);
    });

    const seen: string[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const query: string = cursor ? `?cursor=${cursor}` : '';
      const response = await api(`/api/links${query}`);
      const body = await response.json<{ links: { slug: string }[]; nextCursor: string | null }>();
      expect(body.links.length).toBeLessThanOrEqual(PAGE_SIZE);
      seen.push(...body.links.map((link) => link.slug));
      cursor = body.nextCursor;
      pages++;
    } while (cursor);
    expect(pages).toBe(3);
    expect(seen).toEqual(expected);
  });

  it('ちょうど上限の件数なら nextCursor は null', async () => {
    const statements = Array.from({ length: PAGE_SIZE }, (_, i) =>
      env.DB.prepare('INSERT INTO links (slug, url, created_at) VALUES (?, ?, ?)').bind(
        `s${i}`,
        'https://example.com/',
        '2026-11-01T00:00:00.000Z',
      ),
    );
    await env.DB.batch(statements);
    const body = await (await api('/api/links')).json<{ links: unknown[]; nextCursor: unknown }>();
    expect(body.links).toHaveLength(PAGE_SIZE);
    expect(body.nextCursor).toBeNull();
  });

  it('解釈できない cursor は 400', async () => {
    await expectError(await api('/api/links?cursor=broken!'), 400, 'invalid_cursor');
  });
});

describe('DELETE /api/links/:slug', () => {
  it('削除すると 204 で、転送は 404 になる', async () => {
    await insertLink('docs', 'https://example.com/', '2026-11-04T05:00:00.000Z');
    const response = await api('/api/links/docs', { method: 'DELETE' });
    expect(response.status).toBe(204);
    expect(await response.text()).toBe('');
    expect((await fetchWorker('/docs')).status).toBe(404);
  });

  it.each(['missing', 'a.b', '%E3%81%82'])('%s は 404', async (slug) => {
    await expectError(await api(`/api/links/${slug}`, { method: 'DELETE' }), 404, 'not_found');
  });

  it('大文字小文字を区別する', async () => {
    await insertLink('ABC', 'https://example.com/', '2026-11-04T05:00:00.000Z');
    await expectError(await api('/api/links/abc', { method: 'DELETE' }), 404, 'not_found');
    expect((await api('/api/links/ABC', { method: 'DELETE' })).status).toBe(204);
  });
});

describe('API のルーティング', () => {
  it.each([
    ['/api/links', 'PUT', 'GET, POST'],
    ['/api/links', 'DELETE', 'GET, POST'],
    ['/api/links/docs', 'GET', 'DELETE'],
    ['/api/links/docs', 'POST', 'DELETE'],
  ])('%s への %s は 405', async (path, method, allow) => {
    const response = await api(path, { method });
    expect(response.headers.get('Allow')).toBe(allow);
    await expectError(response, 405, 'method_not_allowed');
  });

  it.each(['/api', '/api/', '/api/unknown', '/api/links/a/b'])('%s は 404', async (path) => {
    await expectError(await api(path), 404, 'not_found');
  });
});
