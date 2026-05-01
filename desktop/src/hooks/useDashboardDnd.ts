import { useCallback, useEffect, useRef, useState } from 'react'
import type { ActionDropType } from '@/components/editor/DragActionPanel'

/**
 * ダッシュボード専用 D&D hook (mousedown ベース、Tauri WebKit の HTML5 DnD 不能対応)。
 *
 * editor の `useDragAndDrop` とは drop policy / target が全く違う (cell-grid 制約なし、
 * card / stock 起源のみ) ため別実装。mousedown / mousemove / mouseup の primitive と
 * `document.elementFromPoint` の target 解決パターンは共通。
 *
 * 2 経路:
 *  - card 起源 drag: 右パネルの DragActionPanel (`[data-action-drop]`) に drop で
 *    `card-action` action を発火 (shred / move / copy / export)
 *  - stock 起源 drag: ダッシュボード空エリア (`[data-dashboard-drop-zone]`) または既存カード
 *    (`[data-dashboard-card-index]`) に drop で `stock-to-new` action を発火
 *
 * stock 起源の drag 中は `dragOverCardIndex` が更新されるので、各 MandalartCard 側で
 * `index >= dragOverCardIndex` のとき右に slide する transform を当てる (drop space を開ける視覚演出)。
 */

const DRAG_THRESHOLD = 5

type DragSourceKind = 'card' | 'stock'

export type DashboardDropAction =
  | { kind: 'card-action'; mandalartId: string; action: ActionDropType }
  | { kind: 'stock-to-new'; stockItemId: string }
  | null

type Opts = {
  onDrop: (action: DashboardDropAction) => Promise<void> | void
}

export function useDashboardDnd({ onDrop }: Opts) {
  const [dragSourceKind, setDragSourceKind] = useState<DragSourceKind | null>(null)
  const [dragSourceId, setDragSourceId] = useState<string | null>(null)
  const [hoveredAction, setHoveredAction] = useState<ActionDropType | null>(null)
  const [dragOverCardIndex, setDragOverCardIndex] = useState<number | null>(null)

  // active な document リスナを cleanup できるよう ref で保持
  const movingRef = useRef<((e: MouseEvent) => void) | null>(null)
  const upRef = useRef<((e: MouseEvent) => void) | null>(null)
  // 最新の onDrop を ref で保持し、beginDrag の closure 内から参照する。
  // useEffect 経由で同期する (render 中の ref 直接更新は React 19 strict mode で warning が出るため)
  const onDropRef = useRef(onDrop)
  useEffect(() => { onDropRef.current = onDrop }, [onDrop])
  // drag 完了直後の click を suppress するためのフラグ。drag 後に同じ card 上で mouseup された
  // ケース (drag がキャンセル方向に戻った) で onClick が fire するのを防ぐ。
  const recentlyDraggedRef = useRef(false)
  // stock 起源 drag 時に「natural 位置のカード矩形」を drag 開始時スナップショット (1 回のみ)。
  // mousemove で transform 後の DOM ではなくこの cached rect 配列に対して hit-test することで、
  // slide 演出 (translateX で動くカード) と hit 判定がフィードバックループになる「バタバタ振動」を防ぐ。
  // メモリ上の単純な配列で disk 永続なし、cleanup で必ず空配列にリセットされ GC 対象になる。
  const cardRectsRef = useRef<Array<{ idx: number; rect: DOMRect }>>([])

  const beginDrag = useCallback((source: { kind: DragSourceKind; id: string }) => {
    setDragSourceKind(source.kind)
    setDragSourceId(source.id)
    document.body.style.cursor = 'grabbing'

    // stock 起源 drag 時のみ、drag 開始時点での全カード矩形をスナップショット。
    // mousemove で transform 後の現 DOM ではなくこの natural 位置 rect 配列に対して hit-test し、
    // slide 演出による DOM 位置変動が hit 判定にフィードバックして振動するのを防ぐ。
    // (drag start 時は transform 未適用なので getBoundingClientRect は natural 位置を返す)
    if (source.kind === 'stock') {
      const cards = document.querySelectorAll<HTMLElement>('[data-dashboard-card-index]')
      cardRectsRef.current = Array.from(cards).map((el) => ({
        idx: Number(el.dataset.dashboardCardIndex),
        rect: el.getBoundingClientRect(),
      }))
    }

    function resolveActionTarget(e: MouseEvent): ActionDropType | null {
      // card 起源のみ DragActionPanel が右側に表示されている
      if (source.kind !== 'card') return null
      const el = document.elementFromPoint(e.clientX, e.clientY)
      const actionEl = el?.closest('[data-action-drop]') as HTMLElement | null
      const v = actionEl?.dataset.actionDrop
      if (v === 'shred' || v === 'move' || v === 'copy' || v === 'export') return v
      return null
    }

    function resolveCardIndex(e: MouseEvent): number | null {
      // stock 起源のみ既存カードの index を解決 (slide 演出用)。
      // elementFromPoint ではなく drag 開始時にキャッシュした natural 位置 rect で hit-test する
      // (transform で視覚的に動いたカードは無視) ことでバタバタ振動を防ぐ。
      if (source.kind !== 'stock') return null
      for (const { idx, rect } of cardRectsRef.current) {
        if (e.clientX >= rect.left && e.clientX <= rect.right
            && e.clientY >= rect.top && e.clientY <= rect.bottom) {
          return idx
        }
      }
      return null
    }

    function isOverDropZone(e: MouseEvent): boolean {
      // stock 起源のみ空エリア drop を受ける
      if (source.kind !== 'stock') return false
      const el = document.elementFromPoint(e.clientX, e.clientY)
      return !!el?.closest('[data-dashboard-drop-zone]')
    }

    function onMouseMove(e: MouseEvent) {
      if (source.kind === 'card') {
        setHoveredAction(resolveActionTarget(e))
      } else {
        setDragOverCardIndex(resolveCardIndex(e))
      }
    }

    function cleanup() {
      if (movingRef.current) document.removeEventListener('mousemove', movingRef.current)
      if (upRef.current) document.removeEventListener('mouseup', upRef.current)
      movingRef.current = null
      upRef.current = null
      // 矩形スナップショットをクリア → 次の drag で再計測 + 旧配列は GC 対象
      cardRectsRef.current = []
      document.body.style.cursor = ''
      setDragSourceKind(null)
      setDragSourceId(null)
      setHoveredAction(null)
      setDragOverCardIndex(null)
    }

    function onMouseUp(e: MouseEvent) {
      let action: DashboardDropAction = null
      if (source.kind === 'card') {
        const a = resolveActionTarget(e)
        if (a) action = { kind: 'card-action', mandalartId: source.id, action: a }
      } else {
        const idx = resolveCardIndex(e)
        const onZone = isOverDropZone(e)
        if (idx != null || onZone) {
          action = { kind: 'stock-to-new', stockItemId: source.id }
        }
      }
      cleanup()
      // drag 完了直後の click は suppress (cardClickGuard 経由で参照される)
      recentlyDraggedRef.current = true
      setTimeout(() => { recentlyDraggedRef.current = false }, 150)
      // onDrop は cleanup 後に呼ぶ (state リセット後の callback 内で副作用を許容)
      void Promise.resolve(onDropRef.current(action))
    }

    movingRef.current = onMouseMove
    upRef.current = onMouseUp
    document.addEventListener('mousemove', onMouseMove)
    document.addEventListener('mouseup', onMouseUp)
  }, [])

  /**
   * mandalart card の onMouseDown 時に閾値超過で card 起源 drag を開始する。
   * 閾値以下で mouseup されたら通常の click として処理 (drag 起動なし)。
   */
  const onCardMouseDown = useCallback((mandalartId: string, e: React.MouseEvent) => {
    if (e.button !== 0) return  // 左クリックのみ
    // 既に drag 中なら何もしない (重複起動防止)
    if (movingRef.current) return
    const startX = e.clientX
    const startY = e.clientY

    function onCheckThreshold(ev: MouseEvent) {
      const dx = ev.clientX - startX
      const dy = ev.clientY - startY
      if (dx * dx + dy * dy >= DRAG_THRESHOLD * DRAG_THRESHOLD) {
        document.removeEventListener('mousemove', onCheckThreshold)
        document.removeEventListener('mouseup', onCancelCheck)
        beginDrag({ kind: 'card', id: mandalartId })
      }
    }
    function onCancelCheck() {
      document.removeEventListener('mousemove', onCheckThreshold)
      document.removeEventListener('mouseup', onCancelCheck)
    }
    document.addEventListener('mousemove', onCheckThreshold)
    document.addEventListener('mouseup', onCancelCheck)
  }, [beginDrag])

  /**
   * StockTab の onItemDragStart callback に繋ぐ。StockTab 内部で閾値チェック済みなので
   * 受信した時点で drag は確定。
   */
  const onStockItemDragStart = useCallback((stockItemId: string) => {
    if (movingRef.current) return  // 既に走行中
    beginDrag({ kind: 'stock', id: stockItemId })
  }, [beginDrag])

  /**
   * drag 直後の click suppression 判定。`<card onClick>` でこれが true ならば
   * navigate を skip する (drag → cancel 系の操作で意図せず編集に飛ぶのを防ぐ)。
   */
  const wasRecentlyDragged = useCallback(() => recentlyDraggedRef.current, [])

  return {
    onCardMouseDown,
    onStockItemDragStart,
    wasRecentlyDragged,
    dragSourceKind,
    dragSourceId,
    hoveredAction,
    dragOverCardIndex,
    isDragging: dragSourceKind !== null,
  }
}
