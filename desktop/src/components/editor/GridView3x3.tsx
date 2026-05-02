import type { Cell } from '@/types'
import CellComponent from './Cell'
import { getCenterCell, isCellEmpty } from '@/lib/utils/grid'
import { GRID_CELL_COUNT, isCenterPosition } from '@/constants/grid'

type Props = {
  cells: Cell[]
  /**
   * このグリッドの id。空 slot placeholder の data-grid-id 属性 / click 時の引数に使う。
   * cells が空 (まだ何も書かれてない grid) の場合 cells から導出できないため明示的に渡す。
   */
  gridId: string
  childCounts: Map<string, number>
  cutCellId: string | null
  dragSourceId?: string | null
  dragOverId?: string | null
  fontScale: number
  inlineEditingCellId: string | null
  userId?: string
  mandalartId?: string
  onCellSave?: (cellId: string, params: { text: string; image_path: string | null; color: string | null }) => Promise<void>
  onStartInlineEdit: (cell: Cell) => void
  onCommitInlineEdit: (cell: Cell, text: string) => void
  onInlineNavigate: (currentPosition: number, currentText: string, reverse: boolean) => void
  /**
   * 空 slot (cell 行が DB に無い) をクリックした時のハンドラ。
   * 受け取り側で pending edit state を立てて inline 編集を開始する。
   */
  onStartEmptySlotEdit?: (gridId: string, position: number) => void
  onDrill: (cell: Cell) => void
  onDragStart?: (cell: Cell, e: React.DragEvent) => void
  onDragEnd?: () => void
  /** Cell / 空 slot wrapper にスプレッドする drop handlers */
  dropProps?: {
    onDragEnter: (e: React.DragEvent) => void
    onDragOver: (e: React.DragEvent) => void
    onDragLeave: (e: React.DragEvent) => void
    onDrop: (e: React.DragEvent) => void
  }
  onContextMenu?: (e: React.MouseEvent, cell: Cell) => void
  onToggleDone?: (cell: Cell) => void
}

export default function GridView3x3({
  cells, gridId, childCounts, cutCellId, dragSourceId, dragOverId,
  fontScale, inlineEditingCellId,
  userId, mandalartId, onCellSave,
  onStartInlineEdit, onCommitInlineEdit, onInlineNavigate, onStartEmptySlotEdit,
  onDrill, onDragStart, onDragEnd, dropProps, onContextMenu, onToggleDone,
}: Props) {
  const center = getCenterCell(cells)
  const centerEmpty = !center || isCellEmpty(center)
  const cellMap = new Map(cells.map((c) => [c.position, c]))

  return (
    <div data-grid-container className="grid grid-cols-3 grid-rows-3 gap-2 w-full h-full">
      {Array.from({ length: GRID_CELL_COUNT }).map((_, i) => {
        const cell = cellMap.get(i)
        if (!cell) {
          // 空 slot placeholder: cell 行が DB に無い slot。
          // - center 空のときは周辺 disabled (現行ルール)
          // - クリックで inline edit に入れるよう data-grid-id + data-position + onClick を付与
          // - D&D も data-grid-id + data-position を見て target 解決する
          const isCenter = isCenterPosition(i)
          const isDisabled = !isCenter && centerEmpty
          const dragOverKey = `slot:${gridId}:${i}`
          const isDragOver = dragOverId === dragOverKey
          return (
            <div
              key={`empty-${gridId}-${i}`}
              data-grid-id={gridId}
              data-position={i}
              className={`
                rounded-lg shadow-sm bg-white dark:bg-neutral-900
                ${isCenter
                  ? 'border-[6px] border-black dark:border-white shadow-md'
                  : 'border border-neutral-300 dark:border-neutral-700'}
                ${isDisabled ? 'cursor-not-allowed' : 'cursor-pointer hover:shadow-md'}
                ${isDragOver && !isDisabled ? 'ring-2 ring-blue-400 ring-offset-1' : ''}
              `}
              onClick={() => {
                if (isDisabled) return
                onStartEmptySlotEdit?.(gridId, i)
              }}
              onDragEnter={dropProps?.onDragEnter}
              onDragOver={dropProps?.onDragOver}
              onDragLeave={dropProps?.onDragLeave}
              onDrop={dropProps?.onDrop}
            />
          )
        }

        const isCenter   = isCenterPosition(i)
        const isDisabled = !isCenter && centerEmpty

        return (
          <CellComponent
            key={cell.id}
            cell={cell}
            isCenter={isCenter}
            isDisabled={isDisabled}
            isCut={cell.id === cutCellId}
            isDragSource={cell.id === dragSourceId}
            isDragOver={cell.id === dragOverId}
            childCount={childCounts.get(cell.id) ?? 0}
            fontScale={fontScale}
            isInlineEditing={cell.id === inlineEditingCellId}
            userId={userId}
            mandalartId={mandalartId}
            onCellSave={onCellSave}
            onStartInlineEdit={onStartInlineEdit}
            onCommitInlineEdit={onCommitInlineEdit}
            onInlineNavigate={onInlineNavigate}
            onDrill={onDrill}
            onDragStart={onDragStart}
            onDragEnd={onDragEnd}
            dropProps={dropProps}
            onContextMenu={onContextMenu}
            onToggleDone={onToggleDone}
          />
        )
      })}
    </div>
  )
}
