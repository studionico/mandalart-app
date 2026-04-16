// ESLint flat config (v9)
// 軽量構成: typescript-eslint + react-hooks + react-refresh の recommended のみ。
// カスタムルール (position === N / localStorage 直接使用禁止 等) は現時点では入れていない。
// 将来カスタムルールを足す場合は CLAUDE.md の「コーディング規約 / ハードコーディング禁止」
// と連動させること。
import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import globals from 'globals'

export default tseslint.config(
  { ignores: ['dist', 'node_modules', 'src-tauri/target', 'src-tauri/gen'] },
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2022,
      globals: { ...globals.browser, ...globals.node },
    },
    extends: [
      js.configs.recommended,
      ...tseslint.configs.recommended,
    ],
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': [
        'warn',
        { allowConstantExport: true },
      ],
      // 未使用変数は _ プレフィックスで無視できるようにする
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
      // react-hooks v7 で新設された厳密ルール (React Compiler 相当の静的解析) は
      // 意図的に使っている既存コードが多く、一括リファクタのコストが見合わない。
      // 警告に留めて新規コードへの注意喚起のみ残し、commit は通す運用にする。
      // (厳密化したくなったら 'error' に戻す)
      'react-hooks/set-state-in-effect': 'warn',
      'react-hooks/refs': 'warn',
      'react-hooks/set-state-in-render': 'warn',
    },
  },
  // Vitest テストファイル向けの緩和設定
  {
    files: ['**/__tests__/**/*.{ts,tsx}', '**/*.test.{ts,tsx}'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
)
