// レスポンスを組み立てる小さな関数をまとめる

/** `/` と 404 ページに付けるセキュリティヘッダー（SPEC.md §9） */
const PAGE_SECURITY_HEADERS = {
  'Content-Security-Policy': "default-src 'none'",
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
} as const;

export function textPage(body: string, status: number, init: HeadersInit = {}): Response {
  const headers = new Headers(init);
  headers.set('Content-Type', 'text/plain; charset=utf-8');
  headers.set('Cache-Control', 'no-store');
  for (const [name, value] of Object.entries(PAGE_SECURITY_HEADERS)) {
    headers.set(name, value);
  }
  return new Response(body, { status, headers });
}

export function notFound(): Response {
  return textPage('見つかりません\n', 404);
}

export function methodNotAllowed(allow: readonly string[]): Response {
  return textPage('許可されていないメソッドです\n', 405, { Allow: allow.join(', ') });
}

export interface ApiError {
  error: string;
  message: string;
}

export function json(body: unknown, status = 200, init: HeadersInit = {}): Response {
  const headers = new Headers(init);
  headers.set('Content-Type', 'application/json; charset=utf-8');
  headers.set('Cache-Control', 'no-store');
  return new Response(JSON.stringify(body), { status, headers });
}

export function apiError(status: number, error: string, message: string): Response {
  return json({ error, message } satisfies ApiError, status);
}
