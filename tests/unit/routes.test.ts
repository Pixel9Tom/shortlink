import { env } from 'cloudflare:test';
import { exports } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';

const ORIGIN = 'https://shortlink.example';

function fetchWorker(path: string, init?: RequestInit): Promise<Response> {
  return exports.default.fetch(new Request(`${ORIGIN}${path}`, { redirect: 'manual', ...init }));
}

function expectPageSecurityHeaders(response: Response): void {
  expect(response.headers.get('Content-Security-Policy')).toBe("default-src 'none'");
  expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff');
  expect(response.headers.get('Referrer-Policy')).toBe('no-referrer');
}

async function insertLink(slug: string, url: string): Promise<void> {
  await env.DB.prepare('INSERT INTO links (slug, url, created_at) VALUES (?, ?, ?)')
    .bind(slug, url, new Date().toISOString())
    .run();
}

beforeEach(async () => {
  await env.DB.prepare('DELETE FROM links').run();
});

describe('GET /', () => {
  it('サービス名だけのページを返す', async () => {
    const response = await fetchWorker('/');
    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toMatch(/^text\/plain/);
    expect(await response.text()).toBe('shortlink\n');
    expectPageSecurityHeaders(response);
  });
});

describe('GET /robots.txt', () => {
  it('すべてのクローラーを拒否する', async () => {
    const response = await fetchWorker('/robots.txt');
    expect(response.status).toBe(200);
    expect(await response.text()).toBe('User-agent: *\nDisallow: /\n');
  });
});

describe('GET /favicon.ico', () => {
  it('404 を返す', async () => {
    const response = await fetchWorker('/favicon.ico');
    expect(response.status).toBe(404);
  });
});

describe('GET /:slug', () => {
  it('登録済みなら 302 で転送し、キャッシュさせない', async () => {
    await insertLink('docs', 'https://example.com/very/long/path');
    const response = await fetchWorker('/docs');
    expect(response.status).toBe(302);
    expect(response.headers.get('Location')).toBe('https://example.com/very/long/path');
    expect(response.headers.get('Cache-Control')).toBe('no-store');
  });

  it('HEAD でも転送する', async () => {
    await insertLink('docs', 'https://example.com/');
    const response = await fetchWorker('/docs', { method: 'HEAD' });
    expect(response.status).toBe(302);
    expect(response.headers.get('Location')).toBe('https://example.com/');
  });

  it('クエリ文字列は転送先に引き継がない', async () => {
    await insertLink('docs', 'https://example.com/path');
    const response = await fetchWorker('/docs?utm_source=x');
    expect(response.headers.get('Location')).toBe('https://example.com/path');
  });

  it('大文字小文字を区別する', async () => {
    await insertLink('ABC', 'https://example.com/upper');
    expect((await fetchWorker('/ABC')).status).toBe(302);
    expect((await fetchWorker('/abc')).status).toBe(404);
  });

  it('未登録なら 404 とセキュリティヘッダーを返す', async () => {
    const response = await fetchWorker('/missing');
    expect(response.status).toBe(404);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expectPageSecurityHeaders(response);
  });

  it.each(['/a.b', '/a/b', '/' + 'x'.repeat(33), '/%E3%81%82'])(
    '形式に合わない %s は 404',
    async (path) => {
      expect((await fetchWorker(path)).status).toBe(404);
    },
  );

  it.each(['POST', 'PUT', 'DELETE', 'PATCH'])('%s は 405', async (method) => {
    const response = await fetchWorker('/docs', { method });
    expect(response.status).toBe(405);
    expect(response.headers.get('Allow')).toBe('GET, HEAD');
  });
});

describe('/api', () => {
  it('API 専用のパスはスラッグとして扱わない', async () => {
    await insertLink('api', 'https://example.com/');
    const response = await fetchWorker('/api');
    expect(response.status).toBe(401);
    expect(response.headers.get('Content-Type')).toMatch(/^application\/json/);
  });
});

describe('X-Shortlink-Version', () => {
  it.each(['/', '/missing', '/api/links'])('%s の応答に版の ID が付く', async (path) => {
    const response = await fetchWorker(path);
    expect(response.headers.get('X-Shortlink-Version')).toBe(env.CF_VERSION_METADATA.id);
    expect(env.CF_VERSION_METADATA.id).not.toBe('');
  });
});
