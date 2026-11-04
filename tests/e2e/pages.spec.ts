import { expect, test, type APIResponse } from '@playwright/test';

function expectPageSecurityHeaders(response: APIResponse): void {
  const headers = response.headers();
  expect(headers['content-security-policy']).toBe("default-src 'none'");
  expect(headers['x-content-type-options']).toBe('nosniff');
  expect(headers['referrer-policy']).toBe('no-referrer');
}

test('/ はサービス名だけのページを返す', async ({ request }) => {
  const response = await request.get('/');
  expect(response.status()).toBe(200);
  expect(await response.text()).toBe('shortlink\n');
  expectPageSecurityHeaders(response);
});

test('/robots.txt はすべてのクローラーを拒否する', async ({ request }) => {
  const response = await request.get('/robots.txt');
  expect(response.status()).toBe(200);
  expect(await response.text()).toBe('User-agent: *\nDisallow: /\n');
});

test('未登録のスラッグは 404 とセキュリティヘッダーを返す', async ({ request }) => {
  // D1 への問い合わせまで通る（マイグレーションが当たっていなければ 500 になる）
  const response = await request.get('/e2e-missing-slug', { maxRedirects: 0 });
  expect(response.status()).toBe(404);
  expect(response.headers()['cache-control']).toBe('no-store');
  expectPageSecurityHeaders(response);
});

test('転送は GET と HEAD だけ受ける', async ({ request }) => {
  const response = await request.post('/e2e-missing-slug');
  expect(response.status()).toBe(405);
  expect(response.headers()['allow']).toBe('GET, HEAD');
});
