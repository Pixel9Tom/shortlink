# コマンド

- インストール: `pnpm install`（pnpm 11。版は package.json の packageManager で決まる）
- CI と同じチェック: `pnpm format:check && pnpm lint && pnpm exec wrangler types --check && pnpm typecheck && pnpm test`
- 単体テスト 1 ファイル: `pnpm vitest run tests/unit/routes.test.ts`
- E2E: `cp .dev.vars.example .dev.vars && pnpm db:migrate:local && pnpm test:e2e`（ローカル D1 は空で始まるので、先にマイグレーションが要る）
- wrangler.jsonc を変えたら `pnpm cf-typegen` で worker-configuration.d.ts を作り直す

# 決めごと

- 仕様は SPEC.md。実装して変わったら SPEC.md を直す
- TypeScript は 6.0 系に据え置く。typescript-eslint が TS 7 に未対応のため。TS 7.1 正式版と typescript-eslint の対応版が出たら見直す
- pnpm 11 の minimumReleaseAge（公開 24 時間未満の版を拒否）は無効にしない。引っかかったら例外リストに足さず、版の指定を 1 つ前の版まで許す形で解決する
- 本番デプロイ・本番 D1 のマイグレーション・Secret の書き込みは main へのマージ後に CI が行う。手元から `pnpm deploy` や `--remote` の操作はしない
- マイグレーションはデプロイ前に当たるので、列や表の追加だけにする

# 注意点

- クラウドセッションから本番へ E2E を流すと、Playwright の request API はプロキシを通らず ENOTFOUND になる。`use.proxy` に `HTTPS_PROXY` を渡した一時的な設定ファイルで実行する
