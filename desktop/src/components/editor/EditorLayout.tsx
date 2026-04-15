
import { useEffect, useState, useCallback, useRef, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useEditorStore } from '@/store/editorStore'
import { useClipboardStore } from '@/store/clipboardStore'
import { useGrid } from '@/hooks/useGrid'
import { useSubGrids } from '@/hooks/useSubGrids'
import { useRealtime } from '@/hooks/useRealtime'
import { useOffline } from '@/hooks/useOffline'
import { useUndo } from '@/hooks/useUndo'
import { useDragAndDrop, type DndUndoable } from '@/hooks/useDragAndDrop'
import GridView3x3 from './GridView3x3'
import GridView9x9 from './GridView9x9'
import Breadcrumb from './Breadcrumb'
import ParallelNav from './ParallelNav'
import SidePanel from './SidePanel'
import ImportDialog from './ImportDialog'
import ThemeToggle from '@/components/ThemeToggle'
import Toast from '@/components/ui/Toast'
import Button from '@/components/ui/Button'
import { getRootGrids, getChildGrids, getGrid, createGrid } from '@/lib/api/grids'
import { updateCell, pasteCell } from '@/lib/api/cells'
import { deleteMandalart } from '@/lib/api/mandalarts'
import { addToStock, pasteFromStock } from '@/lib/api/stock'
import { copyImageFromPath } from '@/lib/api/storage'
import { exportAsPNG, exportAsPDF, downloadJSON, downloadCSV } from '@/lib/utils/export'
import { exportToJSON, exportToCSV } from '@/lib/api/transfer'
import { isCellEmpty, hasPeripheralContent, getCenterCell } from '@/lib/utils/grid'
import { nextTabPosition } from '@/constants/tabOrder'
import type { Cell, Grid, StockItem } from '@/types'

type Props = {
  mandalartId: string
  userId: string
}

export default function EditorLayout({ mandalartId, userId }: Props) {
  const navigate = useNavigate()
  const {
    currentGridId, viewMode, breadcrumb, fontScale, fontLevel,
    setMandalartId, setCurrentGrid, setViewMode,
    pushBreadcrumb, popBreadcrumbTo, resetBreadcrumb, updateBreadcrumbItem,
    bumpFontLevel, resetFontLevel,
  } = useEditorStore()

  const { push: pushUndo } = useUndo()
  const { isOffline } = useOffline()
  const clipboard = useClipboardStore()

  const { data: gridData, reload, updateCell: updateCellLocal } = useGrid(currentGridId)
  const { subGrids, reload: reloadSubGrids } = useSubGrids(gridData?.cells ?? [])
  const gridRef = useRef<HTMLDivElement>(null)
  const gridAreaRef = useRef<HTMLDivElement>(null)
  const [gridSize, setGridSize] = useState(0)

  useEffect(() => {
    const el = gridAreaRef.current
    if (!el) return
    const observer = new ResizeObserver((entries) => {
      const { width, height } = entries[0].contentRect
      setGridSize(Math.min(width, height))
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  // 並列グリッド
  const [parallelGrids, setParallelGrids] = useState<Grid[]>([])
  const [parallelIndex, setParallelIndex] = useState(0)

  // サブグリッドの存在マップ (cellId → childCount)
  const [childCounts, setChildCounts] = useState<Map<string, number>>(new Map())


  // インライン編集中のセル ID (textarea を表示するセル)
  const [inlineEditingCellId, setInlineEditingCellId] = useState<string | null>(null)

  // コンテキストメニュー
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; cell: Cell } | null>(null)

  // トースト
  const [toast, setToast] = useState<{ message: string; type: 'info' | 'error' | 'success'; action?: { label: string; onClick: () => void } } | null>(null)

  // タイトルダイアログ

  // エクスポートメニュー
  const [exportMenu, setExportMenu] = useState(false)

  // ストック再読み込みキー
  const [stockReloadKey, setStockReloadKey] = useState(0)

  // インポートダイアログ（コンテキストメニュー「インポート」から起動）
  const [importTarget, setImportTarget] = useState<{ cellId: string; cellLabel: string } | null>(null)

  useEffect(() => {
    setMandalartId(mandalartId)
  }, [mandalartId, setMandalartId])

  // 初期ロード: ルートグリッドを取得してエディタを初期化
  useEffect(() => {
    async function init() {
      try {
        const roots = await getRootGrids(mandalartId)
        if (roots.length === 0) {
          setToast({ message: 'グリッドが見つかりません', type: 'error' })
          return
        }
        const root = roots[0]
        setCurrentGrid(root.id)
        setParallelGrids(roots)
        setParallelIndex(0)

        // ルートグリッドのセルを取得してパンくず初期化
        const { query } = await import('@/lib/db')
        const cells = await query<import('@/types').Cell>(
          'SELECT * FROM cells WHERE grid_id = ? AND deleted_at IS NULL ORDER BY position',
          [root.id],
        )
        resetBreadcrumb({
          gridId: root.id,
          cellId: null,
          label: cells.find((c: Cell) => c.position === 4)?.text ?? '',
          imagePath: cells.find((c: Cell) => c.position === 4)?.image_path ?? null,
          cells: cells,
          highlightPosition: null,
        })
      } catch (e) {
        console.error('EditorLayout init error:', e)
        setToast({ message: `読み込みエラー: ${(e as Error).message}`, type: 'error' })
      }
    }
    init()
  }, [mandalartId]) // eslint-disable-line react-hooks/exhaustive-deps

  // 子グリッド数を更新
  useEffect(() => {
    if (!gridData) return
    async function loadChildCounts() {
      const map = new Map<string, number>()
      for (const cell of gridData!.cells) {
        const children = await getChildGrids(cell.id)
        map.set(cell.id, children.length)
      }
      setChildCounts(map)
    }
    loadChildCounts()
  }, [gridData])

  // 現在表示中のグリッドの中心セル (position=4) が編集されたら、
  // パンくずリストの末尾エントリ (= 現在地) のラベル / 画像を即座に同期する。
  // ルート・サブグリッド・並列グリッドいずれでも「現在地 = 末尾」の原則で扱うので、
  // 並列切替時には handleParallelNav / handleAddParallel が末尾エントリの gridId も
  // 切替先と一致するよう更新している。
  useEffect(() => {
    if (!gridData || breadcrumb.length === 0) return
    const last = breadcrumb[breadcrumb.length - 1]
    if (gridData.id !== last.gridId) return
    const centerCell = gridData.cells.find((c) => c.position === 4)
    if (!centerCell) return
    const nextLabel = centerCell.text
    const nextImagePath = centerCell.image_path
    if (last.label !== nextLabel || (last.imagePath ?? null) !== (nextImagePath ?? null)) {
      updateBreadcrumbItem(last.gridId, { label: nextLabel, imagePath: nextImagePath })
    }
  }, [gridData, breadcrumb, updateBreadcrumbItem])

  // Realtime: 別デバイスでの変更が来たらローカルを再読み込み
  useRealtime(useCallback(() => {
    reload()
    reloadSubGrids()
  }, [reload, reloadSubGrids]))

  // D&D のドロップ先解決に使う全セル（3x3ではルート、9x9ではルート+サブを平坦化）
  const dndCells = useMemo<Cell[]>(() => {
    if (!gridData) return []
    if (viewMode === '9x9') {
      const flat: Cell[] = [...gridData.cells]
      subGrids.forEach((sub) => flat.push(...sub.cells))
      return flat
    }
    return gridData.cells
  }, [gridData, subGrids, viewMode])

  const handleStockDrop = useCallback(async (cellId: string) => {
    await addToStock(cellId)
    setStockReloadKey((k) => k + 1)
    setToast({ message: 'ストックに追加しました', type: 'success' })
  }, [])

  // 画像ファイルかどうかの簡易判定
  function isImagePath(p: string): boolean {
    return /\.(png|jpe?g|gif|webp|bmp|svg|heic|avif)$/i.test(p)
  }

  const reloadAll = useCallback(() => {
    reload()
    reloadSubGrids()
  }, [reload, reloadSubGrids])

  const handleStockPasteDrop = useCallback(async (stockItemId: string, targetCellId: string) => {
    try {
      await pasteFromStock(stockItemId, targetCellId)
      reloadAll()
      setToast({ message: 'ストックからペーストしました', type: 'success' })
    } catch (e) {
      setToast({ message: `ペースト失敗: ${(e as Error).message}`, type: 'error' })
    }
  }, [reloadAll])

  const {
    dragSourceId, dragOverId, isOverStock, isDragging,
    handleDragStart, handleStockItemDragStart,
  } = useDragAndDrop(
    dndCells,
    reloadAll,
    handleStockDrop,
    handleStockPasteDrop,
    useCallback((op: DndUndoable) => {
      pushUndo({
        description: op.description,
        undo: async () => { await op.undo(); reloadAll() },
        redo: async () => { await op.redo(); reloadAll() },
      })
    }, [pushUndo, reloadAll]),
  )

  // クリップボードショートカット用: マウス位置を追跡
  const mousePosRef = useRef({ x: 0, y: 0 })
  const dndCellsRef = useRef<Cell[]>(dndCells)
  dndCellsRef.current = dndCells
  // 最新の handlePaste を保持（useEffect の []-deps クロージャ越しでも最新参照を使うため）
  const handlePasteRef = useRef<(target: Cell) => Promise<void>>(async () => {})

  useEffect(() => {
    function onMouseMove(e: MouseEvent) {
      mousePosRef.current = { x: e.clientX, y: e.clientY }
    }
    function getHoveredCell(): Cell | null {
      const { x, y } = mousePosRef.current
      const el = document.elementFromPoint(x, y)
      const cellEl = el?.closest('[data-cell-id]') as HTMLElement | null
      const id = cellEl?.dataset.cellId
      if (!id) return null
      return dndCellsRef.current.find((c) => c.id === id) ?? null
    }
    function onKeyDown(e: KeyboardEvent) {
      const mod = e.metaKey || e.ctrlKey
      if (!mod) return
      // 入力中はテキスト編集側の ⌘X/C/V を優先
      const tag = (e.target as HTMLElement)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA') return

      if (e.key === 'c' || e.key === 'x') {
        const cell = getHoveredCell()
        if (!cell || isCellEmpty(cell)) return
        e.preventDefault()
        const mode = e.key === 'x' ? 'cut' : 'copy'
        useClipboardStore.getState().set(mode, cell.id)
        setToast({ message: mode === 'cut' ? 'カットしました' : 'コピーしました', type: 'info' })
      } else if (e.key === 'v') {
        const cell = getHoveredCell()
        if (!cell) return
        const cb = useClipboardStore.getState()
        if (!cb.sourceCellId || !cb.mode) return
        e.preventDefault()
        handlePasteRef.current(cell)
      }
    }
    document.addEventListener('mousemove', onMouseMove)
    window.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Tauri ネイティブのファイルドロップイベント
  // 画像ファイルを受け付け、ドロップ位置のセルに保存 + image_path を更新
  useEffect(() => {
    let unlisten: (() => void) | undefined

    import('@tauri-apps/api/webview').then(({ getCurrentWebview }) => {
      getCurrentWebview().onDragDropEvent(async (event) => {
        if (event.payload.type !== 'drop') return
        const { paths, position } = event.payload
        const imagePaths = paths.filter(isImagePath)
        if (imagePaths.length === 0) return

        const el = document.elementFromPoint(position.x, position.y)
        const cellEl = el?.closest('[data-cell-id]') as HTMLElement | null
        const cellId = cellEl?.dataset.cellId
        if (!cellId) return
        const cell = dndCellsRef.current.find((c) => c.id === cellId)
        if (!cell) return

        try {
          const newPath = await copyImageFromPath(imagePaths[0], cellId)
          await updateCellLocal(cellId, { image_path: newPath })
          reloadAll()
          setToast({ message: '画像を追加しました', type: 'success' })
        } catch (e) {
          console.error('image drop failed:', e)
          setToast({ message: `画像の追加に失敗: ${(e as Error).message}`, type: 'error' })
        }
      }).then((u) => { unlisten = u })
    })

    return () => { unlisten?.() }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // ダブルクリック: ドリル / 親グリッドへ戻る / ホームへ
  async function handleCellDrill(cell: Cell) {
    // インライン編集中なら抜けてから処理
    setInlineEditingCellId(null)

    // 9×9 表示で周辺サブグリッドのセルをクリックした場合
    // (= cell.grid_id が現在表示中のグリッドと異なる)
    // そのサブグリッド自体にフォーカスを移す (currentGrid をサブグリッドに切替 + breadcrumb を進める)。
    // view mode は 9×9 のまま維持されるので、そのサブグリッドが中央ブロックに表示され、
    // その子グリッドが周辺ブロックに配置される。
    if (gridData && cell.grid_id !== gridData.id) {
      const subGrid = await getGrid(cell.grid_id)
      if (!subGrid) return
      const parentCellId = subGrid.parent_cell_id
      if (!parentCellId) return
      const parentCell = gridData.cells.find((c) => c.id === parentCellId)
      if (!parentCell) return

      const siblings = await getChildGrids(parentCellId)
      const siblingIdx = siblings.findIndex((g) => g.id === subGrid.id)

      setCurrentGrid(subGrid.id)
      setParallelGrids(siblings.length > 0 ? siblings : [subGrid])
      setParallelIndex(Math.max(0, siblingIdx))
      pushBreadcrumb({
        gridId: subGrid.id,
        cellId: parentCell.id,
        label: parentCell.text,
        imagePath: parentCell.image_path,
        cells: gridData.cells,
        highlightPosition: parentCell.position,
      })
      return
    }

    // 中央セル（position 4）の特別処理
    if (cell.position === 4) {
      if (breadcrumb.length <= 1) {
        // ルートグリッドの中心セル（入力あり）→ ホームへ
        if (!isCellEmpty(cell)) {
          handleNavigateHome()
        }
        // 空ならドリル先がないので何もしない（編集はインラインで行う）
      } else {
        // サブグリッドの中心セル → 親グリッドに戻る
        const parent = breadcrumb[breadcrumb.length - 2]
        if (parent) {
          const parentCellId = parent.cellId
          const siblings = parentCellId ? await getChildGrids(parentCellId) : await getRootGrids(mandalartId)
          const siblingIdx = siblings.findIndex((g) => g.id === parent.gridId)
          setCurrentGrid(parent.gridId)
          setParallelGrids(siblings.length > 0 ? siblings : [])
          setParallelIndex(siblingIdx >= 0 ? siblingIdx : 0)
          popBreadcrumbTo(parent.gridId)
        }
      }
      return
    }

    const children = await getChildGrids(cell.id)
    if (children.length > 0) {
      // 掘り下げ
      const firstChild = children[0]
      setCurrentGrid(firstChild.id)
      setParallelGrids(children)
      setParallelIndex(0)

      const currentCells = gridData?.cells ?? []
      pushBreadcrumb({
        gridId: firstChild.id,
        cellId: cell.id,
        label: cell.text,
        imagePath: cell.image_path,
        cells: currentCells,
        highlightPosition: cell.position,
      })
    } else if (!isCellEmpty(cell)) {
      // 入力ありだが子グリッドなし → 新しいサブグリッドを作成して掘り下げ
      const newGrid = await createGrid({ mandalartId, parentCellId: cell.id, sortOrder: 0 })

      const centerCell = newGrid.cells.find((c) => c.position === 4)
      if (centerCell && !isCellEmpty(cell)) {
        await updateCell(centerCell.id, {
          text: cell.text,
          image_path: cell.image_path,
          color: cell.color,
        })
      }

      setCurrentGrid(newGrid.id)
      setParallelGrids([newGrid])
      setParallelIndex(0)

      const currentCells = gridData?.cells ?? []
      pushBreadcrumb({
        gridId: newGrid.id,
        cellId: cell.id,
        label: cell.text,
        imagePath: cell.image_path,
        cells: currentCells,
        highlightPosition: cell.position,
      })
    }
    // 空セルでドリルしようとしても何もしない (編集はインラインで)
  }

  // インライン編集の開始 (シングルクリック)
  function handleCellStartInlineEdit(cell: Cell) {
    setInlineEditingCellId(cell.id)
  }

  // インライン編集の確定 (blur / Esc / Tab / Cmd+Enter)
  async function handleCellCommitInlineEdit(cell: Cell, text: string) {
    setInlineEditingCellId(null)
    if (text === cell.text) return
    await handleSaveCell(cell.id, {
      text,
      image_path: cell.image_path,
      color: cell.color,
    })
  }

  // Tab キーでの次のセルへの移動
  // currentText: 直前にコミットしたテキスト（DB 反映前の状態を見る必要があるため引数で受け取る）
  function handleCellInlineNavigate(currentPosition: number, currentText: string, reverse: boolean) {
    const cells = gridData?.cells ?? []
    // gridData は更新前なので、今 commit したテキストで上書きしたバーチャル配列で判定する
    const updatedCells = cells.map((c) =>
      c.position === currentPosition ? { ...c, text: currentText } : c
    )
    const center = getCenterCell(updatedCells)
    const centerEmpty = !center || isCellEmpty(center)
    const nextPos = nextTabPosition(currentPosition, reverse)
    // 中心が空のときは周辺セル無効なので留まる
    if (centerEmpty && nextPos !== 4) {
      setInlineEditingCellId(updatedCells.find((c) => c.position === 4)?.id ?? null)
      return
    }
    const next = updatedCells.find((c) => c.position === nextPos)
    if (next) setInlineEditingCellId(next.id)
  }

  async function handleSaveCell(cellId: string, params: { text: string; image_path: string | null; color: string | null }) {
    const cell = gridData?.cells.find((c) => c.id === cellId)
    if (!cell) return

    // バリデーション: 周辺セルに入力があれば中心をクリアできない
    if (cell.position === 4 && isCellEmpty({ text: params.text, image_path: params.image_path })) {
      if (hasPeripheralContent(gridData?.cells ?? [])) {
        setToast({ message: '周辺セルに入力がある場合、中心セルを空にできません', type: 'error' })
        return
      }
    }

    const previous = { text: cell.text, image_path: cell.image_path, color: cell.color }
    await updateCellLocal(cellId, params)

    pushUndo({
      description: 'セル編集',
      undo: async () => { await updateCellLocal(cellId, previous) },
      redo: async () => { await updateCellLocal(cellId, params) },
    })
  }

  async function handleNavigateHome() {
    // 全セルが空なら未保存扱いで削除してホームへ
    const allEmpty = (gridData?.cells ?? []).every((c) => isCellEmpty(c))
    if (allEmpty) {
      await deleteMandalart(mandalartId)
      navigate('/dashboard')
      return
    }
    // タイトルは root 中心セルの自動キャッシュなので、別途ダイアログは出さない
    navigate('/dashboard')
  }

  // 並列ナビゲーション
  async function handleParallelNav(dir: 'prev' | 'next') {
    const nextIdx = dir === 'prev' ? parallelIndex - 1 : parallelIndex + 1
    if (nextIdx < 0 || nextIdx >= parallelGrids.length) return
    const nextGridId = parallelGrids[nextIdx].id
    // 並列切替に追従して breadcrumb 末尾エントリの gridId も更新し、
    // 新しい currentGrid に対してラベル同期の useEffect が走るようにする
    const last = breadcrumb[breadcrumb.length - 1]
    if (last) {
      updateBreadcrumbItem(last.gridId, { gridId: nextGridId })
    }
    setParallelIndex(nextIdx)
    setCurrentGrid(nextGridId)
  }

  async function handleAddParallel() {
    const parentCellId = breadcrumb[breadcrumb.length - 1]?.cellId ?? null
    const newGrid = await createGrid({ mandalartId, parentCellId, sortOrder: parallelGrids.length })
    // 並列追加直後はその新しいグリッドが currentGrid になるので、breadcrumb 末尾も追従させる
    const last = breadcrumb[breadcrumb.length - 1]
    if (last) {
      updateBreadcrumbItem(last.gridId, { gridId: newGrid.id })
    }
    setParallelGrids((prev) => [...prev, newGrid])
    setParallelIndex(parallelGrids.length)
    setCurrentGrid(newGrid.id)
  }

  // コンテキストメニュー
  function handleContextMenu(e: React.MouseEvent, cell: Cell) {
    setContextMenu({ x: e.clientX, y: e.clientY, cell })
  }

  async function handleContextAction(action: string) {
    if (!contextMenu) return
    const cell = contextMenu.cell
    setContextMenu(null)

    switch (action) {
      case 'copy':
        clipboard.set('copy', cell.id)
        setToast({ message: 'コピーしました', type: 'info' })
        break
      case 'cut':
        clipboard.set('cut', cell.id)
        setToast({ message: 'カットしました', type: 'info' })
        break
      case 'paste':
        await handlePaste(cell)
        break
      case 'stock':
        await addToStock(cell.id)
        setStockReloadKey((k) => k + 1)
        setToast({ message: 'ストックに追加しました', type: 'success' })
        break
      case 'import':
        setImportTarget({
          cellId: cell.id,
          cellLabel: cell.text || `セル ${cell.position + 1}`,
        })
        break
    }
  }

  async function handlePaste(target: Cell) {
    if (!clipboard.sourceCellId || !clipboard.mode) {
      setToast({ message: 'クリップボードが空です', type: 'info' })
      return
    }
    if (clipboard.sourceCellId === target.id) return
    try {
      await pasteCell(clipboard.sourceCellId, target.id, clipboard.mode)
      if (clipboard.mode === 'cut') clipboard.clear()
      reload()
      reloadSubGrids()
      setToast({ message: 'ペーストしました', type: 'success' })
    } catch (e) {
      setToast({ message: `ペースト失敗: ${(e as Error).message}`, type: 'error' })
    }
  }
  handlePasteRef.current = handlePaste

  async function handleStockPaste(item: StockItem) {
    // インライン編集中のセルを貼り付け先にする (詳細編集モーダル廃止後の動線)
    const targetCellId = inlineEditingCellId
    if (!targetCellId) {
      setToast({ message: 'ペースト先のセルをインライン編集中にしてください (またはドラッグ&ドロップしてください)', type: 'info' })
      return
    }
    await pasteFromStock(item.id, targetCellId)
    reload()
  }

  // エクスポート
  async function handleExport(format: 'png' | 'pdf' | 'json' | 'csv') {
    setExportMenu(false)
    if (!currentGridId) return
    if (format === 'png' && gridRef.current) {
      await exportAsPNG(gridRef.current)
    } else if (format === 'pdf' && gridRef.current) {
      await exportAsPDF(gridRef.current)
    } else if (format === 'json') {
      const data = await exportToJSON(currentGridId)
      downloadJSON(data)
    } else if (format === 'csv') {
      const csv = await exportToCSV(currentGridId)
      downloadCSV(csv)
    }
  }

  return (
    <div className="flex flex-col h-screen bg-gray-50 dark:bg-gray-950 text-gray-900 dark:text-gray-100 overflow-hidden">
      {/* オフラインインジケーター */}
      {isOffline && (
        <div className="bg-yellow-500 text-white text-xs text-center py-1">
          オフライン — 変更はローカルに保存されます
        </div>
      )}

      {/* ヘッダー */}
      <header className="bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-800 px-4 py-2 flex items-center gap-2 shrink-0">
        <Breadcrumb onHome={handleNavigateHome} />
        <div className="ml-auto flex items-center gap-2 shrink-0">
          <ThemeToggle />

          {/* 文字サイズ (-10 〜 +10、各段 ×1.1) */}
          <div className="flex items-stretch rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden text-xs">
            <button
              onClick={() => bumpFontLevel(-1)}
              className="px-2 py-1.5 hover:bg-gray-50 dark:hover:bg-gray-800 text-gray-600 dark:text-gray-300 disabled:opacity-30"
              disabled={fontLevel <= -10}
              title="文字を小さく"
            >
              A−
            </button>
            <button
              onClick={() => resetFontLevel()}
              className="px-2 py-1.5 hover:bg-gray-50 dark:hover:bg-gray-800 text-gray-600 dark:text-gray-300 border-x border-gray-200 dark:border-gray-700 min-w-[3.5rem] text-center tabular-nums"
              title={`100% にリセット (現在 level ${fontLevel >= 0 ? '+' : ''}${fontLevel})`}
            >
              {(fontScale * 100).toFixed(0)}%
            </button>
            <button
              onClick={() => bumpFontLevel(1)}
              className="px-2 py-1.5 hover:bg-gray-50 dark:hover:bg-gray-800 text-gray-600 dark:text-gray-300 disabled:opacity-30"
              disabled={fontLevel >= 20}
              title="文字を大きく"
            >
              A＋
            </button>
          </div>

          {/* 表示モード切替 */}
          <div className="flex rounded-lg border border-gray-200 overflow-hidden text-xs">
            {(['3x3', '9x9'] as const).map((mode) => (
              <button
                key={mode}
                onClick={() => setViewMode(mode)}
                className={`px-3 py-1.5 transition-colors ${viewMode === mode ? 'bg-blue-600 text-white' : 'hover:bg-gray-50 dark:hover:bg-gray-800 text-gray-600 dark:text-gray-300'}`}
              >
                {mode}
              </button>
            ))}
          </div>

          {/* エクスポート */}
          <div className="relative">
            <Button variant="secondary" size="sm" onClick={() => setExportMenu((v) => !v)}>
              エクスポート ▾
            </Button>
            {exportMenu && (
              <div className="absolute right-0 top-full mt-1 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl shadow-lg z-20 min-w-[120px]">
                {['png', 'pdf', 'json', 'csv'].map((fmt) => (
                  <button
                    key={fmt}
                    onClick={() => handleExport(fmt as 'png' | 'pdf' | 'json' | 'csv')}
                    className="w-full text-left px-4 py-2 text-sm hover:bg-gray-50 dark:hover:bg-gray-800 first:rounded-t-xl last:rounded-b-xl uppercase"
                  >
                    {fmt}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </header>

      {/* メインエリア */}
      <div className="flex flex-1 overflow-hidden">
        {/* グリッドエリア */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* 並列ナビ */}
          <div className="flex items-center justify-center py-2 shrink-0">
            <ParallelNav
              currentIndex={parallelIndex}
              total={parallelGrids.length}
              onPrev={() => handleParallelNav('prev')}
              onNext={() => handleParallelNav('next')}
            />
          </div>

          {/* グリッド表示（正方形・最大化） */}
          <div ref={gridAreaRef} className="flex-1 flex items-center justify-center overflow-hidden p-4">
            <div
              ref={gridRef}
              style={{ width: gridSize, height: gridSize }}
            >
              {gridData && viewMode === '3x3' && gridSize > 0 && (
                <GridView3x3
                  cells={gridData.cells}
                  childCounts={childCounts}
                  cutCellId={clipboard.mode === 'cut' ? clipboard.sourceCellId : null}
                  dragSourceId={dragSourceId}
                  dragOverId={dragOverId}
                  fontScale={fontScale}
                  inlineEditingCellId={inlineEditingCellId}
                  userId={userId}
                  mandalartId={mandalartId}
                  onCellSave={handleSaveCell}
                  onStartInlineEdit={handleCellStartInlineEdit}
                  onCommitInlineEdit={handleCellCommitInlineEdit}
                  onInlineNavigate={handleCellInlineNavigate}
                  onDrill={handleCellDrill}
                  onDragStart={handleDragStart}
                  onContextMenu={handleContextMenu}
                />
              )}
              {gridData && viewMode === '9x9' && gridSize > 0 && (
                <GridView9x9
                  rootCells={gridData.cells}
                  subGrids={subGrids}
                  childCounts={childCounts}
                  cutCellId={clipboard.mode === 'cut' ? clipboard.sourceCellId : null}
                  dragSourceId={dragSourceId}
                  dragOverId={dragOverId}
                  fontScale={fontScale}
                  inlineEditingCellId={inlineEditingCellId}
                  userId={userId}
                  mandalartId={mandalartId}
                  onCellSave={handleSaveCell}
                  onStartInlineEdit={handleCellStartInlineEdit}
                  onCommitInlineEdit={handleCellCommitInlineEdit}
                  onInlineNavigate={handleCellInlineNavigate}
                  onDrill={handleCellDrill}
                  onDragStart={handleDragStart}
                  onContextMenu={handleContextMenu}
                />
              )}
            </div>
          </div>

          {/* 並列グリッド追加ボタン */}
          <div className="flex justify-center py-2 shrink-0">
            <button
              onClick={handleAddParallel}
              className="text-sm text-gray-500 dark:text-gray-400 hover:text-blue-600 dark:hover:text-blue-400 border border-dashed border-gray-300 dark:border-gray-700 hover:border-blue-400 dark:hover:border-blue-500 px-4 py-2 rounded-lg transition-colors"
            >
              + 新しいグリッドを追加
            </button>
          </div>
        </div>

        {/* サイドパネル（デスクトップのみ） */}
        <div className="hidden lg:flex w-72 shrink-0">
          <SidePanel
            gridId={currentGridId}
            gridMemo={gridData?.memo ?? null}
            onStockPaste={handleStockPaste}
            isDragging={isDragging}
            isOverStock={isOverStock}
            stockReloadKey={stockReloadKey}
            onStockItemDragStart={handleStockItemDragStart}
            dragSourceId={dragSourceId}
          />
        </div>
      </div>

      {/* コンテキストメニュー */}
      {contextMenu && (
        <div
          className="fixed bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl shadow-lg z-30 text-sm min-w-[140px]"
          style={{ top: contextMenu.y, left: contextMenu.x }}
          onMouseLeave={() => setContextMenu(null)}
        >
          <button onClick={() => handleContextAction('cut')} className="w-full text-left px-4 py-2 hover:bg-gray-50 dark:hover:bg-gray-800 rounded-t-xl flex justify-between">
            カット <span className="text-gray-400 dark:text-gray-500">⌘X</span>
          </button>
          <button onClick={() => handleContextAction('copy')} className="w-full text-left px-4 py-2 hover:bg-gray-50 dark:hover:bg-gray-800 flex justify-between">
            コピー <span className="text-gray-400 dark:text-gray-500">⌘C</span>
          </button>
          <button
            onClick={() => handleContextAction('paste')}
            disabled={!clipboard.sourceCellId}
            className="w-full text-left px-4 py-2 hover:bg-gray-50 dark:hover:bg-gray-800 flex justify-between disabled:opacity-40 disabled:hover:bg-transparent"
          >
            ペースト <span className="text-gray-400 dark:text-gray-500">⌘V</span>
          </button>
          <button onClick={() => handleContextAction('stock')} className="w-full text-left px-4 py-2 hover:bg-gray-50 dark:hover:bg-gray-800">
            ストックに追加
          </button>
          <button onClick={() => handleContextAction('import')} className="w-full text-left px-4 py-2 hover:bg-gray-50 dark:hover:bg-gray-800 rounded-b-xl">
            ここにインポート
          </button>
        </div>
      )}

      {/* インポートダイアログ（セル配下へ） */}
      <ImportDialog
        open={importTarget !== null}
        mode={importTarget ? { kind: 'cell', cellId: importTarget.cellId, cellLabel: importTarget.cellLabel } : { kind: 'new' }}
        onClose={() => setImportTarget(null)}
        onComplete={() => {
          setImportTarget(null)
          reloadAll()
          setToast({ message: 'インポートしました', type: 'success' })
        }}
      />

      {/* トースト */}
      {toast && (
        <Toast
          message={toast.message}
          type={toast.type}
          action={toast.action}
          onClose={() => setToast(null)}
        />
      )}
    </div>
  )
}
