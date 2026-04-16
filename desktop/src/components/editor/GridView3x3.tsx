import type { Cell } from '@/types'
import CellComponent from './Cell'
import { getCenterCell, isCellEmpty } from '@/lib/utils/grid'
import { GRID_CELL_COUNT, isCenterPosition } from '@/constants/grid'

type Props = {
  cells: Cell[]
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
  onDrill: (cell: Cell) => void
  onDragStart?: (cell: Cell) => void
  onContextMenu?: (e: React.MouseEvent, cell: Cell) => void
}

export default function GridView3x3({
  cells, childCounts, cutCellId, dragSourceId, dragOverId,
  fontScale, inlineEditingCellId,
  userId, mandalartId, onCellSave,
  onStartInlineEdit, onCommitInlineEdit, onInlineNavigate,
  onDrill, onDragStart, onContextMenu,
}: Props) {
  const center = getCenterCell(cells)
  const centerEmpty = !center || isCellEmpty(center)
  const cellMap = new Map(cells.map((c) => [c.position, c]))

  return (
    <div data-grid-container className="grid grid-cols-3 grid-rows-3 gap-2 w-full h-full">
      {Array.from({ length: GRID_CELL_COUNT }).map((_, i) => {
        const cell = cellMap.get(i)
        if (!cell) return <div key={i} className="rounded-lg bg-gray-100 dark:bg-gray-900" />

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
            onContextMenu={onContextMenu}
          />
        )
      })}
    </div>
  )
}
