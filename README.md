# shortlink

[![CI / Deploy](https://github.com/Pixel9Tom/shortlink/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/Pixel9Tom/shortlink/actions/workflows/ci.yml)

自分専用の短縮 URL サービス。Cloudflare Workers ＋ D1 で動く。仕様は [SPEC.md](SPEC.md)。

公開先：<https://shortlink.pixel9tom.workers.dev>

## 使い方

登録・一覧・削除の API は `Authorization: Bearer <token>` で保護している。転送（`/<slug>`）は誰でも使える。

> 登録・一覧・削除の API は実装中（この土台の次の PR で入る）。

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

## 開発

必要なもの：Node.js 22 以上、pnpm 11（`corepack enable` で `package.json` の `packageManager` の版が使われる）。

```bash
pnpm install
```

```bash
cp .dev.vars.example .dev.vars
```

```bash
pnpm db:migrate:local
```

```bash
pnpm dev
```

| コマンド                | 内容                                                      |
| ----------------------- | --------------------------------------------------------- |
| `pnpm dev`              | `wrangler dev` で起動（ローカル D1 を使う）               |
| `pnpm db:migrate:local` | ローカル D1 にマイグレーションを当てる                    |
| `pnpm test`             | 単体テスト（Vitest ＋ `@cloudflare/vitest-plugin`）       |
| `pnpm test:e2e`         | E2E（Playwright の request API で `wrangler dev` を試す） |
| `pnpm lint`             | ESLint                                                    |
| `pnpm typecheck`        | TypeScript の型チェック                                   |
| `pnpm format`           | Prettier で整形                                           |
| `pnpm cf-typegen`       | `wrangler.jsonc` から `worker-configuration.d.ts` を生成  |

E2E は本番 URL にも流せる。

```bash
E2E_BASE_URL=https://shortlink.pixel9tom.workers.dev pnpm test:e2e
```

## デプロイ

`main` にマージすると、GitHub Actions が次を順に行う。手元から `pnpm deploy` は実行しない。

1. 整形・lint・型チェック・単体テスト・`wrangler dev` への E2E
2. 本番の D1 にマイグレーションを当てる（`wrangler d1 migrations apply --remote`）
3. `wrangler deploy --secrets-file` で、Worker と Secret `API_TOKEN` をまとめて書き込む
4. 本番 URL に E2E を流す

PR ごとのプレビュー版は作らない（どの版も本番の D1 と Secret を共有してしまうため）。

## 人が画面で行うこと

1. Cloudflare の API トークンに「Account → D1 → Edit」の権限を足す（済み）。「Edit Cloudflare Workers」テンプレートには D1 が含まれない。
2. D1 データベースを作る（`wrangler d1 create shortlink`）。できた `database_id` を `wrangler.jsonc` に書く。
3. 登録 API のトークンを手元で作る（`openssl rand -base64 32` など）。パスワードマネージャーに保存し、GitHub の Secrets に `SHORTLINK_API_TOKEN` として登録する。Worker への設定は CI が行うので、`wrangler secret put` は手で実行しない。値を Claude のセッションに渡さない。
4. GitHub の Secrets に `CLOUDFLARE_API_TOKEN`・`CLOUDFLARE_ACCOUNT_ID` を登録する。
5. Settings → General で「Automatically delete head branches」をオン、Settings → Rules で `main` を保護する。
6. カスタムドメインに替えるとき：`wrangler.jsonc` の `routes` に `{ "pattern": "<domain>", "custom_domain": true }` を足し、`vars` の `SELF_HOSTNAMES` にそのホスト名を足す。コードの変更は要らない。
