import { useState } from 'react'
import MemoTab from './MemoTab'
import StockTab from './StockTab'
import DragActionPanel, { type ActionDropType } from './DragActionPanel'
import type { StockItem } from '@/types'

type Tab = 'memo' | 'stock'

type Props = {
  gridId: string | null
  gridMemo: string | null
  onStockPaste: (item: StockItem) => void
  isDragging?: boolean
  /** D&D 中にホバー中のアクションアイコン (DragActionPanel のハイライト用) */
  hoveredAction?: ActionDropType | null
  stockReloadKey?: number
  onStockItemDragStart?: (itemId: string) => void
  dragSourceId?: string | null
}

/**
 * 右サイドパネル。通常はメモ / ストックタブを切替表示する。
 *
 * D&D 進行中 (isDragging) はメモ / ストックを非表示にして、`DragActionPanel` (4 アクションアイコン) を
 * 大きく表示する。アイコンが drop target を担うため、ストック自動切替は行わない。
 */
export default function SidePanel({
  gridId, gridMemo, onStockPaste, isDragging, hoveredAction, stockReloadKey,
  onStockItemDragStart, dragSourceId,
}: Props) {
  const [tab, setTab] = useState<Tab>('memo')

  return (
    // w-full で親 (w-72) に張り付かせ、min-w-0 + overflow-hidden で内部コンテンツの
    // intrinsic 幅 (長 URL / pre block 等) が外側に伝播しないようにする
    <div className="flex flex-col h-full w-full min-w-0 overflow-hidden border-l border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900">
      {/* タブ (ドラッグ中は隠す) */}
      <div className={`flex border-b border-neutral-200 dark:border-neutral-800 ${isDragging ? 'invisible' : ''}`}>
        {(['memo', 'stock'] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`flex-1 py-2.5 text-xs font-medium transition-colors ${
              tab === t ? 'text-blue-600 dark:text-blue-400 border-b-2 border-blue-600 dark:border-blue-400' : 'text-neutral-500 dark:text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200'
            }`}
          >
            {t === 'memo' ? 'メモ' : 'ストック'}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-hidden p-3 relative">
        {/* ドラッグ中: 4 アクションアイコンを overlay で表示 */}
        {isDragging && (
          <div className="absolute inset-0 z-10 bg-white dark:bg-neutral-900 p-3">
            <DragActionPanel hoveredAction={hoveredAction} />
          </div>
        )}
        {/* memo / stock タブの DOM は state を保持するため display:none で隠すだけ */}
        <div className={`h-full ${isDragging ? 'invisible' : ''}`}>
          {tab === 'memo' ? (
            <MemoTab gridId={gridId} initialMemo={gridMemo} />
          ) : (
            <StockTab
              onPaste={onStockPaste}
              reloadKey={stockReloadKey}
              onItemDragStart={onStockItemDragStart}
              dragSourceId={dragSourceId}
            />
          )}
        </div>
      </div>
    </div>
  )
}
