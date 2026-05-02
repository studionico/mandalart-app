/**
 * HTML5 D&D の dataTransfer に詰める payload helper。
 *
 * 落とし穴 #1 (旧): Tauri WebKit の `dragDropEnabled: true` (default) では target 側 event
 * (dragenter / dragover / drop) が伝搬しないため自前 mousedown 実装をしていた。
 * tauri.conf.json で `dragDropEnabled: false` に切替えた現在は標準 HTML5 D&D が動く。
 *
 * dataTransfer は drag 中 (dragover) には getData が制限されるため、source 種別の判定は
 * 別途 hook 内の useRef で持つ。dataTransfer は drop 時の payload 復元と、ブラウザ標準の
 * `text/plain` fallback (debug 表示用) のためだけに使う。
 */

export type DragPayload =
  | { kind: 'cell'; cellId: string }
  | { kind: 'stock'; stockItemId: string }
  | { kind: 'dashboard-card'; mandalartId: string }

const MIME = 'application/x-mandalart-drag'

export function setDragPayload(e: React.DragEvent | DragEvent, payload: DragPayload): void {
  const dt = e.dataTransfer
  if (!dt) return
  dt.setData(MIME, JSON.stringify(payload))
  // text/plain fallback (debug ツール / 他 app への drag 出し時の表示用)
  const fallbackText =
    payload.kind === 'cell'
      ? `cell:${payload.cellId}`
      : payload.kind === 'stock'
        ? `stock:${payload.stockItemId}`
        : `card:${payload.mandalartId}`
  dt.setData('text/plain', fallbackText)
}

export function getDragPayload(e: React.DragEvent | DragEvent): DragPayload | null {
  const dt = e.dataTransfer
  if (!dt) return null
  const raw = dt.getData(MIME)
  if (!raw) return null
  try {
    return JSON.parse(raw) as DragPayload
  } catch {
    return null
  }
}

/**
 * dragover 中に dataTransfer の types に MIME が含まれているかだけチェックする
 * (getData は drop 時しか読めないが types は読める)。drop zone の preventDefault 判定に使う。
 */
export function hasMandalartDragType(e: React.DragEvent | DragEvent): boolean {
  return Array.from(e.dataTransfer?.types ?? []).includes(MIME)
}

/** dragover 中に file drop 検出。HTML5 file drop の preventDefault 判定に使う。 */
export function hasFileDragType(e: React.DragEvent | DragEvent): boolean {
  return Array.from(e.dataTransfer?.types ?? []).includes('Files')
}
