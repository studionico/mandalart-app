import { readTextFile, writeTextFile, exists, BaseDirectory } from '@tauri-apps/plugin-fs'

/**
 * vault モードの永続設定。AppData 直下の JSON ファイルに保持する (既存 plugin-fs を再利用、
 * 新プラグイン不要)。DB はキャッシュに格下げ予定なので DB カラムには置かない。
 *
 * Stage 3a 時点ではトグル UI から未配線 (scaffolding)。Stage 3b で設定画面のトグル +
 * フォルダ選択ダイアログから読み書きし、起動時に `vaultMode` を見て経路を切り替える。
 */

const CONFIG_FILE = 'vault-config.json'

export type VaultConfig = {
  /** true = vault を正として起動時に DB を再構築する (Stage 3b で本配線)。 */
  vaultMode: boolean
  /** vault ルートの絶対パス (fs:scope 内)。未設定なら null。 */
  vaultPath: string | null
}

const DEFAULT_CONFIG: VaultConfig = { vaultMode: false, vaultPath: null }

export async function loadVaultConfig(): Promise<VaultConfig> {
  try {
    if (!(await exists(CONFIG_FILE, { baseDir: BaseDirectory.AppData }))) {
      return { ...DEFAULT_CONFIG }
    }
    const text = await readTextFile(CONFIG_FILE, { baseDir: BaseDirectory.AppData })
    const parsed = JSON.parse(text) as Partial<VaultConfig>
    return {
      vaultMode: parsed.vaultMode === true,
      vaultPath: typeof parsed.vaultPath === 'string' ? parsed.vaultPath : null,
    }
  } catch {
    // 壊れた設定は安全側 (vault off) にフォールバック
    return { ...DEFAULT_CONFIG }
  }
}

export async function saveVaultConfig(config: VaultConfig): Promise<void> {
  await writeTextFile(CONFIG_FILE, JSON.stringify(config, null, 2), {
    baseDir: BaseDirectory.AppData,
  })
}
