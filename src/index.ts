import { apiError, methodNotAllowed, notFound, textPage } from './http';
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

  // /api/ 以下は API 専用。登録・一覧・削除は次の PR で実装する
  if (pathname === '/api' || pathname.startsWith('/api/')) {
    return apiError(404, 'not_found', 'API はまだ実装されていません');
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

export default {
  fetch(request, env) {
    return handleRequest(request, env);
  },
} satisfies ExportedHandler<Env>;
