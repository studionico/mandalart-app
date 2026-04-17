import type { Cell, Grid } from '@/types'
import CellComponent from './Cell'
import { getCenterCell, isCellEmpty } from '@/lib/utils/grid'
import { CENTER_POSITION, GRID_CELL_COUNT, isCenterPosition } from '@/constants/grid'

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

export default function GridView9x9({
  rootCells, subGrids, childCounts, cutCellId, dragSourceId, dragOverId,
  fontScale, inlineEditingCellId,
  userId, mandalartId, onCellSave,
  onStartInlineEdit, onCommitInlineEdit, onInlineNavigate,
  onDrill, onDragStart, onContextMenu,
}: Props) {
  const rootCellMap = new Map(rootCells.map((c) => [c.position, c]))
  const rootCenter = getCenterCell(rootCells)
  const rootCenterEmpty = !rootCenter || isCellEmpty(rootCenter)

  // 各サブグリッドラッパーの共通クラス
  // gap-px + bg-gray-300 で「セル同士が共有する 1 本の境界線」を表現
  const wrapperBase = 'grid grid-cols-3 grid-rows-3 gap-px bg-gray-300 dark:bg-gray-700 rounded-xl overflow-hidden min-h-0 min-w-0'
  const emptyCellClass = 'bg-white dark:bg-gray-900'

  return (
    <div className="grid grid-cols-3 grid-rows-3 gap-2 w-full h-full">
      {Array.from({ length: GRID_CELL_COUNT }).map((_, outerPos) => {
        const isRootCenter = isCenterPosition(outerPos)

        // 9×9 表示の中央ブロックはルートグリッド自体の 9 セルを描画する
        if (isRootCenter) {
          return (
            <div
              key={outerPos}
              data-grid-container
              className={`${wrapperBase} border-[6px] border-black dark:border-white`}
            >
              {Array.from({ length: GRID_CELL_COUNT }).map((_, innerPos) => {
                const cell = rootCellMap.get(innerPos)
                if (!cell) return <div key={innerPos} className={emptyCellClass} />
                const isInnerCenter = isCenterPosition(innerPos)
                const isDisabled = !isInnerCenter && rootCenterEmpty

                return (
                  <CellComponent
                    key={cell.id}
                    cell={cell}
                    isCenter={isInnerCenter}
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
                    size="small"
                  />
                )
              })}
            </div>
          )
        }

        const rootCell = rootCellMap.get(outerPos)
        const sub = rootCell ? subGrids.get(rootCell.id) : null
        const subCellMap = sub ? new Map(sub.cells.map((c) => [c.position, c])) : null
        const subCenter = sub ? getCenterCell(sub.cells) : null
        const subCenterEmpty = !subCenter || isCellEmpty(subCenter)

        // 外枠の黒 2px は「意味のあるサブグリッド」= 周辺セルに入力がある場合のみ。
        // childCounts は fetchChildCountsFor 側でその条件を満たすものだけカウントされる。
        const hasMeaningfulSub = rootCell
          ? (childCounts.get(rootCell.id) ?? 0) > 0
          : false
        const borderClass = hasMeaningfulSub
          ? 'border-2 border-black dark:border-gray-300'
          : 'border-2 border-gray-300 dark:border-gray-700'

        return (
          <div key={outerPos} data-grid-container className={`${wrapperBase} ${borderClass}`}>
            {Array.from({ length: GRID_CELL_COUNT }).map((_, innerPos) => {
              if (subCellMap) {
                const cell = subCellMap.get(innerPos)
                if (!cell) return <div key={innerPos} className={emptyCellClass} />
                const isSubCenter = isCenterPosition(innerPos)
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
                    size="small"
                  />
                )
              }

              // 子サブグリッドが無い場合: ルートセル本体を中央に、周辺は空の白セル
              if (innerPos === CENTER_POSITION && rootCell) {
                return (
                  <CellComponent
                    key={rootCell.id + '-center'}
                    cell={rootCell}
                    isCenter={true}
                    isDisabled={false}
                    isCut={rootCell.id === cutCellId}
                    isDragSource={rootCell.id === dragSourceId}
                    isDragOver={rootCell.id === dragOverId}
                    childCount={childCounts.get(rootCell.id) ?? 0}
                    fontScale={fontScale}
                    isInlineEditing={rootCell.id === inlineEditingCellId}
                    userId={userId}
                    mandalartId={mandalartId}
                    onCellSave={onCellSave}
                    onStartInlineEdit={onStartInlineEdit}
                    onCommitInlineEdit={onCommitInlineEdit}
                    onInlineNavigate={onInlineNavigate}
                    onDrill={onDrill}
                    onDragStart={onDragStart}
                    onContextMenu={onContextMenu}
                    size="small"
                  />
                )
              }
              return <div key={innerPos} className={emptyCellClass} />
            })}
          </div>
        )
      })}
    </div>
  )
}
