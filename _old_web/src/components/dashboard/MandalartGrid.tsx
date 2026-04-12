'use client'

import { useState } from 'react'
import type { Mandalart, Cell } from '@/types'
import MandalartCard from './MandalartCard'

type Props = {
  initialMandalarts: (Mandalart & { previewCells: Cell[] })[]
}

export default function MandalartGrid({ initialMandalarts }: Props) {
  const [list, setList] = useState(initialMandalarts)

  function handleDeleted(id: string) {
    setList((prev) => prev.filter((m) => m.id !== id))
  }

  function handleUpdated(updated: Mandalart) {
    setList((prev) => prev.map((m) => m.id === updated.id ? { ...m, ...updated } : m))
  }

  if (list.length === 0) {
    return (
      <div className="text-center py-20 text-gray-400">
        <p className="text-lg">まだマンダラートがありません</p>
        <p className="text-sm mt-1">「+ 新規作成」から始めましょう</p>
      </div>
    )
  }

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
      {list.map((m) => (
        <MandalartCard
          key={m.id}
          mandalart={m}
          previewCells={m.previewCells}
          onDeleted={handleDeleted}
          onUpdated={handleUpdated}
        />
      ))}
    </div>
  )
}
