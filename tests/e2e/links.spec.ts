import { expect, test, type APIRequestContext } from '@playwright/test';

// 本番では CI の Secret、手元と PR では .dev.vars.example と同じ値を使う
const isRemote = !!process.env.E2E_BASE_URL;
const token = process.env.E2E_API_TOKEN ?? (isRemote ? undefined : 'local-dev-token');
const auth = { Authorization: `Bearer ${token}` };

// 本番 E2E は実行ごとに専用のスラッグを使い、終わったら必ず消す
const runId = process.env.GITHUB_RUN_ID
  ? `${process.env.GITHUB_RUN_ID}-${process.env.GITHUB_RUN_ATTEMPT ?? '1'}`
  : `local-${Date.now()}`;
const slug = `e2e-${runId}`;
const target = 'https://example.com/shortlink-e2e';

interface Link {
  slug: string;
  url: string;
  shortUrl: string;
  createdAt: string;
}

interface LinkList {
  links: Link[];
  nextCursor: string | null;
}

async function listAll(request: APIRequestContext): Promise<Link[]> {
  const links: Link[] = [];
  let cursor: string | null = null;
  do {
    const response = await request.get('/api/links', {
      headers: auth,
      params: cursor ? { cursor } : {},
    });
    expect(response.status()).toBe(200);
    const body = (await response.json()) as LinkList;
    links.push(...body.links);
    cursor = body.nextCursor;
  } while (cursor);
  return links;
}

test.describe.configure({ mode: 'serial' });

test.beforeAll(async ({ request }) => {
  expect(token, '本番に流すときは E2E_API_TOKEN を指定する').toBeTruthy();
  // 前回の残り（途中で落ちて消えなかったもの）を先に消す
  for (const link of await listAll(request)) {
    if (link.slug.startsWith('e2e-')) {
      await request.delete(`/api/links/${link.slug}`, { headers: auth });
    }
  }
});

test.afterAll(async ({ request }) => {
  await request.delete(`/api/links/${slug}`, { headers: auth });
});

test('トークンが無ければ API は 401', async ({ request }) => {
  const response = await request.get('/api/links');
  expect(response.status()).toBe(401);
  expect(response.headers()['www-authenticate']).toBe('Bearer');
});

test('登録 → 転送 → 一覧 → 削除 → 404', async ({ request, baseURL }) => {
  const created = await request.post('/api/links', {
    headers: { ...auth, 'Content-Type': 'application/json' },
    data: { url: target, slug },
  });
  expect(created.status()).toBe(201);
  const link = (await created.json()) as Link;
  expect(link).toMatchObject({ slug, url: target, shortUrl: `${baseURL}/${slug}` });
  expect(created.headers()['location']).toBe(link.shortUrl);

  // 転送先まで取りに行かないよう、302 と Location を直接確かめる
  const redirect = await request.get(`/${slug}?utm_source=e2e`, { maxRedirects: 0 });
  expect(redirect.status()).toBe(302);
  expect(redirect.headers()['location']).toBe(target);
  expect(redirect.headers()['cache-control']).toBe('no-store');

  const duplicate = await request.post('/api/links', {
    headers: { ...auth, 'Content-Type': 'application/json' },
    data: { url: target, slug },
  });
  expect(duplicate.status()).toBe(409);

  const links = await listAll(request);
  expect(links.find((item) => item.slug === slug)).toEqual(link);

  const deleted = await request.delete(`/api/links/${slug}`, { headers: auth });
  expect(deleted.status()).toBe(204);

  const gone = await request.get(`/${slug}`, { maxRedirects: 0 });
  expect(gone.status()).toBe(404);
});

test('スラッグを省くと自動生成する', async ({ request }) => {
  const created = await request.post('/api/links', {
    headers: { ...auth, 'Content-Type': 'application/json' },
    data: { url: target },
  });
  expect(created.status()).toBe(201);
  const link = (await created.json()) as Link;
  expect(link.slug).toMatch(/^[23456789a-km-zA-HJ-NP-Z]{6}$/);
  // 自動生成のスラッグは e2e- で始まらないので、ここで消す
  expect((await request.delete(`/api/links/${link.slug}`, { headers: auth })).status()).toBe(204);
});
