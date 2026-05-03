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
  // NOTE: `text/plain` 等の標準 MIME を **設定しない** こと。設定すると macOS WebKit が
  //       「外部 app へコピー可能」と判定して **drag image 右下に緑の "+" indicator を強制
  //       オーバーレイ** する (effectAllowed / dropEffect = 'move' でも消えない、OS レベル)。
  //       custom MIME (application/x-mandalart-drag) のみなら "+"  は出ない。
  //       debug 用の text/plain fallback は欲しい場面 (他 app への drag 出し) が無いため犠牲化。
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

/**
 * dragstart event で drag image を **明示的に source 要素の clone に固定**する helper。
 *
 * WebKit は default drag image 生成のとき、source 要素が `position: relative` + 内部に
 * `<img class="absolute inset-0">` を持つ + 周囲 sibling が transform で動いている、と
 * いった条件下で合成 layer の境界判定がブレて他要素 (隣接カードや DragActionPanel) の
 * テキストが drag image に混入する症状が出る。`setDragImage(clone, x, y)` を明示呼出して
 * 要素単独の snapshot に強制することでこれを防ぐ。
 *
 * source 要素そのものを渡すと `isDragSource: opacity 0.4` の影響で半透明 ghost に
 * なるため、`cloneNode(true)` した off-screen clone を 1 frame だけ使う方式を採用。
 *
 * @param e React DragEvent
 * @param sourceEl drag source の wrapper element (通常 `e.currentTarget`)
 */
export function applyCleanDragImage(e: React.DragEvent, sourceEl: HTMLElement): void {
  const dt = e.dataTransfer
  if (!dt || typeof dt.setDragImage !== 'function') return

  const clone = sourceEl.cloneNode(true) as HTMLElement
  // 元 source の opacity (isDragSource state による 0.4) を打ち消す
  clone.style.opacity = '1'
  // off-screen に配置 (画面外で render させて drag image に capture させる)
  clone.style.position = 'fixed'
  clone.style.top = '-9999px'
  clone.style.left = '-9999px'
  clone.style.pointerEvents = 'none'
  // 元 source と同じ寸法を確定させる (cloneNode は computed style を継承しないため)
  clone.style.width = `${sourceEl.offsetWidth}px`
  clone.style.height = `${sourceEl.offsetHeight}px`
  // clone 自体は draggable にしない (= OS が「外部 app へ drag 可能」と判定する余地を断つ)。
  // 元 source の draggable=true 属性が cloneNode で継承されているので明示的に false に戻す。
  clone.setAttribute('draggable', 'false')
  // 同じ意図で webkit-user-drag を element 固定 (= 外部 export ではなく内部 element drag)
  clone.style.setProperty('-webkit-user-drag', 'element')
  // 後で DevTools / cleanup で識別できるようにフラグを付ける
  clone.setAttribute('data-drag-image-clone', '')
  document.body.appendChild(clone)

  dt.setDragImage(clone, clone.offsetWidth / 2, clone.offsetHeight / 2)

  // browser が drag image を内部的に capture した後 (= 同じ event loop の末尾) に削除する
  setTimeout(() => { clone.remove() }, 0)
}
