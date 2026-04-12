
import { useRef } from 'react'
import type { Cell as CellType } from '@/types'
import { getColorClasses } from '@/constants/colors'

type Props = {
  cell: CellType
  isCenter: boolean
  isDisabled: boolean   // 中心が空で周辺が無効
  isCut: boolean        // カット中グレーアウト
  childCount: number    // 子グリッド数
  onClick: (cell: CellType) => void
  onDoubleClick: (cell: CellType) => void
  onDragStart?: (cell: CellType) => void
  onDrop?: (target: CellType) => void
  onContextMenu?: (e: React.MouseEvent, cell: CellType) => void
  size?: 'normal' | 'small'
}

export default function Cell({
  cell, isCenter, isDisabled, isCut, childCount,
  onClick, onDoubleClick, onDragStart, onDrop, onContextMenu,
  size = 'normal',
}: Props) {
  const clickTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const { bg, text: textColor } = getColorClasses(cell.color)

  function handleClick() {
    if (isDisabled) return
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

  const sizeClasses = size === 'small'
    ? 'text-[10px] p-0.5'
    : 'text-xs sm:text-sm p-1.5'

  return (
    <div
      className={`
        relative flex items-center justify-center rounded-lg border transition-all select-none
        ${sizeClasses}
        ${bg}
        ${isCenter ? 'border-blue-400 border-2 font-semibold shadow-md' : 'border-gray-300 shadow-sm'}
        ${isDisabled ? 'opacity-30 cursor-not-allowed' : 'cursor-pointer hover:shadow-md hover:border-gray-400 active:scale-95'}
        ${isCut ? 'opacity-40' : ''}
      `}
      onClick={handleClick}
      onContextMenu={onContextMenu ? (e) => { e.preventDefault(); onContextMenu(e, cell) } : undefined}
      draggable={!isDisabled && onDragStart != null}
      onDragStart={() => onDragStart?.(cell)}
      onDragOver={(e) => { e.preventDefault() }}
      onDrop={() => onDrop?.(cell)}
    >
      {/* 画像 */}
      {cell.image_path && (
        <div className="absolute inset-0 rounded-lg overflow-hidden">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={`/api/image?path=${encodeURIComponent(cell.image_path)}`} alt="" className="w-full h-full object-cover opacity-60" />
        </div>
      )}

      <span className={`relative z-10 text-center leading-tight break-all line-clamp-3 ${textColor}`}>
        {cell.text}
      </span>

      {/* 子グリッドがある場合のインジケーター */}
      {childCount > 0 && (
        <span className="absolute bottom-0.5 right-0.5 w-1.5 h-1.5 bg-blue-400 rounded-full" />
      )}
    </div>
  )
}
