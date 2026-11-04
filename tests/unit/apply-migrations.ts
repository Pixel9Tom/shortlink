import { applyD1Migrations, env } from 'cloudflare:test';

// 各テストファイルの前に、ローカル D1 へマイグレーションを当てる（当て済みのものは飛ばされる）
await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
