import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  getMandalarts, createMandalart, deleteMandalart, updateMandalartTitle, duplicateMandalart,
} from '@/lib/api/mandalarts'
import { createGrid } from '@/lib/api/grids'
import type { Mandalart } from '@/types'

type SortKey = 'updated' | 'title'

export default function DashboardPage() {
  const navigate = useNavigate()
  const [mandalarts, setMandalarts] = useState<Mandalart[]>([])
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState('')
  const [sortKey, setSortKey] = useState<SortKey>('updated')

  async function load() {
    setMandalarts(await getMandalarts())
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  async function handleCreate() {
    try {
      const m = await createMandalart()
      const grid = await createGrid({ mandalartId: m.id, parentCellId: null, sortOrder: 0 })
      void grid
      navigate(`/mandalart/${m.id}`)
    } catch (e) {
      alert('エラー: ' + String(e))
      console.error(e)
    }
  }

  async function handleDelete(id: string) {
    try {
      await deleteMandalart(id)
      setMandalarts((prev) => prev.filter((m) => m.id !== id))
    } catch (e) {
      alert('削除に失敗しました: ' + String(e))
      console.error('deleteMandalart failed:', e)
    }
  }

  async function handleRename(m: Mandalart) {
    const title = window.prompt('タイトルを入力', m.title)
    if (title === null) return
    await updateMandalartTitle(m.id, title)
    setMandalarts((prev) => prev.map((x) => x.id === m.id ? { ...x, title } : x))
  }

  async function handleDuplicate(m: Mandalart) {
    try {
      const copy = await duplicateMandalart(m.id)
      setMandalarts((prev) => [copy, ...prev])
    } catch (e) {
      alert('複製に失敗しました: ' + String(e))
    }
  }

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    const filtered = q
      ? mandalarts.filter((m) => (m.title || '').toLowerCase().includes(q))
      : mandalarts
    const sorted = [...filtered].sort((a, b) => {
      if (sortKey === 'title') {
        return (a.title || '無題').localeCompare(b.title || '無題', 'ja')
      }
      return b.updated_at.localeCompare(a.updated_at)
    })
    return sorted
  }, [mandalarts, query, sortKey])

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between gap-4">
        <h1 className="text-lg font-bold shrink-0">マンダラート</h1>

        <div className="flex-1 flex items-center gap-2 max-w-xl">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="タイトルで検索..."
            className="flex-1 text-sm border border-gray-200 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <select
            value={sortKey}
            onChange={(e) => setSortKey(e.target.value as SortKey)}
            className="text-sm border border-gray-200 rounded-lg px-2 py-1.5 bg-white"
          >
            <option value="updated">更新日順</option>
            <option value="title">タイトル順</option>
          </select>
        </div>

        <button
          onClick={handleCreate}
          className="bg-blue-600 text-white text-sm font-medium px-4 py-2 rounded-lg hover:bg-blue-700 transition-colors shrink-0"
        >
          + 新規作成
        </button>
      </header>

      <main className="max-w-5xl mx-auto px-6 py-8">
        {loading ? (
          <p className="text-gray-400">読み込み中...</p>
        ) : mandalarts.length === 0 ? (
          <div className="text-center py-20 text-gray-400">
            <p className="text-lg mb-2">まだマンダラートがありません</p>
            <p className="text-sm">「+ 新規作成」から始めましょう</p>
          </div>
        ) : visible.length === 0 ? (
          <div className="text-center py-20 text-gray-400">
            <p className="text-sm">「{query}」に一致するマンダラートはありません</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
            {visible.map((m) => (
              <div
                key={m.id}
                className="bg-white border border-gray-200 rounded-xl p-4 hover:shadow-md transition-shadow cursor-pointer group"
                onClick={() => navigate(`/mandalart/${m.id}`)}
              >
                <div className="aspect-square bg-gray-100 rounded-lg mb-3 grid grid-cols-3 gap-0.5 p-1.5">
                  {Array.from({ length: 9 }).map((_, i) => (
                    <div key={i} className={`rounded-sm ${i === 4 ? 'bg-blue-200' : 'bg-white border border-gray-200'}`} />
                  ))}
                </div>
                <p className="text-sm font-medium text-gray-800 truncate">{m.title || '無題'}</p>
                <p className="text-xs text-gray-400 mt-0.5">
                  {new Date(m.updated_at).toLocaleDateString('ja-JP')}
                </p>
                <div className="flex gap-2 mt-2 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button
                    onClick={(e) => { e.stopPropagation(); handleRename(m) }}
                    className="text-xs text-gray-500 hover:text-gray-700"
                  >
                    リネーム
                  </button>
                  <button
                    onClick={(e) => { e.stopPropagation(); handleDuplicate(m) }}
                    className="text-xs text-gray-500 hover:text-gray-700"
                  >
                    複製
                  </button>
                  <button
                    onClick={(e) => { e.stopPropagation(); handleDelete(m.id) }}
                    className="text-xs text-red-400 hover:text-red-600"
                  >
                    削除
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  )
}
