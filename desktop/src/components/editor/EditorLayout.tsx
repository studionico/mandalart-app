
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
import CellComponent from './Cell'
import Breadcrumb from './Breadcrumb'
import SidePanel from './SidePanel'
import ImportDialog from './ImportDialog'
import ThemeToggle from '@/components/ThemeToggle'
import Toast from '@/components/ui/Toast'
import Button from '@/components/ui/Button'
import { getRootGrids, getChildGrids, getGrid, createGrid, deleteGrid } from '@/lib/api/grids'
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
      // 左右の並列ナビボタン分を横幅から差し引く (2 * (ボタン幅 48 + gap 16) = 128px)
      const SIDE_BUTTON_RESERVE = 128
      const usableWidth = Math.max(0, width - SIDE_BUTTON_RESERVE)
      const next = Math.floor(Math.min(usableWidth, height))
      // 数 px 単位の微小な変化は無視する。drill 遷移時に header の scrollbar 出し入れなどで
      // ちらつく原因になるため。
      setGridSize((prev) => (Math.abs(prev - next) < 4 ? prev : next))
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  // 並列グリッド
  const [parallelGrids, setParallelGrids] = useState<Grid[]>([])
  const [parallelIndex, setParallelIndex] = useState(0)

  // 並列グリッド切替時のスライドアニメーション用 state
  // slide が truthy な間は 2 枚のグリッド (from/to) を横並びに描画し、
  // CSS keyframes で translateX を動かす。
  type SlideState = {
    fromCells: Cell[]
    toCells: Cell[]
    direction: 'forward' | 'backward'
  }
  const [slide, setSlide] = useState<SlideState | null>(null)
  const SLIDE_DURATION_MS = 320

  // ドリル (3×3 のみ) のセル軌道アニメーション用 state
  // - targetCells: 遷移後のグリッドの 9 セル
  // - targetGridId: 切替後の currentGridId になる grid の id。
  //                 gridData がこの id に追いつくまで orbit を表示し続けることで
  //                 古い gridData が一瞬表示される「点滅」を防ぐ
  // - childCountsByCellId: orbit 中の各セルに付ける border (サブグリッドあり = 2px 黒) の
  //                        判定用。通常時の childCounts は gridData ベースで遅れて更新される
  //                        ため、orbit 開始時に target 専用に事前フェッチして持たせる
  // - movingCellId: 「動くセル」の id (ドリル元 or ドリル先で位置が変わるセル)
  // - movingFromPosition: 動くセルの開始位置 (target 内でのレイアウト基準)
  // - direction: 'drill-down' なら 4 番を除く [7,6,3,0,1,2,5,8] を stagger
  //              'drill-up'   なら [7,6,3,0,1,2,5,8,4] を stagger (中心は最後)
  //              'initial'    なら [4,7,6,3,0,1,2,5,8] を stagger (中心から時計回り)
  type OrbitState = {
    targetCells: Cell[]
    targetGridId: string
    childCountsByCellId: Map<string, number>
    movingCellId: string | null
    movingFromPosition: number
    direction: 'drill-down' | 'drill-up' | 'initial'
  }
  const [orbit, setOrbit] = useState<OrbitState | null>(null)
  // drill-down と drill-up を同じ感覚になるよう stagger / fade を揃える。
  // drill-down: 7 * 85 + 400 = 995ms  (≒ 1s)
  // drill-up:   8 * 85 + 400 = 1080ms (≒ 1.1s、ステップが 1 つ多いぶん若干長い)
  // initial:    8 * 85 + 400 = 1080ms (中心含む 9 セル)
  const ORBIT_STAGGER_DOWN_MS = 85
  const ORBIT_STAGGER_UP_MS = 85
  const ORBIT_STAGGER_INIT_MS = 85
  const ORBIT_FADE_DOWN_MS = 400
  const ORBIT_FADE_UP_MS = 400
  const ORBIT_FADE_INIT_MS = 400
  /** target cells それぞれの子グリッド数を事前フェッチする */
  async function fetchChildCountsFor(cells: Cell[]): Promise<Map<string, number>> {
    const map = new Map<string, number>()
    await Promise.all(
      cells.map(async (c) => {
        const children = await getChildGrids(c.id)
        map.set(c.id, children.length)
      }),
    )
    return map
  }

  /**
   * 移動セル用の keyframe 名を返す。from → to の相対位置から 8 方向のうちどれかを選ぶ。
   * 同一位置 (fromPos === toPos) のときは null。
   */
  function orbitMoveAnimationName(fromPos: number, toPos: number): string | null {
    if (fromPos === toPos) return null
    const dCol = (fromPos % 3) - (toPos % 3)
    const dRow = Math.floor(fromPos / 3) - Math.floor(toPos / 3)
    if (dCol === -1 && dRow === -1) return 'orbit-from-nw'
    if (dCol === 0 && dRow === -1) return 'orbit-from-n'
    if (dCol === 1 && dRow === -1) return 'orbit-from-ne'
    if (dCol === -1 && dRow === 0) return 'orbit-from-w'
    if (dCol === 1 && dRow === 0) return 'orbit-from-e'
    if (dCol === -1 && dRow === 1) return 'orbit-from-sw'
    if (dCol === 0 && dRow === 1) return 'orbit-from-s'
    if (dCol === 1 && dRow === 1) return 'orbit-from-se'
    return null
  }

  // orbit 中に gridData が target に追いついたら orbit をクリアする。
  // orbit 表示 → 通常表示の切替で古いセルが一瞬見える (= ドリル末の点滅) を防ぐ。
  // また、通常描画に使う childCounts は別の useEffect が async で再計算するため
  // 反映まで数 ms 遅れてセルの border 幅が一瞬ずれてちらつく。これを防ぐため
  // orbit クリアと同時に事前フェッチ済みの childCountsByCellId を childCounts に
  // 流し込んでおく。
  //
  // 'initial' (ダッシュボードから開いた直後) は resetBreadcrumb により currentGridId が
  // 既にセットされていて gridData のフェッチが走る。この auto-clear を走らせてしまうと
  // アニメーション終了前に orbit がクリアされてしまうので、'initial' 中は除外する。
  // 'initial' 用の orbit クリアは init() 内の setTimeout で明示的に行う。
  useEffect(() => {
    if (
      orbit &&
      orbit.direction !== 'initial' &&
      gridData &&
      gridData.id === orbit.targetGridId
    ) {
      setChildCounts(orbit.childCountsByCellId)
      setOrbit(null)
    }
  }, [orbit, gridData])

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

        // 初回表示アニメーション: 中心 → 時計回りに周辺を順に fade-in
        const childCountsByCellId = await fetchChildCountsFor(cells)
        setOrbit({
          targetCells: cells,
          targetGridId: root.id,
          childCountsByCellId,
          movingCellId: null,
          movingFromPosition: 4, // 未使用 (moving cell なし)
          direction: 'initial',
        })
        await new Promise((r) =>
          setTimeout(r, ORBIT_STAGGER_INIT_MS * 8 + ORBIT_FADE_INIT_MS),
        )
        setChildCounts(childCountsByCellId)
        setOrbit(null)
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
        const currentEntry = breadcrumb[breadcrumb.length - 1]
        if (parent) {
          // parent.cellId は「親グリッドをさらに掘るために使われたセル (= 祖父階層のセル)」
          // なので、ここで欲しい「親グリッド内のドリル元セル」ではない。
          // 現在地 breadcrumb エントリの cellId が「現在 grid を生んだ親 grid 内のセル」。
          const drillFromCellId = currentEntry?.cellId ?? null
          const siblings = parent.cellId
            ? await getChildGrids(parent.cellId)
            : await getRootGrids(mandalartId)
          const siblingIdx = siblings.findIndex((g) => g.id === parent.gridId)
          // 3×3 表示ならドリルアップの軌道アニメーションを再生してから状態を切替
          if (viewMode === '3x3') {
            // 移動セル = 親グリッド内の「ドリル元セル」(= 今の中心が対応しているセル)
            const parentGridData = await getGrid(parent.gridId)
            const movingCell = drillFromCellId
              ? parentGridData.cells.find((c) => c.id === drillFromCellId)
              : null
            if (movingCell) {
              const childCountsByCellId = await fetchChildCountsFor(parentGridData.cells)
              setOrbit({
                targetCells: parentGridData.cells,
                targetGridId: parent.gridId,
                childCountsByCellId,
                movingCellId: movingCell.id,
                movingFromPosition: 4, // 現在の中心から親内の対応位置へ移動
                direction: 'drill-up',
              })
              await new Promise((r) =>
                setTimeout(r, ORBIT_STAGGER_UP_MS * 8 + ORBIT_FADE_UP_MS),
              )
            }
          }
          setCurrentGrid(parent.gridId)
          setParallelGrids(siblings.length > 0 ? siblings : [])
          setParallelIndex(siblingIdx >= 0 ? siblingIdx : 0)
          popBreadcrumbTo(parent.gridId)
          // orbit は gridData が parent.gridId に追いついた時点で useEffect がクリア
        }
      }
      return
    }

    const children = await getChildGrids(cell.id)
    if (children.length > 0) {
      // 掘り下げ
      const firstChild = await getGrid(children[0].id)
      const currentCells = gridData?.cells ?? []

      if (viewMode === '3x3') {
        const targetCenter = firstChild.cells.find((c) => c.position === 4)
        const childCountsByCellId = await fetchChildCountsFor(firstChild.cells)
        setOrbit({
          targetCells: firstChild.cells,
          targetGridId: firstChild.id,
          childCountsByCellId,
          movingCellId: targetCenter?.id ?? null,
          movingFromPosition: cell.position, // クリックした周辺セルの位置から中心へ
          direction: 'drill-down',
        })
        await new Promise((r) =>
          setTimeout(r, ORBIT_STAGGER_DOWN_MS * 7 + ORBIT_FADE_DOWN_MS),
        )
      }

      setCurrentGrid(firstChild.id)
      setParallelGrids([firstChild])
      setParallelIndex(0)
      pushBreadcrumb({
        gridId: firstChild.id,
        cellId: cell.id,
        label: cell.text,
        imagePath: cell.image_path,
        cells: currentCells,
        highlightPosition: cell.position,
      })
      // orbit は gridData が firstChild.id に追いついた時点で useEffect がクリア
    } else if (!isCellEmpty(cell)) {
      // 入力ありだが子グリッドなし → 新しいサブグリッドを作成して掘り下げ
      const newGrid = await createGrid({ mandalartId, parentCellId: cell.id, sortOrder: 0 })

      const centerCell = newGrid.cells.find((c) => c.position === 4)
      const populatedCells = centerCell && !isCellEmpty(cell)
        ? newGrid.cells.map((c) =>
            c.position === 4
              ? { ...c, text: cell.text, image_path: cell.image_path, color: cell.color }
              : c,
          )
        : newGrid.cells
      if (centerCell && !isCellEmpty(cell)) {
        await updateCell(centerCell.id, {
          text: cell.text,
          image_path: cell.image_path,
          color: cell.color,
        })
      }

      if (viewMode === '3x3') {
        const targetCenter = populatedCells.find((c) => c.position === 4)
        // 新規作成したばかりのサブグリッドなので子グリッド 0 件で確定
        const childCountsByCellId = new Map<string, number>(
          populatedCells.map((c) => [c.id, 0]),
        )
        setOrbit({
          targetCells: populatedCells,
          targetGridId: newGrid.id,
          childCountsByCellId,
          movingCellId: targetCenter?.id ?? null,
          movingFromPosition: cell.position,
          direction: 'drill-down',
        })
        await new Promise((r) =>
          setTimeout(r, ORBIT_STAGGER_DOWN_MS * 7 + ORBIT_FADE_DOWN_MS),
        )
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
      // orbit は gridData が newGrid.id に追いついた時点で useEffect がクリア
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

  /**
   * 指定グリッドの中心セルが空なら soft-delete する。
   * さらに、これが最後の子グリッド (= 並列を含めて他に兄弟が無い) だった場合は、
   * ドリル元のセル (親セル) も連動してクリアする。これをやらないと、
   * サブグリッドの中心セルを空にしても親セル側に値が残っていて「復活した」
   * ように見えてしまう (親セルは DB 上別の行なので updateCell では連動しない)。
   * 呼び出し側は必要に応じて parallelGrids / parallelIndex を更新する。
   */
  async function cleanupGridIfCenterEmpty(gridId: string, cells: Cell[]): Promise<boolean> {
    const center = cells.find((c) => c.position === 4)
    const isEmpty = !center || isCellEmpty(center)
    if (!isEmpty) return false
    try {
      // 削除前にグリッド情報 (parent_cell_id) を取得しておく
      const gridWithCells = await getGrid(gridId)
      const parentCellId = gridWithCells.parent_cell_id

      await deleteGrid(gridId)

      // 削除後、他の兄弟 (並列を含む) が 1 つも残っていなければドリル元セルも空にする
      if (parentCellId) {
        const siblings = await getChildGrids(parentCellId)
        if (siblings.length === 0) {
          await updateCell(parentCellId, { text: '', image_path: null, color: null })
        }
      }
      return true
    } catch (e) {
      console.error('cleanup deleteGrid failed:', e)
      return false
    }
  }

  async function handleNavigateHome() {
    if (!gridData) {
      navigate('/dashboard')
      return
    }
    const center = gridData.cells.find((c) => c.position === 4)
    const centerEmpty = !center || isCellEmpty(center)

    if (centerEmpty) {
      // 現在のグリッドは「空」= 存在しないものとして削除する。
      // 唯一のルートグリッドだった場合はマンダラート全体を削除する (以前の挙動を踏襲)。
      if (breadcrumb.length === 1 && parallelGrids.length === 1) {
        await deleteMandalart(mandalartId)
      } else {
        await cleanupGridIfCenterEmpty(gridData.id, gridData.cells)
      }
    }
    navigate('/dashboard')
  }

  // パンくず項目クリックで階層を戻す際、現在地グリッドが空なら削除する
  async function handleBreadcrumbNavigate(targetGridId: string) {
    if (!gridData) {
      popBreadcrumbTo(targetGridId)
      return
    }
    const oldGridId = gridData.id
    const oldCells = gridData.cells

    // 先に cleanup (DB 上のグリッド削除 + 必要なら親セルのクリア) を完了させてから
    // popBreadcrumbTo を呼ぶ。
    // 順序を逆にすると、popBreadcrumbTo で React が再レンダし useGrid が target grid
    // を即座にフェッチしてしまい、cleanup による親セルクリアが反映される前のキャッシュで
    // gridData が固定化される (= 画面上で変化が見えない) ため。
    await cleanupGridIfCenterEmpty(oldGridId, oldCells)

    // target 階層の並列兄弟を再取得して parallelGrids / parallelIndex を現在地に合わせる。
    // これをやらないと、遷移元 (より下位) の parallelGrids が残ったまま target を表示
    // してしまい、実在しない「＜」「＞」ボタンが出て、クリックすると別階層のグリッドに
    // 飛んでしまう。
    const targetEntry = breadcrumb.find((b) => b.gridId === targetGridId)
    if (targetEntry) {
      const siblings = targetEntry.cellId
        ? await getChildGrids(targetEntry.cellId)
        : await getRootGrids(mandalartId)
      const idx = siblings.findIndex((g) => g.id === targetGridId)
      setParallelGrids(siblings)
      setParallelIndex(idx >= 0 ? idx : 0)
    } else {
      // 万一 target が breadcrumb 内に見つからない場合は安全側に倒してクリア
      setParallelGrids([])
      setParallelIndex(0)
    }

    popBreadcrumbTo(targetGridId)
  }

  // 並列ナビゲーション
  async function handleParallelNav(dir: 'prev' | 'next') {
    if (slide) return // アニメーション中は無視
    const nextIdx = dir === 'prev' ? parallelIndex - 1 : parallelIndex + 1
    if (nextIdx < 0 || nextIdx >= parallelGrids.length) return
    const nextGridId = parallelGrids[nextIdx].id

    // 切替先のセルを取得 (アニメーション中に描画するため)
    const nextGridData = await getGrid(nextGridId)
    const oldGridId = gridData?.id
    const fromCells = gridData?.cells ?? []

    // 状態更新 (breadcrumb 末尾 gridId / parallelIndex / currentGrid)
    const last = breadcrumb[breadcrumb.length - 1]
    if (last) {
      updateBreadcrumbItem(last.gridId, { gridId: nextGridId })
    }
    setParallelIndex(nextIdx)
    setCurrentGrid(nextGridId)

    // スライド描画を開始し、終了後に state クリア
    setSlide({
      fromCells,
      toCells: nextGridData.cells,
      direction: dir === 'next' ? 'forward' : 'backward',
    })
    await new Promise((r) => setTimeout(r, SLIDE_DURATION_MS))
    setSlide(null)

    // 旧グリッドの中心セルが空なら削除する
    // (アニメーション終了後にまとめて片付けることで、スライド中の視覚には残っているが
    //  データ的には存在しない、という整合を担保)
    if (oldGridId) {
      const deleted = await cleanupGridIfCenterEmpty(oldGridId, fromCells)
      if (deleted) {
        // parallelGrids から除去しつつ、現在地 (next) のインデックスを再計算する。
        // 'next' 方向では old が next より前にあったので index が 1 減る。
        // 'prev' 方向では old が next より後ろにあったので index は変わらない。
        setParallelGrids((prev) => prev.filter((g) => g.id !== oldGridId))
        setParallelIndex((prev) => (dir === 'next' ? Math.max(0, prev - 1) : prev))
      }
    }
  }

  async function handleAddParallel() {
    if (slide) return
    const parentCellId = breadcrumb[breadcrumb.length - 1]?.cellId ?? null
    const newGrid = await createGrid({ mandalartId, parentCellId, sortOrder: parallelGrids.length })

    // 元 (現在表示中) のグリッドの中心セル内容を新しい並列グリッドの中心セルに自動コピーする
    const originCenter = gridData?.cells.find((c) => c.position === 4)
    const newCenter = newGrid.cells.find((c) => c.position === 4)
    let toCells: Cell[] = newGrid.cells
    if (originCenter && newCenter && !isCellEmpty(originCenter)) {
      await updateCell(newCenter.id, {
        text: originCenter.text,
        image_path: originCenter.image_path,
        color: originCenter.color,
      })
      // アニメーション用のセル配列にも反映させる (まだ newGrid.cells は古い状態)
      toCells = newGrid.cells.map((c) =>
        c.position === 4
          ? { ...c, text: originCenter.text, image_path: originCenter.image_path, color: originCenter.color }
          : c,
      )
    }

    const fromCells = gridData?.cells ?? []

    // 並列追加直後はその新しいグリッドが currentGrid になるので、breadcrumb 末尾も追従させる
    const last = breadcrumb[breadcrumb.length - 1]
    if (last) {
      updateBreadcrumbItem(last.gridId, { gridId: newGrid.id })
    }
    setParallelGrids((prev) => [...prev, newGrid])
    setParallelIndex(parallelGrids.length)
    setCurrentGrid(newGrid.id)

    // スライドアニメーション (新グリッドが右から入ってきて元のグリッドが左へ)
    setSlide({
      fromCells,
      toCells,
      direction: 'forward',
    })
    await new Promise((r) => setTimeout(r, SLIDE_DURATION_MS))
    setSlide(null)
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
        <Breadcrumb onHome={handleNavigateHome} onNavigate={handleBreadcrumbNavigate} />
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
          {/* グリッド表示（正方形・最大化） + 両脇に並列ナビボタン */}
          <div ref={gridAreaRef} className="flex-1 flex items-center justify-center overflow-hidden p-4 gap-4">
            {/* 左側: 1 つ前の並列グリッドへ戻る「＜」 */}
            <div className="w-12 flex items-center justify-center shrink-0">
              {parallelIndex > 0 && (
                <button
                  onClick={() => handleParallelNav('prev')}
                  className="w-12 h-12 rounded-full bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 shadow-sm flex items-center justify-center"
                  title="前の並列グリッドへ"
                >
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="15 18 9 12 15 6" />
                  </svg>
                </button>
              )}
            </div>

            <div
              ref={gridRef}
              className="relative overflow-hidden"
              style={{ width: gridSize, height: gridSize }}
            >
              {slide && gridSize > 0 ? (
                // スライド中: from (現在) と to (切替先) を横並びに描画して
                // translateX で動かす。アニメーション中は操作を無効化する。
                <div
                  className="flex absolute top-0 left-0"
                  style={{
                    width: gridSize * 2,
                    height: gridSize,
                    transform:
                      slide.direction === 'forward' ? 'translateX(0)' : 'translateX(-50%)',
                    animation: `${
                      slide.direction === 'forward'
                        ? 'parallel-slide-forward'
                        : 'parallel-slide-backward'
                    } ${SLIDE_DURATION_MS}ms ease-in-out forwards`,
                    pointerEvents: 'none',
                  }}
                >
                  {(slide.direction === 'forward'
                    ? [slide.fromCells, slide.toCells]
                    : [slide.toCells, slide.fromCells]
                  ).map((cells, i) => (
                    <div
                      key={i}
                      style={{ width: gridSize, height: gridSize, flexShrink: 0 }}
                    >
                      {viewMode === '3x3' ? (
                        <GridView3x3
                          cells={cells}
                          childCounts={childCounts}
                          cutCellId={null}
                          dragSourceId={null}
                          dragOverId={null}
                          fontScale={fontScale}
                          inlineEditingCellId={null}
                          onStartInlineEdit={handleCellStartInlineEdit}
                          onCommitInlineEdit={handleCellCommitInlineEdit}
                          onInlineNavigate={handleCellInlineNavigate}
                          onDrill={handleCellDrill}
                          onContextMenu={handleContextMenu}
                        />
                      ) : (
                        <GridView9x9
                          rootCells={cells}
                          subGrids={subGrids}
                          childCounts={childCounts}
                          cutCellId={null}
                          dragSourceId={null}
                          dragOverId={null}
                          fontScale={fontScale}
                          inlineEditingCellId={null}
                          onStartInlineEdit={handleCellStartInlineEdit}
                          onCommitInlineEdit={handleCellCommitInlineEdit}
                          onInlineNavigate={handleCellInlineNavigate}
                          onDrill={handleCellDrill}
                          onContextMenu={handleContextMenu}
                        />
                      )}
                    </div>
                  ))}
                </div>
              ) : orbit && viewMode === '3x3' && gridSize > 0 ? (
                // セル軌道アニメーション中: 遷移後のグリッドの 9 セルを描画しつつ、
                // 時計回りに staggered fade-in。移動セルだけは CSS transition で
                // 開始位置から自然位置へ動く。
                <div className="grid grid-cols-3 grid-rows-3 gap-2 w-full h-full pointer-events-none">
                  {(() => {
                    const stagger =
                      orbit.direction === 'drill-up'
                        ? ORBIT_STAGGER_UP_MS
                        : orbit.direction === 'initial'
                          ? ORBIT_STAGGER_INIT_MS
                          : ORBIT_STAGGER_DOWN_MS
                    const fade =
                      orbit.direction === 'drill-up'
                        ? ORBIT_FADE_UP_MS
                        : orbit.direction === 'initial'
                          ? ORBIT_FADE_INIT_MS
                          : ORBIT_FADE_DOWN_MS
                    // 時計回り順:
                    //  drill-up は中心を含む 9 position (中心は最後)
                    //  drill-down は 8 周辺のみ (中心は moving cell)
                    //  initial は中心から始まる 9 position
                    const order =
                      orbit.direction === 'drill-up'
                        ? [7, 6, 3, 0, 1, 2, 5, 8, 4]
                        : orbit.direction === 'initial'
                          ? [4, 7, 6, 3, 0, 1, 2, 5, 8]
                          : [7, 6, 3, 0, 1, 2, 5, 8]
                    const center = orbit.targetCells.find((c) => c.position === 4)
                    const centerEmpty = !center || isCellEmpty(center)
                    return Array.from({ length: 9 }).map((_, pos) => {
                      const cell = orbit.targetCells.find((c) => c.position === pos)
                      if (!cell) return <div key={pos} />
                      const isMoving = cell.id === orbit.movingCellId
                      const staggerIdx = order.indexOf(pos)
                      // drill-down で pos=4 (= 移動セル) は stagger に含まれないので delay 0
                      const fadeDelay = staggerIdx >= 0 ? staggerIdx * stagger : 0

                      // 移動セルの transform 遷移は方向別:
                      //  drill-down: delay 0, duration = fade — 一気に中心へ寄る
                      //  drill-up  : delay 0, duration = staggerIdx * stagger + fade
                      //              (natural timing で周辺に到着するよう長くドリフト)
                      let movingDuration = fade
                      const movingDelay = 0
                      if (isMoving && orbit.direction === 'drill-up') {
                        const arrival = Math.max(0, staggerIdx) * stagger + fade
                        movingDuration = Math.max(fade, arrival)
                      }

                      // 移動セル用の keyframe 名 (8 方向から選択)
                      const moveAnimName = isMoving
                        ? orbitMoveAnimationName(orbit.movingFromPosition, pos)
                        : null

                      // CSS keyframes + animation-fill-mode: both を使う。これにより
                      // 各セルは delay 期間中は from フレームで固定され、時間が来たら
                      // 再生され、終了後は to フレームで固定される。React の state flip
                      // に依存しないので、タイミングのブレで「一瞬で終わる」問題を防げる。
                      const wrapperStyle: React.CSSProperties =
                        isMoving && moveAnimName
                          ? {
                              animation: `${moveAnimName} ${movingDuration}ms ease-out ${movingDelay}ms both`,
                              willChange: 'transform',
                            }
                          : {
                              animation: `orbit-fade-in ${fade}ms ease-out ${fadeDelay}ms both`,
                              willChange: 'opacity',
                            }
                      const isCenter = pos === 4
                      const isDisabled = !isCenter && centerEmpty
                      return (
                        <CellComponent
                          key={cell.id}
                          cell={cell}
                          isCenter={isCenter}
                          isDisabled={isDisabled}
                          isCut={false}
                          isDragSource={false}
                          isDragOver={false}
                          childCount={orbit.childCountsByCellId.get(cell.id) ?? 0}
                          fontScale={fontScale}
                          isInlineEditing={false}
                          onStartInlineEdit={() => {}}
                          onCommitInlineEdit={async () => {}}
                          onInlineNavigate={() => {}}
                          onDrill={() => {}}
                          wrapperStyle={wrapperStyle}
                        />
                      )
                    })
                  })()}
                </div>
              ) : (
                <>
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
                </>
              )}
            </div>

            {/* 右側: 次の並列グリッドへ進む「＞」、末尾にいる場合は新規追加「＋」 */}
            <div className="w-12 flex items-center justify-center shrink-0">
              {parallelIndex < parallelGrids.length - 1 ? (
                <button
                  onClick={() => handleParallelNav('next')}
                  className="w-12 h-12 rounded-full bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 shadow-sm flex items-center justify-center"
                  title="次の並列グリッドへ"
                >
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="9 18 15 12 9 6" />
                  </svg>
                </button>
              ) : (() => {
                const centerCell = gridData?.cells.find((c) => c.position === 4)
                const centerEmpty = !centerCell || isCellEmpty(centerCell)
                if (centerEmpty) return null
                return (
                  <button
                    onClick={handleAddParallel}
                    className="w-12 h-12 rounded-full bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:text-blue-600 dark:hover:text-blue-400 hover:border-blue-400 dark:hover:border-blue-500 hover:bg-gray-50 dark:hover:bg-gray-800 shadow-sm flex items-center justify-center"
                    title="新しい並列グリッドを追加"
                  >
                    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <line x1="12" y1="5" x2="12" y2="19" />
                      <line x1="5" y1="12" x2="19" y2="12" />
                    </svg>
                  </button>
                )
              })()}
            </div>
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
