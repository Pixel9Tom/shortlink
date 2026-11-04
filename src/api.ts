// 登録・一覧・削除の API（SPEC.md §7）

import { authenticate } from './auth';
import { decodeCursor, encodeCursor } from './cursor';
import { apiError, json } from './http';
import { generateSlug, isReservedSlug, isValidSlug } from './slug';
import { selfHostnames, validateTargetUrl } from './url';

export const MAX_BODY_BYTES = 8 * 1024;
export const PAGE_SIZE = 100;
const MAX_GENERATE_ATTEMPTS = 5;

interface LinkRow {
  slug: string;
  url: string;
  created_at: string;
}

interface LinkJson {
  slug: string;
  url: string;
  shortUrl: string;
  createdAt: string;
}

function toJson(row: LinkRow, origin: string): LinkJson {
  return {
    slug: row.slug,
    url: row.url,
    shortUrl: `${origin}/${row.slug}`,
    createdAt: row.created_at,
  };
}

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Error && /UNIQUE constraint failed/i.test(error.message);
}

function methodNotAllowed(allow: readonly string[]): Response {
  return json({ error: 'method_not_allowed', message: '許可されていないメソッドです' }, 405, {
    Allow: allow.join(', '),
  });
}

/** 本文を 8 KiB まで読む。Content-Length が無い（chunked）場合も実際の長さで確かめる */
async function readBody(request: Request): Promise<string | Response> {
  const mediaType = request.headers.get('Content-Type')?.split(';')[0]?.trim().toLowerCase();
  if (mediaType !== 'application/json') {
    return apiError(
      415,
      'unsupported_media_type',
      'Content-Type は application/json にしてください',
    );
  }
  const declared = Number(request.headers.get('Content-Length') ?? '0');
  if (declared > MAX_BODY_BYTES) {
    return apiError(413, 'payload_too_large', `本文は ${MAX_BODY_BYTES} バイトまでです`);
  }
  const body = await request.arrayBuffer();
  if (body.byteLength > MAX_BODY_BYTES) {
    return apiError(413, 'payload_too_large', `本文は ${MAX_BODY_BYTES} バイトまでです`);
  }
  return new TextDecoder().decode(body);
}

async function createLink(request: Request, env: Env): Promise<Response> {
  const body = await readBody(request);
  if (body instanceof Response) return body;

  let payload: unknown;
  try {
    payload = JSON.parse(body);
  } catch {
    return apiError(400, 'invalid_json', '本文が JSON として解釈できません');
  }
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
    return apiError(400, 'invalid_json', '本文は JSON のオブジェクトにしてください');
  }
  const { url, slug } = payload as Record<string, unknown>;

  if (typeof url !== 'string') {
    return apiError(400, 'invalid_url', 'url（文字列）は必須です');
  }
  const validation = validateTargetUrl(url, selfHostnames(request.url, env.SELF_HOSTNAMES));
  if (!validation.ok) {
    return apiError(400, 'invalid_url', validation.message);
  }

  // slug のキーが無いか null なら自動生成。文字列なら形式と予約語を確かめる
  if (slug !== undefined && slug !== null) {
    if (typeof slug !== 'string' || !isValidSlug(slug)) {
      return apiError(
        400,
        'invalid_slug',
        'slug は 1〜32 文字の英数字・ハイフン・アンダースコアにしてください',
      );
    }
    if (isReservedSlug(slug)) {
      return apiError(400, 'reserved_slug', `${slug} は予約されているため使えません`);
    }
  }

  const origin = new URL(request.url).origin;
  const createdAt = new Date().toISOString();
  const attempts = typeof slug === 'string' ? 1 : MAX_GENERATE_ATTEMPTS;
  for (let attempt = 0; attempt < attempts; attempt++) {
    const candidate = typeof slug === 'string' ? slug : generateSlug();
    try {
      await env.DB.prepare('INSERT INTO links (slug, url, created_at) VALUES (?, ?, ?)')
        .bind(candidate, validation.href, createdAt)
        .run();
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      if (typeof slug === 'string') {
        return apiError(409, 'slug_taken', `${slug} はすでに使われています`);
      }
      continue;
    }
    const link = toJson({ slug: candidate, url: validation.href, created_at: createdAt }, origin);
    return json(link, 201, { Location: link.shortUrl });
  }
  return apiError(
    500,
    'slug_generation_failed',
    'スラッグを作れませんでした。もう一度試してください',
  );
}

async function listLinks(request: Request, env: Env): Promise<Response> {
  const requestUrl = new URL(request.url);
  const rawCursor = requestUrl.searchParams.get('cursor');
  const cursor = rawCursor === null ? null : decodeCursor(rawCursor);
  if (rawCursor !== null && cursor === null) {
    return apiError(400, 'invalid_cursor', 'cursor が解釈できません');
  }

  // 並び順と続きの条件の向きをそろえる（新しい順、同じ時刻ならスラッグの昇順）。
  // 1 件多く取り、続きがあるかを判断する
  const statement = cursor
    ? env.DB.prepare(
        `SELECT slug, url, created_at FROM links
         WHERE created_at < ?1 OR (created_at = ?1 AND slug > ?2)
         ORDER BY created_at DESC, slug ASC LIMIT ?3`,
      ).bind(cursor.createdAt, cursor.slug, PAGE_SIZE + 1)
    : env.DB.prepare(
        'SELECT slug, url, created_at FROM links ORDER BY created_at DESC, slug ASC LIMIT ?1',
      ).bind(PAGE_SIZE + 1);
  const { results } = await statement.all<LinkRow>();

  const page = results.slice(0, PAGE_SIZE);
  const last = page.at(-1);
  const nextCursor =
    results.length > PAGE_SIZE && last
      ? encodeCursor({ createdAt: last.created_at, slug: last.slug })
      : null;
  return json({ links: page.map((row) => toJson(row, requestUrl.origin)), nextCursor });
}

async function deleteLink(slug: string, env: Env): Promise<Response> {
  if (isValidSlug(slug)) {
    const result = await env.DB.prepare('DELETE FROM links WHERE slug = ?').bind(slug).run();
    if (result.meta.changes > 0) {
      return new Response(null, { status: 204, headers: { 'Cache-Control': 'no-store' } });
    }
  }
  return apiError(404, 'not_found', `${slug} は登録されていません`);
}

export async function handleApi(request: Request, env: Env): Promise<Response> {
  // Secret が未設定なら 503、トークンが合わなければ 401。どのパスでも先に確かめる
  const auth = authenticate(request, env.API_TOKEN as string | undefined);
  if (auth === 'not_configured') {
    return apiError(503, 'not_configured', 'API のトークンが設定されていません');
  }
  if (auth === 'unauthorized') {
    const response = apiError(
      401,
      'unauthorized',
      '正しいトークンを Authorization: Bearer で送ってください',
    );
    response.headers.set('WWW-Authenticate', 'Bearer');
    return response;
  }

  const { pathname } = new URL(request.url);
  if (pathname === '/api/links') {
    if (request.method === 'POST') return createLink(request, env);
    if (request.method === 'GET') return listLinks(request, env);
    return methodNotAllowed(['GET', 'POST']);
  }
  const match = pathname.match(/^\/api\/links\/([^/]+)$/);
  if (match?.[1]) {
    if (request.method === 'DELETE') return deleteLink(match[1], env);
    return methodNotAllowed(['DELETE']);
  }
  return apiError(404, 'not_found', 'そのパスの API はありません');
}
