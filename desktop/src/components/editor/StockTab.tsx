
import { useEffect, useState } from 'react'
import { getStockItems, deleteStockItem } from '@/lib/api/stock'
import type { StockItem } from '@/types'
import Button from '@/components/ui/Button'

type Props = {
  onPaste: (item: StockItem) => void
}

export default function StockTab({ onPaste }: Props) {
  const [items, setItems] = useState<StockItem[]>([])
  const [loading, setLoading] = useState(true)

  async function load() {
    setLoading(true)
    const data = await getStockItems()
    setItems(data)
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  async function handleDelete(id: string) {
    await deleteStockItem(id)
    setItems((prev) => prev.filter((i) => i.id !== id))
  }

  if (loading) return <div className="text-xs text-gray-400 py-4 text-center">読み込み中...</div>

  if (items.length === 0) {
    return (
      <div className="text-xs text-gray-400 py-6 text-center">
        <p>ストックは空です</p>
        <p className="mt-1">セルを右クリックして「ストックに追加」できます</p>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-2 overflow-y-auto">
      {items.map((item) => (
        <div
          key={item.id}
          className="border border-gray-200 rounded-xl p-3 flex items-start gap-2 group"
          draggable
          onDragStart={(e) => e.dataTransfer.setData('stockItemId', item.id)}
        >
          {/* ミニプレビュー */}
          <div className="grid grid-cols-3 gap-0.5 w-10 h-10 shrink-0">
            {Array.from({ length: 9 }).map((_, i) => (
              <div key={i} className={`rounded-sm ${i === 4 ? 'bg-blue-100' : 'bg-gray-100'}`} />
            ))}
          </div>

          <div className="flex-1 min-w-0">
            <p className="text-xs font-medium truncate">{item.snapshot.cell.text || '（テキストなし）'}</p>
            <p className="text-xs text-gray-400 mt-0.5">
              {new Date(item.created_at).toLocaleDateString('ja-JP')}
            </p>
          </div>

          <div className="flex flex-col gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
            <Button size="sm" variant="secondary" onClick={() => onPaste(item)}>
              貼付
            </Button>
            <Button size="sm" variant="danger" onClick={() => handleDelete(item.id)}>
              削除
            </Button>
          </div>
        </div>
      ))}
    </div>
  )
}
