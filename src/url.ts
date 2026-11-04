// 転送先 URL の検証（SPEC.md §6）

export const MAX_URL_LENGTH = 2048;

export type UrlValidation = { ok: true; href: string } | { ok: false; message: string };

/** 比べやすいよう小文字にし、末尾のドット（FQDN 表記）を外す */
function normalizeHostname(hostname: string): string {
  return hostname.trim().toLowerCase().replace(/\.$/, '');
}

/** 自分自身のホスト名：リクエストのホスト名と SELF_HOSTNAMES（カンマ区切り） */
export function selfHostnames(requestUrl: string, configured: string | undefined): Set<string> {
  const names = new Set([normalizeHostname(new URL(requestUrl).hostname)]);
  for (const name of (configured ?? '').split(',')) {
    const normalized = normalizeHostname(name);
    if (normalized) names.add(normalized);
  }
  return names;
}

export function validateTargetUrl(input: string, self: ReadonlySet<string>): UrlValidation {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return { ok: false, message: '絶対 URL として解釈できません' };
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return { ok: false, message: 'http または https の URL だけ登録できます' };
  }
  // 保存するのは正規化後の値。ASCII に変換されるので Location ヘッダーに必ず入る
  const href = url.href;
  if (href.length > MAX_URL_LENGTH) {
    return { ok: false, message: `URL は ${MAX_URL_LENGTH} 文字以内にしてください` };
  }
  if (self.has(normalizeHostname(url.hostname))) {
    return { ok: false, message: '自分自身への転送は登録できません' };
  }
  return { ok: true, href };
}
