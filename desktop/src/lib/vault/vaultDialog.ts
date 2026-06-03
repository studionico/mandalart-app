import { open } from '@tauri-apps/plugin-dialog'

/**
 * vault ルートフォルダをネイティブダイアログで選ばせる (Phase 2 productize P1)。
 *
 * plugin-dialog の import はこのファイルだけに閉じ込める (UI 層から直接叩かせない)。
 * 選択フォルダは後続の read/write が capability の `fs:scope` 内 (`$HOME`/`$DOCUMENT` 等)
 * である必要があるため、UI 側で「対象フォルダ配下を選んでください」と注記する。
 *
 * @returns 選択された絶対パス。キャンセル時は null。
 */
export async function pickVaultFolder(): Promise<string | null> {
  const selected = await open({ directory: true, multiple: false })
  // directory:true / multiple:false のとき plugin-dialog は string | null を返す。
  return typeof selected === 'string' ? selected : null
}
