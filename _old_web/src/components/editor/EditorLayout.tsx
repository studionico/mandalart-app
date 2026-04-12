'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { useEditorStore } from '@/store/editorStore'
import { useClipboardStore } from '@/store/clipboardStore'
import { useGrid } from '@/hooks/useGrid'
import { useSubGrids } from '@/hooks/useSubGrids'
import { useRealtime } from '@/hooks/useRealtime'
import { useOffline } from '@/hooks/useOffline'
import { useUndo } from '@/hooks/useUndo'
import { useDragAndDrop } from '@/hooks/useDragAndDrop'
import GridView3x3 from './GridView3x3'
import GridView9x9 from './GridView9x9'
import Breadcrumb from './Breadcrumb'
import ParallelNav from './ParallelNav'
import CellEditModal from './CellEditModal'
import SidePanel from './SidePanel'
import Toast from '@/components/ui/Toast'
import Button from '@/components/ui/Button'
import { getRootGrids, getChildGrids, createGrid, deleteGrid } from '@/lib/api/grids'
import { updateCell, swapCellContent, swapCellSubtree, copyCellSubtree } from '@/lib/api/cells'
import { updateMandalartTitle } from '@/lib/api/mandalarts'
import { addToStock, pasteFromStock } from '@/lib/api/stock'
import { exportAsPNG, exportAsPDF, downloadJSON, downloadCSV } from '@/lib/utils/export'
import { exportToJSON, exportToCSV } from '@/lib/api/transfer'
import { isCellEmpty, hasPeripheralContent, getCenterCell } from '@/lib/utils/grid'
import type { Cell, Grid, StockItem } from '@/types'
import Modal from '@/components/ui/Modal'

type Props = {
  mandalartId: string
  userId: string
}

export default function EditorLayout({ mandalartId, userId }: Props) {
  const router = useRouter()
  const {
    currentGridId, viewMode, breadcrumb,
    setMandalartId, setCurrentGrid, setViewMode,
    pushBreadcrumb, popBreadcrumbTo, resetBreadcrumb,
  } = useEditorStore()

  const { push: pushUndo } = useUndo()
  const { isOffline } = useOffline()
  const clipboard = useClipboardStore()

  const { data: gridData, error: gridError, reload, updateCell: updateCellLocal, refreshCell } = useGrid(currentGridId)
  const { subGrids, reload: reloadSubGrids } = useSubGrids(gridData?.cells ?? [])
  const gridRef = useRef<HTMLDivElement>(null)

  // 並列グリッド
  const [parallelGrids, setParallelGrids] = useState<Grid[]>([])
  const [parallelIndex, setParallelIndex] = useState(0)

  // サブグリッドの存在マップ (cellId → childCount)
  const [childCounts, setChildCounts] = useState<Map<string, number>>(new Map())

  // セル編集モーダル
  const [editingCell, setEditingCell] = useState<Cell | null>(null)
  const [isMobile, setIsMobile] = useState(false)

  // コンテキストメニュー
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; cell: Cell } | null>(null)

  // トースト
  const [toast, setToast] = useState<{ message: string; type: 'info' | 'error' | 'success'; action?: { label: string; onClick: () => void } } | null>(null)

  // タイトルダイアログ
  const [titleDialog, setTitleDialog] = useState(false)
  const [titleValue, setTitleValue] = useState('')

  // エクスポートメニュー
  const [exportMenu, setExportMenu] = useState(false)

  useEffect(() => {
    setMandalartId(mandalartId)
    setIsMobile(window.matchMedia('(max-width: 768px)').matches)
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
        const { data: cells } = await import('@/lib/supabase/client').then(({ createClient }) =>
          createClient().from('cells').select('*').eq('grid_id', root.id)
        )
        resetBreadcrumb({
          gridId: root.id,
          cellId: null,
          label: cells?.find((c: Cell) => c.position === 4)?.text ?? '',
          cells: cells ?? [],
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

  // Realtime
  useRealtime(
    mandalartId,
    (cell) => refreshCell(cell),
    (cell) => refreshCell(cell),
    () => reload(),
    () => reload(),
  )

  const { handleDragStart, handleDrop } = useDragAndDrop(useCallback(() => {
    reload()
    reloadSubGrids()
  }, [reload, reloadSubGrids]))

  // シングルクリック: 掘り下げ or 編集フォールバック
  async function handleCellClick(cell: Cell) {
    // ルートグリッドの中心セル（入力あり）→ ホームへ
    if (breadcrumb.length === 1 && cell.position === 4 && !isCellEmpty(cell)) {
      handleNavigateHome()
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
        cells: currentCells,
        highlightPosition: cell.position,
      })
    } else if (isCellEmpty(cell)) {
      // 空セルはサブグリッドがなければ編集モードへ
      setEditingCell(cell)
    } else {
      // 入力ありだが子グリッドなし → 新しいサブグリッドを作成して掘り下げ
      const newGrid = await createGrid({ mandalartId, parentCellId: cell.id, sortOrder: 0 })

      // 中央セル（position 4）に親セルのテキストを自動入力
      const centerCell = newGrid.cells.find((c) => c.position === 4)
      console.log('centerCell:', centerCell, 'cell.text:', cell.text)
      if (centerCell && cell.text) {
        try {
          const updated = await updateCell(centerCell.id, { text: cell.text })
          console.log('updateCell result:', updated)
        } catch (e) {
          console.error('updateCell error:', e)
        }
      }

      setCurrentGrid(newGrid.id)
      setParallelGrids([newGrid])
      setParallelIndex(0)

      const currentCells = gridData?.cells ?? []
      pushBreadcrumb({
        gridId: newGrid.id,
        cellId: cell.id,
        label: cell.text,
        cells: currentCells,
        highlightPosition: cell.position,
      })
    }
  }

  function handleCellDoubleClick(cell: Cell) {
    setEditingCell(cell)
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

  function handleNavigateHome() {
    // タイトル未設定なら設定ダイアログを表示
    const center = getCenterCell(gridData?.cells ?? [])
    setTitleValue(center?.text ?? '')
    setTitleDialog(true)
  }

  async function handleSaveTitle(saveTitle: boolean) {
    if (saveTitle && titleValue.trim()) {
      await updateMandalartTitle(mandalartId, titleValue.trim())
    }
    setTitleDialog(false)
    router.push('/dashboard')
  }

  // 並列ナビゲーション
  async function handleParallelNav(dir: 'prev' | 'next') {
    const nextIdx = dir === 'prev' ? parallelIndex - 1 : parallelIndex + 1
    if (nextIdx < 0 || nextIdx >= parallelGrids.length) return
    setParallelIndex(nextIdx)
    setCurrentGrid(parallelGrids[nextIdx].id)
  }

  async function handleAddParallel() {
    const parentCellId = breadcrumb[breadcrumb.length - 1]?.cellId ?? null
    const newGrid = await createGrid({ mandalartId, parentCellId, sortOrder: parallelGrids.length })
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
      case 'copy': {
        const snapshot = await import('@/lib/api/stock').then(({ addToStock: _ }) => {
          return import('@/lib/api/transfer').then(({ exportToJSON }) => exportToJSON(cell.grid_id))
        })
        clipboard.set('copy', cell.id, { cell: { text: cell.text, image_path: cell.image_path, color: cell.color }, children: [] })
        break
      }
      case 'cut':
        clipboard.set('cut', cell.id, { cell: { text: cell.text, image_path: cell.image_path, color: cell.color }, children: [] })
        setToast({ message: 'カットしました', type: 'info' })
        break
      case 'stock':
        await addToStock(cell.id)
        setToast({ message: 'ストックに追加しました', type: 'success' })
        break
    }
  }

  async function handleStockPaste(item: StockItem) {
    if (!editingCell) {
      setToast({ message: 'ペーストするセルを選択してください', type: 'info' })
      return
    }
    await pasteFromStock(item.id, editingCell.id)
    reload()
  }

  // Tab ナビゲーション
  function handleNavigate(position: number) {
    const cell = gridData?.cells.find((c) => c.position === position)
    if (cell) setEditingCell(cell)
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
    <div className="flex flex-col h-screen bg-gray-50 overflow-hidden">
      {/* オフラインインジケーター */}
      {isOffline && (
        <div className="bg-yellow-500 text-white text-xs text-center py-1">
          オフライン — 変更はローカルに保存されます
        </div>
      )}

      {/* ヘッダー */}
      <header className="bg-white border-b border-gray-200 px-4 py-2 flex items-center gap-2 shrink-0">
        <Breadcrumb />
        <div className="ml-auto flex items-center gap-2 shrink-0">
          {/* 表示モード切替 */}
          <div className="flex rounded-lg border border-gray-200 overflow-hidden text-xs">
            {(['3x3', '9x9'] as const).map((mode) => (
              <button
                key={mode}
                onClick={() => setViewMode(mode)}
                className={`px-3 py-1.5 transition-colors ${viewMode === mode ? 'bg-blue-600 text-white' : 'hover:bg-gray-50 text-gray-600'}`}
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
              <div className="absolute right-0 top-full mt-1 bg-white border border-gray-200 rounded-xl shadow-lg z-20 min-w-[120px]">
                {['png', 'pdf', 'json', 'csv'].map((fmt) => (
                  <button
                    key={fmt}
                    onClick={() => handleExport(fmt as 'png' | 'pdf' | 'json' | 'csv')}
                    className="w-full text-left px-4 py-2 text-sm hover:bg-gray-50 first:rounded-t-xl last:rounded-b-xl uppercase"
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
        <div className="flex-1 flex flex-col items-center justify-center p-4 gap-4 overflow-auto">
          {/* 並列ナビ */}
          <div className="flex items-center gap-4">
            <ParallelNav
              currentIndex={parallelIndex}
              total={parallelGrids.length}
              onPrev={() => handleParallelNav('prev')}
              onNext={() => handleParallelNav('next')}
            />
          </div>

          {/* グリッド表示 */}
          <div ref={gridRef} className="w-full max-w-lg">
{gridData && viewMode === '3x3' && (
              <GridView3x3
                cells={gridData.cells}
                childCounts={childCounts}
                cutCellId={clipboard.mode === 'cut' ? clipboard.sourceCellId : null}
                onCellClick={handleCellClick}
                onCellDoubleClick={handleCellDoubleClick}
                onDragStart={handleDragStart}
                onDrop={handleDrop}
                onContextMenu={handleContextMenu}
              />
            )}
            {gridData && viewMode === '9x9' && (
              <GridView9x9
                rootCells={gridData.cells}
                subGrids={subGrids}
                childCounts={childCounts}
                cutCellId={clipboard.mode === 'cut' ? clipboard.sourceCellId : null}
                onCellClick={handleCellClick}
                onCellDoubleClick={handleCellDoubleClick}
                onDragStart={handleDragStart}
                onDrop={handleDrop}
                onContextMenu={handleContextMenu}
              />
            )}
          </div>

          {/* 並列グリッド追加ボタン */}
          <button
            onClick={handleAddParallel}
            className="text-sm text-gray-500 hover:text-blue-600 border border-dashed border-gray-300 hover:border-blue-400 px-4 py-2 rounded-lg transition-colors"
          >
            + 新しいグリッドを追加
          </button>
        </div>

        {/* サイドパネル（デスクトップのみ） */}
        <div className="hidden lg:flex w-72 shrink-0">
          <SidePanel
            gridId={currentGridId}
            gridMemo={gridData?.memo ?? null}
            onStockPaste={handleStockPaste}
          />
        </div>
      </div>

      {/* セル編集モーダル */}
      <CellEditModal
        cell={editingCell}
        allCells={gridData?.cells ?? []}
        userId={userId}
        mandalartId={mandalartId}
        onSave={handleSaveCell}
        onClose={() => setEditingCell(null)}
        onNavigate={handleNavigate}
        isMobile={isMobile}
      />

      {/* コンテキストメニュー */}
      {contextMenu && (
        <div
          className="fixed bg-white border border-gray-200 rounded-xl shadow-lg z-30 text-sm min-w-[140px]"
          style={{ top: contextMenu.y, left: contextMenu.x }}
          onMouseLeave={() => setContextMenu(null)}
        >
          <button onClick={() => handleContextAction('cut')} className="w-full text-left px-4 py-2 hover:bg-gray-50 rounded-t-xl flex justify-between">
            カット <span className="text-gray-400">⌘X</span>
          </button>
          <button onClick={() => handleContextAction('copy')} className="w-full text-left px-4 py-2 hover:bg-gray-50 flex justify-between">
            コピー <span className="text-gray-400">⌘C</span>
          </button>
          <button onClick={() => handleContextAction('stock')} className="w-full text-left px-4 py-2 hover:bg-gray-50 rounded-b-xl">
            ストックに追加
          </button>
        </div>
      )}

      {/* タイトル設定ダイアログ */}
      <Modal open={titleDialog} onClose={() => setTitleDialog(false)} title="マンダラートのタイトルを設定">
        <p className="text-sm text-gray-500 mb-3">後からダッシュボードで変更できます</p>
        <input
          type="text"
          value={titleValue}
          onChange={(e) => setTitleValue(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') handleSaveTitle(true) }}
          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm mb-4 focus:outline-none focus:ring-2 focus:ring-blue-500"
          placeholder="タイトル"
        />
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => handleSaveTitle(false)}>スキップ</Button>
          <Button onClick={() => handleSaveTitle(true)}>保存してホームへ</Button>
        </div>
      </Modal>

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
