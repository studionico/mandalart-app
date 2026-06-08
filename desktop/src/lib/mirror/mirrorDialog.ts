import { open } from '@tauri-apps/plugin-dialog'

/**
 * ミラー出力先フォルダをネイティブダイアログで選ばせる。
 *
 * plugin-dialog の import はこのファイルだけに閉じ込める (UI 層から直接叩かせない)。
 * 選択フォルダは後続の write が capability の `fs:scope` 内 (`$HOME`/`$DOCUMENT` 等) で
 * ある必要があるため、UI 側で「対象フォルダ配下を選んでください」と注記する。
 *
 * @returns 選択された絶対パス。キャンセル時は null。
 */
export async function pickMirrorFolder(): Promise<string | null> {
  const selected = await open({ directory: true, multiple: false })
  return typeof selected === 'string' ? selected : null
}
