import js from '@eslint/js';
import globals from 'globals';
import react from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';
import tseslint from 'typescript-eslint';

const commonIgnores = [
  '**/node_modules/**',
  '**/build/**',
  '**/dist/**',
  '**/coverage/**',
  'server/dist/**',
  'chrome-extension/dist/**',
  '**/*.min.js',
  'public/**',
  // CommonJS / sequelize CLI — not typed as ESM
  'server/src/db/migrations/**',
  'server/src/db/config/**',
  'server/src/db/models/index.js',
  'server/src/migrate.js',
  'server/src/db/migrate.js',
  'server/src/sdk/browserSide/**/*.js',
  'server/src/workflow-management/scripts/**/*.js',
];

export default tseslint.config(
  { ignores: commonIgnores },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/no-wrapper-object-types': 'warn',
      '@typescript-eslint/no-empty-object-type': 'warn',
      '@typescript-eslint/ban-ts-comment': 'warn',
      '@typescript-eslint/no-unused-expressions': 'warn',
      '@typescript-eslint/no-unsafe-function-type': 'warn',
      'no-case-declarations': 'warn',
      'prefer-const': 'warn',
      'no-useless-escape': 'off',
      'no-empty': 'warn',
      'no-control-regex': 'warn',
      'no-constant-binary-expression': 'warn',
    },
  },
  {
    files: ['**/*.{ts,tsx}'],
    rules: {
      'no-undef': 'off',
    },
  },
  {
    files: ['src/**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: { ...globals.browser },
      parserOptions: {
        ecmaFeatures: { jsx: true },
      },
    },
    plugins: {
      react,
      'react-hooks': reactHooks,
    },
    rules: {
      ...react.configs.recommended.rules,
      ...react.configs['jsx-runtime'].rules,
      ...reactHooks.configs.recommended.rules,
      'react/prop-types': 'off',
      'react/jsx-no-target-blank': 'warn',
      'react/display-name': 'warn',
      'react/no-unescaped-entities': 'warn',
      'react/jsx-key': 'warn',
    },
    settings: {
      react: { version: 'detect' },
    },
  },
  {
    files: ['server/src/**/*.ts'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: { ...globals.node },
    },
    rules: {
      '@typescript-eslint/no-require-imports': 'off',
    },
  },
  {
    files: ['chrome-extension/src/**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: { ...globals.browser, ...globals.webextensions },
      parserOptions: {
        ecmaFeatures: { jsx: true },
      },
    },
    plugins: {
      react,
      'react-hooks': reactHooks,
    },
    rules: {
      ...react.configs.recommended.rules,
      ...react.configs['jsx-runtime'].rules,
      ...reactHooks.configs.recommended.rules,
      'react/prop-types': 'off',
      'react/jsx-no-target-blank': 'warn',
      'react/display-name': 'warn',
      'react/no-unescaped-entities': 'warn',
      'react/jsx-key': 'warn',
    },
    settings: {
      react: { version: 'detect' },
    },
  },
  {
    files: ['**/*.{test,spec}.{ts,tsx}', 'e2e/**/*.ts'],
    languageOptions: {
      globals: { ...globals.node },
    },
  },
  {
    files: ['playwright.config.ts', 'vitest.config.ts'],
    languageOptions: {
      globals: { ...globals.node },
    },
  },
  {
    // Node-side diagnostics scripts and child-process entrypoints kept as CommonJS.
    files: ['server/src/**/*.js', 'server/src/**/*.cjs'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'commonjs',
      globals: { ...globals.node },
    },
    rules: {
      '@typescript-eslint/no-require-imports': 'off',
    },
  },
  {
    files: ['src/**/*.js'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: { ...globals.browser },
    },
  }
);
