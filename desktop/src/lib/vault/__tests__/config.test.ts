import { describe, it, expect, vi } from 'vitest'

// config.ts は @tauri-apps/plugin-fs を import するが、shouldRebuildOnStartup は純関数。
// テスト環境に Tauri runtime は無いので plugin-fs をスタブして import を通す。
vi.mock('@tauri-apps/plugin-fs', () => ({
  readTextFile: vi.fn(),
  writeTextFile: vi.fn(),
  exists: vi.fn(),
  BaseDirectory: { AppData: 1 },
}))

import { shouldRebuildOnStartup, type VaultConfig } from '@/lib/vault/config'

describe('shouldRebuildOnStartup', () => {
  const cases: { cfg: VaultConfig; expected: boolean }[] = [
    { cfg: { vaultMode: true, vaultPath: '/v' }, expected: true },
    { cfg: { vaultMode: true, vaultPath: null }, expected: false },
    { cfg: { vaultMode: false, vaultPath: '/v' }, expected: false },
    { cfg: { vaultMode: false, vaultPath: null }, expected: false },
  ]
  for (const { cfg, expected } of cases) {
    it(`vaultMode=${cfg.vaultMode} vaultPath=${cfg.vaultPath} → ${expected}`, () => {
      expect(shouldRebuildOnStartup(cfg)).toBe(expected)
    })
  }
})
