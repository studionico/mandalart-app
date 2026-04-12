'use client'

import { useState } from 'react'
import MemoTab from './MemoTab'
import StockTab from './StockTab'
import type { StockItem } from '@/types'

type Tab = 'memo' | 'stock'

type Props = {
  gridId: string | null
  gridMemo: string | null
  onStockPaste: (item: StockItem) => void
}

export default function SidePanel({ gridId, gridMemo, onStockPaste }: Props) {
  const [tab, setTab] = useState<Tab>('memo')

  return (
    <div className="flex flex-col h-full border-l border-gray-200 bg-white">
      {/* タブ */}
      <div className="flex border-b border-gray-200">
        {(['memo', 'stock'] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`flex-1 py-2.5 text-xs font-medium transition-colors ${
              tab === t ? 'text-blue-600 border-b-2 border-blue-600' : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            {t === 'memo' ? 'メモ' : 'ストック'}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-hidden p-3">
        {tab === 'memo' ? (
          <MemoTab gridId={gridId} initialMemo={gridMemo} />
        ) : (
          <StockTab onPaste={onStockPaste} />
        )}
      </div>
    </div>
  )
}
