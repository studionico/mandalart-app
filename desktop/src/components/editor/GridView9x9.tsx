import type { Cell, Grid } from '@/types'
import CellComponent from './Cell'
import { getCenterCell, isCellEmpty } from '@/lib/utils/grid'

type SubGrid = {
  grid: Grid
  cells: Cell[]
  parentPosition: number
}

type Props = {
  rootCells: Cell[]
  subGrids: Map<string, SubGrid>
  childCounts: Map<string, number>
  cutCellId: string | null
  dragSourceId?: string | null
  dragOverId?: string | null
  onCellClick: (cell: Cell) => void
  onCellDoubleClick: (cell: Cell) => void
  onDragStart?: (cell: Cell) => void
  onContextMenu?: (e: React.MouseEvent, cell: Cell) => void
}

export default function GridView9x9({
  rootCells, subGrids, childCounts, cutCellId, dragSourceId, dragOverId,
  onCellClick, onCellDoubleClick, onDragStart, onContextMenu,
}: Props) {
  const rootCellMap = new Map(rootCells.map((c) => [c.position, c]))
  const rootCenter = getCenterCell(rootCells)
  const rootCenterEmpty = !rootCenter || isCellEmpty(rootCenter)

  return (
    <div className="grid grid-cols-3 gap-2 w-full">
      {Array.from({ length: 9 }).map((_, outerPos) => {
        const rootCell = rootCellMap.get(outerPos)
        const sub = rootCell ? subGrids.get(rootCell.id) : null

        if (!rootCell) {
          return (
            <div key={outerPos} className="grid grid-cols-3 gap-0.5 p-1 bg-gray-50 rounded-xl border border-gray-200">
              {Array.from({ length: 9 }).map((_, k) => (
                <div key={k} className="aspect-square rounded bg-gray-100" />
              ))}
            </div>
          )
        }

        const subCellMap = sub ? new Map(sub.cells.map((c) => [c.position, c])) : null
        const subCenter = sub ? getCenterCell(sub.cells) : null
        const subCenterEmpty = !subCenter || isCellEmpty(subCenter)
        const isRootCenter = outerPos === 4

        return (
          <div
            key={outerPos}
            className={`grid grid-cols-3 gap-0.5 p-1 rounded-xl border ${
              isRootCenter ? 'border-blue-300 bg-blue-50' : 'border-gray-200 bg-gray-50'
            }`}
          >
            {Array.from({ length: 9 }).map((_, innerPos) => {
              if (subCellMap) {
                const cell = subCellMap.get(innerPos)
                if (!cell) return <div key={innerPos} className="aspect-square rounded bg-gray-100" />
                const isSubCenter = innerPos === 4
                const isDisabled = !isSubCenter && subCenterEmpty

                return (
                  <CellComponent
                    key={cell.id}
                    cell={cell}
                    isCenter={isSubCenter}
                    isDisabled={isDisabled}
                    isCut={cell.id === cutCellId}
                    isDragSource={cell.id === dragSourceId}
                    isDragOver={cell.id === dragOverId}
                    childCount={childCounts.get(cell.id) ?? 0}
                    onClick={onCellClick}
                    onDoubleClick={onCellDoubleClick}
                    onDragStart={onDragStart}
                    onContextMenu={onContextMenu}
                    size="small"
                  />
                )
              }

              if (innerPos === 4) {
                return (
                  <CellComponent
                    key={rootCell.id + '-center'}
                    cell={rootCell}
                    isCenter={isRootCenter}
                    isDisabled={!isRootCenter && rootCenterEmpty}
                    isCut={rootCell.id === cutCellId}
                    isDragSource={rootCell.id === dragSourceId}
                    isDragOver={rootCell.id === dragOverId}
                    childCount={childCounts.get(rootCell.id) ?? 0}
                    onClick={onCellClick}
                    onDoubleClick={onCellDoubleClick}
                    onDragStart={onDragStart}
                    onContextMenu={onContextMenu}
                    size="small"
                  />
                )
              }
              return <div key={innerPos} className="aspect-square rounded bg-gray-100" />
            })}
          </div>
        )
      })}
    </div>
  )
}
