import type { D1Migration } from 'cloudflare:test';

// vitest.config.ts で単体テストにだけ渡すバインディング
declare global {
  namespace Cloudflare {
    interface Env {
      TEST_MIGRATIONS: D1Migration[];
    }
  }
}
