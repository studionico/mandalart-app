
import { useEffect, useRef, useState } from 'react'
import { getStockItems, deleteStockItem } from '@/lib/api/stock'
import { CONFIRM_AUTO_RESET_MS } from '@/constants/timing'
import Button from '@/components/ui/Button'
import type { StockItem, CellSnapshot } from '@/types'

type Props = {
  onPaste: (item: StockItem) => void
  isOverStock?: boolean
  reloadKey?: number
  onItemDragStart?: (
    itemId: string,
    snapshot: CellSnapshot | null,
    meta: { rect: DOMRect; x: number; y: number; element: HTMLElement },
  ) => void
  dragSourceId?: string | null
}

const DRAG_THRESHOLD = 5

export default function StockTab({
  onPaste, isOverStock, reloadKey, onItemDragStart, dragSourceId,
}: Props) {
  const [items, setItems] = useState<StockItem[]>([])
  const [loading, setLoading] = useState(true)
  // Tauri v2 の WebView は window.confirm が動作しないため、一括削除は 2 クリック方式。
  // 1 回目でボタン表記を切替え、2 回目で実行。CONFIRM_AUTO_RESET_MS 放置で自動解除。
  const [confirmingAll, setConfirmingAll] = useState(false)
  const [busy, setBusy] = useState(false)

  async function load() {
    setLoading(true)
    const data = await getStockItems()
    setItems(data)
    setLoading(false)
  }

  useEffect(() => { load() }, [reloadKey])

  // confirm 状態は CONFIRM_AUTO_RESET_MS で自動解除
  useEffect(() => {
    if (!confirmingAll) return
    const t = setTimeout(() => setConfirmingAll(false), CONFIRM_AUTO_RESET_MS)
    return () => clearTimeout(t)
  }, [confirmingAll])

  async function handleDelete(id: string) {
    await deleteStockItem(id)
    setItems((prev) => prev.filter((i) => i.id !== id))
  }

  async function handleDeleteAll() {
    // 1 回目: confirm 状態へ
    if (!confirmingAll) {
      setConfirmingAll(true)
      return
    }
    // 2 回目: 全件削除
    setBusy(true)
    const targets = [...items]
    setItems([]) // 楽観的 UI
    try {
      const results = await Promise.allSettled(
        targets.map((it) => deleteStockItem(it.id)),
      )
      const failed = results.filter((r) => r.status === 'rejected')
      if (failed.length > 0) {
        console.warn(`[stock] ${failed.length} 件の削除が失敗しました`)
        await load()
      }
    } finally {
      setBusy(false)
      setConfirmingAll(false)
    }
  }

  // 各 stock item の DOM を参照するための ref マップ (ドラッグ開始時の rect 取得用)
  const itemRefs = useRef<Map<string, HTMLElement>>(new Map())

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
        const el = itemRefs.current.get(itemId)
        const rect = el?.getBoundingClientRect()
        const item = items.find((it) => it.id === itemId)
        if (rect && el) {
          onItemDragStart?.(itemId, item?.snapshot ?? null, { rect, x: e2.clientX, y: e2.clientY, element: el })
        }
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

      {/* すべて削除ボタン (件数付き、2 クリック確認) */}
      {!loading && items.length > 0 && (
        <div className="shrink-0 flex justify-end">
          <Button
            variant="danger"
            size="sm"
            onClick={handleDeleteAll}
            disabled={busy}
            title={confirmingAll ? 'もう一度押すとすべて削除されます' : 'ストックをすべて削除'}
          >
            {confirmingAll
              ? `本当に全削除? (${items.length}件)`
              : `すべて削除 (${items.length}件)`}
          </Button>
        </div>
      )}

      {/* アイテム一覧 — ダッシュボードと同形式の正方形タイル */}
      <div className="flex-1 overflow-y-auto">
        {loading && <div className="text-xs text-gray-400 py-4 text-center">読み込み中...</div>}

        {!loading && items.length === 0 && (
          <div className="text-xs text-gray-400 py-4 text-center">
            <p>ストックは空です</p>
          </div>
        )}

        <div className="grid gap-2 grid-cols-[repeat(auto-fill,80px)] justify-center">
          {items.map((item) => {
            const isSourceDragging = dragSourceId === `stock:${item.id}`
            const text = item.snapshot.cell.text || '（テキストなし）'
            return (
              <div
                key={item.id}
                ref={(el) => {
                  if (el) itemRefs.current.set(item.id, el)
                  else itemRefs.current.delete(item.id)
                }}
                onMouseDown={(e) => handleItemMouseDown(e, item.id)}
                className={`
                  relative w-[80px] h-[80px] bg-white dark:bg-gray-900
                  border-2 border-black dark:border-white rounded-xl
                  shadow-sm hover:shadow-md transition-shadow
                  cursor-grab active:cursor-grabbing select-none
                  group overflow-hidden
                `}
                style={isSourceDragging ? { visibility: 'hidden' } : undefined}
                title={text}
              >
                <div
                  className="w-full h-full flex items-start justify-start p-2 text-left break-all leading-tight text-gray-800 dark:text-gray-100 font-medium"
                  style={{ fontSize: 10 }}
                >
                  <span className="block w-full line-clamp-5 whitespace-pre-wrap">
                    {text}
                  </span>
                </div>

                {/* 作成日: hover 時のみ下部 */}
                <div className="absolute bottom-0.5 left-1 right-1 text-[8px] text-gray-400 dark:text-gray-500 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none text-center">
                  {new Date(item.created_at).toLocaleDateString('ja-JP')}
                </div>

                {/* アクション: hover 時に右上 */}
                <div className="absolute top-0.5 right-0.5 flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button
                    onClick={(e) => { e.stopPropagation(); onPaste(item) }}
                    onMouseDown={(e) => e.stopPropagation()}
                    className="w-4 h-4 rounded bg-white/90 dark:bg-gray-800/90 border border-gray-200 dark:border-gray-700 text-[8px] text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-200 flex items-center justify-center"
                    title="貼付"
                  >
                    ↓
                  </button>
                  <button
                    onClick={(e) => { e.stopPropagation(); handleDelete(item.id) }}
                    onMouseDown={(e) => e.stopPropagation()}
                    className="w-4 h-4 rounded bg-white/90 dark:bg-gray-800/90 border border-gray-200 dark:border-gray-700 text-[8px] text-red-500 hover:text-red-700 dark:hover:text-red-300 flex items-center justify-center"
                    title="削除"
                  >
                    ✕
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
