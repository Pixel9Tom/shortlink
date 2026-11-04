import { handleApi } from './api';
import { methodNotAllowed, notFound, textPage } from './http';
import { isValidSlug } from './slug';

const SERVICE_NAME = 'shortlink';
const REDIRECT_METHODS = ['GET', 'HEAD'] as const;

function isRedirectMethod(method: string): boolean {
  return (REDIRECT_METHODS as readonly string[]).includes(method);
}

async function redirect(slug: string, env: Env): Promise<Response> {
  // 形式に合わないものは D1 に問い合わせずに 404
  if (!isValidSlug(slug)) {
    return notFound();
  }
  const row = await env.DB.prepare('SELECT url FROM links WHERE slug = ?')
    .bind(slug)
    .first<{ url: string }>();
  if (!row) {
    return notFound();
  }
  // クエリ文字列は引き継がず、登録された URL をそのまま返す（SPEC.md §3・§4）
  return new Response(`${row.url}\n`, {
    status: 302,
    headers: {
      Location: row.url,
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
}

export async function handleRequest(request: Request, env: Env): Promise<Response> {
  const { pathname } = new URL(request.url);

  // /api/ 以下は API 専用（スラッグとしては扱わない）
  if (pathname === '/api' || pathname.startsWith('/api/')) {
    return handleApi(request, env);
  }

  if (!isRedirectMethod(request.method)) {
    return methodNotAllowed(REDIRECT_METHODS);
  }

  switch (pathname) {
    case '/':
      return textPage(`${SERVICE_NAME}\n`, 200);
    case '/robots.txt':
      // 短縮 URL や API を検索エンジンに載せない
      return textPage('User-agent: *\nDisallow: /\n', 200);
    case '/favicon.ico':
      return notFound();
  }

  // 先頭の / を除いた 1 階層だけをスラッグとして扱う。% エンコードはそのまま比べる
  return redirect(pathname.slice(1), env);
}

/** どの版が応答したかを示すヘッダー。デプロイ直後は古い版が応答することがある */
const VERSION_HEADER = 'X-Shortlink-Version';

export default {
  async fetch(request, env) {
    const response = await handleRequest(request, env);
    response.headers.set(VERSION_HEADER, env.CF_VERSION_METADATA.id);
    return response;
  },
} satisfies ExportedHandler<Env>;
