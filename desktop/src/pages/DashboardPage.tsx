import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  getMandalarts, createMandalart, deleteMandalart, updateMandalartTitle, duplicateMandalart,
  searchMandalarts,
} from '@/lib/api/mandalarts'
import { createGrid } from '@/lib/api/grids'
import { signOut } from '@/lib/api/auth'
import ImportDialog from '@/components/editor/ImportDialog'
import AuthDialog from '@/components/AuthDialog'
import TrashDialog from '@/components/dashboard/TrashDialog'
import ThemeToggle from '@/components/ThemeToggle'
import { useAuthStore } from '@/store/authStore'
import { useSync } from '@/hooks/useSync'
import type { Mandalart } from '@/types'

type SortKey = 'updated' | 'title'

export default function DashboardPage() {
  const navigate = useNavigate()
  const [mandalarts, setMandalarts] = useState<Mandalart[]>([])
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState('')
  const [sortKey, setSortKey] = useState<SortKey>('updated')
  const [importOpen, setImportOpen] = useState(false)
  const [authOpen, setAuthOpen] = useState(false)
  const [trashOpen, setTrashOpen] = useState(false)

  const user = useAuthStore((s) => s.user)
  const { status: syncStatus, lastSync, error: syncError, sync, reloadKey } = useSync()

  async function load() {
    setLoading(true)
    try {
      const data = query.trim() ? await searchMandalarts(query) : await getMandalarts()
      setMandalarts(data)
    } finally {
      setLoading(false)
    }
  }

  // 起動時 / 同期 / クエリ変更時に debounce して再取得
  useEffect(() => {
    const t = setTimeout(() => { load() }, query.trim() ? 200 : 0)
    return () => clearTimeout(t)
  }, [query, reloadKey]) // eslint-disable-line react-hooks/exhaustive-deps

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

  // 絞り込みはサーバ側 (searchMandalarts) で行うので、ここではソートのみ
  const visible = useMemo(() => {
    const sorted = [...mandalarts].sort((a, b) => {
      if (sortKey === 'title') {
        return (a.title || '無題').localeCompare(b.title || '無題', 'ja')
      }
      return b.updated_at.localeCompare(a.updated_at)
    })
    return sorted
  }, [mandalarts, sortKey])

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950 text-gray-900 dark:text-gray-100">
      <header className="bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-800 px-6 py-4 flex items-center justify-between gap-4">
        <h1 className="text-lg font-bold shrink-0">マンダラート</h1>

        <div className="flex-1 flex items-center gap-2 max-w-xl">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="タイトル・セル本文で検索..."
            className="flex-1 text-sm border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <select
            value={sortKey}
            onChange={(e) => setSortKey(e.target.value as SortKey)}
            className="text-sm border border-gray-200 dark:border-gray-700 rounded-lg px-2 py-1.5 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
          >
            <option value="updated">更新日順</option>
            <option value="title">タイトル順</option>
          </select>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <ThemeToggle />
          {user ? (
            <div className="flex items-center gap-2">
              <SyncIndicator
                status={syncStatus}
                lastSync={lastSync}
                error={syncError}
                onSync={sync}
              />
              <button
                onClick={async () => { await signOut() }}
                className="text-xs text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
                title={user.email ?? ''}
              >
                サインアウト
              </button>
            </div>
          ) : (
            <button
              onClick={() => setAuthOpen(true)}
              className="text-sm font-medium text-gray-600 dark:text-gray-300 hover:text-gray-800 dark:hover:text-gray-100 border border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600 px-3 py-2 rounded-lg transition-colors"
            >
              サインイン
            </button>
          )}
          <button
            onClick={() => setTrashOpen(true)}
            className="text-sm font-medium text-gray-600 dark:text-gray-300 hover:text-gray-800 dark:hover:text-gray-100 border border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600 px-3 py-2 rounded-lg transition-colors"
            title="削除済みの復元 / 完全削除"
          >
            ゴミ箱
          </button>
          <button
            onClick={() => setImportOpen(true)}
            className="text-sm font-medium text-gray-600 dark:text-gray-300 hover:text-gray-800 dark:hover:text-gray-100 border border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600 px-3 py-2 rounded-lg transition-colors"
          >
            インポート
          </button>
          <button
            onClick={handleCreate}
            className="bg-blue-600 text-white text-sm font-medium px-4 py-2 rounded-lg hover:bg-blue-700 transition-colors"
          >
            + 新規作成
          </button>
        </div>
      </header>

      <AuthDialog open={authOpen} onClose={() => setAuthOpen(false)} />
      <TrashDialog
        open={trashOpen}
        onClose={() => setTrashOpen(false)}
        onChange={load}
      />

      <ImportDialog
        open={importOpen}
        mode={{ kind: 'new' }}
        onClose={() => setImportOpen(false)}
        onComplete={(result) => {
          setImportOpen(false)
          if (result.mandalartId) navigate(`/mandalart/${result.mandalartId}`)
        }}
      />

      <main className="max-w-5xl mx-auto px-6 py-8">
        {loading ? (
          <p className="text-gray-400 dark:text-gray-500">読み込み中...</p>
        ) : !query.trim() && mandalarts.length === 0 ? (
          <div className="text-center py-20 text-gray-400 dark:text-gray-500">
            <p className="text-lg mb-2">まだマンダラートがありません</p>
            <p className="text-sm">「+ 新規作成」から始めましょう</p>
          </div>
        ) : visible.length === 0 ? (
          <div className="text-center py-20 text-gray-400 dark:text-gray-500">
            <p className="text-sm">「{query}」に一致するマンダラートはありません</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
            {visible.map((m) => (
              <div
                key={m.id}
                className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-4 hover:shadow-md transition-shadow cursor-pointer group"
                onClick={() => navigate(`/mandalart/${m.id}`)}
              >
                <div className="aspect-square bg-gray-100 dark:bg-gray-800 rounded-lg mb-3 grid grid-cols-3 gap-0.5 p-1.5">
                  {Array.from({ length: 9 }).map((_, i) => (
                    <div key={i} className={`rounded-sm ${i === 4 ? 'bg-blue-200 dark:bg-blue-900' : 'bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700'}`} />
                  ))}
                </div>
                <p className="text-sm font-medium text-gray-800 dark:text-gray-100 truncate">{m.title || '無題'}</p>
                <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">
                  {new Date(m.updated_at).toLocaleDateString('ja-JP')}
                </p>
                <div className="flex gap-2 mt-2 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button
                    onClick={(e) => { e.stopPropagation(); handleRename(m) }}
                    className="text-xs text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
                  >
                    リネーム
                  </button>
                  <button
                    onClick={(e) => { e.stopPropagation(); handleDuplicate(m) }}
                    className="text-xs text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
                  >
                    複製
                  </button>
                  <button
                    onClick={(e) => { e.stopPropagation(); handleDelete(m.id) }}
                    className="text-xs text-red-400 dark:text-red-400 hover:text-red-600 dark:hover:text-red-300"
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

function SyncIndicator({
  status, lastSync, error, onSync,
}: {
  status: 'idle' | 'syncing' | 'error' | 'offline'
  lastSync: Date | null
  error: string | null
  onSync: () => void
}) {
  const label =
    status === 'syncing' ? '同期中...' :
    status === 'error' ? `同期エラー` :
    lastSync ? `${formatTime(lastSync)} 同期済み` :
    '未同期'

  const colorClass =
    status === 'syncing' ? 'text-blue-500' :
    status === 'error' ? 'text-red-500' :
    'text-gray-500 dark:text-gray-400'

  return (
    <button
      onClick={onSync}
      disabled={status === 'syncing'}
      title={error ?? '今すぐ同期'}
      className={`text-xs ${colorClass} border border-gray-200 dark:border-gray-700 rounded-lg px-2 py-1.5 hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-50`}
    >
      ⟳ {label}
    </button>
  )
}

function formatTime(d: Date): string {
  return d.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' })
}
