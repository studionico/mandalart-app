import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  getMandalarts, createMandalart, deleteMandalart, duplicateMandalart,
  searchMandalarts,
} from '@/lib/api/mandalarts'
import { signOut } from '@/lib/api/auth'
import ImportDialog from '@/components/editor/ImportDialog'
import AuthDialog from '@/components/AuthDialog'
import TrashDialog from '@/components/dashboard/TrashDialog'
import ThemeToggle from '@/components/ThemeToggle'
import { useAuthStore } from '@/store/authStore'
import { useEditorStore } from '@/store/editorStore'
import { useSync } from '@/hooks/useSync'
import { DASHBOARD_CARD_SIZE_PX, DASHBOARD_CARD_FONT_PX } from '@/constants/layout'
import type { Mandalart } from '@/types'

type SortKey = 'updated' | 'title'

export default function DashboardPage() {
  const navigate = useNavigate()
  const [mandalarts, setMandalarts] = useState<Mandalart[]>([])
  // 初回ロードが完了したかどうか (初回のみ「読み込み中...」を表示するため)
  const [initialLoaded, setInitialLoaded] = useState(false)
  const [query, setQuery] = useState('')
  const [sortKey, setSortKey] = useState<SortKey>('updated')
  const [importOpen, setImportOpen] = useState(false)
  const [authOpen, setAuthOpen] = useState(false)
  const [trashOpen, setTrashOpen] = useState(false)

  const user = useAuthStore((s) => s.user)
  const { status: syncStatus, lastSync, error: syncError, sync, reloadKey } = useSync()

  // 再取得中の古いレスポンスで UI が上書きされるのを防ぐ
  const loadSeqRef = useRef(0)

  const load = useCallback(async () => {
    const seq = ++loadSeqRef.current
    try {
      const data = query.trim() ? await searchMandalarts(query) : await getMandalarts()
      // 後続のリクエストが走っていたら、古い結果は破棄する
      if (seq !== loadSeqRef.current) return
      setMandalarts(data)
    } finally {
      if (seq === loadSeqRef.current) setInitialLoaded(true)
    }
  }, [query])

  // クエリ変更 / 同期完了 / Realtime 受信時に debounce して再取得
  // debounce を入れることで Realtime が連鎖発火したときのリマウント祭りを防ぐ。
  useEffect(() => {
    const delay = query.trim() ? 200 : 150
    const t = setTimeout(() => { load() }, delay)
    return () => clearTimeout(t)
  }, [query, reloadKey, load])

  // ダッシュボードからエディタへ遷移する際は常に 3×3 モードで開く。
  // 直前に 9×9 を見ていたマンダラートを閉じて別のマンダラートを開いた場合でも、
  // エディタの入口を一貫させたいので必ずリセットする。
  function openMandalart(id: string) {
    useEditorStore.getState().setViewMode('3x3')
    navigate(`/mandalart/${id}`)
  }

  async function handleCreate() {
    try {
      // createMandalart は root grid + 9 cells + root_cell_id も atomic に作成する
      const m = await createMandalart()
      openMandalart(m.id)
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
          if (result.mandalartId) openMandalart(result.mandalartId)
        }}
      />

      <main className="max-w-5xl mx-auto px-6 py-8">
        {!initialLoaded ? (
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
          <div
            className="grid gap-3"
            style={{
              gridTemplateColumns: `repeat(auto-fill, ${DASHBOARD_CARD_SIZE_PX}px)`,
            }}
          >
            {visible.map((m) => (
              <MandalartCard
                key={m.id}
                mandalart={m}
                onOpen={() => openMandalart(m.id)}
                onDuplicate={() => handleDuplicate(m)}
                onDelete={() => handleDelete(m.id)}
              />
            ))}
          </div>
        )}
      </main>
    </div>
  )
}

function MandalartCard({
  mandalart: m, onOpen, onDuplicate, onDelete,
}: {
  mandalart: Mandalart
  onOpen: () => void
  onDuplicate: () => void
  onDelete: () => void
}) {
  const [imageUrl, setImageUrl] = useState<string | null>(null)
  const titleFirstLine = (m.title || '').split('\n')[0]

  useEffect(() => {
    let cancelled = false
    if (titleFirstLine || !m.image_path) {
      setImageUrl(null)
      return
    }
    import('@/lib/api/storage').then(({ getCellImageUrl }) =>
      getCellImageUrl(m.image_path!).then((url) => {
        if (!cancelled) setImageUrl(url || null)
      })
    )
    return () => { cancelled = true }
  }, [titleFirstLine, m.image_path])

  return (
    <div
      className="relative bg-white dark:bg-gray-900 border-2 border-black dark:border-white rounded-xl shadow-sm hover:shadow-md transition-shadow cursor-pointer group overflow-hidden"
      style={{ width: DASHBOARD_CARD_SIZE_PX, height: DASHBOARD_CARD_SIZE_PX }}
      onClick={onOpen}
      title={m.title || '無題'}
    >
      {!titleFirstLine && imageUrl ? (
        <img src={imageUrl} alt="" className="absolute inset-0 w-full h-full object-cover" />
      ) : (
        <div
          className="w-full h-full flex items-start justify-start p-3 text-left break-all leading-tight text-gray-800 dark:text-gray-100 font-medium"
          style={{ fontSize: DASHBOARD_CARD_FONT_PX }}
        >
          <span className="block w-full line-clamp-6 whitespace-pre-wrap">
            {m.title || '無題'}
          </span>
        </div>
      )}
      {/* 更新日: hover 時のみ下部にうっすら表示 */}
      <div className="absolute bottom-1 left-2 right-2 text-[9px] text-gray-400 dark:text-gray-500 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none text-center">
        {new Date(m.updated_at).toLocaleDateString('ja-JP')}
      </div>
      {/* アクション: hover 時に右上 */}
      <div className="absolute top-1 right-1 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
        <button
          onClick={(e) => { e.stopPropagation(); onDuplicate() }}
          className="w-5 h-5 rounded bg-white/90 dark:bg-gray-800/90 border border-gray-200 dark:border-gray-700 text-[10px] text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-gray-100 flex items-center justify-center"
          title="複製"
        >
          ⧉
        </button>
        <button
          onClick={(e) => { e.stopPropagation(); onDelete() }}
          className="w-5 h-5 rounded bg-white/90 dark:bg-gray-800/90 border border-gray-200 dark:border-gray-700 text-[10px] text-red-500 hover:text-red-700 dark:hover:text-red-300 flex items-center justify-center"
          title="削除"
        >
          ×
        </button>
      </div>
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
