
import { useEffect, useState } from 'react'
import { getStockItems, deleteStockItem } from '@/lib/api/stock'
import { CONFIRM_AUTO_RESET_MS } from '@/constants/timing'
import Button from '@/components/ui/Button'
import type { StockItem } from '@/types'

type Props = {
  onPaste: (item: StockItem) => void
  reloadKey?: number
  onItemDragStart?: (itemId: string) => void
  dragSourceId?: string | null
}

const DRAG_THRESHOLD = 5

export default function StockTab({
  onPaste, reloadKey, onItemDragStart, dragSourceId,
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
    <div className="flex flex-col h-full gap-2">
      {/* ストック追加導線は D&D 中の DragActionPanel (Copy アイコン) に集約済 (旧 data-stock-drop は廃止) */}

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
        {loading && <div className="text-xs text-neutral-400 py-4 text-center">読み込み中...</div>}

        {!loading && items.length === 0 && (
          <div className="text-xs text-neutral-400 py-4 text-center">
            <p>ストックは空です</p>
          </div>
        )}

        {/* 親 (SidePanel 内幅) を 3 等分してタイルを敷き詰める。
            タイルは aspect-square で正方形を維持しつつ、横幅は親に対する 1/3 の相対値となる。
            これにより SidePanel 内幅が変わっても余白なくフィットし、メモ編集 / プレビュー /
            ストックの 3 タブで描画幅が揃う。 */}
        <div className="grid gap-2 grid-cols-3">
          {items.map((item) => {
            const isSourceDragging = dragSourceId === `stock:${item.id}`
            const text = item.snapshot.cell.text || '（テキストなし）'
            return (
              <div
                key={item.id}
                onMouseDown={(e) => handleItemMouseDown(e, item.id)}
                className={`
                  relative w-full aspect-square bg-white dark:bg-neutral-900
                  border-2 border-black dark:border-white rounded-xl
                  shadow-sm hover:shadow-md transition-shadow
                  cursor-grab active:cursor-grabbing select-none
                  group overflow-hidden
                  ${isSourceDragging ? 'opacity-40' : ''}
                `}
                title={text}
              >
                <div
                  className="w-full h-full flex items-start justify-start p-2 text-left break-all leading-tight text-neutral-800 dark:text-neutral-100 font-medium"
                  style={{ fontSize: 10 }}
                >
                  <span className="block w-full line-clamp-5 whitespace-pre-wrap">
                    {text}
                  </span>
                </div>

                {/* 作成日: hover 時のみ下部 */}
                <div className="absolute bottom-0.5 left-1 right-1 text-[8px] text-neutral-400 dark:text-neutral-500 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none text-center">
                  {new Date(item.created_at).toLocaleDateString('ja-JP')}
                </div>

                {/* アクション: hover 時に右上 */}
                <div className="absolute top-0.5 right-0.5 flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button
                    onClick={(e) => { e.stopPropagation(); onPaste(item) }}
                    onMouseDown={(e) => e.stopPropagation()}
                    className="w-4 h-4 rounded bg-white/90 dark:bg-neutral-800/90 border border-neutral-200 dark:border-neutral-700 text-[8px] text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-200 flex items-center justify-center"
                    title="貼付"
                  >
                    ↓
                  </button>
                  <button
                    onClick={(e) => { e.stopPropagation(); handleDelete(item.id) }}
                    onMouseDown={(e) => e.stopPropagation()}
                    className="w-4 h-4 rounded bg-white/90 dark:bg-neutral-800/90 border border-neutral-200 dark:border-neutral-700 text-[8px] text-red-500 hover:text-red-700 dark:hover:text-red-300 flex items-center justify-center"
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
