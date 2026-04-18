import { useState, useCallback, useRef } from 'react'
import type { Cell, CellSnapshot } from '@/types'
import { resolveDndAction, type DndAction } from '@/lib/utils/dnd'
import { isCellEmpty } from '@/lib/utils/grid'
import { CENTER_POSITION, isCenterPosition } from '@/constants/grid'
import { swapCellContent, swapCellSubtree, copyCellSubtree } from '@/lib/api/cells'
import { query, execute, now } from '@/lib/db'
import { DRAG_TARGET_SHIFT_MS } from '@/constants/timing'
import type { UndoOperation } from '@/store/undoStore'

/**
 * ストックからのドロップ先として有効かどうかを判定する。
 * - セルが空でなければ不可 (既存ルール: 空セルのみ受け入れ)
 * - 中心セル (position 4) 自体は常に OK
 * - 周辺セルは、グリッドの中心セルが非空の場合のみ OK
 *
 * `allCells` は常に現在表示中の grid の merged 9 cells なので、position=4 で
 * 1 意に中心が見つかる。grid_id 一致チェックは X=C 統一後の drilled child grid で
 * merged center の grid_id が親グリッドになるため使えず、ここでは外す。
 */
function isDroppableTarget(cell: Cell, allCells: Cell[]): boolean {
  if (!isCellEmpty(cell)) return false
  if (isCenterPosition(cell.position)) return true
  const center = allCells.find((c) => c.position === CENTER_POSITION)
  return center != null && !isCellEmpty(center)
}

/** 2D 点 (x, y) が矩形内にあるかの判定 */
function pointInRect(x: number, y: number, rect: DOMRect): boolean {
  return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom
}

export type DndUndoable = UndoOperation & { description: string }

/**
 * D&D アクションを実行し、Undo/Redo 用のクロージャを返す。
 */
async function executeAction(action: DndAction): Promise<DndUndoable | null> {
  switch (action.type) {
    case 'SWAP_SUBTREE': {
      await swapCellSubtree(action.cellIdA, action.cellIdB)
      const run = () => swapCellSubtree(action.cellIdA, action.cellIdB)
      return { description: 'セルのサブツリー入れ替え', undo: run, redo: run }
    }
    case 'SWAP_CONTENT': {
      await swapCellContent(action.cellIdA, action.cellIdB)
      const run = () => swapCellContent(action.cellIdA, action.cellIdB)
      return { description: 'セル内容の入れ替え', undo: run, redo: run }
    }
    case 'COPY_SUBTREE': {
      const targetBefore = (await query<{ text: string; image_path: string | null; color: string | null }>(
        'SELECT text, image_path, color FROM cells WHERE id = ? AND deleted_at IS NULL',
        [action.targetCellId],
      ))[0]
      const gridsBefore = await query<{ id: string }>(
        'SELECT id FROM grids WHERE center_cell_id = ? AND deleted_at IS NULL',
        [action.targetCellId],
      )
      const beforeIds = new Set(gridsBefore.map((g) => g.id))

      await copyCellSubtree(action.sourceCellId, action.targetCellId)

      const gridsAfter = await query<{ id: string }>(
        'SELECT id FROM grids WHERE center_cell_id = ? AND deleted_at IS NULL',
        [action.targetCellId],
      )
      const newGridIds = gridsAfter.filter((g) => !beforeIds.has(g.id)).map((g) => g.id)

      return {
        description: 'セル階層のコピー',
        undo: async () => {
          await execute(
            'UPDATE cells SET text=?, image_path=?, color=?, updated_at=? WHERE id=?',
            [targetBefore?.text ?? '', targetBefore?.image_path ?? null, targetBefore?.color ?? null, now(), action.targetCellId],
          )
          for (const id of newGridIds) {
            await execute('DELETE FROM grids WHERE id = ?', [id])
          }
        },
        redo: async () => {
          await copyCellSubtree(action.sourceCellId, action.targetCellId)
        },
      }
    }
    case 'NOOP':
      return null
  }
}

export type DragStartMeta = {
  /** ソース要素の画面上の位置 (getBoundingClientRect) */
  rect: DOMRect
  /** mousedown 時 / threshold 到達時のカーソル座標 */
  x: number
  y: number
  /** ソースセルの DOM 要素。ゴーストはこれを cloneNode して描画することで、
   *  フォントウェイト・境界・色・レイアウトなどセルそのままの見た目を再現する。 */
  element: HTMLElement
}

type DragSource =
  | { kind: 'cell'; cell: Cell; rect: DOMRect; element: HTMLElement }
  | { kind: 'stock'; itemId: string; snapshot: CellSnapshot | null; rect: DOMRect; element: HTMLElement }

/**
 * HTML5 DnD の代わりに mousedown/mousemove/mouseup で D&D を実装。
 * Tauri の WebKit では HTML5 DnD の drop イベントが信頼できないため。
 *
 * アニメーション連動のため以下も追加で公開する:
 *  - dragPosition: 現在のカーソル位置 (fixed ゴースト描画用)
 *  - sourceCellRect: セル由来ドラッグ時の元位置 (ホバー中のターゲットが swap 予告で動く先)
 *  - sourceCell / sourceStockSnapshot: ゴースト preview の内容
 */
export function useDragAndDrop(
  cells: Cell[],
  onComplete: () => void,
  onStockDrop?: (cellId: string) => void,
  onStockPaste?: (stockItemId: string, targetCellId: string) => void,
  pushUndo?: (op: DndUndoable) => void,
) {
  const [dragSourceId, setDragSourceId] = useState<string | null>(null)
  const [dragOverId, setDragOverId]     = useState<string | null>(null)
  const [isOverStock, setIsOverStock]   = useState(false)
  const [dragPosition, setDragPosition] = useState<{ x: number; y: number } | null>(null)
  const [sourceCellRect, setSourceCellRect] = useState<DOMRect | null>(null)
  const [sourceCell, setSourceCell]         = useState<Cell | null>(null)
  const [sourceStockSnapshot, setSourceStockSnapshot] = useState<CellSnapshot | null>(null)
  /** ゴーストの見た目を「ドラッグ前のセルそのまま」にするため、元要素を cloneNode 用に公開 */
  const [sourceElement, setSourceElement]   = useState<HTMLElement | null>(null)
  /** grab 時点でのセル内オフセット (マウスがセルのどこを掴んだか)。
   *  ゴーストを top-left にスナップせず、掴んだ相対位置を保ったまま追従させるために使う。 */
  const [dragGrabOffset, setDragGrabOffset] = useState<{ x: number; y: number } | null>(null)
  const sourceRef = useRef<DragSource | null>(null)
  const cellsRef  = useRef<Cell[]>(cells)
  cellsRef.current = cells
  // mouseup 後の sourceCellRect 遅延クリア用タイマー。
  // 戻りアニメ中に新たなドラッグが始まったら即キャンセルして state を揃える。
  const clearSourceRectTimerRef = useRef<number | null>(null)
  // D&D 開始時点での全セルの layout rect を固定キャッシュ。
  // 以降の mousemove / mouseup のヒットテストはここに対して矩形内判定を行う。
  // elementFromPoint を使うと target が transform でずれた先を拾うため、ホバー中に
  // target がカーソル下から抜けて unhover → rehover の振動を起こしてしまう。
  const cellLayoutRectsRef = useRef<Map<string, DOMRect>>(new Map())

  function hitTestCell(x: number, y: number): string | null {
    for (const [id, rect] of cellLayoutRectsRef.current) {
      if (pointInRect(x, y, rect)) return id
    }
    return null
  }

  const beginDrag = useCallback((source: DragSource, initialMeta: DragStartMeta) => {
    // 前回 drag の遅延クリアが走っていたらキャンセルして、新 drag の state を汚さないようにする
    if (clearSourceRectTimerRef.current != null) {
      clearTimeout(clearSourceRectTimerRef.current)
      clearSourceRectTimerRef.current = null
    }
    sourceRef.current = source
    setDragSourceId(source.kind === 'cell' ? source.cell.id : `stock:${source.itemId}`)
    setDragPosition({ x: initialMeta.x, y: initialMeta.y })
    if (source.kind === 'cell') {
      setSourceCellRect(source.rect)
      setSourceCell(source.cell)
      setSourceStockSnapshot(null)
    } else {
      // ストック由来: target 移動アニメは不要なので sourceCellRect は null に
      setSourceCellRect(null)
      setSourceCell(null)
      setSourceStockSnapshot(source.snapshot)
    }
    setSourceElement(source.element)
    // grab 位置 (cursor 基準のセル内オフセット) を保存
    setDragGrabOffset({
      x: initialMeta.x - source.rect.left,
      y: initialMeta.y - source.rect.top,
    })
    // 全セルの layout rect をキャッシュ (この時点では transform 未適用なので layout 座標)
    const rects = new Map<string, DOMRect>()
    document.querySelectorAll<HTMLElement>('[data-cell-id]').forEach((el) => {
      const id = el.dataset.cellId
      if (id) rects.set(id, el.getBoundingClientRect())
    })
    cellLayoutRectsRef.current = rects
    document.body.style.cursor = 'grabbing'

    function onMouseMove(e: MouseEvent) {
      setDragPosition({ x: e.clientX, y: e.clientY })

      // ストックドロップゾーンは位置が動かないので elementFromPoint でも OK
      const el      = document.elementFromPoint(e.clientX, e.clientY)
      const stockEl = el?.closest('[data-stock-drop]') as HTMLElement | null

      // セルのヒットテストは layout rect cache で (transform 影響を排除)
      let overCellId: string | null = hitTestCell(e.clientX, e.clientY)

      // ストック → セル: 空セル + 中心セルが非空の場合のみ有効なドロップ先としてハイライト
      if (sourceRef.current?.kind === 'stock' && overCellId) {
        const t = cellsRef.current.find((c) => c.id === overCellId)
        if (!t || !isDroppableTarget(t, cellsRef.current)) overCellId = null
      }
      // セル → 同一セル は NOOP (自分自身にはホバーしない扱い)
      if (sourceRef.current?.kind === 'cell' && overCellId === sourceRef.current.cell.id) {
        overCellId = null
      }

      setDragOverId(overCellId)
      setIsOverStock(!!stockEl)
    }

    function onMouseUp(e: MouseEvent) {
      document.removeEventListener('mousemove', onMouseMove)
      document.removeEventListener('mouseup', onMouseUp)
      document.body.style.cursor = ''

      // ドロップ判定は state クリア前の cellLayoutRectsRef で行う
      const el      = document.elementFromPoint(e.clientX, e.clientY)
      const stockEl = el?.closest('[data-stock-drop]') as HTMLElement | null
      const targetId = hitTestCell(e.clientX, e.clientY)

      const src = sourceRef.current
      sourceRef.current = null

      // 即時にクリアする state:
      // - dragSourceId: ソースセルの visibility を元に戻す
      // - dragOverId: ホバーしていた target の戻りアニメを発火
      // - ghost まわり: 追従描画を止める
      setDragSourceId(null)
      setDragOverId(null)
      setIsOverStock(false)
      setDragPosition(null)
      setSourceElement(null)
      setDragGrabOffset(null)

      // sourceCellRect と cellLayoutRectsRef は遅延クリアする。
      // これを残している間、target cell は "else if (sourceCellRect)" 分岐に入り、
      // drag-target-shifting class + transform:translate(0,0) で元位置への戻り
      // アニメが DRAG_TARGET_SHIFT_MS 分再生される。
      if (clearSourceRectTimerRef.current != null) {
        clearTimeout(clearSourceRectTimerRef.current)
      }
      clearSourceRectTimerRef.current = window.setTimeout(() => {
        setSourceCellRect(null)
        setSourceCell(null)
        setSourceStockSnapshot(null)
        cellLayoutRectsRef.current = new Map()
        clearSourceRectTimerRef.current = null
      }, DRAG_TARGET_SHIFT_MS + 50) // transition 終了を確実に待つための余白

      if (!src) return

      if (src.kind === 'cell') {
        if (stockEl) {
          onStockDrop?.(src.cell.id)
          return
        }
        if (!targetId || targetId === src.cell.id) return
        const target = cellsRef.current.find((c) => c.id === targetId)
        if (!target) return
        const action = resolveDndAction(src.cell, target)
        if (action.type !== 'NOOP') {
          executeAction(action)
            .then((undoable) => {
              if (undoable && pushUndo) pushUndo(undoable)
              onComplete()
            })
            .catch(console.error)
        }
      } else {
        if (!targetId) return
        const target = cellsRef.current.find((c) => c.id === targetId)
        if (!target || !isDroppableTarget(target, cellsRef.current)) return
        onStockPaste?.(src.itemId, targetId)
      }
    }

    document.addEventListener('mousemove', onMouseMove)
    document.addEventListener('mouseup',   onMouseUp)
  }, [onComplete, onStockDrop, onStockPaste, pushUndo])

  const handleDragStart = useCallback(
    (cell: Cell, meta: DragStartMeta) =>
      beginDrag({ kind: 'cell', cell, rect: meta.rect, element: meta.element }, meta),
    [beginDrag],
  )
  const handleStockItemDragStart = useCallback(
    (itemId: string, snapshot: CellSnapshot | null, meta: DragStartMeta) =>
      beginDrag({ kind: 'stock', itemId, snapshot, rect: meta.rect, element: meta.element }, meta),
    [beginDrag],
  )

  return {
    dragSourceId,
    dragOverId,
    isOverStock,
    isDragging: dragSourceId !== null,
    handleDragStart,
    handleStockItemDragStart,
    dragPosition,
    sourceCellRect,
    sourceCell,
    sourceStockSnapshot,
    sourceElement,
    dragGrabOffset,
  }
}
