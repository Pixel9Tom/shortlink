# shortlink 仕様

短縮 URL サービス。利用者は自分 1 人だけ。登録・一覧・削除の API は秘密のトークンで保護し、転送は誰でも使える。

この文書は実装前のインタビューで決めたことをまとめたもの。実装して変わったら、この文書を直す。

## 1. 決めたこと（概要）

| 項目             | 決定                                                                      |
| ---------------- | ------------------------------------------------------------------------- |
| 実行環境         | Cloudflare Workers                                                        |
| 保存先           | Cloudflare D1（SQLite）                                                   |
| ドメイン         | まず `shortlink.pixel9tom.workers.dev`。後でカスタムドメインに付け替える  |
| スラッグ         | 自動生成（6 文字）＋任意で指定（1〜32 文字）                              |
| API の操作       | 登録・一覧・削除                                                          |
| 認証             | `Authorization: Bearer <token>`。トークンは Worker の Secret              |
| 転送             | 302 Found                                                                 |
| クリック数       | 記録しない                                                                |
| `/` と未登録     | 簡素なテキスト／HTML を返す                                               |
| 入り口           | API のみ（curl やスクリプト）。画面や CLI は作らない                      |
| 転送先 URL       | http / https の絶対 URL のみ、2048 文字以内。自分自身への転送は拒否       |
| 開発の土台       | 前回（my-claude-app）と同じ構成を踏襲                                     |

## 2. 作らないもの

- 管理画面・CLI スクリプト
- クリック数やアクセスログ
- 有効期限・自動削除（必要になったら `expires_at` 列を足す）
- 転送先 URL の更新 API（直したいときは削除して登録し直す）
- 複数利用者・利用者ごとのトークン
- レート制限（転送は Cloudflare の既定の保護に任せる。登録系はトークンが要る）

## 3. URL とルーティング

ドメインに依存しない形で書く。`<origin>` は配信元（最初は `https://shortlink.pixel9tom.workers.dev`）。

| メソッド | パス               | 認証 | 動き                                     |
| -------- | ------------------ | ---- | ---------------------------------------- |
| GET      | `/`                | 不要 | サービス名だけの短いページ（200）        |
| GET      | `/:slug`           | 不要 | 登録済みなら 302 で転送、無ければ 404    |
| POST     | `/api/links`       | 必要 | 登録                                     |
| GET      | `/api/links`       | 必要 | 一覧                                     |
| DELETE   | `/api/links/:slug` | 必要 | 削除                                     |

- `/api/` で始まるパスは API 専用。上の表にないパス・メソッドは 404 または 405 を返す。
- `/:slug` の転送は GET と HEAD だけ受ける。それ以外のメソッドは 405。
- `/favicon.ico` と `/robots.txt` はスラッグとして扱わず 404 を返す（`robots.txt` は `User-agent: *` / `Disallow: /api/` を返してもよい）。
- `/:slug` の後ろにクエリ文字列が付いていても、転送先には引き継がない（登録された URL をそのまま返す）。

## 4. 転送（GET /:slug）

- 登録済み：`302 Found`、`Location: <登録された URL>`。本文は空か、転送先を 1 行書いた text/plain。
- 未登録・形式不正なスラッグ：`404 Not Found`。簡素な text/plain か HTML（「見つかりません」だけ）。
- キャッシュ：`Cache-Control: no-store`。削除や登録し直しが即座に効くようにする。
- D1 への問い合わせは 1 リンクにつき 1 回（主キーでの SELECT）。

## 5. スラッグ

### 自動生成

- 長さ 6 文字。
- 使う文字は英数字から誤読しやすい `0 O o 1 l I` を除いた 56 文字（`23456789abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ`）。
- `crypto.getRandomValues` で生成し、INSERT が一意制約で失敗したら作り直す（最大 5 回。すべて失敗したら 500）。

### 指定

- 1〜32 文字、使える文字は `A-Z a-z 0-9 - _`（正規表現 `^[A-Za-z0-9_-]{1,32}$`）。
- 大文字小文字は区別する（`ABC` と `abc` は別のリンク）。D1 のスラッグ列は `BINARY` 照合（SQLite の既定）で扱う。
- 予約語は登録できない：`api`、`favicon.ico`、`robots.txt`。`/api` 以下と衝突するものを守るため。
- すでに登録済みのスラッグを指定したら `409 Conflict`。

## 6. 転送先 URL の検証

登録時に次をすべて満たすこと。満たさなければ `400 Bad Request`。

1. `new URL()` で解釈できる絶対 URL。
2. スキームが `http:` または `https:`。
3. 文字列の長さが 2048 文字以内。
4. ホストが自分自身（リクエストの `Host`）と同じでない。転送のループを防ぐ。
5. 保存する値は `URL#href`（正規化後）ではなく、受け取った文字列をそのまま保存する。正規化で意図しない変化が起きるのを避けるため。

## 7. API

### 共通

- リクエスト・レスポンスとも JSON（`Content-Type: application/json`）。
- 認証：`Authorization: Bearer <token>`。トークンは Worker の Secret `API_TOKEN`（`wrangler secret put API_TOKEN`）。
  - 比較は固定時間で行う（長さが違えば不一致、同じなら `crypto.subtle.timingSafeEqual` か XOR 累積）。
  - ヘッダーが無い・形式が違う・値が違う、いずれも `401 Unauthorized` と `WWW-Authenticate: Bearer`。
  - `API_TOKEN` が未設定なら、API はすべて `503 Service Unavailable` を返す（誤って無防備にならないため）。
- エラーの本文は `{ "error": "<機械可読なコード>", "message": "<人向けの説明>" }`。
  - コードの例：`unauthorized`、`invalid_json`、`invalid_url`、`invalid_slug`、`reserved_slug`、`slug_taken`、`not_found`。
- CORS は付けない（ブラウザからは使わない）。

### POST /api/links（登録）

リクエスト：

```json
{ "url": "https://example.com/very/long/path", "slug": "docs" }
```

- `url`：必須。§6 の検証を通ること。
- `slug`：任意。あれば §5「指定」の検証、無ければ自動生成。

成功：`201 Created`、`Location: <origin>/<slug>`

```json
{
  "slug": "docs",
  "url": "https://example.com/very/long/path",
  "shortUrl": "https://shortlink.pixel9tom.workers.dev/docs",
  "createdAt": "2026-11-04T05:00:00.000Z"
}
```

- `shortUrl` はリクエストの `Host` から組み立てる。ドメインを付け替えても設定変更なしで追従する。

失敗：`400`（JSON でない・`url` がない・検証不通過）、`409`（スラッグ重複）、`401`。

### GET /api/links（一覧）

- 登録日時の新しい順。
- 1 回で返す上限は 100 件。それ以上あるときは `?cursor=` で続きを取る（`cursor` は最後の要素の `createdAt` と `slug` を組み合わせた不透明文字列）。利用者が 1 人で件数も少ない想定なので、初版はこの上限で足りる。

```json
{
  "links": [{ "slug": "docs", "url": "https://...", "shortUrl": "https://.../docs", "createdAt": "..." }],
  "nextCursor": null
}
```

### DELETE /api/links/:slug（削除）

- 成功：`204 No Content`。
- 無い：`404 Not Found`。

### curl の例（README にも載せる）

```bash
curl -X POST https://shortlink.pixel9tom.workers.dev/api/links \
  -H "Authorization: Bearer $SHORTLINK_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"url":"https://example.com/very/long/path","slug":"docs"}'
```

```bash
curl https://shortlink.pixel9tom.workers.dev/api/links \
  -H "Authorization: Bearer $SHORTLINK_TOKEN"
```

```bash
curl -X DELETE https://shortlink.pixel9tom.workers.dev/api/links/docs \
  -H "Authorization: Bearer $SHORTLINK_TOKEN"
```

## 8. データ（D1）

```sql
CREATE TABLE links (
  slug       TEXT PRIMARY KEY,
  url        TEXT NOT NULL,
  created_at TEXT NOT NULL  -- ISO 8601（UTC）
);
CREATE INDEX links_created_at ON links (created_at DESC, slug);
```

- マイグレーションは `migrations/0001_create_links.sql` に置き、`wrangler d1 migrations apply` で当てる。CI の本番デプロイ前にも `--remote` で当てる。
- D1 のデータベースは本番用 1 つ。`wrangler dev` は既定のローカル D1 を使うので、手元や E2E で本番のデータに触れない。
- バックアップは D1 の Time Travel（既定で 30 日）に任せる。

## 9. セキュリティ

- トークンは Secret だけに置く。リポジトリ・ログ・エラー本文に出さない。
- API のレスポンスに `Cache-Control: no-store` を付ける。
- `/` と 404 ページには `Content-Security-Policy: default-src 'none'`、`X-Content-Type-Options: nosniff`、`Referrer-Policy: no-referrer` を付ける。
- 転送の `Location` にはユーザー入力（登録済み URL）がそのまま入るが、§6 でスキームを http/https に限っているので `javascript:` などは通らない。
- オープンリダイレクトは本サービスの性質上避けられない。登録できるのが自分だけであることが対策。

## 10. 開発の土台

前回（my-claude-app）の構成を踏襲する。詳細は my-claude-app の `docs/learnings.md`。

- ひな形：`npm create cloudflare@latest`（Hello World の Worker、TypeScript）。
- pnpm 11（`packageManager`・`.nvmrc`・`pnpm-workspace.yaml` の `allowBuilds`。`minimumReleaseAge` は無効にしない）。
- TypeScript strict。ESLint（typescript-eslint）＋ Prettier。TypeScript は 6.0 系に据え置く（前回と同じ理由。typescript-eslint が TS 7 対応したら見直す）。
- フレームワークは使わず、`fetch` ハンドラーで自前ルーティング。ルートは 5 本しかない。
- 単体テスト：Vitest ＋ `@cloudflare/vitest-pool-workers`（workerd 上で D1 のローカル DB を使って動かす）。スラッグ生成・URL 検証・認証比較・各ルートを対象にする。
- E2E：Playwright。`pnpm build` 不要（Worker はビルドなしで `wrangler dev` に渡す）なので、`webServer` で `wrangler dev` を起こして試す。登録 → 転送 → 一覧 → 削除 → 404 までを 1 本で確かめる。
  - E2E では `API_TOKEN` を `.dev.vars` で与える（`.dev.vars` は `.gitignore` に入れ、CI では `.dev.vars.example` からコピーする）。
  - ブラウザのコンソールに error / warning が 1 件でも出たら失敗にする fixture を前回から持ってくる。
  - `E2E_BASE_URL` と `E2E_API_TOKEN` が指定されたら本番に対して流す。本番 E2E は専用のスラッグ（例 `e2e-<run id>`）を登録し、最後に必ず削除する。
- CI（GitHub Actions）：`pnpm/setup`、ランナーの版を固定、アクションをハッシュで固定、`timeout-minutes`。
  - PR：format / lint / typecheck / test / E2E、プレビュー版の発行（Worker 未作成時と Dependabot・フォークの PR は飛ばす）。
  - main：上に加えて `wrangler d1 migrations apply --remote` → `wrangler deploy` → 本番 E2E。
  - Secrets：`CLOUDFLARE_API_TOKEN`、`CLOUDFLARE_ACCOUNT_ID`、`E2E_API_TOKEN`（本番の `API_TOKEN` と同じ値）。
- デプロイは CI だけが行う。手元から `pnpm deploy` は実行しない。

## 11. 人が画面で行うこと

1. D1 データベースを作る（`wrangler d1 create shortlink` はセッションから実行できる。できた `database_id` を `wrangler.jsonc` に書く）。
2. `wrangler secret put API_TOKEN` で本番のトークンを設定する（値は `openssl rand -base64 32` などで作り、パスワードマネージャーに保存する）。
3. GitHub の Secrets に `CLOUDFLARE_API_TOKEN`・`CLOUDFLARE_ACCOUNT_ID`・`E2E_API_TOKEN` を登録する。
4. Settings → General で「Automatically delete head branches」をオン、Settings → Rules で `main` を保護する。
5. カスタムドメインに替えるとき：`wrangler.jsonc` の `routes` に `{ "pattern": "<domain>", "custom_domain": true }` を足す。コードの変更は要らない（`shortUrl` は `Host` から組み立てるため）。

## 12. 完了の条件

- `pnpm format:check && pnpm lint && pnpm typecheck && pnpm test` が通る。
- `pnpm test:e2e` が `wrangler dev` に対して通る。
- main にマージ後、CI が本番にデプロイし、本番 URL への E2E が通る。
- README に curl の例と、§11 の手順が書いてある。
