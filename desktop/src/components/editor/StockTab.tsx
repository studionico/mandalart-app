
import { useEffect, useState } from 'react'
import { getStockItems, deleteStockItem } from '@/lib/api/stock'
import { GRID_CELL_COUNT } from '@/constants/grid'
import type { StockItem } from '@/types'
import Button from '@/components/ui/Button'

type Props = {
  onPaste: (item: StockItem) => void
  isOverStock?: boolean
  reloadKey?: number
  onItemDragStart?: (itemId: string) => void
  dragSourceId?: string | null
}

const DRAG_THRESHOLD = 5

export default function StockTab({
  onPaste, isOverStock, reloadKey, onItemDragStart, dragSourceId,
}: Props) {
  const [items, setItems] = useState<StockItem[]>([])
  const [loading, setLoading] = useState(true)

  async function load() {
    setLoading(true)
    const data = await getStockItems()
    setItems(data)
    setLoading(false)
  }

  useEffect(() => { load() }, [reloadKey])

  async function handleDelete(id: string) {
    await deleteStockItem(id)
    setItems((prev) => prev.filter((i) => i.id !== id))
  }

  function handleItemMouseDown(e: React.MouseEvent, itemId: string) {
    if (e.button !== 0) return
    // ボタン上でのクリックはドラッグ開始しない
    const targetTag = (e.target as HTMLElement).tagName
    if (targetTag === 'BUTTON' || (e.target as HTMLElement).closest('button')) return

    const startX = e.clientX
    const startY = e.clientY

    function onMove(e2: MouseEvent) {
      const dx = e2.clientX - startX
      const dy = e2.clientY - startY
      if (Math.sqrt(dx * dx + dy * dy) > DRAG_THRESHOLD) {
        document.removeEventListener('mousemove', onMove)
        document.removeEventListener('mouseup', onUp)
        onItemDragStart?.(itemId)
      }
    }
    function onUp() {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }

  return (
    <div data-stock-drop="true" className="flex flex-col h-full gap-2">
      {/* ドロップゾーン */}
      <div
        className={`
          shrink-0 border-2 border-dashed rounded-xl py-3 text-xs text-center transition-colors select-none
          ${isOverStock
            ? 'border-blue-400 bg-blue-50 text-blue-600'
            : 'border-gray-200 text-gray-400 hover:border-gray-300'}
        `}
      >
        {isOverStock ? 'ここにドロップ' : 'セルをドラッグしてストックに追加'}
      </div>

      {/* アイテム一覧 */}
      <div className="flex-1 flex flex-col gap-2 overflow-y-auto">
        {loading && <div className="text-xs text-gray-400 py-4 text-center">読み込み中...</div>}

        {!loading && items.length === 0 && (
          <div className="text-xs text-gray-400 py-4 text-center">
            <p>ストックは空です</p>
          </div>
        )}

        {items.map((item) => {
          const isSourceDragging = dragSourceId === `stock:${item.id}`
          return (
            <div
              key={item.id}
              onMouseDown={(e) => handleItemMouseDown(e, item.id)}
              className={`
                border border-gray-200 rounded-xl p-3 group cursor-grab select-none overflow-hidden
                hover:border-gray-300 active:cursor-grabbing
                ${isSourceDragging ? 'opacity-40' : ''}
              `}
            >
              <div className="flex items-start gap-2">
                {/* ミニプレビュー */}
                <div className="grid grid-cols-3 gap-0.5 w-10 h-10 shrink-0">
                  {Array.from({ length: GRID_CELL_COUNT }).map((_, i) => (
                    <div key={i} className={`rounded-sm ${i === 4 ? 'bg-blue-100' : 'bg-gray-100'}`} />
                  ))}
                </div>

                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium truncate">{item.snapshot.cell.text || '（テキストなし）'}</p>
                  <p className="text-xs text-gray-400 mt-0.5">
                    {new Date(item.created_at).toLocaleDateString('ja-JP')}
                  </p>
                </div>
              </div>

              <div className="flex gap-1 mt-2 opacity-0 group-hover:opacity-100 transition-opacity">
                <Button size="sm" variant="secondary" onClick={() => onPaste(item)}>
                  貼付
                </Button>
                <Button size="sm" variant="danger" onClick={() => handleDelete(item.id)}>
                  削除
                </Button>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
