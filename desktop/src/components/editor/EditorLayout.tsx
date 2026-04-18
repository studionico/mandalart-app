
import { useEffect, useState, useCallback, useRef, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useEditorStore } from '@/store/editorStore'
import { useClipboardStore } from '@/store/clipboardStore'
import { useGrid } from '@/hooks/useGrid'
import { useSubGrids, type SubGridData } from '@/hooks/useSubGrids'
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
import { updateCell, pasteCell, toggleCellDone, seedCellWithDone } from '@/lib/api/cells'
import { deleteMandalart } from '@/lib/api/mandalarts'
import { addToStock, pasteFromStock } from '@/lib/api/stock'
import { copyImageFromPath } from '@/lib/api/storage'
import { exportAsPNG, exportAsPDF, downloadJSON, downloadCSV } from '@/lib/utils/export'
import { exportToJSON, exportToCSV } from '@/lib/api/transfer'
import { isCellEmpty, hasPeripheralContent, getCenterCell } from '@/lib/utils/grid'
import { nextTabPosition } from '@/constants/tabOrder'
import {
  CENTER_POSITION,
  GRID_CELL_COUNT,
  GRID_SIDE,
  ORBIT_ORDER_CENTER_THEN_PERIPHERAL,
  ORBIT_ORDER_PERIPHERAL,
  ORBIT_ORDER_PERIPHERAL_THEN_CENTER,
  isCenterPosition,
} from '@/constants/grid'
import {
  ANIM_FADE_MS,
  ANIM_STAGGER_MS,
  SLIDE_DURATION_MS as SLIDE_MS,
  VIEW_SWITCH_TO_9_DELAY_MS as VIEW_SWITCH_TO_9_DELAY,
} from '@/constants/timing'
import {
  GRID_SIZE_CHANGE_THRESHOLD_PX,
  OUTER_GRID_GAP_PX,
  SIDE_BUTTON_RESERVE_PX,
} from '@/constants/layout'
import type { Cell, Grid, StockItem } from '@/types'

type Props = {
  mandalartId: string
  userId: string
}

export default function EditorLayout({ mandalartId, userId }: Props) {
  const navigate = useNavigate()
  const {
    currentGridId, viewMode, breadcrumb, fontScale, fontLevel,
    showCheckbox,
    setMandalartId, setCurrentGrid, setViewMode,
    pushBreadcrumb, popBreadcrumbTo, resetBreadcrumb, updateBreadcrumbItem,
    bumpFontLevel, resetFontLevel, setShowCheckbox,
  } = useEditorStore()

  const { push: pushUndo } = useUndo()
  const { isOffline } = useOffline()
  const clipboard = useClipboardStore()

  const { data: gridData, reload, updateCell: updateCellLocal } = useGrid(currentGridId)
  const { subGrids, reload: reloadSubGrids, setSubGrids } = useSubGrids(gridData?.cells ?? [])
  const gridRef = useRef<HTMLDivElement>(null)
  const gridAreaRef = useRef<HTMLDivElement>(null)
  const [gridSize, setGridSize] = useState(0)

  useEffect(() => {
    const el = gridAreaRef.current
    if (!el) return
    const observer = new ResizeObserver((entries) => {
      const { width, height } = entries[0].contentRect
      // 左右の並列ナビボタン分を横幅から差し引く
      const usableWidth = Math.max(0, width - SIDE_BUTTON_RESERVE_PX)
      const next = Math.floor(Math.min(usableWidth, height))
      // 数 px 単位の微小な変化は無視する。drill 遷移時に header の scrollbar 出し入れなどで
      // ちらつく原因になるため。
      setGridSize((prev) => (Math.abs(prev - next) < GRID_SIZE_CHANGE_THRESHOLD_PX ? prev : next))
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
  const SLIDE_DURATION_MS = SLIDE_MS

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
  // drill-down: 7 * stagger + fade (≒ 1s)
  // drill-up:   8 * stagger + fade (≒ 1.1s、ステップが 1 つ多いぶん若干長い)
  // initial:    8 * stagger + fade (中心含む 9 セル)
  // 値は constants/timing.ts で一元管理し、Orbit / View Switch でビートを揃えている。
  const ORBIT_STAGGER_DOWN_MS = ANIM_STAGGER_MS
  const ORBIT_STAGGER_UP_MS = ANIM_STAGGER_MS
  const ORBIT_STAGGER_INIT_MS = ANIM_STAGGER_MS
  const ORBIT_FADE_DOWN_MS = ANIM_FADE_MS
  const ORBIT_FADE_UP_MS = ANIM_FADE_MS
  const ORBIT_FADE_INIT_MS = ANIM_FADE_MS

  // 9×9 表示用の orbit state。こちらは「サブグリッド (3×3 ブロック)」単位で動かす。
  // 3×3 orbit の仕組みをそのままブロック単位に持ち上げた構造。
  // - targetRootCells: target 9×9 の中央ブロック (= target 現在グリッド) の 9 セル
  // - targetSubGrids:  target 9×9 の各周辺ブロックに表示するサブグリッドデータ
  //                    (cellId → SubGridData。useSubGrids と同じ構造)
  // - movingToPosition: 移動ブロックの target 内での位置 (drill-down = 4、drill-up = 親内位置)
  //                     null のとき (initial) は移動ブロックなし
  // - movingFromPosition: 移動ブロックが視覚的に出発する位置
  type Orbit9State = {
    targetRootCells: Cell[]
    targetSubGrids: Map<string, SubGridData>
    targetGridId: string
    childCountsByCellId: Map<string, number>
    movingToPosition: number | null
    movingFromPosition: number
    direction: 'drill-down' | 'drill-up' | 'initial'
  }
  const [orbit9, setOrbit9] = useState<Orbit9State | null>(null)

  // 表示モード切替アニメーション用 state (3×3 ↔ 9×9)
  // - direction 'to-9x9': 現在の 3×3 を縮小して中央ブロックへ収束 + 周辺ブロックを時計回り fade-in
  // - direction 'to-3x3': 中央ブロックの 9 セルを個別に 3×3 位置へ展開 + 周辺ブロックを fade-out
  //
  // 9→3 方向は per-cell で translate 量が異なるため、CSS 変数ベースの keyframes が使えない
  // (animations.md 参照)。代わりに React state flip + double requestAnimationFrame +
  // inline transform で動かす。viewSwitchPhase が 'start' → 'end' に切り替わった瞬間
  // CSS transition が発火する。
  type ViewSwitchState = {
    direction: 'to-9x9' | 'to-3x3'
    rootCells: Cell[]
    subGrids: Map<string, SubGridData>
    childCountsByCellId: Map<string, number>
  }
  const [viewSwitch, setViewSwitch] = useState<ViewSwitchState | null>(null)
  const [viewSwitchPhase, setViewSwitchPhase] = useState<'start' | 'end'>('start')
  // to-9x9: 0-400ms で中央 3×3 が scale(1)→scale(1/3)、200ms から周辺ブロックが時計回り stagger fade-in。
  //         total = 200 + 7 * 85 + 400 = 1195ms
  // to-3x3: 0-400ms 周辺ブロック fade-out、中央 9 セルが順次 [7,6,3,0,1,2,5,8,4] で 3×3 位置へ展開。
  //         total = 8 * 85 + 400 = 1080ms
  const VIEW_SWITCH_FADE_MS = ANIM_FADE_MS
  const VIEW_SWITCH_STAGGER_MS = ANIM_STAGGER_MS
  const VIEW_SWITCH_TO_9_DELAY_MS = VIEW_SWITCH_TO_9_DELAY
  const VIEW_SWITCH_TO_9_TOTAL_MS =
    VIEW_SWITCH_TO_9_DELAY_MS + 7 * VIEW_SWITCH_STAGGER_MS + VIEW_SWITCH_FADE_MS
  const VIEW_SWITCH_TO_3_TOTAL_MS = 8 * VIEW_SWITCH_STAGGER_MS + VIEW_SWITCH_FADE_MS

  // viewSwitch がセットされたら 2 フレーム待って phase を 'end' に切替 → CSS transition 発火
  useEffect(() => {
    if (!viewSwitch) {
      setViewSwitchPhase('start')
      return
    }
    let r1 = 0
    let r2 = 0
    r1 = requestAnimationFrame(() => {
      r2 = requestAnimationFrame(() => setViewSwitchPhase('end'))
    })
    return () => {
      if (r1) cancelAnimationFrame(r1)
      if (r2) cancelAnimationFrame(r2)
    }
  }, [viewSwitch])
  /**
   * target cells それぞれの「意味のある子グリッド数」を事前フェッチする。
   *
   * 「意味のある子グリッド」= 周辺セル (position != 4) に 1 つでも入力 (text または画像) が
   * あるサブグリッド。ドリル直後にセンターだけ自動コピーされただけの状態はカウントしない。
   * Cell 側の border 表示 (border-2 black = サブグリッドあり) で参照される。
   */
  async function fetchChildCountsFor(cells: Cell[]): Promise<Map<string, number>> {
    const { query } = await import('@/lib/db')
    const map = new Map<string, number>()
    await Promise.all(
      cells.map(async (c) => {
        const rows = await query<{ cnt: number }>(
          `SELECT COUNT(DISTINCT g.id) AS cnt
           FROM grids g
           JOIN cells sub ON sub.grid_id = g.id
           WHERE g.parent_cell_id = ?
             AND g.deleted_at IS NULL
             AND sub.position != 4
             AND sub.deleted_at IS NULL
             AND (sub.text != '' OR sub.image_path IS NOT NULL)`,
          [c.id],
        )
        map.set(c.id, rows[0]?.cnt ?? 0)
      }),
    )
    return map
  }

  /**
   * 9×9 orbit 用: root cells それぞれの子グリッドを一括取得。
   * ないセルは Map に含めない。
   */
  async function fetchSubGridsFor(rootCells: Cell[]): Promise<Map<string, SubGridData>> {
    const map = new Map<string, SubGridData>()
    await Promise.all(
      rootCells.map(async (cell) => {
        const children = await getChildGrids(cell.id)
        if (children.length > 0) {
          const first = await getGrid(children[0].id)
          map.set(cell.id, {
            grid: first,
            cells: first.cells,
            parentPosition: cell.position,
          })
        }
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

  // 9×9 orbit も同様に gridData 一致で auto-clear。
  // subGrids は useSubGrids 側が async でフェッチするため、切替直後に古い subGrids で
  // 描画されて「ちらつく」ことがある。事前取得済みの targetSubGrids を setSubGrids で
  // 注入して初回描画から正しい状態にする。
  useEffect(() => {
    if (
      orbit9 &&
      orbit9.direction !== 'initial' &&
      gridData &&
      gridData.id === orbit9.targetGridId
    ) {
      setChildCounts(orbit9.childCountsByCellId)
      setSubGrids(orbit9.targetSubGrids)
      setOrbit9(null)
    }
  }, [orbit9, gridData, setSubGrids])

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
          label: cells.find((c: Cell) => c.position === CENTER_POSITION)?.text ?? '',
          imagePath: cells.find((c: Cell) => c.position === CENTER_POSITION)?.image_path ?? null,
          cells: cells,
          highlightPosition: null,
        })

        // 初回表示アニメーション: 中心 → 時計回りに周辺を順に fade-in
        // 現在の viewMode に合わせて 3×3 (セル単位) か 9×9 (サブグリッド単位) のどちらかを発火
        const childCountsByCellId = await fetchChildCountsFor(cells)
        if (viewMode === '9x9') {
          const targetSubGrids = await fetchSubGridsFor(cells)
          setOrbit9({
            targetRootCells: cells,
            targetSubGrids,
            targetGridId: root.id,
            childCountsByCellId,
            movingToPosition: null, // 移動ブロックなし
            movingFromPosition: 4, // 未使用
            direction: 'initial',
          })
          await new Promise((r) =>
            setTimeout(r, ORBIT_STAGGER_INIT_MS * 8 + ORBIT_FADE_INIT_MS),
          )
          setChildCounts(childCountsByCellId)
          setSubGrids(targetSubGrids)
          setOrbit9(null)
        } else {
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
        }
      } catch (e) {
        console.error('EditorLayout init error:', e)
        setToast({ message: `読み込みエラー: ${(e as Error).message}`, type: 'error' })
      }
    }
    init()
  }, [mandalartId]) // eslint-disable-line react-hooks/exhaustive-deps

  // 子グリッド数を更新 (= 「意味のあるサブグリッド」カウント)
  // fetchChildCountsFor は周辺セルに入力のあるサブグリッドのみを数えるので、
  // Cell 側の border (border-2 = サブグリッドあり) が実際の内容状態を反映する。
  useEffect(() => {
    if (!gridData) return
    let cancelled = false
    fetchChildCountsFor(gridData.cells)
      .then((map) => {
        if (!cancelled) setChildCounts(map)
      })
      .catch((e) => console.error('loadChildCounts failed:', e))
    return () => { cancelled = true }
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
    const centerCell = gridData.cells.find((c) => c.position === CENTER_POSITION)
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
  }, [])

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

      // 9×9 表示ではサブグリッドブロック単位の orbit を再生してから状態を切替
      if (viewMode === '9x9') {
        const [targetSubGrids, childCountsByCellId] = await Promise.all([
          fetchSubGridsFor(subGrid.cells),
          fetchChildCountsFor(subGrid.cells),
        ])
        setOrbit9({
          targetRootCells: subGrid.cells,
          targetSubGrids,
          targetGridId: subGrid.id,
          childCountsByCellId,
          movingToPosition: 4, // 周辺 (q) → 中心 (4) へ
          movingFromPosition: parentCell.position,
          direction: 'drill-down',
        })
        await new Promise((r) =>
          setTimeout(r, ORBIT_STAGGER_DOWN_MS * 7 + ORBIT_FADE_DOWN_MS),
        )
      }

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
      // orbit9 は auto-clear useEffect が gridData.id === subGrid.id を検知してクリア
      return
    }

    // 中央セル（position 4）の特別処理
    if (cell.position === CENTER_POSITION) {
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
          } else if (viewMode === '9x9') {
            // 9×9 ブロック単位のドリルアップ: 現在の中央ブロック (= 現在 grid) が
            // 親内のドリル元位置 (p) に向かって動く。target は親グリッド + その子グリッド群
            const parentGridData = await getGrid(parent.gridId)
            const movingParentCell = drillFromCellId
              ? parentGridData.cells.find((c) => c.id === drillFromCellId)
              : null
            if (movingParentCell) {
              const [targetSubGrids, childCountsByCellId] = await Promise.all([
                fetchSubGridsFor(parentGridData.cells),
                fetchChildCountsFor(parentGridData.cells),
              ])
              setOrbit9({
                targetRootCells: parentGridData.cells,
                targetSubGrids,
                targetGridId: parent.gridId,
                childCountsByCellId,
                movingToPosition: movingParentCell.position, // 親内のドリル元位置へ
                movingFromPosition: 4, // 現中央ブロックから出発
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
        const targetCenter = firstChild.cells.find((c) => c.position === CENTER_POSITION)
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

      const centerCell = newGrid.cells.find((c) => c.position === CENTER_POSITION)
      const populatedCells = centerCell && !isCellEmpty(cell)
        ? newGrid.cells.map((c) =>
            c.position === CENTER_POSITION
              ? { ...c, text: cell.text, image_path: cell.image_path, color: cell.color, done: !!cell.done }
              : { ...c, done: !!cell.done },
          )
        : newGrid.cells.map((c) => ({ ...c, done: !!cell.done }))
      if (centerCell && !isCellEmpty(cell)) {
        // 新規子グリッドの中央セルを親のテキスト+done で atomic 初期化。
        // updateCell 経由だと空→非空 transition で propagateUndoneUp が走り
        // 親 (= clicked cell) が uncheck されてしまうので seedCellWithDone を使う。
        await seedCellWithDone(centerCell.id, {
          text: cell.text,
          image_path: cell.image_path,
          color: cell.color,
          done: !!cell.done,
        })
      }

      if (viewMode === '3x3') {
        const targetCenter = populatedCells.find((c) => c.position === CENTER_POSITION)
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
      setInlineEditingCellId(updatedCells.find((c) => c.position === CENTER_POSITION)?.id ?? null)
      return
    }
    const next = updatedCells.find((c) => c.position === nextPos)
    if (next) setInlineEditingCellId(next.id)
  }

  async function handleSaveCell(cellId: string, params: { text: string; image_path: string | null; color: string | null }) {
    const cell = gridData?.cells.find((c) => c.id === cellId)
    if (!cell) return

    // バリデーション: 周辺セルに入力があれば中心をクリアできない
    if (cell.position === CENTER_POSITION && isCellEmpty({ text: params.text, image_path: params.image_path })) {
      if (hasPeripheralContent(gridData?.cells ?? [])) {
        setToast({ message: '周辺セルに入力がある場合、中心セルを空にできません', type: 'error' })
        return
      }
    }

    // バリデーション: サブグリッドに入力のある周辺セルは空にできない
    // (周辺セル X に子グリッドがあり、そこに意味ある周辺入力がある場合、X は
    // そのサブグリッドの「中心」と等価。X を空にすると配下のテーマが孤立する)
    if (cell.position !== CENTER_POSITION && isCellEmpty({ text: params.text, image_path: params.image_path })) {
      const meaningfulSubCount = childCounts.get(cell.id) ?? 0
      if (meaningfulSubCount > 0) {
        setToast({ message: 'サブグリッドに入力がある場合、このセルを空にできません', type: 'error' })
        return
      }
    }

    const previous = { text: cell.text, image_path: cell.image_path, color: cell.color }
    // 空 → 非空 transition の場合、updateCell が propagateUndoneUp を走らせて
    // 祖先の done=1 を解除する。useGrid.updateCellLocal は編集したセル 1 つだけ
    // React state を更新するので、伝搬先 (同 grid の center + 祖先 grids) の
    // done 変更が UI に反映されない。reloadAll() で取り直す。
    const wasEmpty = isCellEmpty(cell)
    const willBeEmpty = isCellEmpty({ text: params.text, image_path: params.image_path })
    const emptyToNonEmpty = wasEmpty && !willBeEmpty

    await updateCellLocal(cellId, params)

    if (emptyToNonEmpty) {
      reloadAll()
    }

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
    const center = cells.find((c) => c.position === CENTER_POSITION)
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
    const center = gridData.cells.find((c) => c.position === CENTER_POSITION)
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
    const originCenter = gridData?.cells.find((c) => c.position === CENTER_POSITION)
    const newCenter = newGrid.cells.find((c) => c.position === CENTER_POSITION)
    let toCells: Cell[] = newGrid.cells
    if (originCenter && newCenter && !isCellEmpty(originCenter)) {
      await updateCell(newCenter.id, {
        text: originCenter.text,
        image_path: originCenter.image_path,
        color: originCenter.color,
      })
      // アニメーション用のセル配列にも反映させる (まだ newGrid.cells は古い状態)
      toCells = newGrid.cells.map((c) =>
        c.position === CENTER_POSITION
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

  // 表示モード切替: 3×3 ↔ 9×9 をアニメーション付きで切替える
  // - to-9x9: 現在の 3×3 を中央原点で scale(1)→scale(1/3) に縮小、同時に周辺 8 ブロックを
  //   時計回り stagger で fade-in
  // - to-3x3: 中央ブロック 9 セルを個別に 3×3 位置へ拡大 + 移動、周辺ブロックは fade-out
  // viewMode 自体はアニメーション開始時に切替える (transition layer 内で表示を制御するので OK)。
  async function handleViewModeSwitch(next: '3x3' | '9x9') {
    if (next === viewMode) return
    if (!gridData) {
      setViewMode(next)
      return
    }
    if (viewSwitch || slide || orbit || orbit9) return // 他アニメ中は多重起動しない

    const [counts, subs] = await Promise.all([
      fetchChildCountsFor(gridData.cells),
      next === '9x9' ? fetchSubGridsFor(gridData.cells) : Promise.resolve(subGrids),
    ])

    if (next === '9x9') {
      // 9×9 への切替: subGrids / childCounts を事前投入しておき、transition layer も
      // 通常 render もすぐ正しい状態を見られるようにする
      setSubGrids(subs)
      setChildCounts(counts)
      setViewSwitch({
        direction: 'to-9x9',
        rootCells: gridData.cells,
        subGrids: subs,
        childCountsByCellId: counts,
      })
      setViewMode('9x9')
      await new Promise((r) => setTimeout(r, VIEW_SWITCH_TO_9_TOTAL_MS))
      setViewSwitch(null)
    } else {
      setChildCounts(counts)
      setViewSwitch({
        direction: 'to-3x3',
        rootCells: gridData.cells,
        subGrids: subs,
        childCountsByCellId: counts,
      })
      setViewMode('3x3')
      await new Promise((r) => setTimeout(r, VIEW_SWITCH_TO_3_TOTAL_MS))
      setViewSwitch(null)
    }
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
    // 中心セルが空のグリッドの周辺セルは disabled → ペースト不可
    if (!isCenterPosition(target.position)) {
      const center = dndCells.find(
        (c) => c.grid_id === target.grid_id && c.position === CENTER_POSITION,
      )
      if (!center || isCellEmpty(center)) {
        setToast({ message: '中心セルが空のため周辺セルには貼り付けできません', type: 'info' })
        return
      }
    }
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

  // セル左上チェックボックスのトグル。API 層が階層カスケード (親 → 子 / 子全 → 親) を担当。
  // 完了後は reload して表示を反映。Undo スタックには積まない (仕様: シンプルなトグル扱い)。
  async function handleToggleDone(cell: Cell) {
    try {
      await toggleCellDone(cell.id)
      reloadAll()
    } catch (e) {
      setToast({ message: `チェック失敗: ${(e as Error).message}`, type: 'error' })
    }
  }

  async function handleStockPaste(item: StockItem) {
    // インライン編集中のセルを貼り付け先にする (詳細編集モーダル廃止後の動線)
    const targetCellId = inlineEditingCellId
    if (!targetCellId) {
      setToast({ message: 'ペースト先のセルをインライン編集中にしてください (またはドラッグ&ドロップしてください)', type: 'info' })
      return
    }
    // 中心セルが空のグリッドの周辺セルは disabled → ペースト不可
    const targetCell = dndCells.find((c) => c.id === targetCellId)
    if (targetCell && !isCenterPosition(targetCell.position)) {
      const center = dndCells.find(
        (c) => c.grid_id === targetCell.grid_id && c.position === CENTER_POSITION,
      )
      if (!center || isCellEmpty(center)) {
        setToast({ message: '中心セルが空のため周辺セルには貼り付けできません', type: 'info' })
        return
      }
    }
    try {
      await pasteFromStock(item.id, targetCellId)
      reload()
    } catch (e) {
      setToast({ message: `ペースト失敗: ${(e as Error).message}`, type: 'error' })
    }
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

          {/* チェックボックス表示 ON/OFF トグル */}
          <button
            type="button"
            onClick={() => setShowCheckbox(!showCheckbox)}
            className={`relative w-10 h-5 rounded-full transition-colors border text-[9px] ${
              showCheckbox
                ? 'bg-blue-600 border-blue-600'
                : 'bg-gray-200 dark:bg-gray-700 border-gray-300 dark:border-gray-600'
            }`}
            title={showCheckbox ? 'チェックボックス表示中 (クリックで非表示)' : 'チェックボックス非表示 (クリックで表示)'}
            aria-label="toggle checkbox display"
          >
            <span
              className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-all flex items-center justify-center ${
                showCheckbox ? 'left-[22px] text-blue-600' : 'left-0.5 text-gray-400'
              }`}
            >
              {showCheckbox && (
                <svg viewBox="0 0 16 16" className="w-2.5 h-2.5" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="3 8 7 12 13 4" />
                </svg>
              )}
            </span>
          </button>

          {/* 表示モード切替 */}
          <div className="flex rounded-lg border border-gray-200 overflow-hidden text-xs">
            {(['3x3', '9x9'] as const).map((mode) => (
              <button
                key={mode}
                onClick={() => handleViewModeSwitch(mode)}
                disabled={viewSwitch != null}
                className={`px-3 py-1.5 transition-colors disabled:opacity-60 ${viewMode === mode ? 'bg-blue-600 text-white' : 'hover:bg-gray-50 dark:hover:bg-gray-800 text-gray-600 dark:text-gray-300'}`}
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
              {viewSwitch && gridSize > 0 ? (
                // 表示モード切替アニメーション (3×3 ↔ 9×9)
                (() => {
                  const FADE = VIEW_SWITCH_FADE_MS
                  const STAGGER = VIEW_SWITCH_STAGGER_MS
                  const GAP = OUTER_GRID_GAP_PX
                  const B = (gridSize - 2 * GAP) / GRID_SIDE // 各ブロックの幅
                  const rootCellMap = new Map(
                    viewSwitch.rootCells.map((c) => [c.position, c]),
                  )
                  const rootCenter = viewSwitch.rootCells.find((c) => c.position === CENTER_POSITION)
                  const rootCenterEmpty = !rootCenter || isCellEmpty(rootCenter)
                  const innerWrapperBase =
                    'grid grid-cols-3 grid-rows-3 gap-px bg-gray-300 dark:bg-gray-700 rounded-xl overflow-hidden min-h-0 min-w-0'
                  const innerEmptyCellClass = 'bg-white dark:bg-gray-900'

                  // 共通: 周辺 9×9 ブロックをレンダリングする関数 (fade-in / fade-out 用)
                  function renderPeripheralBlock(outerPos: number, style: React.CSSProperties) {
                    const rootCell = rootCellMap.get(outerPos) ?? null
                    const sub =
                      rootCell
                        ? viewSwitch!.subGrids.get(rootCell.id) ?? null
                        : null
                    const hasMeaningfulSub = rootCell
                      ? (viewSwitch!.childCountsByCellId.get(rootCell.id) ?? 0) > 0
                      : false
                    const blockBorder = hasMeaningfulSub
                      ? 'border-2 border-black dark:border-gray-300'
                      : 'border-2 border-gray-300 dark:border-gray-700'

                    // 子サブグリッドあり: 9 セルすべて描画
                    if (sub) {
                      const subCellMap = new Map(sub.cells.map((c) => [c.position, c]))
                      const subCenter = sub.cells.find((c) => c.position === CENTER_POSITION)
                      const subCenterEmpty = !subCenter || isCellEmpty(subCenter)
                      return (
                        <div
                          key={outerPos}
                          style={style}
                          className={`${innerWrapperBase} ${blockBorder}`}
                        >
                          {Array.from({ length: GRID_CELL_COUNT }).map((_, innerPos) => {
                            const cell = subCellMap.get(innerPos)
                            if (!cell) return <div key={innerPos} className={innerEmptyCellClass} />
                            const isInnerCenter = isCenterPosition(innerPos)
                            const isDisabled = !isInnerCenter && subCenterEmpty
                            return (
                              <CellComponent
                                key={cell.id}
                                cell={cell}
                                isCenter={isInnerCenter}
                                isDisabled={isDisabled}
                                isCut={false}
                                isDragSource={false}
                                isDragOver={false}
                                childCount={0}
                                fontScale={fontScale}
                                isInlineEditing={false}
                                onStartInlineEdit={() => {}}
                                onCommitInlineEdit={async () => {}}
                                onInlineNavigate={() => {}}
                                onDrill={() => {}}
                                size="small"
                              />
                            )
                          })}
                        </div>
                      )
                    }

                    // 子サブグリッドなし: rootCell を中央にだけ、他は空白
                    return (
                      <div
                        key={outerPos}
                        style={style}
                        className={`${innerWrapperBase} ${blockBorder}`}
                      >
                        {Array.from({ length: GRID_CELL_COUNT }).map((_, innerPos) => {
                          if (innerPos === CENTER_POSITION && rootCell) {
                            return (
                              <CellComponent
                                key={rootCell.id + '-center'}
                                cell={rootCell}
                                isCenter={true}
                                isDisabled={false}
                                isCut={false}
                                isDragSource={false}
                                isDragOver={false}
                                childCount={0}
                                fontScale={fontScale}
                                isInlineEditing={false}
                                onStartInlineEdit={() => {}}
                                onCommitInlineEdit={async () => {}}
                                onInlineNavigate={() => {}}
                                onDrill={() => {}}
                                size="small"
                              />
                            )
                          }
                          return <div key={innerPos} className={innerEmptyCellClass} />
                        })}
                      </div>
                    )
                  }

                  if (viewSwitch.direction === 'to-9x9') {
                    // 3×3 → 9×9: 中央の 3×3 が縮小 + 終端の実 9×9 中央ブロックにクロスフェード。
                    // 周辺ブロックは時計回り stagger で fade-in。
                    //
                    // 設計:
                    //  - 縮小 3×3 (source): scale 1 → 1/3 (0〜FADE) + opacity 1 → 0 (FADE/2〜FADE)
                    //  - 実 9×9 中央ブロック (target): 自然サイズで配置、opacity 0 → 1 (FADE/2〜FADE)
                    //  - 2 者は FADE/2〜FADE の間にクロスフェードし、FADE 時点で完全に target に遷移
                    //
                    // これにより「transition layer 終了 (VIEW_SWITCH_TO_9_TOTAL_MS 時点) での
                    // swap で text 位置がわずかに内側に動く」pop が消える。target 側は実 9×9
                    // render と同じ構造 (bg-gray-300 wrapper + 6px 外枠 + size='small' セル) を
                    // 使っているのでピクセル一致する。
                    const order = ORBIT_ORDER_PERIPHERAL
                    const crossfadeDuration = FADE / 2
                    const crossfadeDelay = FADE - crossfadeDuration
                    return (
                      <div className="relative w-full h-full pointer-events-none">
                        {/* 9×9 周辺ブロック: 時計回り stagger で fade-in */}
                        <div className="absolute inset-0 grid grid-cols-3 grid-rows-3 gap-2">
                          {Array.from({ length: GRID_CELL_COUNT }).map((_, outerPos) => {
                            if (isCenterPosition(outerPos)) return <div key={outerPos} />
                            const idx = order.indexOf(outerPos)
                            const delay =
                              VIEW_SWITCH_TO_9_DELAY_MS + Math.max(0, idx) * STAGGER
                            const style: React.CSSProperties = {
                              animation: `orbit-fade-in ${FADE}ms ease-out ${delay}ms both`,
                              willChange: 'opacity',
                            }
                            return renderPeripheralBlock(outerPos, style)
                          })}
                        </div>

                        {/* source: 縮小 3×3 (中央原点で scale 1 → 1/3、後半で opacity 0) */}
                        <div
                          className="absolute inset-0"
                          style={{
                            transformOrigin: 'center center',
                            animation: `view-shrink-to-center ${FADE}ms ease-out 0ms both, view-fade-out ${crossfadeDuration}ms linear ${crossfadeDelay}ms both`,
                            willChange: 'transform, opacity',
                          }}
                        >
                          <GridView3x3
                            cells={viewSwitch.rootCells}
                            childCounts={viewSwitch.childCountsByCellId}
                            cutCellId={null}
                            dragSourceId={null}
                            dragOverId={null}
                            fontScale={fontScale}
                            inlineEditingCellId={null}
                            onStartInlineEdit={() => {}}
                            onCommitInlineEdit={async () => {}}
                            onInlineNavigate={() => {}}
                            onDrill={() => {}}
                          />
                        </div>

                        {/* target: 実 9×9 中央ブロック (shrink 後半で fade-in)。
                            通常 9×9 render と同一構造。 */}
                        <div className="absolute inset-0 grid grid-cols-3 grid-rows-3 gap-2">
                          {Array.from({ length: GRID_CELL_COUNT }).map((_, outerPos) => {
                            if (outerPos !== 4) return <div key={outerPos} />
                            return (
                              <div
                                key={outerPos}
                                className={`${innerWrapperBase} border-[6px] border-black dark:border-white`}
                                style={{
                                  animation: `orbit-fade-in ${crossfadeDuration}ms ease-out ${crossfadeDelay}ms both`,
                                  willChange: 'opacity',
                                }}
                              >
                                {Array.from({ length: GRID_CELL_COUNT }).map((_, innerPos) => {
                                  const cell = rootCellMap.get(innerPos)
                                  if (!cell) return <div key={innerPos} className={innerEmptyCellClass} />
                                  const isInnerCenter = isCenterPosition(innerPos)
                                  const isDisabled = !isInnerCenter && rootCenterEmpty
                                  return (
                                    <CellComponent
                                      key={cell.id}
                                      cell={cell}
                                      isCenter={isInnerCenter}
                                      isDisabled={isDisabled}
                                      isCut={false}
                                      isDragSource={false}
                                      isDragOver={false}
                                      childCount={viewSwitch!.childCountsByCellId.get(cell.id) ?? 0}
                                      fontScale={fontScale}
                                      isInlineEditing={false}
                                      onStartInlineEdit={() => {}}
                                      onCommitInlineEdit={async () => {}}
                                      onInlineNavigate={() => {}}
                                      onDrill={() => {}}
                                      size="small"
                                    />
                                  )
                                })}
                              </div>
                            )
                          })}
                        </div>
                      </div>
                    )
                  }

                  // 9×9 → 3×3: 中央ブロックの 9 セルを個別に 3×3 位置へ拡大展開、
                  // 周辺ブロックは fade-out
                  const cellOrder = ORBIT_ORDER_PERIPHERAL_THEN_CENTER
                  return (
                    <div className="relative w-full h-full pointer-events-none">
                      {/* 9×9 周辺ブロック: 全体 fade-out (stagger なし) */}
                      <div className="absolute inset-0 grid grid-cols-3 grid-rows-3 gap-2">
                        {Array.from({ length: GRID_CELL_COUNT }).map((_, outerPos) => {
                          if (isCenterPosition(outerPos)) return <div key={outerPos} />
                          const style: React.CSSProperties = {
                            animation: `view-fade-out ${FADE}ms ease-out 0ms both`,
                            willChange: 'opacity',
                          }
                          return renderPeripheralBlock(outerPos, style)
                        })}
                      </div>

                      {/* 中央ブロック 9 セル: 9×9 内側位置 → 3×3 外側位置へ transition */}
                      {/* 各セルは最終 3×3 grid 配置で描画し、start 状態で scale(1/3) + translate
                          により 9×9 中央ブロック内位置に寄せる。double rAF で phase を
                          'start' → 'end' に切替えると transform transition が発火する。
                          transform は Cell の wrapperStyle 経由でセル本体 (= grid item) に
                          直接適用する。余分な div で囲むとセルが grid item としてサイズを
                          得られず空になってしまうので注意。 */}
                      <div className="absolute inset-0 grid grid-cols-3 grid-rows-3 gap-2">
                        {Array.from({ length: GRID_CELL_COUNT }).map((_, pos) => {
                          const cell = rootCellMap.get(pos)
                          if (!cell) return <div key={pos} />
                          const c = pos % GRID_SIDE
                          const r = Math.floor(pos / GRID_SIDE)
                          // 9×9 中央ブロック内位置 (global 座標、gridSize 原点から)
                          //   top-left = (B+GAP) + c * (B/GRID_SIDE + 1), (B+GAP) + r * (B/GRID_SIDE + 1)
                          // 3×3 natural 位置 (grid セルとしての top-left)
                          //   = c * (B+GAP), r * (B+GAP)
                          // transform: translate(tx, ty) scale(1/GRID_SIDE) with origin top-left
                          //   の最終 top-left = (natural.x + tx, natural.y + ty)
                          // これを 9×9 位置に合わせる
                          const tx = (B + GAP) + c * (B / GRID_SIDE + 1) - c * (B + GAP)
                          const ty = (B + GAP) + r * (B / GRID_SIDE + 1) - r * (B + GAP)
                          const idx = cellOrder.indexOf(pos)
                          const delay = Math.max(0, idx) * STAGGER
                          const isCenter = isCenterPosition(pos)
                          const isDisabled = !isCenter && rootCenterEmpty
                          const transform =
                            viewSwitchPhase === 'start'
                              ? `translate(${tx}px, ${ty}px) scale(${1 / GRID_SIDE})`
                              : 'translate(0, 0) scale(1)'
                          const transition = `transform ${FADE}ms ease-out ${delay}ms`
                          return (
                            <CellComponent
                              key={cell.id}
                              cell={cell}
                              isCenter={isCenter}
                              isDisabled={isDisabled}
                              isCut={false}
                              isDragSource={false}
                              isDragOver={false}
                              childCount={
                                viewSwitch.childCountsByCellId.get(cell.id) ?? 0
                              }
                              fontScale={fontScale}
                              isInlineEditing={false}
                              onStartInlineEdit={() => {}}
                              onCommitInlineEdit={async () => {}}
                              onInlineNavigate={() => {}}
                              onDrill={() => {}}
                              wrapperStyle={{
                                transform,
                                transition,
                                transformOrigin: 'top left',
                                willChange: 'transform',
                              }}
                            />
                          )
                        })}
                      </div>
                    </div>
                  )
                })()
              ) : slide && gridSize > 0 ? (
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
                        ? ORBIT_ORDER_PERIPHERAL_THEN_CENTER
                        : orbit.direction === 'initial'
                          ? ORBIT_ORDER_CENTER_THEN_PERIPHERAL
                          : ORBIT_ORDER_PERIPHERAL
                    const center = orbit.targetCells.find((c) => c.position === CENTER_POSITION)
                    const centerEmpty = !center || isCellEmpty(center)
                    return Array.from({ length: GRID_CELL_COUNT }).map((_, pos) => {
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
                      const isCenter = isCenterPosition(pos)
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
              ) : orbit9 && viewMode === '9x9' && gridSize > 0 ? (
                // 9×9 orbit: サブグリッドブロック単位で時計回りに現れる。
                // 移動ブロック (クリックされた or 親セル対応) は対応 keyframes で translate。
                (() => {
                  const stagger =
                    orbit9.direction === 'drill-up'
                      ? ORBIT_STAGGER_UP_MS
                      : orbit9.direction === 'initial'
                        ? ORBIT_STAGGER_INIT_MS
                        : ORBIT_STAGGER_DOWN_MS
                  const fade =
                    orbit9.direction === 'drill-up'
                      ? ORBIT_FADE_UP_MS
                      : orbit9.direction === 'initial'
                        ? ORBIT_FADE_INIT_MS
                        : ORBIT_FADE_DOWN_MS
                  const order =
                    orbit9.direction === 'drill-up'
                      ? ORBIT_ORDER_PERIPHERAL_THEN_CENTER
                      : orbit9.direction === 'initial'
                        ? ORBIT_ORDER_CENTER_THEN_PERIPHERAL
                        : ORBIT_ORDER_PERIPHERAL
                  const rootCellMap = new Map(
                    orbit9.targetRootCells.map((c) => [c.position, c]),
                  )
                  const rootCenter = orbit9.targetRootCells.find((c) => c.position === CENTER_POSITION)
                  const rootCenterEmpty = !rootCenter || isCellEmpty(rootCenter)
                  // 各ブロック内の小サブグリッドラッパー共通クラス
                  const innerWrapperBase =
                    'grid grid-cols-3 grid-rows-3 gap-px bg-gray-300 dark:bg-gray-700 rounded-xl overflow-hidden min-h-0 min-w-0'
                  const innerEmptyCellClass = 'bg-white dark:bg-gray-900'
                  return (
                    <div className="grid grid-cols-3 grid-rows-3 gap-2 w-full h-full pointer-events-none">
                      {Array.from({ length: GRID_CELL_COUNT }).map((_, outerPos) => {
                        const isMoving = outerPos === orbit9.movingToPosition
                        const staggerIdx = order.indexOf(outerPos)
                        const fadeDelay =
                          staggerIdx >= 0 ? staggerIdx * stagger : 0
                        let movingDuration = fade
                        if (isMoving && orbit9.direction === 'drill-up') {
                          const arrival = Math.max(0, staggerIdx) * stagger + fade
                          movingDuration = Math.max(fade, arrival)
                        }
                        const moveAnimName =
                          isMoving && orbit9.movingToPosition !== null
                            ? orbitMoveAnimationName(
                                orbit9.movingFromPosition,
                                orbit9.movingToPosition,
                              )
                            : null
                        const blockStyle: React.CSSProperties =
                          isMoving && moveAnimName
                            ? {
                                animation: `${moveAnimName} ${movingDuration}ms ease-out 0ms both`,
                                willChange: 'transform',
                              }
                            : {
                                animation: `orbit-fade-in ${fade}ms ease-out ${fadeDelay}ms both`,
                                willChange: 'opacity',
                              }

                        const isCenterBlock = isCenterPosition(outerPos)
                        // 中央ブロック = target のルートセル 9 つ、それ以外 = target の子サブグリッド
                        const rootCell = isCenterBlock
                          ? null
                          : rootCellMap.get(outerPos) ?? null
                        const sub =
                          !isCenterBlock && rootCell
                            ? orbit9.targetSubGrids.get(rootCell.id) ?? null
                            : null
                        // 周辺ブロック外枠の黒判定: 「意味のあるサブグリッド」
                        // (= 周辺セルに入力がある) の場合のみ 2px 黒。
                        const hasMeaningfulSub = rootCell
                          ? (orbit9.childCountsByCellId.get(rootCell.id) ?? 0) > 0
                          : false
                        const blockBorder = isCenterBlock
                          ? 'border-[6px] border-black dark:border-white'
                          : hasMeaningfulSub
                            ? 'border-2 border-black dark:border-gray-300'
                            : 'border-2 border-gray-300 dark:border-gray-700'

                        // 中央ブロックの内側セル
                        if (isCenterBlock) {
                          return (
                            <div
                              key={outerPos}
                              style={blockStyle}
                              className={`${innerWrapperBase} ${blockBorder}`}
                            >
                              {Array.from({ length: GRID_CELL_COUNT }).map((_, innerPos) => {
                                const cell = rootCellMap.get(innerPos)
                                if (!cell) return <div key={innerPos} className={innerEmptyCellClass} />
                                const isInnerCenter = isCenterPosition(innerPos)
                                const isDisabled = !isInnerCenter && rootCenterEmpty
                                return (
                                  <CellComponent
                                    key={cell.id}
                                    cell={cell}
                                    isCenter={isInnerCenter}
                                    isDisabled={isDisabled}
                                    isCut={false}
                                    isDragSource={false}
                                    isDragOver={false}
                                    childCount={orbit9.childCountsByCellId.get(cell.id) ?? 0}
                                    fontScale={fontScale}
                                    isInlineEditing={false}
                                    onStartInlineEdit={() => {}}
                                    onCommitInlineEdit={async () => {}}
                                    onInlineNavigate={() => {}}
                                    onDrill={() => {}}
                                    size="small"
                                  />
                                )
                              })}
                            </div>
                          )
                        }

                        // 周辺ブロック: 子サブグリッドがあれば 9 セル、なければ placeholder + root cell
                        if (sub) {
                          const subCellMap = new Map(sub.cells.map((c) => [c.position, c]))
                          const subCenter = sub.cells.find((c) => c.position === CENTER_POSITION)
                          const subCenterEmpty = !subCenter || isCellEmpty(subCenter)
                          return (
                            <div
                              key={outerPos}
                              style={blockStyle}
                              className={`${innerWrapperBase} ${blockBorder}`}
                            >
                              {Array.from({ length: GRID_CELL_COUNT }).map((_, innerPos) => {
                                const cell = subCellMap.get(innerPos)
                                if (!cell) return <div key={innerPos} className={innerEmptyCellClass} />
                                const isInnerCenter = isCenterPosition(innerPos)
                                const isDisabled = !isInnerCenter && subCenterEmpty
                                return (
                                  <CellComponent
                                    key={cell.id}
                                    cell={cell}
                                    isCenter={isInnerCenter}
                                    isDisabled={isDisabled}
                                    isCut={false}
                                    isDragSource={false}
                                    isDragOver={false}
                                    childCount={0}
                                    fontScale={fontScale}
                                    isInlineEditing={false}
                                    onStartInlineEdit={() => {}}
                                    onCommitInlineEdit={async () => {}}
                                    onInlineNavigate={() => {}}
                                    onDrill={() => {}}
                                    size="small"
                                  />
                                )
                              })}
                            </div>
                          )
                        }

                        // 子サブグリッドなし: rootCell 本体だけ中央に、周辺は白プレースホルダ
                        return (
                          <div
                            key={outerPos}
                            style={blockStyle}
                            className={`${innerWrapperBase} ${blockBorder}`}
                          >
                            {Array.from({ length: GRID_CELL_COUNT }).map((_, innerPos) => {
                              if (innerPos === CENTER_POSITION && rootCell) {
                                return (
                                  <CellComponent
                                    key={rootCell.id + '-center'}
                                    cell={rootCell}
                                    isCenter={true}
                                    isDisabled={false}
                                    isCut={false}
                                    isDragSource={false}
                                    isDragOver={false}
                                    childCount={0}
                                    fontScale={fontScale}
                                    isInlineEditing={false}
                                    onStartInlineEdit={() => {}}
                                    onCommitInlineEdit={async () => {}}
                                    onInlineNavigate={() => {}}
                                    onDrill={() => {}}
                                    size="small"
                                  />
                                )
                              }
                              return <div key={innerPos} className={innerEmptyCellClass} />
                            })}
                          </div>
                        )
                      })}
                    </div>
                  )
                })()
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
                      onToggleDone={showCheckbox ? handleToggleDone : undefined}
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
                const centerCell = gridData?.cells.find((c) => c.position === CENTER_POSITION)
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
