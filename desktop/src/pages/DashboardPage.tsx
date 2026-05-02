import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  getMandalarts, createMandalart, deleteMandalart, duplicateMandalart,
  searchMandalarts, permanentDeleteMandalart, createMandalartFromStockItem,
  updateMandalartPinned, reorderMandalarts, updateMandalartFolderId,
} from '@/lib/api/mandalarts'
import {
  getFolders, createFolder, updateFolderName, deleteFolder, ensureInboxFolder,
} from '@/lib/api/folders'
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
import { reorderArray } from '@/lib/utils/reorderArray'
import { useAuthStore } from '@/store/authStore'
import { useEditorStore } from '@/store/editorStore'
import { useConvergeStore } from '@/store/convergeStore'
import { useSync } from '@/hooks/useSync'
import { useDashboardDnd, type DashboardDropAction } from '@/hooks/useDashboardDnd'
import { useTwoClickConfirmKey } from '@/hooks/useTwoClickConfirm'
import {
  DASHBOARD_CARD_SIZE_PX,
  DASHBOARD_CARD_FONT_PX,
  DASHBOARD_CARD_INSET_PX,
} from '@/constants/layout'
import { CONVERGE_DURATION_MS } from '@/constants/timing'
import type { Mandalart, StockItem, Folder } from '@/types'

type SortKey = 'updated' | 'title'

export default function DashboardPage() {
  const navigate = useNavigate()
  const [mandalarts, setMandalarts] = useState<Mandalart[]>([])
  // フォルダ機能 (Phase B、migration 010)。selectedFolderId は初回 bootstrap で Inbox に設定される。
  const [folders, setFolders] = useState<Folder[]>([])
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null)
  // 新フォルダ追加 / リネーム時の inline 入力 state (window.prompt は Tauri WebKit で動かないため)
  const [pendingFolder, setPendingFolder] = useState<
    | { kind: 'create'; name: string }
    | { kind: 'rename'; folderId: string; name: string }
    | null
  >(null)
  // タブ ✕ ボタンの 2 クリック確認 (落とし穴 #7、既存の TrashDialog / StockTab と同パターン)
  const folderDeleteConfirm = useTwoClickConfirmKey<string>()
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
      // 検索中は全フォルダ横断、それ以外は選択中フォルダで絞る (Phase B)
      const data = query.trim()
        ? await searchMandalarts(query)
        : await getMandalarts(selectedFolderId ?? undefined)
      // 後続のリクエストが走っていたら、古い結果は破棄する
      if (seq !== loadSeqRef.current) return
      setMandalarts(data)
    } finally {
      if (seq === loadSeqRef.current) setInitialLoaded(true)
    }
  }, [query, selectedFolderId])

  /** folders を再取得する (タブの追加 / 名前変更 / 削除後に呼ぶ) */
  const loadFolders = useCallback(async () => {
    setFolders(await getFolders())
  }, [])

  /**
   * Inbox bootstrap: アプリ起動時 + ダッシュボードマウント時に呼ぶ。
   * Inbox folder が無ければ生成し、folder_id NULL のマンダラートを Inbox に振り分ける。
   * 完了後 selectedFolderId を Inbox に設定 (初回のみ)。
   */
  useEffect(() => {
    let cancelled = false
    void (async () => {
      const inboxId = await ensureInboxFolder()
      if (cancelled) return
      await loadFolders()
      if (cancelled) return
      // 初回のみ Inbox を選択 (ユーザーが既に別タブを選んでいる場合は維持)
      setSelectedFolderId((prev) => prev ?? inboxId)
    })()
    return () => { cancelled = true }
  }, [loadFolders])

  // クエリ変更 / フォルダ切替 / 同期完了 / Realtime 受信時に debounce して再取得
  // debounce を入れることで Realtime が連鎖発火したときのリマウント祭りを防ぐ。
  useEffect(() => {
    const delay = query.trim() ? 200 : 150
    const t = setTimeout(() => { load() }, delay)
    return () => clearTimeout(t)
  }, [query, reloadKey, load])

  // 同期 / Realtime で folders が更新された可能性があるので reloadKey で再取得
  useEffect(() => {
    void loadFolders()
  }, [reloadKey, loadFolders])

  // 選択中フォルダが folders 一覧から消えた場合 (別デバイスでの削除等) は Inbox にフォールバック
  useEffect(() => {
    if (folders.length === 0) return
    if (!selectedFolderId || !folders.some((f) => f.id === selectedFolderId)) {
      const inbox = folders.find((f) => f.is_system) ?? folders[0]
      setSelectedFolderId(inbox.id)
    }
  }, [folders, selectedFolderId])

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
      // 選択中の folder に追加 (Phase B、bootstrap 後 selectedFolderId は必ず Inbox 以上)
      const m = await createMandalart('', selectedFolderId)
      openMandalart(m.id)
    } catch (e) {
      alert('エラー: ' + String(e))
      console.error(e)
    }
  }

  /** 「+」タブをクリック → タブ列末尾の inline input にフォーカス */
  function handleStartAddFolder() {
    setPendingFolder({ kind: 'create', name: '' })
  }

  /** タブを右クリック → そのタブを inline 編集モードに */
  function handleStartRenameFolder(folder: Folder) {
    setPendingFolder({ kind: 'rename', folderId: folder.id, name: folder.name })
  }

  /** inline input の確定 (Enter / blur)。空文字ならキャンセル扱い。 */
  async function commitPendingFolder() {
    if (!pendingFolder) return
    const name = pendingFolder.name.trim()
    if (!name) {
      setPendingFolder(null)
      return
    }
    try {
      if (pendingFolder.kind === 'create') {
        const f = await createFolder(name)
        await loadFolders()
        setSelectedFolderId(f.id)  // 追加直後はそのタブを選択
      } else {
        await updateFolderName(pendingFolder.folderId, name)
        await loadFolders()
      }
    } catch (e) {
      setToast({ message: `フォルダ操作失敗: ${(e as Error).message}`, type: 'error' })
    } finally {
      setPendingFolder(null)
    }
  }

  /** ユーザー定義フォルダの削除 (Shift+右クリック)。Inbox は API 側で reject される。 */
  async function handleDeleteFolder(folder: Folder) {
    if (folder.is_system) return
    try {
      await deleteFolder(folder.id)
      await loadFolders()
      // 選択中フォルダを削除した場合は Inbox に戻す
      if (selectedFolderId === folder.id) {
        const inbox = (await getFolders()).find((f) => f.is_system)
        setSelectedFolderId(inbox?.id ?? null)
      }
      setToast({ message: `「${folder.name}」を削除しました`, type: 'success' })
    } catch (e) {
      setToast({ message: `フォルダ削除失敗: ${(e as Error).message}`, type: 'error' })
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

  // stock entry からの paste = 新規マンダラート作成 (現在選択中のフォルダに追加)
  // selectedFolderId への依存があるので useCallback 依存配列に含める
  const handleStockPaste = useCallback(async (item: StockItem) => {
    try {
      const m = await createMandalartFromStockItem(item.id, selectedFolderId)
      setMandalarts((prev) => [m, ...prev])
      setToast({ message: '新規マンダラートを作成しました', type: 'success' })
    } catch (e) {
      setToast({ message: `作成失敗: ${(e as Error).message}`, type: 'error' })
    }
  }, [selectedFolderId])

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

  // card → 4 アクション / stock → ダッシュボード / card → 別 card 位置 (reorder) /
  // card → フォルダタブ (folder 移動) の drop dispatcher
  const handleDashboardDrop = useCallback(async (action: DashboardDropAction) => {
    if (!action) return
    if (action.kind === 'card-to-folder') {
      // 選択中タブから別 folder にカードを移動 → 一覧から消える (移動先で fade-in 等の演出は省略)
      if (action.targetFolderId === selectedFolderId) return  // 同 folder への移動は no-op
      setMandalarts((prev) => prev.filter((m) => m.id !== action.sourceMandalartId))  // 楽観的
      try {
        await updateMandalartFolderId(action.sourceMandalartId, action.targetFolderId)
        setToast({ message: 'フォルダを移動しました', type: 'success' })
      } catch (e) {
        setToast({ message: `フォルダ移動失敗: ${(e as Error).message}`, type: 'error' })
        load()
      }
      return
    }
    if (action.kind === 'card-reorder') {
      // 共通 utility `reorderArray` で「source を target 位置に挿入する」semantics の新配列を計算。
      // pinned は API ORDER BY 側で先頭固定されるので、ここでは見た目の順序だけを反映すれば
      // 「pin ↑ + sort_order」が成立する (load() 後の DB 順序とも整合)。
      const srcIdx = mandalarts.findIndex((m) => m.id === action.sourceMandalartId)
      if (srcIdx < 0 || srcIdx === action.targetIndex) return
      const next = reorderArray(mandalarts, srcIdx, action.targetIndex)
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
      // 直接 API 呼出。エラー処理は同形式。現在選択中のフォルダに追加。
      try {
        const m = await createMandalartFromStockItem(action.stockItemId, selectedFolderId)
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
  }, [mandalarts, load, selectedFolderId])

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

  // 通常画面 (検索なし): API の ORDER BY (pinned > sort_order > updated_at) をそのまま尊重。
  // ピン留め / 手動並び替えはここで再ソートしないことが必須。
  // 検索結果: ユーザー選択の sortKey で再ソート (タイトル順 / 更新日順を切替えたい場合のみ意味あり)。
  const visible = useMemo(() => {
    if (!query.trim()) return mandalarts
    if (sortKey === 'title') {
      return [...mandalarts].sort((a, b) =>
        (a.title || '無題').localeCompare(b.title || '無題', 'ja'),
      )
    }
    return [...mandalarts].sort((a, b) => b.updated_at.localeCompare(a.updated_at))
  }, [mandalarts, sortKey, query])

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
          {/* 並び順セレクターは検索中のみ表示。通常画面は API ORDER BY (pinned > 手動 sort_order >
              updated_at) で十分なので選択肢を出さない (= ピン留め / D&D 並び替えがそのまま反映)。 */}
          {query.trim() && (
            <select
              value={sortKey}
              onChange={(e) => setSortKey(e.target.value as SortKey)}
              className="text-sm border border-neutral-200 dark:border-neutral-700 rounded-lg px-2 py-1.5 bg-white dark:bg-neutral-800 text-neutral-900 dark:text-neutral-100"
            >
              <option value="updated">更新日順</option>
              <option value="title">タイトル順</option>
            </select>
          )}
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

      {/* フォルダタブ列 (Phase B、migration 010)。検索中は無視 (search は全 folder 横断)。 */}
      {!query.trim() && (
        <div className="shrink-0 border-b border-neutral-200 dark:border-neutral-800 px-6">
          <div className="max-w-5xl mx-auto flex items-center gap-1 overflow-x-auto">
            {folders.map((f) => {
              const isActive = f.id === selectedFolderId
              const isRenaming = pendingFolder?.kind === 'rename' && pendingFolder.folderId === f.id
              if (isRenaming) {
                return (
                  <input
                    key={`rename-${f.id}`}
                    type="text"
                    autoFocus
                    value={pendingFolder.name}
                    onChange={(e) => setPendingFolder({ kind: 'rename', folderId: f.id, name: e.target.value })}
                    onBlur={commitPendingFolder}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') commitPendingFolder()
                      else if (e.key === 'Escape') setPendingFolder(null)
                    }}
                    className="shrink-0 px-3 py-2 text-sm font-medium border-b-2 border-blue-600 bg-transparent text-neutral-900 dark:text-neutral-100 focus:outline-none whitespace-nowrap"
                    style={{ width: '8rem' }}
                  />
                )
              }
              const isDeleteArmed = folderDeleteConfirm.isArmed(f.id)
              return (
                <button
                  key={f.id}
                  type="button"
                  data-folder-tab-id={f.id}
                  onClick={() => setSelectedFolderId(f.id)}
                  onContextMenu={(e) => {
                    e.preventDefault()
                    // 簡易メニュー: Shift+右クリックで削除 (system 不可)、それ以外は名前変更
                    if (e.shiftKey && !f.is_system) handleDeleteFolder(f)
                    else handleStartRenameFolder(f)
                  }}
                  title={f.is_system ? `${f.name} (system) — 右クリックで名前変更` : `${f.name} — 右クリックで名前変更 / hover の ✕ で削除`}
                  className={`group shrink-0 px-3 py-2 text-sm font-medium border-b-2 transition-colors select-none whitespace-nowrap inline-flex items-center ${
                    isActive
                      ? 'border-blue-600 text-neutral-900 dark:text-neutral-100'
                      : 'border-transparent text-neutral-500 dark:text-neutral-400 hover:text-neutral-800 dark:hover:text-neutral-200'
                  }`}
                >
                  <span>{f.name}</span>
                  {!f.is_system && (
                    <span
                      role="button"
                      tabIndex={0}
                      // 1 回目: armed 状態へ / 2 回目: 削除実行。タブ選択 click への伝播は止める
                      onMouseDown={(e) => e.stopPropagation()}
                      onClick={(e) => {
                        e.stopPropagation()
                        if (isDeleteArmed) {
                          folderDeleteConfirm.reset()
                          handleDeleteFolder(f)
                        } else {
                          folderDeleteConfirm.arm(f.id)
                        }
                      }}
                      title={isDeleteArmed ? 'もう一度クリックで削除' : 'フォルダを削除 (中のカードは Inbox に戻る)'}
                      className={`ml-1.5 px-1 text-xs rounded transition-opacity ${
                        isDeleteArmed
                          ? 'opacity-100 text-red-600 dark:text-red-400 font-bold'
                          : 'opacity-0 group-hover:opacity-60 hover:!opacity-100 text-neutral-500 hover:text-red-600 dark:text-neutral-400 dark:hover:text-red-400'
                      }`}
                    >
                      {isDeleteArmed ? '削除?' : '×'}
                    </span>
                  )}
                </button>
              )
            })}
            {pendingFolder?.kind === 'create' ? (
              <input
                type="text"
                autoFocus
                placeholder="フォルダ名"
                value={pendingFolder.name}
                onChange={(e) => setPendingFolder({ kind: 'create', name: e.target.value })}
                onBlur={commitPendingFolder}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') commitPendingFolder()
                  else if (e.key === 'Escape') setPendingFolder(null)
                }}
                className="shrink-0 px-3 py-2 text-sm font-medium border-b-2 border-blue-600 bg-transparent text-neutral-900 dark:text-neutral-100 placeholder:text-neutral-400 focus:outline-none whitespace-nowrap"
                style={{ width: '8rem' }}
              />
            ) : (
              <button
                type="button"
                onClick={handleStartAddFolder}
                title="新しいフォルダを追加"
                className="shrink-0 px-3 py-2 text-sm text-neutral-400 dark:text-neutral-500 hover:text-neutral-700 dark:hover:text-neutral-200 border-b-2 border-transparent select-none"
              >
                +
              </button>
            )}
          </div>
        </div>
      )}

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
                // drag 中の slide 方向計算。
                // - stock 源: 新規挿入なので target 以降が右にスライド (空間を作る)
                // - card 源: 並び替え。slid card の最終位置を pre-place するため、
                //   src と target の位置関係で方向決定:
                //   * src < target (左→右ドラッグ): (src, target] 範囲が **左**にスライド (source の slot を埋める)
                //   * src > target (右→左ドラッグ): [target, src) 範囲が **右**にスライド (target に空間を作る)
                //   結果として drop 後の natural レイアウトと slid 位置が一致し、snap-back が発生しない。
                let shift: 'left' | 'right' | null = null
                if (dnd.dragOverCardIndex !== null && dnd.dragSourceId !== m.id) {
                  const target = dnd.dragOverCardIndex
                  if (dnd.dragSourceKind === 'stock') {
                    if (index >= target) shift = 'right'
                  } else {
                    const srcIdx = visible.findIndex((mm) => mm.id === dnd.dragSourceId)
                    if (srcIdx >= 0) {
                      if (srcIdx < target && index > srcIdx && index <= target) shift = 'left'
                      else if (srcIdx > target && index >= target && index < srcIdx) shift = 'right'
                    }
                  }
                }
                return (
                  <MandalartCard
                    key={m.id}
                    mandalart={m}
                    index={index}
                    shift={shift}
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
  mandalart: m, index, shift, isDragSource, onOpen, onDuplicate, onDelete, onTogglePin,
  onMouseDown, wasRecentlyDragged,
}: {
  mandalart: Mandalart
  index: number
  /**
   * drag 中の slide 方向 (DashboardPage 側で計算)。
   * - 'right': 右にスライド (stock 新規挿入 / card 源右→左ドラッグの target..src-1)
   * - 'left':  左にスライド (card 源左→右ドラッグの src+1..target)
   * - null:    スライドなし (drag 不在 / 自分が source / 範囲外)
   */
  shift: 'left' | 'right' | null
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
        // drag 中の slide。方向は呼出側 (DashboardPage) が src vs target の位置関係で決定する。
        transform:
          shift === 'right' ? 'translateX(calc(100% + 12px))'
          : shift === 'left' ? 'translateX(calc(-100% - 12px))'
          : undefined,
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
