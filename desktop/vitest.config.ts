import { defineConfig } from 'vitest/config'
import path from 'path'

/**
 * Vitest 設定。
 *
 * - env: `node` (ピュア関数中心、DOM は使わないので jsdom 不要)
 * - `@/` path alias を vite.config.ts と揃える (テストから `@/lib/...` で import するため)
 * - test file 置き場: `src/**\/__tests__/*.test.ts` または `src/**\/*.test.ts`
 */
export default defineConfig({
  test: {
    environment: 'node',
    globals: false, // describe / it / expect は明示 import させる
    include: ['src/**/__tests__/**/*.test.ts', 'src/**/*.test.ts'],
  },
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') },
  },
})
