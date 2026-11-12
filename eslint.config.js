import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';
import prettier from 'eslint-config-prettier';

export default tseslint.config(
  { ignores: ['dist', 'node_modules', 'test-results', 'playwright-report'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  prettier,
  {
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
  {
    // The game rules stay pure: no DOM, audio or network, so they're easy to test and replay.
    files: ['src/game/**/*.ts'],
    rules: {
      'no-restricted-imports': ['error', { patterns: ['../ui/*', '../audio/*', '../net/*'] }],
      'no-restricted-globals': ['error', 'window', 'document', 'navigator'],
    },
  },
);
