import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      'coverage',
      'test-results',
      'playwright-report',
      '.wrangler',
      'worker-configuration.d.ts',
    ],
  },
  {
    files: ['**/*.{ts,js}'],
    extends: [js.configs.recommended, ...tseslint.configs.strict],
    languageOptions: {
      ecmaVersion: 2024,
    },
  },
  {
    files: ['*.{ts,js}', 'tests/e2e/**/*.ts'],
    languageOptions: { globals: globals.node },
  },
);
