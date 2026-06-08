import { readTextFile, writeTextFile, exists, remove, BaseDirectory } from '@tauri-apps/plugin-fs'

/**
 * ローカル JSON ミラーの永続設定。AppData 直下の JSON に保持する (既存 plugin-fs を再利用)。
 *
 * 旧 vault の `vault-config.json` (`{ vaultMode, vaultPath }`) からは初回読込時に一度だけ
 * `vaultPath` を `mirrorPath` へ移行する (`vaultMode` は捨てる。ミラーはクラウド同期を止めない)。
 */

const CONFIG_FILE = 'mirror-config.json'
const LEGACY_VAULT_CONFIG_FILE = 'vault-config.json'

export type MirrorConfig = {
  /** true = DB 編集を選択フォルダへ自動ミラーする。 */
  mirrorEnabled: boolean
  /** ミラー出力先フォルダの絶対パス (fs:scope 内)。未設定なら null。 */
  mirrorPath: string | null
}

const DEFAULT_CONFIG: MirrorConfig = { mirrorEnabled: false, mirrorPath: null }

function normalize(parsed: Partial<MirrorConfig>): MirrorConfig {
  return {
    mirrorEnabled: parsed.mirrorEnabled === true,
    mirrorPath: typeof parsed.mirrorPath === 'string' ? parsed.mirrorPath : null,
  }
}

/**
 * 旧 vault-config.json から一度だけ移行する。新 config が既に在れば何もしない。
 * 旧 `vaultPath` のみ引き継ぐ (ミラーは既定で無効。ユーザーがトグルで有効化する)。
 */
async function migrateFromLegacy(): Promise<MirrorConfig | null> {
  try {
    if (!(await exists(LEGACY_VAULT_CONFIG_FILE, { baseDir: BaseDirectory.AppData }))) return null
    const text = await readTextFile(LEGACY_VAULT_CONFIG_FILE, { baseDir: BaseDirectory.AppData })
    const legacy = JSON.parse(text) as { vaultPath?: unknown }
    const migrated: MirrorConfig = {
      mirrorEnabled: false,
      mirrorPath: typeof legacy.vaultPath === 'string' ? legacy.vaultPath : null,
    }
    await saveMirrorConfig(migrated)
    // 旧設定は役目を終えたので削除する (vault モードの残骸を残さない)。失敗は無視。
    try {
      await remove(LEGACY_VAULT_CONFIG_FILE, { baseDir: BaseDirectory.AppData })
    } catch { /* best-effort */ }
    return migrated
  } catch {
    return null
  }
}

export async function loadMirrorConfig(): Promise<MirrorConfig> {
  try {
    if (await exists(CONFIG_FILE, { baseDir: BaseDirectory.AppData })) {
      const text = await readTextFile(CONFIG_FILE, { baseDir: BaseDirectory.AppData })
      return normalize(JSON.parse(text) as Partial<MirrorConfig>)
    }
    const migrated = await migrateFromLegacy()
    if (migrated) return migrated
    return { ...DEFAULT_CONFIG }
  } catch {
    // 壊れた設定は安全側 (ミラー off) にフォールバック
    return { ...DEFAULT_CONFIG }
  }
}

export async function saveMirrorConfig(config: MirrorConfig): Promise<void> {
  await writeTextFile(CONFIG_FILE, JSON.stringify(config, null, 2), {
    baseDir: BaseDirectory.AppData,
  })
}
