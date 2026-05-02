import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ActionDropType } from '@/components/editor/DragActionPanel'
import { setDragPayload, applyCleanDragImage } from '@/lib/utils/dndPayload'
import { useDragClickSuppress } from './useDragClickSuppress'

/**
 * ダッシュボード専用 D&D hook (HTML5 D&D ベース)。
 *
 * editor の `useDragAndDrop` とは drop policy / target が違うため別実装。
 *
 * Source:
 *  - card 起源: MandalartCard の onDragStart から `onCardDragStart`
 *  - stock 起源: StockTab の onItemDragStart から `onStockItemDragStart`
 *
 * Drop targets:
 *  - DragActionPanel の各タイル (card 起源のみ): `getActionDropProps(action)`
 *  - フォルダタブ (card 起源のみ): `getFolderTabDropProps(folderId)`
 *  - カード一覧コンテナ ([data-dashboard-drop-zone]): `containerDropProps`
 *    - card 起源 → card-reorder (target index は cached rect で hit-test、empty area なら末尾)
 *    - stock 起源 → stock-to-new
 *
 * cached rect pattern (`cardRectsRef`): drag 開始時に全カードの natural 位置を snapshot。
 * dragover 中は (transform で動いた現 DOM 位置ではなく) この cached rect で hit-test することで、
 * slide 演出 (translateX で動くカード) と hit 判定がフィードバックループになるバタバタ振動を防ぐ。
 */

type DragSourceKind = 'card' | 'stock'

export type DashboardDropAction =
  | { kind: 'card-action'; mandalartId: string; action: ActionDropType }
  | { kind: 'stock-to-new'; stockItemId: string }
  | { kind: 'card-reorder'; sourceMandalartId: string; targetIndex: number }
  | { kind: 'card-to-folder'; sourceMandalartId: string; targetFolderId: string }
  | null

type Opts = {
  onDrop: (action: DashboardDropAction) => Promise<void> | void
}

type DropHandlers = {
  onDragEnter: (e: React.DragEvent) => void
  onDragOver: (e: React.DragEvent) => void
  onDragLeave: (e: React.DragEvent) => void
  onDrop: (e: React.DragEvent) => void
}

export function useDashboardDnd({ onDrop }: Opts) {
  const [dragSourceKind, setDragSourceKind] = useState<DragSourceKind | null>(null)
  const [dragSourceId, setDragSourceId] = useState<string | null>(null)
  const [hoveredAction, setHoveredAction] = useState<ActionDropType | null>(null)
  const [dragOverCardIndex, setDragOverCardIndex] = useState<number | null>(null)

  const sourceRef = useRef<{ kind: DragSourceKind; id: string } | null>(null)
  const cardRectsRef = useRef<Array<{ idx: number; rect: DOMRect }>>([])
  const onDropRef = useRef(onDrop)
  useEffect(() => { onDropRef.current = onDrop }, [onDrop])

  const clickSuppress = useDragClickSuppress()

  function snapshotCardRects() {
    const cards = document.querySelectorAll<HTMLElement>('[data-dashboard-card-index]')
    cardRectsRef.current = Array.from(cards).map((el) => ({
      idx: Number(el.dataset.dashboardCardIndex),
      rect: el.getBoundingClientRect(),
    }))
  }

  function hitTestCardIndex(clientX: number, clientY: number): number | null {
    for (const { idx, rect } of cardRectsRef.current) {
      if (
        clientX >= rect.left && clientX <= rect.right &&
        clientY >= rect.top && clientY <= rect.bottom
      ) {
        return idx
      }
    }
    return null
  }

  // ===== Source =====

  const onCardDragStart = useCallback((mandalartId: string, e: React.DragEvent) => {
    sourceRef.current = { kind: 'card', id: mandalartId }
    setDragSourceKind('card')
    setDragSourceId(mandalartId)
    setDragPayload(e, { kind: 'dashboard-card', mandalartId })
    if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move'
    applyCleanDragImage(e, e.currentTarget as HTMLElement)
    snapshotCardRects()
  }, [])

  const onStockItemDragStart = useCallback((stockItemId: string, e: React.DragEvent) => {
    sourceRef.current = { kind: 'stock', id: stockItemId }
    setDragSourceKind('stock')
    setDragSourceId(stockItemId)
    setDragPayload(e, { kind: 'stock', stockItemId })
    if (e.dataTransfer) e.dataTransfer.effectAllowed = 'copy'
    applyCleanDragImage(e, e.currentTarget as HTMLElement)
    snapshotCardRects()
  }, [])

  const onDragEnd = useCallback(() => {
    sourceRef.current = null
    cardRectsRef.current = []
    setDragSourceKind(null)
    setDragSourceId(null)
    setHoveredAction(null)
    setDragOverCardIndex(null)
    clickSuppress.markDragged()
  }, [clickSuppress])

  // ===== Drop targets =====

  // カード一覧コンテナ ([data-dashboard-drop-zone]) — card-reorder / stock-to-new を dispatch
  const containerDropProps = useMemo<DropHandlers>(() => ({
    onDragEnter: (e) => {
      if (!sourceRef.current) return
      e.preventDefault()
    },
    onDragOver: (e) => {
      const src = sourceRef.current
      if (!src) return
      e.preventDefault()
      // 4 アクションアイコン上やフォルダタブ上にいる時は dragover bubble するだけで、
      // それぞれの per-target handler が hoveredAction / target tab 強調を引き受ける。
      // ここでは card hit-test して dragOverCardIndex を更新するのみ。
      const idx = hitTestCardIndex(e.clientX, e.clientY)
      setDragOverCardIndex(idx)
    },
    onDragLeave: (e) => {
      // drop zone から完全に出た (relatedTarget が外側) 時のみ clear
      const related = e.relatedTarget as Node | null
      if (related && (e.currentTarget as Node).contains(related)) return
      setDragOverCardIndex(null)
    },
    onDrop: (e) => {
      e.preventDefault()
      const src = sourceRef.current
      // hit-test は ref クリア前に実行する。先にクリアすると hitTestCardIndex が常に null を
      // 返し、card-reorder が targetIndex=0 (= 先頭) になるバグを起こす。
      const idx = hitTestCardIndex(e.clientX, e.clientY)
      const totalCards = cardRectsRef.current.length
      sourceRef.current = null
      cardRectsRef.current = []
      setDragSourceKind(null)
      setDragSourceId(null)
      setHoveredAction(null)
      setDragOverCardIndex(null)
      clickSuppress.markDragged()
      if (!src) return
      if (src.kind === 'card') {
        if (idx != null) {
          void Promise.resolve(
            onDropRef.current({ kind: 'card-reorder', sourceMandalartId: src.id, targetIndex: idx }),
          )
        } else {
          // 空エリア drop = 末尾へ移動
          void Promise.resolve(
            onDropRef.current({
              kind: 'card-reorder',
              sourceMandalartId: src.id,
              targetIndex: totalCards,
            }),
          )
        }
      } else {
        // stock 起源は drop zone のどこに落としても新規 mandalart を作る
        void Promise.resolve(
          onDropRef.current({ kind: 'stock-to-new', stockItemId: src.id }),
        )
      }
    },
  }), [clickSuppress])

  // 4 アクションアイコン (card 起源のみ受ける)
  const getActionDropProps = useCallback(
    (action: ActionDropType): DropHandlers => ({
      onDragEnter: (e) => {
        if (sourceRef.current?.kind !== 'card') return
        e.preventDefault()
        setHoveredAction(action)
        setDragOverCardIndex(null)
      },
      onDragOver: (e) => {
        if (sourceRef.current?.kind !== 'card') return
        e.preventDefault()
      },
      onDragLeave: () => {
        setHoveredAction((prev) => (prev === action ? null : prev))
      },
      onDrop: (e) => {
        e.preventDefault()
        const src = sourceRef.current
        sourceRef.current = null
        cardRectsRef.current = []
        setDragSourceKind(null)
        setDragSourceId(null)
        setHoveredAction(null)
        setDragOverCardIndex(null)
        clickSuppress.markDragged()
        if (src?.kind !== 'card') return
        void Promise.resolve(
          onDropRef.current({ kind: 'card-action', mandalartId: src.id, action }),
        )
      },
    }),
    [clickSuppress],
  )

  // フォルダタブ (card 起源のみ受ける)
  const getFolderTabDropProps = useCallback(
    (folderId: string): DropHandlers => ({
      onDragEnter: (e) => {
        if (sourceRef.current?.kind !== 'card') return
        e.preventDefault()
      },
      onDragOver: (e) => {
        if (sourceRef.current?.kind !== 'card') return
        e.preventDefault()
      },
      onDragLeave: () => {},
      onDrop: (e) => {
        e.preventDefault()
        const src = sourceRef.current
        sourceRef.current = null
        cardRectsRef.current = []
        setDragSourceKind(null)
        setDragSourceId(null)
        setHoveredAction(null)
        setDragOverCardIndex(null)
        clickSuppress.markDragged()
        if (src?.kind !== 'card') return
        void Promise.resolve(
          onDropRef.current({ kind: 'card-to-folder', sourceMandalartId: src.id, targetFolderId: folderId }),
        )
      },
    }),
    [clickSuppress],
  )

  return {
    onCardDragStart,
    onStockItemDragStart,
    onDragEnd,
    wasRecentlyDragged: clickSuppress.wasRecentlyDragged,
    dragSourceKind,
    dragSourceId,
    hoveredAction,
    dragOverCardIndex,
    isDragging: dragSourceKind !== null,
    containerDropProps,
    getActionDropProps,
    getFolderTabDropProps,
  }
}
