'use client'

import { useState, useEffect, useCallback } from 'react'
import { updateGridMemo } from '@/lib/api/grids'

type Props = {
  gridId: string | null
  initialMemo: string | null
}

export default function MemoTab({ gridId, initialMemo }: Props) {
  const [memo, setMemo] = useState(initialMemo ?? '')
  const [preview, setPreview] = useState(false)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    setMemo(initialMemo ?? '')
  }, [gridId, initialMemo])

  const save = useCallback(
    async (value: string) => {
      if (!gridId) return
      setSaving(true)
      try {
        await updateGridMemo(gridId, value)
      } finally {
        setSaving(false)
      }
    },
    [gridId],
  )

  // debounce 保存
  useEffect(() => {
    if (!gridId) return
    const timer = setTimeout(() => save(memo), 800)
    return () => clearTimeout(timer)
  }, [memo, save, gridId])

  return (
    <div className="flex flex-col h-full gap-2">
      <div className="flex items-center justify-between">
        <div className="flex gap-1">
          <button
            onClick={() => setPreview(false)}
            className={`text-xs px-2 py-1 rounded-md transition-colors ${!preview ? 'bg-gray-200 font-medium' : 'hover:bg-gray-100 text-gray-500'}`}
          >
            編集
          </button>
          <button
            onClick={() => setPreview(true)}
            className={`text-xs px-2 py-1 rounded-md transition-colors ${preview ? 'bg-gray-200 font-medium' : 'hover:bg-gray-100 text-gray-500'}`}
          >
            プレビュー
          </button>
        </div>
        {saving && <span className="text-xs text-gray-400">保存中...</span>}
      </div>

      {preview ? (
        <div
          className="prose prose-sm flex-1 overflow-y-auto"
          dangerouslySetInnerHTML={{ __html: renderMarkdown(memo) }}
        />
      ) : (
        <textarea
          value={memo}
          onChange={(e) => setMemo(e.target.value)}
          placeholder="Markdown でメモを書く..."
          className="flex-1 text-sm resize-none border border-gray-200 rounded-lg p-2 focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono"
        />
      )}
    </div>
  )
}

// 簡易 Markdown レンダラー（最小限）
function renderMarkdown(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/^### (.+)$/gm, '<h3 class="text-sm font-semibold mt-2">$1</h3>')
    .replace(/^## (.+)$/gm, '<h2 class="text-base font-semibold mt-3">$1</h2>')
    .replace(/^# (.+)$/gm, '<h1 class="text-lg font-bold mt-4">$1</h1>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/^- (.+)$/gm, '<li class="ml-4 list-disc">$1</li>')
    .replace(/\n/g, '<br/>')
}
