import { useRef } from 'react'
import type { Cell as CellType } from '@/types'
import { getColorClasses } from '@/constants/colors'

type Props = {
  cell: CellType
  isCenter: boolean
  isDisabled: boolean
  isCut: boolean
  isDragSource: boolean  // ドラッグ中のセル（半透明）
  isDragOver: boolean    // ドロップ候補（リングハイライト）
  childCount: number
  onClick: (cell: CellType) => void
  onDoubleClick: (cell: CellType) => void
  onDragStart?: (cell: CellType) => void
  onContextMenu?: (e: React.MouseEvent, cell: CellType) => void
  size?: 'normal' | 'small'
}

const DRAG_THRESHOLD = 5   // ドラッグ判定の移動距離（px）

export default function Cell({
  cell, isCenter, isDisabled, isCut, isDragSource, isDragOver, childCount,
  onClick, onDoubleClick, onDragStart, onContextMenu,
  size = 'normal',
}: Props) {
  const clickTimer  = useRef<ReturnType<typeof setTimeout> | null>(null)
  const didDrag     = useRef(false)
  const { bg, text: textColor } = getColorClasses(cell.color)

  function handleMouseDown(e: React.MouseEvent) {
    if (isDisabled || e.button !== 0) return

    const startX = e.clientX
    const startY = e.clientY
    didDrag.current = false

    function onMove(e2: MouseEvent) {
      const dx = e2.clientX - startX
      const dy = e2.clientY - startY
      if (!didDrag.current && Math.sqrt(dx * dx + dy * dy) > DRAG_THRESHOLD) {
        didDrag.current = true
        document.removeEventListener('mousemove', onMove)
        document.removeEventListener('mouseup',   onUp)
        onDragStart?.(cell)
      }
    }

    function onUp() {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup',   onUp)
    }

    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup',   onUp)
  }

  function handleClick() {
    if (isDisabled || didDrag.current) return
    if (clickTimer.current) {
      clearTimeout(clickTimer.current)
      clickTimer.current = null
      onDoubleClick(cell)
    } else {
      clickTimer.current = setTimeout(() => {
        clickTimer.current = null
        onClick(cell)
      }, 220)
    }
  }

  const sizeClasses = size === 'small' ? 'text-[10px] p-0.5' : 'text-xs sm:text-sm p-1.5'

  return (
    <div
      data-cell-id={cell.id}
      className={`
        relative flex items-center justify-center rounded-lg border transition-all select-none
        ${sizeClasses}
        ${bg}
        ${isCenter ? 'border-blue-400 border-2 font-semibold shadow-md' : 'border-gray-300 shadow-sm'}
        ${isDisabled ? 'opacity-30 cursor-not-allowed' : 'cursor-pointer hover:shadow-md hover:border-gray-400 active:scale-95'}
        ${isCut || isDragSource ? 'opacity-40' : ''}
        ${isDragOver && !isDisabled ? 'ring-2 ring-blue-400 ring-offset-1 scale-105' : ''}
      `}
      onMouseDown={handleMouseDown}
      onClick={handleClick}
      onContextMenu={onContextMenu ? (e) => { e.preventDefault(); onContextMenu(e, cell) } : undefined}
    >
      {cell.image_path && (
        <div className="absolute inset-0 rounded-lg overflow-hidden">
          <img src={`/api/image?path=${encodeURIComponent(cell.image_path)}`} alt="" className="w-full h-full object-cover opacity-60" />
        </div>
      )}

      <span className={`relative z-10 text-center leading-tight break-all line-clamp-3 ${textColor}`}>
        {cell.text}
      </span>

      {childCount > 0 && (
        <span className="absolute bottom-0.5 right-0.5 w-1.5 h-1.5 bg-blue-400 rounded-full" />
      )}
    </div>
  )
}
