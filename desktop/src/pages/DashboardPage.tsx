import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  getMandalarts, createMandalart, deleteMandalart, duplicateMandalart,
  searchMandalarts, permanentDeleteMandalart, createMandalartFromStockItem,
  updateMandalartPinned, reorderMandalarts,
} from '@/lib/api/mandalarts'
import { findOrphanGrids, cleanupOrphanGrids, getRootGrids } from '@/lib/api/grids'
import { addToStock } from '@/lib/api/stock'
import { exportToJSON, exportToMarkdown, exportToIndentText } from '@/lib/api/transfer'
import { downloadJSON, downloadText } from '@/lib/utils/export'
import { signOut } from '@/lib/api/auth'
import ImportDialog from '@/components/editor/ImportDialog'
import StockTab from '@/components/editor/StockTab'
import DragActionPanel from '@/components/editor/DragActionPanel'
import ShredConfirmDialog from '@/components/editor/ShredConfirmDialog'
import ExportFormatPicker, { type ExportFormat } from '@/components/editor/ExportFormatPicker'
import AuthDialog from '@/components/AuthDialog'
import TrashDialog from '@/components/dashboard/TrashDialog'
import ThemeToggle from '@/components/ThemeToggle'
import Toast from '@/components/ui/Toast'
import { HoverActionButtons } from '@/components/ui/HoverActionButtons'
import { CardLikeText } from '@/components/CardLikeText'
import { useCellImageUrl } from '@/hooks/useCellImageUrl'
import { captureCardLikeSource } from '@/lib/utils/captureCardLikeSource'
import { useAuthStore } from '@/store/authStore'
import { useEditorStore } from '@/store/editorStore'
import { useConvergeStore } from '@/store/convergeStore'
import { useSync } from '@/hooks/useSync'
import { useDashboardDnd, type DashboardDropAction } from '@/hooks/useDashboardDnd'
import {
  DASHBOARD_CARD_SIZE_PX,
  DASHBOARD_CARD_FONT_PX,
  DASHBOARD_CARD_INSET_PX,
} from '@/constants/layout'
import { CONVERGE_DURATION_MS } from '@/constants/timing'
import type { Mandalart, StockItem } from '@/types'

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
  // 過去の無限再帰バグ残骸 (orphan grids) の整理ボタン用 state。
  // Tauri v2 WebView は window.alert / confirm が動作しないので、全ての feedback を
  // ボタン内テキストに集約する。2 クリック確認方式。
  //  - null: 初期 ("データ整理")
  //  - 'busy': 実行中 ("処理中...")
  //  - number: 1 クリック後 ("N 件を削除 (もう一度)")
  //  - { type: 'done', ... }: 完了 ("完了: N 個削除")
  //  - { type: 'none' }: 対象なし ("整理対象なし")
  //  - { type: 'error', message }: 失敗 ("失敗: msg")
  type CleanupResult =
    | { type: 'done'; gridsDeleted: number; cellsDeleted: number }
    | { type: 'none' }
    | { type: 'error'; message: string }
  type CleanupState = null | 'busy' | number | CleanupResult
  const [cleanupState, setCleanupState] = useState<CleanupState>(null)

  // ダッシュボード D&D 関連 state
  const [stockReloadKey, setStockReloadKey] = useState(0)
  const [cardShredConfirm, setCardShredConfirm] = useState<
    | { mandalartId: string; title: string }
    | null
  >(null)
  const [cardExportPicker, setCardExportPicker] = useState<
    | { mandalartId: string; title: string }
    | null
  >(null)
  const [toast, setToast] = useState<
    | { message: string; type: 'info' | 'success' | 'error' }
    | null
  >(null)

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
  // また、currentGridId を null に落とすことで、次に EditorLayout が mount したときに
  // useGrid が stale な gridId で gridData を先行ロードしてしまうのを防ぐ
  // (stale ロードが起きると init effect の setOrbit より早く通常 render が走り、
  //  初回表示 orbit アニメがスキップされる)。
  function openMandalart(id: string) {
    const store = useEditorStore.getState()
    store.setViewMode('3x3')
    store.setCurrentGrid(null)
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

  async function handleTogglePin(m: Mandalart) {
    const next = !m.pinned
    setMandalarts((prev) => prev.map((x) => (x.id === m.id ? { ...x, pinned: next } : x)))  // 楽観的
    try {
      await updateMandalartPinned(m.id, next)
      // ピン状態変更で並び順が変わるので reload
      load()
    } catch (e) {
      setToast({ message: `ピン留め失敗: ${(e as Error).message}`, type: 'error' })
      load()
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

  // pending (number) は 60 秒、done/none/error は 10 秒で自動解除
  useEffect(() => {
    if (cleanupState === null || cleanupState === 'busy') return
    const timeout = typeof cleanupState === 'number' ? 60_000 : 10_000
    const t = setTimeout(() => setCleanupState(null), timeout)
    return () => clearTimeout(t)
  }, [cleanupState])

  async function handleCleanupOrphans() {
    if (cleanupState === 'busy') return
    // result 表示中 (done/none/error) にクリックされたら一旦 null に戻して普通に処理
    const isInitial = cleanupState === null ||
      (typeof cleanupState === 'object' && cleanupState !== null)
    if (isInitial) {
      // 1 クリック目: 件数調査
      setCleanupState('busy')
      try {
        const stats = await findOrphanGrids()
        if (stats.orphanGridIds.length === 0) {
          setCleanupState({ type: 'none' })
          return
        }
        setCleanupState(stats.orphanGridIds.length)
      } catch (e) {
        setCleanupState({ type: 'error', message: String(e) })
      }
      return
    }
    // 2 クリック目 (number): 実行
    setCleanupState('busy')
    try {
      const result = await cleanupOrphanGrids()
      setCleanupState({
        type: 'done',
        gridsDeleted: result.gridsDeleted,
        cellsDeleted: result.cellsDeleted,
      })
      await load()
    } catch (e) {
      setCleanupState({ type: 'error', message: String(e) })
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

  // stock entry からの paste = 新規マンダラート作成
  const handleStockPaste = useCallback(async (item: StockItem) => {
    try {
      const m = await createMandalartFromStockItem(item.id)
      setMandalarts((prev) => [m, ...prev])
      setToast({ message: '新規マンダラートを作成しました', type: 'success' })
    } catch (e) {
      setToast({ message: `作成失敗: ${(e as Error).message}`, type: 'error' })
    }
  }, [])

  /**
   * card DOM から ConvergeOverlay の direction='stock' source 値を計測する。
   * 共通ユーティリティ `captureCardLikeSource` を `[data-converge-card="<id>"]` 要素に適用し、
   * data 由来の値 (text / imagePath / color) を組合せて convergeStore の expected shape に整える。
   * 画像のみカード (titleFirstLine 空 + image_path あり) では text wrapper 不在 → default 値で fallback。
   */
  function captureCardSource(mandalartId: string, mandalart: Mandalart) {
    const cardEl = document.querySelector(`[data-converge-card="${mandalartId}"]`) as HTMLElement | null
    if (!cardEl) return null
    const m_ = captureCardLikeSource(cardEl, {
      topInsetPx: DASHBOARD_CARD_INSET_PX,
      sideInsetPx: DASHBOARD_CARD_INSET_PX,
      fontPx: DASHBOARD_CARD_FONT_PX,
    })
    const titleFirstLine = (mandalart.title || '').split('\n')[0]
    return {
      rect: m_.rect,
      centerCell: {
        // 画像のみカード (titleFirstLine 空 + image_path あり) は image を、それ以外は title を表示
        text: titleFirstLine ? (mandalart.title || '') : '',
        imagePath: !titleFirstLine && mandalart.image_path ? mandalart.image_path : null,
        color: null,
        fontPx: m_.fontPx,
        topInsetPx: m_.topInsetPx,
        sideInsetPx: m_.sideInsetPx,
        borderPx: m_.borderPx,
        radiusPx: m_.radiusPx,
      },
    }
  }

  // card → 4 アクションアイコン / stock → ダッシュボード / card → 別 card 位置 (reorder) の drop dispatcher
  const handleDashboardDrop = useCallback(async (action: DashboardDropAction) => {
    if (!action) return
    if (action.kind === 'card-reorder') {
      // mandalarts 配列内で source カードを target index に挿入し、reorderMandalarts で
      // sort_order を 0..N に振り直す。pinned は ORDER BY 側で先頭固定されるので、
      // ここでは見た目の順序だけを反映すれば自動的に「pinned ↑ + sort_order」が成立する。
      const srcIdx = mandalarts.findIndex((m) => m.id === action.sourceMandalartId)
      if (srcIdx < 0 || srcIdx === action.targetIndex) return
      const next = [...mandalarts]
      const [moved] = next.splice(srcIdx, 1)
      const insertAt = srcIdx < action.targetIndex ? action.targetIndex - 1 : action.targetIndex
      next.splice(insertAt, 0, moved)
      setMandalarts(next)  // 楽観的更新
      try {
        await reorderMandalarts(next.map((m) => m.id))
      } catch (e) {
        setToast({ message: `並び替え失敗: ${(e as Error).message}`, type: 'error' })
        load()  // 失敗時はサーバ値で復元
      }
      return
    }
    if (action.kind === 'stock-to-new') {
      // 既存 handleStockPaste と同じ経路だが stockItemId しか持たないので fetch なしで
      // 直接 API 呼出。エラー処理は同形式。
      try {
        const m = await createMandalartFromStockItem(action.stockItemId)
        setMandalarts((prev) => [m, ...prev])
        setToast({ message: '新規マンダラートを作成しました', type: 'success' })
      } catch (e) {
        setToast({ message: `作成失敗: ${(e as Error).message}`, type: 'error' })
      }
      return
    }
    // card-action
    const target = mandalarts.find((m) => m.id === action.mandalartId)
    if (!target) return
    const titleLabel = target.title || '無題'
    switch (action.action) {
      case 'shred':
        setCardShredConfirm({ mandalartId: target.id, title: titleLabel })
        return
      case 'move':
        try {
          // card 削除前に source 値を計測 (DOM 削除後は計測不可)
          const source = captureCardSource(target.id, target)
          const stockItem = await addToStock(target.root_cell_id)
          await permanentDeleteMandalart(target.id)
          setMandalarts((prev) => prev.filter((m) => m.id !== target.id))
          setStockReloadKey((k) => k + 1)
          if (source) {
            useConvergeStore.getState().setConverge(
              'stock', stockItem.id, source.rect, source.centerCell,
            )
          }
          setToast({ message: 'ストックへ移動し、マンダラートを削除しました', type: 'success' })
        } catch (e) {
          setToast({ message: `移動失敗: ${(e as Error).message}`, type: 'error' })
        }
        return
      case 'copy':
        try {
          const source = captureCardSource(target.id, target)
          const stockItem = await addToStock(target.root_cell_id)
          setStockReloadKey((k) => k + 1)
          if (source) {
            useConvergeStore.getState().setConverge(
              'stock', stockItem.id, source.rect, source.centerCell,
            )
          }
          setToast({ message: 'ストックにコピーしました', type: 'success' })
        } catch (e) {
          setToast({ message: `コピー失敗: ${(e as Error).message}`, type: 'error' })
        }
        return
      case 'export':
        setCardExportPicker({ mandalartId: target.id, title: titleLabel })
        return
    }
  }, [mandalarts, load])

  // useDashboardDnd は handleDashboardDrop を購読
  const dnd = useDashboardDnd({ onDrop: handleDashboardDrop })

  // shred 確認ダイアログの最終アクション
  const handleCardShredConfirm = useCallback(async () => {
    if (!cardShredConfirm) return
    const { mandalartId, title } = cardShredConfirm
    setCardShredConfirm(null)
    try {
      await permanentDeleteMandalart(mandalartId)
      setMandalarts((prev) => prev.filter((m) => m.id !== mandalartId))
      setToast({ message: `「${title}」を削除しました`, type: 'success' })
    } catch (e) {
      setToast({ message: `削除失敗: ${(e as Error).message}`, type: 'error' })
    }
  }, [cardShredConfirm])

  // export 形式選択後の最終アクション
  const handleCardExportPick = useCallback(async (format: ExportFormat) => {
    if (!cardExportPicker) return
    const { mandalartId, title } = cardExportPicker
    setCardExportPicker(null)
    try {
      const baseName = title.replace(/[\\/:*?"<>|]/g, '_').slice(0, 40) || 'mandalart'
      // mandalart 全体 = primary root grid 起点でエクスポート
      const roots = await getRootGrids(mandalartId)
      const targetGridId = roots[0]?.id
      if (!targetGridId) {
        setToast({ message: 'エクスポート対象の grid が見つかりません', type: 'info' })
        return
      }
      let filename: string
      if (format === 'json') {
        const snap = await exportToJSON(targetGridId)
        filename = await downloadJSON(snap, baseName)
      } else if (format === 'markdown') {
        const md = await exportToMarkdown(targetGridId)
        filename = await downloadText(md, 'md', baseName)
      } else {
        const txt = await exportToIndentText(targetGridId)
        filename = await downloadText(txt, 'txt', baseName)
      }
      setToast({ message: `保存しました: ${filename}`, type: 'success' })
    } catch (e) {
      setToast({ message: `エクスポート失敗: ${(e as Error).message}`, type: 'error' })
    }
  }, [cardExportPicker])

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
    <div className="h-screen flex flex-col bg-neutral-50 dark:bg-neutral-950 text-neutral-900 dark:text-neutral-100 overflow-hidden">
      <header className="bg-white dark:bg-neutral-900 border-b border-neutral-200 dark:border-neutral-800 px-6 py-4 flex items-center justify-between gap-4 shrink-0">
        <h1 className="text-lg font-bold shrink-0">マンダラート</h1>

        <div className="flex-1 flex items-center gap-2 max-w-xl">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="タイトル・セル本文で検索..."
            className="flex-1 text-sm border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-800 text-neutral-900 dark:text-neutral-100 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <select
            value={sortKey}
            onChange={(e) => setSortKey(e.target.value as SortKey)}
            className="text-sm border border-neutral-200 dark:border-neutral-700 rounded-lg px-2 py-1.5 bg-white dark:bg-neutral-800 text-neutral-900 dark:text-neutral-100"
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
                className="text-xs text-neutral-500 dark:text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200"
                title={user.email ?? ''}
              >
                サインアウト
              </button>
            </div>
          ) : (
            <button
              onClick={() => setAuthOpen(true)}
              className="text-sm font-medium text-neutral-600 dark:text-neutral-300 hover:text-neutral-800 dark:hover:text-neutral-100 border border-neutral-200 dark:border-neutral-700 hover:border-neutral-300 dark:hover:border-neutral-600 px-3 py-2 rounded-lg transition-colors"
            >
              サインイン
            </button>
          )}
          <button
            onClick={() => setTrashOpen(true)}
            className="text-sm font-medium text-neutral-600 dark:text-neutral-300 hover:text-neutral-800 dark:hover:text-neutral-100 border border-neutral-200 dark:border-neutral-700 hover:border-neutral-300 dark:hover:border-neutral-600 px-3 py-2 rounded-lg transition-colors"
            title="削除済みの復元 / 完全削除"
          >
            ゴミ箱
          </button>
          <button
            onClick={handleCleanupOrphans}
            disabled={cleanupState === 'busy'}
            className="text-sm font-medium text-neutral-600 dark:text-neutral-300 hover:text-neutral-800 dark:hover:text-neutral-100 border border-neutral-200 dark:border-neutral-700 hover:border-neutral-300 dark:hover:border-neutral-600 px-3 py-2 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            title="過去バグ由来の孤立グリッド (root から辿れないバグチェーン) を整理"
          >
            {(() => {
              if (cleanupState === 'busy') return '処理中...'
              if (typeof cleanupState === 'number') return `${cleanupState} 件を削除 (もう一度)`
              if (cleanupState === null) return 'データ整理'
              if (cleanupState.type === 'done') {
                return `完了: ${cleanupState.gridsDeleted} グリッド削除`
              }
              if (cleanupState.type === 'none') return '整理対象なし'
              return `失敗: ${cleanupState.message.slice(0, 30)}`
            })()}
          </button>
          <button
            onClick={() => setImportOpen(true)}
            className="text-sm font-medium text-neutral-600 dark:text-neutral-300 hover:text-neutral-800 dark:hover:text-neutral-100 border border-neutral-200 dark:border-neutral-700 hover:border-neutral-300 dark:hover:border-neutral-600 px-3 py-2 rounded-lg transition-colors"
          >
            インポート
          </button>
          {/* 「+ 新規作成」は card grid 先頭の「+」card に移行 (Phase A 以降) */}
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

      {/* body row: 左 = main (card grid、scrollable)、右 = aside (StockTab、viewport 右端で full-height、editor SidePanel と同じ位置) */}
      <div className="flex flex-1 min-h-0 overflow-hidden">
        {/* 左: card grid (drop zone も兼ねる)。max-w-5xl で中央寄せしつつ overflow-y-auto で内部スクロール */}
        <main
          data-dashboard-drop-zone
          className="flex-1 min-w-0 overflow-y-auto px-6 py-8"
        >
          <div className="max-w-5xl mx-auto">
          {!initialLoaded ? (
            <p className="text-neutral-400 dark:text-neutral-500">読み込み中...</p>
          ) : query.trim() && visible.length === 0 ? (
            <div className="text-center py-20 text-neutral-400 dark:text-neutral-500">
              <p className="text-sm">「{query}」に一致するマンダラートはありません</p>
            </div>
          ) : (
            <div
              className="grid gap-3"
              style={{
                gridTemplateColumns: `repeat(auto-fill, ${DASHBOARD_CARD_SIZE_PX}px)`,
              }}
            >
              {/* 検索中以外は先頭に「+」card を表示 (新規作成導線、card と同サイズの dashed 枠) */}
              {!query.trim() && <NewMandalartCard onClick={handleCreate} />}
              {visible.map((m, index) => {
                // drag 中、hover 中のカード以降を右に slide してドロップスペースを開ける。
                // 自分自身 (card source の場合) は固定。
                const shouldShiftRight =
                  dnd.dragOverCardIndex !== null &&
                  index >= dnd.dragOverCardIndex &&
                  dnd.dragSourceId !== m.id
                return (
                  <MandalartCard
                    key={m.id}
                    mandalart={m}
                    index={index}
                    shouldShiftRight={shouldShiftRight}
                    isDragSource={dnd.dragSourceKind === 'card' && dnd.dragSourceId === m.id}
                    onOpen={() => openMandalart(m.id)}
                    onDuplicate={() => handleDuplicate(m)}
                    onDelete={() => handleDelete(m.id)}
                    onTogglePin={() => handleTogglePin(m)}
                    onMouseDown={dnd.onCardMouseDown}
                    wasRecentlyDragged={dnd.wasRecentlyDragged}
                  />
                )
              })}
            </div>
          )}
          </div>
        </main>

        {/* 右: ストックパネル (lg 以上で表示)、viewport 右端で full-height (editor SidePanel と同じ位置)。
            card 起源 drag 中は DragActionPanel をオーバーレイ */}
        <aside
          data-dashboard-stock-drop-zone
          className="hidden lg:flex w-72 shrink-0 flex-col border-l border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900"
        >
          <div className="px-4 py-2 border-b border-neutral-200 dark:border-neutral-800 text-xs font-medium text-neutral-600 dark:text-neutral-300 shrink-0">
            ストック
          </div>
          <div className="flex-1 overflow-hidden p-3 relative">
            {/* card 起源 drag 中: 4 アクションアイコンを overlay で表示 (editor SidePanel と同じパターン) */}
            {dnd.dragSourceKind === 'card' && (
              <div className="absolute inset-0 z-10 bg-white dark:bg-neutral-900 p-3">
                <DragActionPanel hoveredAction={dnd.hoveredAction} />
              </div>
            )}
            <div className={`h-full ${dnd.dragSourceKind === 'card' ? 'invisible' : ''}`}>
              <StockTab
                onPaste={handleStockPaste}
                reloadKey={stockReloadKey}
                onItemDragStart={dnd.onStockItemDragStart}
                dragSourceId={dnd.dragSourceKind === 'stock' && dnd.dragSourceId
                  ? `stock:${dnd.dragSourceId}` : null}
              />
            </div>
          </div>
        </aside>
      </div>

      {/* card → shred drop の確認ダイアログ */}
      <ShredConfirmDialog
        open={cardShredConfirm !== null}
        targetText={cardShredConfirm?.title}
        isPrimaryRoot={true}
        onCancel={() => setCardShredConfirm(null)}
        onConfirm={handleCardShredConfirm}
      />

      {/* card → export drop の形式選択ダイアログ */}
      <ExportFormatPicker
        open={cardExportPicker !== null}
        targetText={cardExportPicker?.title}
        onCancel={() => setCardExportPicker(null)}
        onPick={handleCardExportPick}
      />

      {/* トースト (D&D action の feedback) */}
      {toast && (
        <Toast
          message={toast.message}
          type={toast.type}
          onClose={() => setToast(null)}
        />
      )}
    </div>
  )
}

function MandalartCard({
  mandalart: m, index, shouldShiftRight, isDragSource, onOpen, onDuplicate, onDelete, onTogglePin,
  onMouseDown, wasRecentlyDragged,
}: {
  mandalart: Mandalart
  index: number
  shouldShiftRight: boolean
  isDragSource: boolean
  onOpen: () => void
  onDuplicate: () => void
  onDelete: () => void
  onTogglePin: () => void
  onMouseDown: (mandalartId: string, e: React.MouseEvent) => void
  wasRecentlyDragged: () => boolean
}) {
  const cardRef = useRef<HTMLDivElement>(null)
  const titleFirstLine = (m.title || '').split('\n')[0]
  // 画像 URL: タイトル空 + image_path あり時のみ解決 (textが優先)
  const imageUrl = useCellImageUrl(!titleFirstLine ? m.image_path : null)

  // direction='home' (エディタ → ダッシュボード収束) で自分がターゲットカードのとき、morph 中は
  // 内容を隠す。overlay がカード位置に到達する前に「中身が先に見えている」のを防ぐため、
  // open 方向の中心セル instant-snap と同じ trick (`orbit-fade-in 1ms ease-out CONVERGE_DURATION_MS both`)
  // で morph 期間中は opacity 0、終端で 1ms snap → 1。
  const convergeDirection = useConvergeStore((s) => s.direction)
  const convergeTargetId = useConvergeStore((s) => s.targetId)
  const isConvergeTarget =
    convergeDirection === 'home' && convergeTargetId === m.id

  // カードクリック → 「カード → 中心セル」拡大アニメの source 値を計測 → setConverge('open')
  // → onOpen() で navigate。両端値の対称化のため EditorLayout の handleNavigateHome と同じ
  // ロジック (source DOM 実測) でカード DOM を読む。
  // ただし drag 直後 (wasRecentlyDragged が true) は drag → cancel 系操作とみなして click を
  // suppress する (誤発火 navigate 回避)。
  function handleClick() {
    if (wasRecentlyDragged()) return
    const cardEl = cardRef.current
    if (!cardEl) { onOpen(); return }
    const m_ = captureCardLikeSource(cardEl, {
      topInsetPx: DASHBOARD_CARD_INSET_PX,
      sideInsetPx: DASHBOARD_CARD_INSET_PX,
      fontPx: DASHBOARD_CARD_FONT_PX,
    })
    useConvergeStore.getState().setConverge(
      'open',
      m.id,
      m_.rect,
      {
        // カードが image-only (タイトル空 + 画像あり) のときは imagePath を使い、それ以外は title 文字列を使う
        text: titleFirstLine ? (m.title || '') : '',
        imagePath: !titleFirstLine && m.image_path ? m.image_path : null,
        color: null,  // ダッシュボードカードは色を持たない (mandalart 型に color 列なし)
        fontPx: m_.fontPx,
        topInsetPx: m_.topInsetPx,
        sideInsetPx: m_.sideInsetPx,
        borderPx: m_.borderPx,
        radiusPx: m_.radiusPx,
      },
    )
    onOpen()
  }

  return (
    <div
      ref={cardRef}
      // ConvergeOverlay の polling target (direction='home' = エディタ → ダッシュボード収束時の着地点)。
      // 中心セル (3×3 normal) を ~0.47 縮小した姿として設計: border-[3px] / shadow-md /
      // dark:bg-neutral-950 はすべて Cell.tsx 中心セルの class と揃えており、太さ・余白・font サイズは
      // layout.ts の DASHBOARD_CARD_* 定数で proportional に縮小。
      // 角丸は中心セルの `rounded-lg (8px)` をスケール 0.47 した ~3.76px に対応する `rounded (4px)` を採用。
      data-converge-card={m.id}
      data-dashboard-card-index={index}
      className="relative bg-white dark:bg-neutral-950 border-[3px] border-black dark:border-white rounded shadow-md hover:shadow-lg transition-shadow cursor-pointer group overflow-hidden select-none"
      style={{
        width: DASHBOARD_CARD_SIZE_PX,
        height: DASHBOARD_CARD_SIZE_PX,
        // 他カード drag 中、drag が hover している card 以降は右に slide してドロップスペースを開ける
        transform: shouldShiftRight ? 'translateX(calc(100% + 12px))' : undefined,
        transition: 'transform 200ms ease-out',
        // 自身が card-source として drag 中なら半透明 (見た目で source 識別)
        opacity: isDragSource ? 0.4 : undefined,
        ...(isConvergeTarget
          ? {
              animation: `orbit-fade-in 1ms ease-out ${CONVERGE_DURATION_MS}ms both`,
              willChange: 'opacity',
            }
          : {}),
      }}
      onMouseDown={(e) => onMouseDown(m.id, e)}
      onClick={handleClick}
      title={m.title || '無題'}
    >
      {!titleFirstLine && imageUrl ? (
        // HTML5 native drag 抑止は index.css の global `img` rule で一括対応 (落とし穴 #1)。
        <img src={imageUrl} alt="" className="absolute inset-0 w-full h-full object-cover" />
      ) : (
        // 共通 <CardLikeText>: ConvergeOverlay polling 互換構造を統一
        <CardLikeText
          text={m.title || '無題'}
          fontPx={DASHBOARD_CARD_FONT_PX}
          sideInsetPx={DASHBOARD_CARD_INSET_PX}
        />
      )}
      {/* 更新日: hover 時のみ下部にうっすら表示 */}
      <div className="absolute bottom-1 left-2 right-2 text-[9px] text-neutral-400 dark:text-neutral-500 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none text-center">
        {new Date(m.updated_at).toLocaleDateString('ja-JP')}
      </div>
      <HoverActionButtons
        size="md"
        actions={[
          {
            icon: m.pinned ? '★' : '☆',
            variant: m.pinned ? 'blue' : 'neutral',
            onClick: onTogglePin,
            title: m.pinned ? 'ピン留めを外す' : 'ピン留め',
          },
          { icon: '⧉', variant: 'neutral', onClick: onDuplicate, title: '複製' },
          { icon: '×', variant: 'red', onClick: onDelete, title: '削除' },
        ]}
      />
    </div>
  )
}

/**
 * 新規マンダラート作成用の「+」card。
 * 通常の MandalartCard と同サイズの dashed-border 枠 + 中央「+」アイコン。card grid の
 * 先頭に常時表示され、現フォルダ (Phase B 以降) に新しいカードを追加するエントリポイント。
 */
function NewMandalartCard({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title="新規マンダラートを作成"
      className="relative bg-transparent border-2 border-dashed border-neutral-300 dark:border-neutral-600 rounded shadow-none hover:border-neutral-400 dark:hover:border-neutral-500 hover:bg-neutral-50 dark:hover:bg-neutral-900 transition-colors flex items-center justify-center select-none"
      style={{
        width: DASHBOARD_CARD_SIZE_PX,
        height: DASHBOARD_CARD_SIZE_PX,
      }}
    >
      <span className="text-3xl text-neutral-400 dark:text-neutral-500 font-light leading-none">+</span>
    </button>
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
    'text-neutral-500 dark:text-neutral-400'

  return (
    <button
      onClick={onSync}
      disabled={status === 'syncing'}
      title={error ?? '今すぐ同期'}
      className={`text-xs ${colorClass} border border-neutral-200 dark:border-neutral-700 rounded-lg px-2 py-1.5 hover:bg-neutral-50 dark:hover:bg-neutral-800 disabled:opacity-50`}
    >
      ⟳ {label}
    </button>
  )
}

function formatTime(d: Date): string {
  return d.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' })
}
