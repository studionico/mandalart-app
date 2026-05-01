
import { useEffect, useState } from 'react'
import { getStockItems, deleteStockItem } from '@/lib/api/stock'
import { CONFIRM_AUTO_RESET_MS, CONVERGE_DURATION_MS } from '@/constants/timing'
import Button from '@/components/ui/Button'
import { CardLikeText } from '@/components/CardLikeText'
import { useCellImageUrl } from '@/hooks/useCellImageUrl'
import { useConvergeStore } from '@/store/convergeStore'
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
  // direction='stock' の収束アニメ着地点を判定するための購読。targetId === item.id のエントリは
  // morph 期間中 opacity 0 で隠し、終端の 1ms snap で可視化する (open / home と同じ pattern)。
  const convergeDirection = useConvergeStore((s) => s.direction)
  const convergeTargetId = useConvergeStore((s) => s.targetId)
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
          {items.map((item) => (
            <StockEntry
              key={item.id}
              item={item}
              isSourceDragging={dragSourceId === `stock:${item.id}`}
              isConvergeTarget={convergeDirection === 'stock' && convergeTargetId === item.id}
              onMouseDown={handleItemMouseDown}
              onPaste={onPaste}
              onDelete={handleDelete}
            />
          ))}
        </div>
      </div>
    </div>
  )
}

/**
 * 1 件のストックエントリ。スナップショットの `image_path` が存在し text が空の場合は画像を、
 * それ以外は text を描画する。画像ロードは `getCachedCellImageUrl` の同期ルックアップ +
 * `useEffect` の async 解決の組合せで MandalartCard と同じ「remount 時 1 frame 目から画像表示」を担保。
 */
function StockEntry({
  item, isSourceDragging, isConvergeTarget, onMouseDown, onPaste, onDelete,
}: {
  item: StockItem
  isSourceDragging: boolean
  isConvergeTarget: boolean
  onMouseDown: (e: React.MouseEvent, itemId: string) => void
  onPaste: (item: StockItem) => void
  onDelete: (id: string) => void
}) {
  const text = item.snapshot.cell.text
  const imagePath = item.snapshot.cell.image_path
  // 画像優先表示の判定: 中心セル相当の取扱い (テキスト空 + image_path あり) でのみ画像表示
  const showImage = !text && !!imagePath
  // 共通フックで同期キャッシュ初期値 + async fallback による remount 1 frame 目描画 (落とし穴 #18)
  const imageUrl = useCellImageUrl(showImage ? imagePath : null)

  const displayText = text || '（テキストなし）'
  const titleAttr = text || (showImage ? '画像' : '（テキストなし）')

  return (
    <div
      // ConvergeOverlay の polling target (direction='stock')。エディタ内セル / ダッシュボードカード →
      // ストック収束の着地点。
      data-converge-stock={item.id}
      onMouseDown={(e) => onMouseDown(e, item.id)}
      className={`
        relative w-full aspect-square bg-white dark:bg-neutral-900
        border-2 border-black dark:border-white rounded-xl
        shadow-sm hover:shadow-md transition-shadow
        cursor-grab active:cursor-grabbing select-none
        group overflow-hidden
        ${isSourceDragging ? 'opacity-40' : ''}
      `}
      style={
        isConvergeTarget
          ? {
              // morph 中 (CONVERGE_DURATION_MS) は opacity 0 で隠し、終端で 1ms snap →
              // overlay の clear と同フレームで可視化 (home / open ターゲットと同じ pattern)
              animation: `orbit-fade-in 1ms ease-out ${CONVERGE_DURATION_MS}ms both`,
              willChange: 'opacity',
            }
          : undefined
      }
      title={titleAttr}
    >
      {showImage && imageUrl ? (
        // HTML5 native drag 抑止は index.css の global `img` rule で一括対応 (落とし穴 #1)。
        <img src={imageUrl} alt="" className="absolute inset-0 w-full h-full object-cover" />
      ) : (
        // 共通 <CardLikeText>: ConvergeOverlay polling 互換構造を統一
        <CardLikeText text={displayText} fontPx={10} sideInsetPx={6} />
      )}

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
          onClick={(e) => { e.stopPropagation(); onDelete(item.id) }}
          onMouseDown={(e) => e.stopPropagation()}
          className="w-4 h-4 rounded bg-white/90 dark:bg-neutral-800/90 border border-neutral-200 dark:border-neutral-700 text-[8px] text-red-500 hover:text-red-700 dark:hover:text-red-300 flex items-center justify-center"
          title="削除"
        >
          ✕
        </button>
      </div>
    </div>
  )
}
