import { useCallback, useMemo, useRef, useState } from 'react'
import type { Cell } from '@/types'
import { resolveDndAction, type DndAction } from '@/lib/utils/dnd'
import { isCellEmpty } from '@/lib/utils/grid'
import { CENTER_POSITION, isCenterPosition } from '@/constants/grid'
import { swapCellSubtree, upsertCellAt } from '@/lib/api/cells'
import { query } from '@/lib/db'
import type { UndoOperation } from '@/store/undoStore'
import { setDragPayload, applyCleanDragImage } from '@/lib/utils/dndPayload'

/** D&D 中に表示する 4 アクションアイコン (DragActionPanel) の種別 */
export type ActionDropType = 'shred' | 'move' | 'copy' | 'export'

/**
 * ストック / D&D の drop 先 slot として有効かを (grid_id, position) ベースで判定する。
 *
 * Phase A 後の仕様:
 * - 中心 slot (position=4) は drop ターゲットになれない (どんな source からも禁止)
 * - 周辺 slot:
 *   - cell-to-cell drop: target に既存 cell があれば SWAP_SUBTREE (resolveDndAction で判定)、
 *     空 slot は新規 INSERT 後に SWAP 扱い
 *   - stock-to-cell drop: target が空 / 入力ありどちらも droppable (入力ありは置換確認フローへ)
 * - 周辺 slot は同 grid の中心 cell が populated でないと NG (中心が空のグリッドへの貼付禁止)
 */
function isDroppableSlot(
  gridId: string,
  position: number,
  _existingCell: Cell | undefined,
  allCells: Cell[],
): boolean {
  if (isCenterPosition(position)) return false
  const center =
    allCells.find((c) => c.grid_id === gridId && c.position === CENTER_POSITION) ??
    allCells.find((c) => c.position === CENTER_POSITION)
  return center != null && !isCellEmpty(center)
}

export type DndUndoable = UndoOperation & { description: string }

async function executeAction(action: DndAction): Promise<DndUndoable | null> {
  switch (action.type) {
    case 'SWAP_SUBTREE': {
      await swapCellSubtree(action.cellIdA, action.cellIdB)
      const run = () => swapCellSubtree(action.cellIdA, action.cellIdB)
      return { description: 'セルのサブツリー入れ替え', undo: run, redo: run }
    }
    case 'NOOP':
      return null
  }
}

type DragSource =
  | { kind: 'cell'; cell: Cell }
  | { kind: 'stock'; itemId: string }

type DropTargetInfo =
  | { kind: 'cell'; cellId: string; gridId: string; position: number }
  | { kind: 'slot'; gridId: string; position: number }

/** target 要素の data-* 属性から drop target 情報を取り出す */
function readDropTarget(el: HTMLElement, cells: Cell[]): DropTargetInfo | null {
  const cellId = el.dataset.cellId
  const gridId = el.dataset.gridId
  const positionStr = el.dataset.position
  if (cellId) {
    const c = cells.find((cc) => cc.id === cellId)
    if (c) return { kind: 'cell', cellId, gridId: c.grid_id, position: c.position }
  }
  if (gridId && positionStr != null) {
    return { kind: 'slot', gridId, position: Number(positionStr) }
  }
  return null
}

/** drop 対象が現在の source に対して許容されるかを返す (中心セル禁止 / 中心空グリッド禁止) */
function canAcceptDrop(source: DragSource, target: DropTargetInfo, cells: Cell[]): boolean {
  if (source.kind === 'cell') {
    if (isCenterPosition(source.cell.position)) return false
    if (isCenterPosition(target.position)) return false
    if (target.kind === 'cell' && target.cellId === source.cell.id) return false
    return true
  }
  // stock → cell
  const existingCell =
    target.kind === 'cell'
      ? cells.find((c) => c.id === target.cellId)
      : cells.find((c) => c.grid_id === target.gridId && c.position === target.position)
  return isDroppableSlot(target.gridId, target.position, existingCell, cells)
}

/**
 * HTML5 D&D ベースで cell / stock の drag & drop を扱う hook。
 * Tauri v2 で `dragDropEnabled: false` を設定すると WKWebView 上でも target 側 event が
 * 正しく伝搬する (旧落とし穴 #1 の "HTML5 D&D 不能" は default の `true` が原因だった)。
 *
 * サポートするソース:
 *  - セル → セル (同一 / 跨ぎ) / 4 アクションアイコン (shred / move / copy / export)
 *  - ストックアイテム → セル (空 → 直接ペースト / 入力あり → 置換確認フロー)
 */
export function useDragAndDrop(
  cells: Cell[],
  onComplete: () => void,
  onStockPaste?: (stockItemId: string, targetCellId: string) => void,
  pushUndo?: (op: DndUndoable) => void,
  /**
   * D&D アクション成功直後に「影響を受けたセル群」を最新値で受け取る callback。
   * EditorLayout 側で `refreshCell` 局所更新するためのフック (落とし穴 #14)。
   */
  onCellsUpdated?: (updated: Cell[]) => void,
  onStockReplaceDrop?: (stockItemId: string, targetCellId: string) => void,
  onActionDrop?: (action: ActionDropType, cellId: string) => void,
) {
  const [dragSourceId, setDragSourceId] = useState<string | null>(null)
  const [dragOverId, setDragOverId] = useState<string | null>(null)
  const [hoveredAction, setHoveredAction] = useState<ActionDropType | null>(null)
  const sourceRef = useRef<DragSource | null>(null)
  const cellsRef = useRef<Cell[]>(cells)
  cellsRef.current = cells

  // ===== Source 側 =====

  const handleDragStart = useCallback((cell: Cell, e: React.DragEvent) => {
    sourceRef.current = { kind: 'cell', cell }
    setDragSourceId(cell.id)
    setDragPayload(e, { kind: 'cell', cellId: cell.id })
    if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move'
    applyCleanDragImage(e, e.currentTarget as HTMLElement)
  }, [])

  const handleStockItemDragStart = useCallback((itemId: string, e: React.DragEvent) => {
    sourceRef.current = { kind: 'stock', itemId }
    setDragSourceId(`stock:${itemId}`)
    setDragPayload(e, { kind: 'stock', stockItemId: itemId })
    if (e.dataTransfer) e.dataTransfer.effectAllowed = 'copy'
    applyCleanDragImage(e, e.currentTarget as HTMLElement)
  }, [])

  const handleDragEnd = useCallback(() => {
    sourceRef.current = null
    setDragSourceId(null)
    setDragOverId(null)
    setHoveredAction(null)
  }, [])

  // ===== Target 側 (cell / 空 slot 共通) =====

  const cellOrSlotDropProps = useMemo(() => {
    function dropTargetIdOf(target: DropTargetInfo): string {
      return target.kind === 'cell' ? target.cellId : `slot:${target.gridId}:${target.position}`
    }

    return {
      onDragEnter: (e: React.DragEvent) => {
        const src = sourceRef.current
        if (!src) return
        const target = readDropTarget(e.currentTarget as HTMLElement, cellsRef.current)
        if (!target) return
        if (!canAcceptDrop(src, target, cellsRef.current)) return
        e.preventDefault()
        setDragOverId(dropTargetIdOf(target))
        setHoveredAction(null)
      },
      onDragOver: (e: React.DragEvent) => {
        const src = sourceRef.current
        if (!src) return
        const target = readDropTarget(e.currentTarget as HTMLElement, cellsRef.current)
        if (!target) return
        if (!canAcceptDrop(src, target, cellsRef.current)) return
        e.preventDefault()
      },
      onDragLeave: (e: React.DragEvent) => {
        const target = readDropTarget(e.currentTarget as HTMLElement, cellsRef.current)
        if (!target) return
        // 子要素間の dragenter→dragleave は無視 (relatedTarget が currentTarget の子なら何もしない)
        const related = e.relatedTarget as Node | null
        if (related && (e.currentTarget as Node).contains(related)) return
        const id = dropTargetIdOf(target)
        setDragOverId((prev) => (prev === id ? null : prev))
      },
      onDrop: (e: React.DragEvent) => {
        e.preventDefault()
        const src = sourceRef.current
        sourceRef.current = null
        setDragSourceId(null)
        setDragOverId(null)
        setHoveredAction(null)
        if (!src) return
        const target = readDropTarget(e.currentTarget as HTMLElement, cellsRef.current)
        if (!target) return
        if (!canAcceptDrop(src, target, cellsRef.current)) return

        if (src.kind === 'cell') {
          ;(async () => {
            let targetCell: Cell | null =
              target.kind === 'cell'
                ? cellsRef.current.find((c) => c.id === target.cellId) ?? null
                : null
            if (!targetCell) {
              targetCell = await upsertCellAt(target.gridId, target.position, {})
            }
            const dndAction = resolveDndAction(src.cell, targetCell)
            if (dndAction.type === 'NOOP') return
            const undoable = await executeAction(dndAction)
            if (undoable && pushUndo) pushUndo(undoable)
            if (onCellsUpdated) {
              const affectedIds: string[] = [dndAction.cellIdA, dndAction.cellIdB]
              const ph = affectedIds.map(() => '?').join(',')
              const updated = await query<Cell>(
                `SELECT * FROM cells WHERE id IN (${ph}) AND deleted_at IS NULL`,
                affectedIds,
              )
              onCellsUpdated(updated)
            } else {
              onComplete()
            }
          })().catch(console.error)
        } else {
          // stock → cell
          ;(async () => {
            const existing =
              target.kind === 'cell'
                ? cellsRef.current.find((c) => c.id === target.cellId) ?? null
                : null
            if (existing && !isCellEmpty(existing)) {
              onStockReplaceDrop?.(src.itemId, existing.id)
              return
            }
            let cell = existing
            if (!cell) {
              cell = await upsertCellAt(target.gridId, target.position, {})
            }
            onStockPaste?.(src.itemId, cell.id)
          })().catch(console.error)
        }
      },
    }
  }, [onComplete, onStockPaste, pushUndo, onCellsUpdated, onStockReplaceDrop])

  // ===== Target 側 (4 アクションアイコン) =====

  const getActionDropProps = useCallback(
    (action: ActionDropType) => ({
      onDragEnter: (e: React.DragEvent) => {
        const src = sourceRef.current
        // アクションアイコンは cell source のみ受ける (stock は対象外)
        if (src?.kind !== 'cell') return
        e.preventDefault()
        setHoveredAction(action)
        setDragOverId(null)
      },
      onDragOver: (e: React.DragEvent) => {
        const src = sourceRef.current
        if (src?.kind !== 'cell') return
        e.preventDefault()
      },
      onDragLeave: () => {
        setHoveredAction((prev) => (prev === action ? null : prev))
      },
      onDrop: (e: React.DragEvent) => {
        e.preventDefault()
        const src = sourceRef.current
        sourceRef.current = null
        setDragSourceId(null)
        setDragOverId(null)
        setHoveredAction(null)
        if (src?.kind !== 'cell') return
        onActionDrop?.(action, src.cell.id)
      },
    }),
    [onActionDrop],
  )

  return {
    dragSourceId,
    dragOverId,
    hoveredAction,
    isDragging: dragSourceId !== null,
    handleDragStart,
    handleStockItemDragStart,
    handleDragEnd,
    /** Cell / 空 slot wrapper にスプレッドする drop handlers (data-cell-id / data-grid-id+data-position から自動判別) */
    cellOrSlotDropProps,
    /** DragActionPanel の各タイル用 (action 種別ごと) */
    getActionDropProps,
  }
}
