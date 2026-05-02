import { useEffect, useState } from 'react'
import MemoTab from './MemoTab'
import StockTab from './StockTab'
import DragActionPanel, { type ActionDropType } from './DragActionPanel'
import { useConvergeStore } from '@/store/convergeStore'
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
  onStockItemDragStart?: (itemId: string, e: React.DragEvent) => void
  onStockDragEnd?: () => void
  /** DragActionPanel の各タイル用 drop handlers ファクトリー */
  getActionDropProps?: (action: ActionDropType) => {
    onDragEnter: (e: React.DragEvent) => void
    onDragOver: (e: React.DragEvent) => void
    onDragLeave: (e: React.DragEvent) => void
    onDrop: (e: React.DragEvent) => void
  }
  dragSourceId?: string | null
}

/**
 * 右サイドパネル。通常はメモ / ストックタブを切替表示する。
 *
 * **エディタ内セル**を drag 中はメモ / ストックを非表示にして `DragActionPanel`
 * (シュレッダー/移動/コピー/エクスポートの 4 アクションアイコン) をオーバーレイ表示する
 * (アイコンが drop target を担う)。ただし **ストックエントリ**を drag した場合は 4 アイコンに
 * drop する意味がないので、判定を分岐して通常タブ表示を維持する。
 */
export default function SidePanel({
  gridId, gridMemo, onStockPaste, isDragging, hoveredAction, stockReloadKey,
  onStockItemDragStart, onStockDragEnd, getActionDropProps, dragSourceId,
}: Props) {
  const [tab, setTab] = useState<Tab>('memo')

  // stock 起源 drag (`dragSourceId` が "stock:" prefix) は 4 アイコンの drop 対象にならないので
  // DragActionPanel を出さず、メモ/ストックタブをそのまま表示する。
  // セル起源 drag のみ既存挙動 (タブ非表示 + DragActionPanel オーバーレイ) を踏襲。
  const isDraggingCellToActions = !!isDragging && !dragSourceId?.startsWith('stock:')

  // copy/move ドロップで `direction='stock'` がセットされたら自動的にストックタブへ切替える。
  // 着地点 (`[data-converge-stock="<id>"]`) は StockTab がマウントされていないと DOM に存在しないため、
  // メモタブのままだと ConvergeOverlay の polling がタイムアウトしてアニメが再生されない。
  // direction='stock' の間にタブを切替えれば、StockTab が render → 新エントリ DOM が出現 → polling 成功。
  // 完了後 (direction が null に戻る) もタブはストックのまま (= ユーザーが格納先を確認できる)。
  const convergeDirection = useConvergeStore((s) => s.direction)
  useEffect(() => {
    if (convergeDirection === 'stock') setTab('stock')
  }, [convergeDirection])

  return (
    // w-full で親 (w-72) に張り付かせ、min-w-0 + overflow-hidden で内部コンテンツの
    // intrinsic 幅 (長 URL / pre block 等) が外側に伝播しないようにする
    <div className="flex flex-col h-full w-full min-w-0 overflow-hidden border-l border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900">
      {/* タブ (ドラッグ中は隠す) */}
      <div className={`flex border-b border-neutral-200 dark:border-neutral-800 ${isDraggingCellToActions ? 'invisible' : ''}`}>
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
        {/* セル → 4 アイコンへの drag 中のみオーバーレイ表示。stock drag は除外 */}
        {isDraggingCellToActions && (
          <div className="absolute inset-0 z-10 bg-white dark:bg-neutral-900 p-3">
            <DragActionPanel
              hoveredAction={hoveredAction}
              getActionDropProps={getActionDropProps}
            />
          </div>
        )}
        {/* memo / stock タブの DOM は state を保持するため display:none で隠すだけ */}
        <div className={`h-full ${isDraggingCellToActions ? 'invisible' : ''}`}>
          {tab === 'memo' ? (
            <MemoTab gridId={gridId} initialMemo={gridMemo} />
          ) : (
            <StockTab
              onPaste={onStockPaste}
              reloadKey={stockReloadKey}
              onItemDragStart={onStockItemDragStart}
              onDragEnd={onStockDragEnd}
              dragSourceId={dragSourceId}
            />
          )}
        </div>
      </div>
    </div>
  )
}
