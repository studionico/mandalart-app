'use client'

import type { Cell } from '@/types'
import CellComponent from './Cell'
import { getCenterCell, isCellEmpty } from '@/lib/utils/grid'

type Props = {
  cells: Cell[]
  childCounts: Map<string, number>   // cellId → 子グリッド数
  cutCellId: string | null
  onCellClick: (cell: Cell) => void
  onCellDoubleClick: (cell: Cell) => void
  onDragStart?: (cell: Cell) => void
  onDrop?: (target: Cell) => void
  onContextMenu?: (e: React.MouseEvent, cell: Cell) => void
}

export default function GridView3x3({
  cells, childCounts, cutCellId,
  onCellClick, onCellDoubleClick, onDragStart, onDrop, onContextMenu,
}: Props) {
  const center = getCenterCell(cells)
  const centerEmpty = !center || isCellEmpty(center)
  const cellMap = new Map(cells.map((c) => [c.position, c]))

  return (
    <div className="grid grid-cols-3 gap-1.5 w-full aspect-square">
      {Array.from({ length: 9 }).map((_, i) => {
        const cell = cellMap.get(i)
        if (!cell) return <div key={i} className="rounded-lg bg-gray-100" />

        const isCenter = i === 4
        const isDisabled = !isCenter && centerEmpty

        return (
          <CellComponent
            key={cell.id}
            cell={cell}
            isCenter={isCenter}
            isDisabled={isDisabled}
            isCut={cell.id === cutCellId}
            childCount={childCounts.get(cell.id) ?? 0}
            onClick={onCellClick}
            onDoubleClick={onCellDoubleClick}
            onDragStart={onDragStart}
            onDrop={onDrop}
            onContextMenu={onContextMenu}
          />
        )
      })}
    </div>
  )
}
