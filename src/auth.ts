// API の認証（SPEC.md §7「共通」）

const encoder = new TextEncoder();

/** 2 つの文字列を固定時間で比べる。長さが違えば不一致 */
export function timingSafeEqualString(a: string, b: string): boolean {
  const left = encoder.encode(a);
  const right = encoder.encode(b);
  if (left.byteLength !== right.byteLength) {
    return false;
  }
  return crypto.subtle.timingSafeEqual(left, right);
}

export type AuthResult = 'ok' | 'unauthorized' | 'not_configured';

export function authenticate(request: Request, expectedToken: string | undefined): AuthResult {
  // Secret が無いときは、誤って無防備にならないよう API をすべて閉じる
  if (!expectedToken) {
    return 'not_configured';
  }
  const header = request.headers.get('Authorization');
  // 方式名は大文字小文字を区別しない（RFC 7235）
  const match = header?.match(/^Bearer ([^\s]+)$/i);
  if (!match?.[1]) {
    return 'unauthorized';
  }
  return timingSafeEqualString(match[1], expectedToken) ? 'ok' : 'unauthorized';
}
