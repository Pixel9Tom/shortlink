import { defineConfig } from '@playwright/test';

const PORT = 8788;
const isCI = !!process.env.CI;
// 指定すると、ローカルのサーバーを起動せずにその URL（例: 本番）をテストする
const remoteBaseURL = process.env.E2E_BASE_URL;

// 画面が無いので、ブラウザは起動せず request API だけを使う
export default defineConfig({
  testDir: './tests/e2e',
  forbidOnly: isCI,
  retries: isCI ? 1 : 0,
  reporter: isCI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: remoteBaseURL ?? `http://localhost:${PORT}`,
  },
  // 本番と同じ実行環境（workerd）とローカル D1 で試す。
  // ローカル D1 は空で始まるので、先に pnpm db:migrate:local を実行しておく
  webServer: remoteBaseURL
    ? undefined
    : {
        command: `pnpm exec wrangler dev --port ${PORT} --show-interactive-dev-session=false`,
        url: `http://localhost:${PORT}`,
        reuseExistingServer: !isCI,
        timeout: 120_000,
        env: { WRANGLER_SEND_METRICS: 'false' },
      },
});
