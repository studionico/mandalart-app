import type { Cell } from '@/types'
import CellComponent from './Cell'
import { getCenterCell, isCellEmpty } from '@/lib/utils/grid'

type Props = {
  cells: Cell[]
  childCounts: Map<string, number>
  cutCellId: string | null
  dragSourceId?: string | null
  dragOverId?: string | null
  fontScale: number
  inlineEditingCellId: string | null
  onStartInlineEdit: (cell: Cell) => void
  onCommitInlineEdit: (cell: Cell, text: string) => void
  onInlineNavigate: (currentPosition: number, currentText: string, reverse: boolean) => void
  onDrill: (cell: Cell) => void
  onOpenModal: (cell: Cell) => void
  onDragStart?: (cell: Cell) => void
  onContextMenu?: (e: React.MouseEvent, cell: Cell) => void
}

export default function GridView3x3({
  cells, childCounts, cutCellId, dragSourceId, dragOverId,
  fontScale, inlineEditingCellId,
  onStartInlineEdit, onCommitInlineEdit, onInlineNavigate,
  onDrill, onOpenModal, onDragStart, onContextMenu,
}: Props) {
  const center = getCenterCell(cells)
  const centerEmpty = !center || isCellEmpty(center)
  const cellMap = new Map(cells.map((c) => [c.position, c]))

  return (
    <div className="grid grid-cols-3 grid-rows-3 gap-2 w-full h-full p-3 bg-gray-100 rounded-2xl shadow-inner">
      {Array.from({ length: 9 }).map((_, i) => {
        const cell = cellMap.get(i)
        if (!cell) return <div key={i} className="rounded-lg bg-gray-100" />

        const isCenter   = i === 4
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
            onStartInlineEdit={onStartInlineEdit}
            onCommitInlineEdit={onCommitInlineEdit}
            onInlineNavigate={onInlineNavigate}
            onDrill={onDrill}
            onOpenModal={onOpenModal}
            onDragStart={onDragStart}
            onContextMenu={onContextMenu}
          />
        )
      })}
    </div>
  )
}
