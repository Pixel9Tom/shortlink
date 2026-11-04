import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-plugin';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [
    cloudflareTest(async () => ({
      // wrangler.jsonc の設定（D1 のバインディングなど）で workerd を起動する
      wrangler: { configPath: './wrangler.jsonc' },
      miniflare: {
        bindings: {
          API_TOKEN: 'test-token',
          // テストの前に当てるマイグレーション（tests/unit/apply-migrations.ts）
          TEST_MIGRATIONS: await readD1Migrations('./migrations'),
        },
      },
    })),
  ],
  test: {
    include: ['tests/unit/**/*.test.ts'],
    setupFiles: ['./tests/unit/apply-migrations.ts'],
  },
});
