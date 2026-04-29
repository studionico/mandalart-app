
import { useEffect, useState, useCallback, useRef, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useEditorStore } from '@/store/editorStore'
import { useConvergeStore } from '@/store/convergeStore'
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
import ReplaceConfirmDialog from './ReplaceConfirmDialog'
import ShredConfirmDialog from './ShredConfirmDialog'
import ExportFormatPicker, { type ExportFormat } from './ExportFormatPicker'
import type { ActionDropType } from '@/hooks/useDragAndDrop'
import ThemeToggle from '@/components/ThemeToggle'
import Toast from '@/components/ui/Toast'
import Button from '@/components/ui/Button'
import { getRootGrids, getChildGrids, getGrid, createGrid, permanentDeleteGrid } from '@/lib/api/grids'
import { pasteCell, toggleCellDone, upsertCellAt, shredCellSubtree } from '@/lib/api/cells'
import { deleteMandalart, getMandalart, permanentDeleteMandalart, updateMandalartShowCheckbox } from '@/lib/api/mandalarts'
import { addToStock, pasteFromStock, pasteFromStockReplacing, moveCellToStock } from '@/lib/api/stock'
import { copyImageFromPath } from '@/lib/api/storage'
import { exportAsPNG, exportAsPDF, downloadJSON, downloadText } from '@/lib/utils/export'
import { exportToJSON, exportToMarkdown, exportToIndentText } from '@/lib/api/transfer'
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
  CONVERGE_DURATION_MS,
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

// 9×9 モードでは cell への入力を一切禁止する (ナビゲーションのみ)。
// 編集が必要な場合は 3×3 モードに切り替えてから行う。
const NOOP_EDIT = () => {}
const NOOP_EDIT_ASYNC = async () => {}
const PREVENT_CONTEXT_MENU = (e: React.MouseEvent) => e.preventDefault()

export default function EditorLayout({ mandalartId, userId }: Props) {
  const navigate = useNavigate()
  const {
    currentGridId, viewMode, breadcrumb, fontScale, fontLevel,
    setMandalartId, setCurrentGrid, setViewMode,
    pushBreadcrumb, popBreadcrumbTo, resetBreadcrumb, updateBreadcrumbItem,
    bumpFontLevel, resetFontLevel,
  } = useEditorStore()

  // セル左上 done チェックボックス UI の表示 ON/OFF。マンダラート単位で記憶 (migration 007)。
  // mandalartId 変更時に DB から復元、トグル時は楽観的更新 + DB 永続化。
  const [showCheckbox, setShowCheckbox] = useState(false)
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const m = await getMandalart(mandalartId)
        if (cancelled) return
        setShowCheckbox(!!m?.show_checkbox)
      } catch {
        if (!cancelled) setShowCheckbox(false)
      }
    })()
    return () => { cancelled = true }
  }, [mandalartId])

  const handleToggleShowCheckbox = useCallback(async () => {
    const next = !showCheckbox
    setShowCheckbox(next)  // 楽観的更新
    try {
      await updateMandalartShowCheckbox(mandalartId, next)
    } catch (e) {
      setShowCheckbox(!next)  // 失敗時ロールバック
      setToast({ message: `チェックボックス設定の保存に失敗: ${(e as Error).message}`, type: 'error' })
    }
  }, [showCheckbox, mandalartId])

  const { push: pushUndo } = useUndo()
  const { isOffline } = useOffline()
  const clipboard = useClipboardStore()

  const { data: gridData, reload, updateCell: updateCellLocal, refreshCell } = useGrid(currentGridId)
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
    /** orbit 全体の開始を遅らせる時間 (ms)。direction='initial' で「ダッシュボード → エディタ拡大
     * (convergeStore direction='open')」経由で入った場合のみ CONVERGE_DURATION_MS が入る。
     * delay 中は `animation-fill-mode: both` の効果でセルは opacity 0 で固定され、
     * convergence overlay が中心セルへ morph している間は周辺セルが見えない。 */
    initialDelayMs?: number
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

  /**
   * グリッド本体を「ストックタイル」or「ホームアイコン」位置に向けて
   * translate + scale + opacity 0 で吸い込ませる収束アニメ用 state。
   * 収束先までの相対 px (translate 量) を持つ。
   * runConvergeAnim() が target DOM を測って算出する。
   * unmount で消えるか setConverging(null) で瞬時復帰 (transition: none)。
   * gridRef (既存の PNG/PDF export 用 ref) を共用してソース位置を測る。
   */
  const [converging, setConverging] = useState<{ tx: number; ty: number } | null>(null)
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
   *
   * 以前は cells ごとに別々の SELECT を Promise.all で走らせていたが、セル数 (9〜81) に
   * 比例してラウンドトリップが増え、"枠が遅れて出てくる" 描画遅延の主因になっていた。
   * 1 発の IN (...) クエリに統合して全 cell 分をバッチ取得する。
   */
  async function fetchChildCountsFor(cells: Cell[]): Promise<Map<string, number>> {
    const map = new Map<string, number>()
    if (cells.length === 0) return map
    // 全 cell の id を初期値 0 でマップに入れておく (クエリで hit しないセルが欠落しないよう)
    for (const c of cells) map.set(c.id, 0)

    const { query } = await import('@/lib/db')
    const cellIds = cells.map((c) => c.id)
    const placeholders = cellIds.map(() => '?').join(',')
    // 旧実装は `JOIN cells sub ON sub.grid_id = g.id` で grids × peripherals をデカルト積的に
    // 展開して COUNT(DISTINCT g.id) で重複排除していたが、データ量が増えると中間行爆発で
    // 秒単位のラグを発生させていた (実測 1〜4 秒)。
    // EXISTS 節の semi-join に変更して index を効かせ、50〜150ms に短縮する。
    //   - self_cell は grid_id 取得のためだけに使うのでスカラサブクエリで置換
    //   - COUNT(DISTINCT) は EXISTS で重複が出ないので COUNT(*) に簡略化
    const rows = await query<{ cell_id: string; cnt: number }>(
      `SELECT g.center_cell_id AS cell_id, COUNT(*) AS cnt
       FROM grids g
       WHERE g.center_cell_id IN (${placeholders})
         AND g.deleted_at IS NULL
         AND g.id != (
           SELECT grid_id FROM cells
           WHERE id = g.center_cell_id AND deleted_at IS NULL
           LIMIT 1
         )
         AND EXISTS (
           SELECT 1 FROM cells sub
           WHERE sub.grid_id = g.id
             AND sub.position != 4
             AND sub.deleted_at IS NULL
             AND (sub.text != '' OR sub.image_path IS NOT NULL)
         )
       GROUP BY g.center_cell_id`,
      cellIds,
    )
    for (const r of rows) {
      map.set(r.cell_id, r.cnt)
    }
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

  /**
   * グリッド本体を `target` (= `data-converge-target` 属性を持つ DOM) の中心へ向けて
   * 縮みながらフェードアウトさせる収束アニメ。
   * - target / グリッド ref のいずれかが取れない場合は no-op で graceful skip
   * - other anim (orbit / orbit9 / viewSwitch / slide) 進行中も no-op で抜ける (二重発火防止)
   * - 完了まで `await` で待つので、呼び出し側はアニメ後に actual DB 操作 / navigate を実行できる
   */
  const runConvergeAnim = useCallback(async (target: 'stock' | 'home'): Promise<void> => {
    if (orbit || orbit9 || viewSwitch || slide) return
    const targetEl = document.querySelector(`[data-converge-target="${target}"]`)
    const sourceEl = gridRef.current
    if (!targetEl || !sourceEl) return
    const src = sourceEl.getBoundingClientRect()
    const tgt = targetEl.getBoundingClientRect()
    const tx = (tgt.left + tgt.width / 2) - (src.left + src.width / 2)
    const ty = (tgt.top + tgt.height / 2) - (src.top + src.height / 2)
    setConverging({ tx, ty })
    await new Promise<void>((r) => setTimeout(r, CONVERGE_DURATION_MS))
  }, [orbit, orbit9, viewSwitch, slide])

  // orbit / orbit9 の safety net: 各 drill handler が明示的に setOrbit(null) を呼ぶ前提の
  // もとで、例外やその他の理由で明示 clear が走らなかった場合の救済としてアニメ最大時間 +
  // 500ms 経過したら強制 clear する。
  //
  // 'initial' (ダッシュボードから開いた直後) は init() 内の setTimeout で明示 clear するので
  // ここでは対象外。
  //
  // 以前は「gridData が targetGridId に追いついたら即 clear」という fast path を持っていたが、
  // 順序変更で setCurrentGrid が await の前に移った結果、animation 途中で gridData が追い
  // ついて早すぎるタイミングで orbit が切れてしまうため削除した。
  useEffect(() => {
    if (!orbit || orbit.direction === 'initial') return
    const maxMs =
      (orbit.direction === 'drill-up'
        ? ORBIT_STAGGER_UP_MS * 8 + ORBIT_FADE_UP_MS
        : ORBIT_STAGGER_DOWN_MS * 7 + ORBIT_FADE_DOWN_MS) + 500
    const t = setTimeout(() => setOrbit(null), maxMs)
    return () => clearTimeout(t)
  }, [orbit, ORBIT_STAGGER_UP_MS, ORBIT_FADE_UP_MS, ORBIT_STAGGER_DOWN_MS, ORBIT_FADE_DOWN_MS])

  useEffect(() => {
    if (!orbit9 || orbit9.direction === 'initial') return
    const maxMs =
      (orbit9.direction === 'drill-up'
        ? ORBIT_STAGGER_UP_MS * 8 + ORBIT_FADE_UP_MS
        : ORBIT_STAGGER_DOWN_MS * 7 + ORBIT_FADE_DOWN_MS) + 500
    const t = setTimeout(() => setOrbit9(null), maxMs)
    return () => clearTimeout(t)
  }, [orbit9, ORBIT_STAGGER_UP_MS, ORBIT_FADE_UP_MS, ORBIT_STAGGER_DOWN_MS, ORBIT_FADE_DOWN_MS])

  // サブグリッドの存在マップ (cellId → childCount)
  const [childCounts, setChildCounts] = useState<Map<string, number>>(new Map())


  // インライン編集中のセル ID (textarea を表示するセル)
  const [inlineEditingCellId, setInlineEditingCellId] = useState<string | null>(null)

  /**
   * 空 slot (DB に cell 行が無い) を編集中の状態。
   * 新設計では空セルを物理的に作らないので、空 slot をクリックしたら以下のフローを取る:
   * 1. pendingEdit に (gridId, position) を立て、inlineEditingCellId に合成 id `pending:gridId:position` を入れる
   * 2. GridView 側はこの合成 id で synthetic cell を生成して inline edit UI を表示
   * 3. commit 時 (Tab/Esc/blur/Cmd+Enter)、実際にテキストが入っていれば upsertCellAt で INSERT、空ならスキップ
   * 4. INSERT 後、refreshCell で gridData に取り込む
   */
  type PendingEdit = { gridId: string; position: number }
  const [pendingEdit, setPendingEdit] = useState<PendingEdit | null>(null)
  const pendingCellId = pendingEdit ? `pending:${pendingEdit.gridId}:${pendingEdit.position}` : null

  function handleStartEmptySlotEdit(targetGridId: string, position: number) {
    setPendingEdit({ gridId: targetGridId, position })
    setInlineEditingCellId(`pending:${targetGridId}:${position}`)
  }

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

  // 非同期処理 (init / drill の setTimeout await) が unmount 後に state を触らないよう
  // 検査する ref。unmount 時に current = false にして、await 直後のガードで早期 return する。
  // ⌘Q (window close) 時にアニメ待ちの Promise が resolve しても、setState が空振りして
  // 外部参照を解放するため、renderer のシャットダウンが滞らない。
  const isMountedRef = useRef(true)
  useEffect(() => {
    isMountedRef.current = true
    return () => { isMountedRef.current = false }
  }, [])

  // 初期ロード: ルートグリッドを取得してエディタを初期化
  useEffect(() => {
    let cancelled = false
    async function init() {
      try {
        const roots = await getRootGrids(mandalartId)
        if (cancelled) return
        if (roots.length === 0) {
          setToast({ message: 'グリッドが見つかりません', type: 'error' })
          return
        }
        const root = roots[0]

        // まず cells / childCounts / subGrids を全て prefetch してから setOrbit → setCurrentGrid の順で
        // state を反映することで、"ベアグリッドが一瞬見える" フラッシュを回避する。
        // orbit が先に active になっていれば、gridData 反映後の通常 render 経路はスキップされ、
        // orbit 経路でセルが描画される (事前フェッチ済み childCountsByCellId を使うので border も正しい)。
        const { query } = await import('@/lib/db')
        if (cancelled) return
        const cells = await query<import('@/types').Cell>(
          'SELECT * FROM cells WHERE grid_id = ? AND deleted_at IS NULL ORDER BY position',
          [root.id],
        )
        if (cancelled) return
        const childCountsByCellId = await fetchChildCountsFor(cells)
        if (cancelled) return

        setParallelGrids(roots)
        setParallelIndex(0)
        resetBreadcrumb({
          gridId: root.id,
          cellId: null,
          label: cells.find((c: Cell) => c.position === CENTER_POSITION)?.text ?? '',
          imagePath: cells.find((c: Cell) => c.position === CENTER_POSITION)?.image_path ?? null,
          cells: cells,
          highlightPosition: null,
        })

        // 初回表示アニメーション: 中心 → 時計回りに周辺を順に fade-in。
        // orbit を先にセットしてから setCurrentGrid (useGrid ロード開始) する。
        // こうすると gridData 反映のタイミングに関わらず、orbit 経路が最初から描画される。
        if (viewMode === '9x9') {
          const targetSubGrids = await fetchSubGridsFor(cells)
          if (cancelled) return
          setOrbit9({
            targetRootCells: cells,
            targetSubGrids,
            targetGridId: root.id,
            childCountsByCellId,
            movingToPosition: null,
            movingFromPosition: 4,
            direction: 'initial',
          })
          setCurrentGrid(root.id)
          await new Promise((r) =>
            setTimeout(r, ORBIT_STAGGER_INIT_MS * 8 + ORBIT_FADE_INIT_MS),
          )
          if (cancelled) return
          setChildCounts(childCountsByCellId)
          setSubGrids(targetSubGrids)
          setOrbit9(null)
        } else {
          // ダッシュボード → エディタ拡大 (convergeStore direction='open') で入ってきた場合は、
          // convergence overlay の morph (CONVERGE_DURATION_MS) が完了してから初回 orbit fade-in を
          // 始める。こうすることで「のの字」描画の前に中心セルが overlay からの引渡しで先に現れる。
          const fromDashboard = useConvergeStore.getState().direction === 'open'
          const initialDelayMs = fromDashboard ? CONVERGE_DURATION_MS : 0
          setOrbit({
            targetCells: cells,
            targetGridId: root.id,
            childCountsByCellId,
            movingCellId: null,
            movingFromPosition: 4,
            direction: 'initial',
            initialDelayMs,
          })
          setCurrentGrid(root.id)
          await new Promise((r) =>
            setTimeout(r, initialDelayMs + ORBIT_STAGGER_INIT_MS * 8 + ORBIT_FADE_INIT_MS),
          )
          if (cancelled) return
          setChildCounts(childCountsByCellId)
          setOrbit(null)
        }
      } catch (e) {
        if (cancelled) return
        console.error('EditorLayout init error:', e)
        setToast({ message: `読み込みエラー: ${(e as Error).message}`, type: 'error' })
      }
    }
    init()
    return () => { cancelled = true }
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

  // GridView3x3 へ渡すセル一覧。pending edit が立っていれば synthetic cell を 1 つ追加する
  // (空 slot でユーザーが文字入力しているとき用。CellComponent が textarea を表示できるようにする)
  const cellsForRender = useMemo<Cell[]>(() => {
    if (!gridData) return []
    if (!pendingEdit || pendingEdit.gridId !== gridData.id) return gridData.cells
    // 既に同 position に real cell がある場合は synthetic を作らない (整合性)
    if (gridData.cells.some((c) => c.position === pendingEdit.position)) return gridData.cells
    const ts = ''  // synthetic cell は DB に保存されないので timestamp は空でよい
    const synthetic: Cell = {
      id: `pending:${pendingEdit.gridId}:${pendingEdit.position}`,
      grid_id: pendingEdit.gridId,
      position: pendingEdit.position,
      text: '',
      image_path: null,
      color: null,
      done: false,
      created_at: ts,
      updated_at: ts,
    }
    return [...gridData.cells, synthetic]
  }, [gridData, pendingEdit])
  void pendingCellId  // 参照保持 (synthetic cell.id 計算で使う想定、現状は cellsForRender で完結)

  // Copy アクション: snapshot をストックに追加 (元セルは変化なし)。返り値の StockItem は
  // direction='stock' の収束アニメで polling target を解決するために使う。
  const handleCopyAction = useCallback(async (cellId: string) => {
    const stockItem = await addToStock(cellId)
    setStockReloadKey((k) => k + 1)
    setToast({ message: 'ストックにコピーしました', type: 'success' })
    return stockItem
  }, [])

  /**
   * direction='stock' の収束アニメ source 値をエディタ内セル DOM から計測する。
   * `handleNavigateHome` (中心セル → ダッシュボードカード) と同じ方法で text wrapper / span を
   * 探索し、`getComputedStyle` で実描画の inset / font / border / radius を読み取る。
   * 戻り値を `setConverge('stock', stockItem.id, rect, centerCell)` にそのまま渡せる形にした。
   * cellEl が無い (drag 元セルが既に unmount されている等の corner case) ときは null。
   */
  const captureCellSource = useCallback((cellId: string) => {
    const cellEl = document.querySelector(`[data-cell-id="${cellId}"]`) as HTMLElement | null
    const cellData = gridData?.cells.find((c) => c.id === cellId)
    if (!cellEl || !cellData) return null
    const r = cellEl.getBoundingClientRect()
    const cs = getComputedStyle(cellEl)
    const borderTop = parseFloat(cs.borderTopWidth) || 0
    const borderLeft = parseFloat(cs.borderLeftWidth) || 0
    let topInsetPx = 12
    let sideInsetPx = 12
    let fontPx = 28 * fontScale
    const textWrapper = Array.from(cellEl.children).find(
      (el) => el instanceof HTMLElement
        && el.classList.contains('absolute')
        && el.classList.contains('z-10')
        && !el.classList.contains('inset-0'),
    ) as HTMLElement | undefined
    if (textWrapper) {
      const wRect = textWrapper.getBoundingClientRect()
      topInsetPx = wRect.top - r.top - borderTop
      sideInsetPx = wRect.left - r.left - borderLeft
      const span = textWrapper.querySelector('span')
      if (span) fontPx = parseFloat(getComputedStyle(span).fontSize) || fontPx
    }
    return {
      rect: { left: r.left, top: r.top, width: r.width, height: r.height },
      centerCell: {
        text: cellData.text,
        imagePath: cellData.image_path,
        color: cellData.color,
        fontPx,
        topInsetPx,
        sideInsetPx,
        borderPx: borderTop,
        radiusPx: parseFloat(cs.borderTopLeftRadius) || 0,
      },
    }
  }, [gridData, fontScale])

  // 画像ファイルかどうかの簡易判定
  function isImagePath(p: string): boolean {
    return /\.(png|jpe?g|gif|webp|bmp|svg|heic|avif)$/i.test(p)
  }

  const reloadAll = useCallback(() => {
    // gridData が更新されれば useSubGrids / childCounts の useEffect が
    // rootCells 変化で自動的に再フェッチするので、ここで手動 reloadSubGrids を
    // 叩く必要はない (重複呼出の削減)。
    reload()
  }, [reload])

  const handleStockPasteDrop = useCallback(async (stockItemId: string, targetCellId: string) => {
    try {
      await pasteFromStock(stockItemId, targetCellId)
      reloadAll()
      setToast({ message: 'ストックからペーストしました', type: 'success' })
    } catch (e) {
      setToast({ message: `ペースト失敗: ${(e as Error).message}`, type: 'error' })
    }
  }, [reloadAll])

  // ストック → 入力ありの周辺セル drop: 確認 dialog を開く
  const [replaceConfirm, setReplaceConfirm] = useState<{ stockItemId: string; targetCellId: string; targetText: string } | null>(null)

  const handleStockReplaceDrop = useCallback((stockItemId: string, targetCellId: string) => {
    const target = dndCells.find((c) => c.id === targetCellId)
    setReplaceConfirm({
      stockItemId,
      targetCellId,
      targetText: target?.text ?? '',
    })
  }, [dndCells])

  const handleReplaceConfirm = useCallback(async () => {
    if (!replaceConfirm) return
    try {
      await pasteFromStockReplacing(replaceConfirm.stockItemId, replaceConfirm.targetCellId)
      reloadAll()
      setToast({ message: 'ストックの内容で上書きしました', type: 'success' })
    } catch (e) {
      setToast({ message: `上書き失敗: ${(e as Error).message}`, type: 'error' })
    } finally {
      setReplaceConfirm(null)
    }
  }, [replaceConfirm, reloadAll])

  // 4 アクションアイコン (DragActionPanel) ドロップ用 state / dialogs
  const [shredConfirm, setShredConfirm] = useState<{
    cellId: string
    isCenter: boolean
    isPrimaryRoot: boolean
    isSelfCenteredInCurrentGrid: boolean
    gridIdForSelfCenter: string | undefined
    targetText: string
    childrenCount: number
  } | null>(null)
  const [exportPicker, setExportPicker] = useState<{
    cellId: string
    targetText: string
    isCenter: boolean
    gridIdForCenter: string | undefined
  } | null>(null)

  // 中心セル drop 後に上の階層へ navigate (drilled は親 grid、root は dashboard)
  const navigateUpAfterAction = useCallback(() => {
    if (breadcrumb.length <= 1) {
      navigate('/dashboard')
      return
    }
    const parent = breadcrumb[breadcrumb.length - 2]
    if (parent) popBreadcrumbTo(parent.gridId)
  }, [breadcrumb, navigate, popBreadcrumbTo])

  /**
   * 並列グリッドが削除された後の遷移処理。
   * - 削除された並列以外がまだ残っていれば「左隣 (sort_order が 1 つ前) のサブグリッド」を表示
   *   先頭 (index=0) を削除した場合は左隣がないので、新しい先頭をそのまま表示
   * - 並列が他に無い場合 (= 削除後 0 件) は上の階層 (drilled なら親 grid、root なら dashboard) へ
   */
  const navigateAfterParallelDeleted = useCallback((deletedGridId: string) => {
    const oldIndex = parallelGrids.findIndex((g) => g.id === deletedGridId)
    const remaining = parallelGrids.filter((g) => g.id !== deletedGridId)
    if (remaining.length === 0) {
      navigateUpAfterAction()
      return
    }
    const newIndex = Math.max(0, oldIndex - 1)
    const targetGrid = remaining[newIndex]
    setParallelGrids(remaining)
    setParallelIndex(newIndex)
    setCurrentGrid(targetGrid.id)
    // breadcrumb 末尾が削除された grid を指していたら、新 grid id に差し替える
    const last = breadcrumb[breadcrumb.length - 1]
    if (last && last.gridId === deletedGridId) {
      updateBreadcrumbItem(last.gridId, { gridId: targetGrid.id })
    }
  }, [parallelGrids, breadcrumb, navigateUpAfterAction, setCurrentGrid, updateBreadcrumbItem])

  /** primary root の中心セルか判定 (mandalart.root_cell_id と一致するか)。
   *  該当する場合 shred / move はマンダラート全体の削除を意味する。
   *  並列ルート (独立 center) は別 cell id なので false。 */
  const isPrimaryRootCell = useCallback(async (cellId: string): Promise<boolean> => {
    try {
      const m = await getMandalart(mandalartId)
      return m?.root_cell_id === cellId
    } catch {
      return false
    }
  }, [mandalartId])

  const handleActionDrop = useCallback(async (action: ActionDropType, cellId: string) => {
    const cell = dndCells.find((c) => c.id === cellId)
    const isCenter = cell?.position === CENTER_POSITION
    const targetText = cell?.text ?? ''
    // 並列グリッドの中心セル判定: cell が自グリッド (= 現在表示中) に属しかつ中心。
    // root primary も同条件にマッチするが、それは別途 isPrimaryRoot で先に分岐するので問題ない。
    const isSelfCenteredInCurrentGrid = !!(isCenter && cell && gridData && cell.grid_id === gridData.id)
    switch (action) {
      case 'shred': {
        // 配下サブグリッド数を概算 (確認 dialog の文言ヒント)
        const [children, isPrimaryRoot] = await Promise.all([
          getChildGrids(cellId).catch(() => []),
          isCenter ? isPrimaryRootCell(cellId) : Promise.resolve(false),
        ])
        setShredConfirm({
          cellId,
          isCenter: !!isCenter,
          isPrimaryRoot,
          isSelfCenteredInCurrentGrid,
          gridIdForSelfCenter: gridData?.id,
          targetText,
          childrenCount: children.length,
        })
        return
      }
      case 'move': {
        try {
          const isPrimaryRoot = isCenter ? await isPrimaryRootCell(cellId) : false
          if (isPrimaryRoot) {
            // primary root center: snapshot をストックに残してマンダラート全体を完全削除。
            // 視覚的に「ホーム (= dashboard) へ吸い込まれる」演出を入れてから navigate
            await addToStock(cellId)
            setStockReloadKey((k) => k + 1)
            await permanentDeleteMandalart(mandalartId)
            await runConvergeAnim('home')
            setToast({ message: 'ストックへ移動し、マンダラートを削除しました', type: 'success' })
            navigate('/dashboard')
          } else if (isSelfCenteredInCurrentGrid && gridData) {
            // 並列 (root or drilled): snapshot 保存後に並列 grid 自体を完全削除
            // (shredCellSubtree では並列 grid 本体は消えないので明示的に permanentDeleteGrid)
            const deletedGridId = gridData.id
            // セル → ストックエントリ収束アニメの source 値 (cellEl が unmount される前に計測)
            const source = captureCellSource(cellId)
            const stockItem = await addToStock(cellId)
            setStockReloadKey((k) => k + 1)
            if (source) {
              useConvergeStore.getState().setConverge(
                'stock', stockItem.id, source.rect, source.centerCell,
              )
            }
            await permanentDeleteGrid(deletedGridId)
            setToast({ message: 'ストックへ移動し、並列グリッドを削除しました', type: 'success' })
            navigateAfterParallelDeleted(deletedGridId)
          } else {
            // X=C primary drilled center または周辺セル: 通常の moveCellToStock
            const source = captureCellSource(cellId)
            const stockItem = await moveCellToStock(cellId)
            setStockReloadKey((k) => k + 1)
            if (source) {
              useConvergeStore.getState().setConverge(
                'stock', stockItem.id, source.rect, source.centerCell,
              )
            }
            setToast({ message: 'ストックに移動しました', type: 'success' })
            if (isCenter) navigateUpAfterAction()
            else reloadAll()
          }
        } catch (e) {
          setToast({ message: `移動失敗: ${(e as Error).message}`, type: 'error' })
        }
        return
      }
      case 'copy': {
        // セル → ストックエントリ収束アニメ。元セルは変化しないが、convergence は target = 新規 entry
        const source = captureCellSource(cellId)
        const stockItem = await handleCopyAction(cellId)
        if (source) {
          useConvergeStore.getState().setConverge(
            'stock', stockItem.id, source.rect, source.centerCell,
          )
        }
        return
      }
      case 'export': {
        setExportPicker({ cellId, targetText, isCenter: !!isCenter, gridIdForCenter: gridData?.id })
        return
      }
    }
  }, [dndCells, gridData, navigateUpAfterAction, navigateAfterParallelDeleted, reloadAll, handleCopyAction, isPrimaryRootCell, mandalartId, navigate, runConvergeAnim, captureCellSource])

  const handleShredConfirm = useCallback(async () => {
    if (!shredConfirm) return
    const { cellId, isCenter, isPrimaryRoot, isSelfCenteredInCurrentGrid, gridIdForSelfCenter } = shredConfirm
    try {
      if (isPrimaryRoot) {
        // primary root center 削除 → マンダラート全体を完全削除 (ゴミ箱に入れない)。
        // ホーム (= dashboard) へ吸い込まれる演出を入れてから navigate
        await permanentDeleteMandalart(mandalartId)
        await runConvergeAnim('home')
        setToast({ message: 'マンダラートを削除しました', type: 'success' })
        navigate('/dashboard')
      } else if (isSelfCenteredInCurrentGrid && gridIdForSelfCenter) {
        // 並列 (root or drilled): 並列 grid 自体を完全削除し、左隣の並列に切替
        await permanentDeleteGrid(gridIdForSelfCenter)
        setToast({ message: '並列グリッドを削除しました', type: 'success' })
        navigateAfterParallelDeleted(gridIdForSelfCenter)
      } else {
        await shredCellSubtree(cellId)
        setToast({ message: '完全に削除しました', type: 'success' })
        if (isCenter) navigateUpAfterAction()
        else reloadAll()
      }
    } catch (e) {
      setToast({ message: `削除失敗: ${(e as Error).message}`, type: 'error' })
    } finally {
      setShredConfirm(null)
    }
  }, [shredConfirm, navigateUpAfterAction, navigateAfterParallelDeleted, reloadAll, mandalartId, navigate, runConvergeAnim])

  const handleExportPick = useCallback(async (format: ExportFormat) => {
    if (!exportPicker) return
    const { cellId, targetText, isCenter, gridIdForCenter } = exportPicker
    setExportPicker(null)
    try {
      // ファイル名のベース: cell.text を sanitize (Tauri / OS で問題になる文字を _ に置換)
      const baseName = (targetText || 'cell').replace(/[\\/:*?"<>|]/g, '_').slice(0, 40) || 'cell'

      // エクスポート対象 grid の決定:
      //  - 中心セル: 現在表示中の grid 自体を書き出す (root primary なら mandalart 全体、
      //    並列 root / 並列 drilled / X=C primary drilled でもユーザーが見ている grid が対象)
      //  - 周辺セル: parent_cell_id = cellId の primary drilled grid を書き出す
      let targetGridId: string | undefined
      if (isCenter) {
        targetGridId = gridIdForCenter
      } else {
        const childGrids = await getChildGrids(cellId)
        targetGridId = childGrids[0]?.id
      }
      if (!targetGridId) {
        setToast({ message: 'エクスポート対象のグリッドが見つかりません', type: 'info' })
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
  }, [exportPicker])

  const handleDndCellsUpdated = useCallback((updated: Cell[]) => {
    // D&D 成功直後に DB から取り直した各セルを React state に即時反映する。
    // reloadAll (全体再フェッチ) でも UI が追従しないケースがあったため、target 周辺だけ
    // refreshCell で確実に更新する補助経路。refreshCell は gridData.cells 中の該当行だけ
    // 差し替えるので、subGrids / childCounts は従来どおり gridData 変更の useEffect で再計算される。
    for (const c of updated) refreshCell(c)
  }, [refreshCell])

  const {
    dragSourceId, dragOverId, hoveredAction, isDragging,
    handleDragStart, handleStockItemDragStart,
  } = useDragAndDrop(
    dndCells,
    reloadAll,
    handleStockPasteDrop,
    useCallback((op: DndUndoable) => {
      pushUndo({
        description: op.description,
        undo: async () => { await op.undo(); reloadAll() },
        redo: async () => { await op.redo(); reloadAll() },
      })
    }, [pushUndo, reloadAll]),
    handleDndCellsUpdated,
    handleStockReplaceDrop,
    handleActionDrop,
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

    // 9×9 表示で周辺サブブロックの cell (= cell.grid_id が現在表示 grid と異なる) をクリック。
    // この cell は親サブグリッド S の周辺セルで、ユーザーの意図は
    // "clicked cell を中心とした更に深いサブグリッド D にフォーカスする" (= 2 段 drill-down)。
    //
    // breadcrumb は root → S → D の 2 段をまとめて push する。
    //
    // 例外: cell.id が現在 grid の center_cell_id に一致する場合は "自グリッドの中心" なので
    // この分岐はスキップして下の drill-up / home 分岐へ流す。
    if (gridData && cell.grid_id !== gridData.id && cell.id !== gridData.center_cell_id) {
      const subGrid = await getGrid(cell.grid_id)
      if (!subGrid) return
      const parentCellId = subGrid.center_cell_id
      const parentCell = gridData.cells.find((c) => c.id === parentCellId)
      if (!parentCell) return

      // 空 cell は drill できない (= 何もしない、インライン編集に任せる)
      if (isCellEmpty(cell)) return

      // 深いサブグリッド D を取得 or 作成
      const deeperChildren = await getChildGrids(cell.id)
      const deeperGrid =
        deeperChildren.length > 0
          ? await getGrid(deeperChildren[0].id)
          : await getGrid(
              (await createGrid({ mandalartId, parentCellId: cell.id, centerCellId: cell.id, sortOrder: 0 })).id,
            )
      const deeperSiblings =
        deeperChildren.length > 0 ? deeperChildren : await getChildGrids(cell.id)
      const deeperSiblingIdx = deeperSiblings.findIndex((g) => g.id === deeperGrid.id)

      // アニメ: 9×9 なら sub-block の外側位置 (= parentCell.position) → 新中央 (4) へ orbit。
      // cell.position は sub-block 内の内側位置 (0-8) であり 9×9 layout 位置ではないので使えない。
      //
      // 順序: setOrbit9 → state 更新 (setCurrentGrid / pushBreadcrumb 等) → await → 明示 clear。
      // setCurrentGrid を await 前に出すことで、animation 中に gridData fetch が並行して走り
      // memo / breadcrumb がアニメ開始と同時に target を指すようになる。
      let pendingClear9: { childCounts: Map<string, number>; subGrids: Map<string, SubGridData> } | null = null
      if (viewMode === '9x9') {
        const [targetSubGrids, childCountsByCellId] = await Promise.all([
          fetchSubGridsFor(deeperGrid.cells),
          fetchChildCountsFor(deeperGrid.cells),
        ])
        setOrbit9({
          targetRootCells: deeperGrid.cells,
          targetSubGrids,
          targetGridId: deeperGrid.id,
          childCountsByCellId,
          movingToPosition: 4,
          movingFromPosition: parentCell.position,
          direction: 'drill-down',
        })
        pendingClear9 = { childCounts: childCountsByCellId, subGrids: targetSubGrids }
      }

      setCurrentGrid(deeperGrid.id)
      setParallelGrids(deeperSiblings.length > 0 ? deeperSiblings : [deeperGrid])
      setParallelIndex(Math.max(0, deeperSiblingIdx))
      // root → S → D の 2 段分を breadcrumb に push する
      pushBreadcrumb({
        gridId: subGrid.id,
        cellId: parentCell.id,
        label: parentCell.text,
        imagePath: parentCell.image_path,
        cells: gridData.cells,
        highlightPosition: parentCell.position,
      })
      pushBreadcrumb({
        gridId: deeperGrid.id,
        cellId: cell.id,
        label: cell.text,
        imagePath: cell.image_path,
        cells: subGrid.cells,
        highlightPosition: cell.position,
      })

      if (pendingClear9) {
        await new Promise((r) =>
          setTimeout(r, ORBIT_STAGGER_DOWN_MS * 7 + ORBIT_FADE_DOWN_MS),
        )
        if (!isMountedRef.current) return
        setChildCounts(pendingClear9.childCounts)
        setSubGrids(pendingClear9.subGrids)
        setOrbit9(null)
      }
      return
    }

    // 中央セル (= 現在 grid の center_cell_id が指す cell) の特別処理。
    // 9×9 の周辺サブブロックの中央セルは UI 上 position=4 で描画されるが、
    // X=C 統一モデルでは "親グリッドの周辺 cell" なので id 比較で除外する必要がある。
    // (position 比較だけだと 9×9 の周辺サブグリッド中心クリックが誤判定される)
    if (gridData && cell.id === gridData.center_cell_id) {
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
          // 順序: setOrbit → state 更新 → await → 明示 clear
          let pendingUpClear3: Map<string, number> | null = null
          let pendingUpClear9: { childCounts: Map<string, number>; subGrids: Map<string, SubGridData> } | null = null
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
              pendingUpClear3 = childCountsByCellId
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
              pendingUpClear9 = { childCounts: childCountsByCellId, subGrids: targetSubGrids }
            }
          }

          // drill-up 経路: 離れる grid (= 現在の gridData) が空なら auto-cleanup する。
          // これを入れないと「drill → 空のまま中心クリックで戻る」を繰り返すたびに
          // 空 grid が DB に残り、積み上がる (breadcrumb / parallel-nav 経路では既に
          // cleanupGridIfEmpty が呼ばれていたが、drill-up 経路が抜けていた)。
          const oldGridId = gridData.id
          setCurrentGrid(parent.gridId)
          setParallelGrids(siblings.length > 0 ? siblings : [])
          setParallelIndex(siblingIdx >= 0 ? siblingIdx : 0)
          popBreadcrumbTo(parent.gridId)
          await cleanupGridIfEmpty(oldGridId)

          if (pendingUpClear3) {
            await new Promise((r) =>
              setTimeout(r, ORBIT_STAGGER_UP_MS * 8 + ORBIT_FADE_UP_MS),
            )
            if (!isMountedRef.current) return
            setChildCounts(pendingUpClear3)
            setOrbit(null)
          } else if (pendingUpClear9) {
            await new Promise((r) =>
              setTimeout(r, ORBIT_STAGGER_UP_MS * 8 + ORBIT_FADE_UP_MS),
            )
            if (!isMountedRef.current) return
            setChildCounts(pendingUpClear9.childCounts)
            setSubGrids(pendingUpClear9.subGrids)
            setOrbit9(null)
          }
        }
      }
      return
    }

    const children = await getChildGrids(cell.id)
    if (children.length > 0) {
      // 掘り下げ
      const firstChild = await getGrid(children[0].id)
      const currentCells = gridData?.cells ?? []

      // 順序: setOrbit → state 更新 → await → 明示 clear
      let pendingDownClear3: Map<string, number> | null = null
      let pendingDownClear9: { childCounts: Map<string, number>; subGrids: Map<string, SubGridData> } | null = null
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
        pendingDownClear3 = childCountsByCellId
      } else if (viewMode === '9x9') {
        // 9×9 中央ブロック内のセル drill-down: 9×9 layout 上の outer 位置 → 新中央 (4) へ。
        // cell.position は merged view の値で、X=C 合流セル (sub-block center) では 4 に
        // 上書きされている。そのまま使うと from === to になり slide animation が不発。
        // gridData.cells 内の DB 上 position が 9×9 layout での sub-block 外側位置なので
        // そちらを参照する。
        const outerPos =
          gridData?.cells.find((c) => c.id === cell.id)?.position ?? cell.position
        const [targetSubGrids, childCountsByCellId] = await Promise.all([
          fetchSubGridsFor(firstChild.cells),
          fetchChildCountsFor(firstChild.cells),
        ])
        setOrbit9({
          targetRootCells: firstChild.cells,
          targetSubGrids,
          targetGridId: firstChild.id,
          childCountsByCellId,
          movingToPosition: 4,
          movingFromPosition: outerPos,
          direction: 'drill-down',
        })
        pendingDownClear9 = { childCounts: childCountsByCellId, subGrids: targetSubGrids }
      }

      setCurrentGrid(firstChild.id)
      // 並列グリッドも含めた全兄弟を state に載せないと、← → で切り替えたり
      // "+" で末尾に追加したりしたときに既存の並列が見えなくなってしまう。
      setParallelGrids(children)
      setParallelIndex(0)
      pushBreadcrumb({
        gridId: firstChild.id,
        cellId: cell.id,
        label: cell.text,
        imagePath: cell.image_path,
        cells: currentCells,
        highlightPosition: cell.position,
      })

      if (pendingDownClear3) {
        await new Promise((r) =>
          setTimeout(r, ORBIT_STAGGER_DOWN_MS * 7 + ORBIT_FADE_DOWN_MS),
        )
        if (!isMountedRef.current) return
        setChildCounts(pendingDownClear3)
        setOrbit(null)
      } else if (pendingDownClear9) {
        await new Promise((r) =>
          setTimeout(r, ORBIT_STAGGER_DOWN_MS * 7 + ORBIT_FADE_DOWN_MS),
        )
        if (!isMountedRef.current) return
        setChildCounts(pendingDownClear9.childCounts)
        setSubGrids(pendingDownClear9.subGrids)
        setOrbit9(null)
      }
    } else if (!isCellEmpty(cell)) {
      // 入力ありだが子グリッドなし → 新しいサブグリッドを作成して掘り下げ
      // 新モデル: center_cell_id = cell.id (親の周辺セルがそのまま子グリッドの中心になる)
      // 中心の text/image/color/done は親セルそのものなので別途コピー不要
      const newGrid = await createGrid({ mandalartId, parentCellId: cell.id, centerCellId: cell.id, sortOrder: 0 })

      // newGrid.cells は 9 要素で提供される (中心は親 cell、周辺 8 は新規 empty)
      const populatedCells = newGrid.cells

      // 順序: setOrbit → state 更新 → await → 明示 clear
      let pendingNewClear3: Map<string, number> | null = null
      let pendingNewClear9: { childCounts: Map<string, number>; subGrids: Map<string, SubGridData> } | null = null
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
        pendingNewClear3 = childCountsByCellId
      } else if (viewMode === '9x9') {
        // 9×9 で新規サブグリッドを掘り下げ。sub-grid が無い新規作成直後なので
        // targetSubGrids / childCountsByCellId はすべて空で確定。
        // movingFromPosition は 9×9 outer 位置 (gridData.cells の DB position) を使う。
        // merged view の cell.position は 4 に上書きされ得るので直接使わない。
        const outerPos =
          gridData?.cells.find((c) => c.id === cell.id)?.position ?? cell.position
        const childCountsByCellId = new Map<string, number>(
          populatedCells.map((c) => [c.id, 0]),
        )
        const targetSubGrids = new Map<string, SubGridData>()
        setOrbit9({
          targetRootCells: populatedCells,
          targetSubGrids,
          targetGridId: newGrid.id,
          childCountsByCellId,
          movingToPosition: 4,
          movingFromPosition: outerPos,
          direction: 'drill-down',
        })
        pendingNewClear9 = { childCounts: childCountsByCellId, subGrids: targetSubGrids }
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

      if (pendingNewClear3) {
        await new Promise((r) =>
          setTimeout(r, ORBIT_STAGGER_DOWN_MS * 7 + ORBIT_FADE_DOWN_MS),
        )
        if (!isMountedRef.current) return
        setChildCounts(pendingNewClear3)
        setOrbit(null)
      } else if (pendingNewClear9) {
        await new Promise((r) =>
          setTimeout(r, ORBIT_STAGGER_DOWN_MS * 7 + ORBIT_FADE_DOWN_MS),
        )
        if (!isMountedRef.current) return
        setChildCounts(pendingNewClear9.childCounts)
        setSubGrids(pendingNewClear9.subGrids)
        setOrbit9(null)
      }
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
    // pending edit (空 slot からの新規) を判定
    const isPending = cell.id.startsWith('pending:')
    if (isPending) {
      setPendingEdit(null)
      // テキストが空なら何もせず終了 (無駄な空 cell を作らない)
      if (text === '') return
      // 中心セルが空のときは周辺の編集を許さない (validation)
      if (cell.position !== CENTER_POSITION) {
        const center = getCenterCell(gridData?.cells ?? [])
        if (!center || isCellEmpty(center)) {
          setToast({ message: '中心セルが空のときは周辺セルを編集できません', type: 'error' })
          return
        }
      }
      const newCell = await upsertCellAt(cell.grid_id, cell.position, {
        text,
        image_path: null,
        color: null,
      })
      refreshCell(newCell)
      return
    }
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
    // currentPosition の cell が無い (空 slot からの pending edit commit) ケースは push する
    const hasCurrent = cells.some((c) => c.position === currentPosition)
    const updatedCells = hasCurrent
      ? cells.map((c) => (c.position === currentPosition ? { ...c, text: currentText } : c))
      : [...cells, {
          id: `_temp_${currentPosition}`, grid_id: gridData?.id ?? '', position: currentPosition,
          text: currentText, image_path: null, color: null, done: false,
          created_at: '', updated_at: '',
        } as Cell]
    const center = getCenterCell(updatedCells)
    const centerEmpty = !center || isCellEmpty(center)
    const nextPos = nextTabPosition(currentPosition, reverse)
    // 中心が空のときは周辺セル無効なので留まる
    if (centerEmpty && nextPos !== 4) {
      const centerCell = updatedCells.find((c) => c.position === CENTER_POSITION)
      if (centerCell && !centerCell.id.startsWith('_temp_')) {
        setInlineEditingCellId(centerCell.id)
      } else if (gridData) {
        handleStartEmptySlotEdit(gridData.id, CENTER_POSITION)
      }
      return
    }
    const next = updatedCells.find((c) => c.position === nextPos)
    if (next && !next.id.startsWith('_temp_')) {
      setInlineEditingCellId(next.id)
    } else if (gridData) {
      // 次の slot に cell 行が無い (新設計の空 slot) → pending edit を開始
      handleStartEmptySlotEdit(gridData.id, nextPos)
    }
  }

  async function handleSaveCell(cellId: string, params: { text: string; image_path: string | null; color: string | null }) {
    // pending edit (空 slot からの新規) で expand editor (色 / 画像) が呼ばれたケース。
    // synthetic cell.id を持っているので gridData には居ない。upsertCellAt で先に INSERT する。
    if (cellId.startsWith('pending:') && pendingEdit) {
      const newCell = await upsertCellAt(pendingEdit.gridId, pendingEdit.position, params)
      refreshCell(newCell)
      setPendingEdit(null)
      setInlineEditingCellId(newCell.id)
      return
    }
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
   * 指定グリッドが「空」なら削除する。判定基準は grid 種別で異なる:
   *
   * - **self-centered** (root grid / 独立並列グリッド、center cell が自グリッド所属):
   *   中心セル **かつ** peripherals が全て空 → 削除。
   *   独立並列は center cell 行を保持しているため、中心だけ見ていると peripherals に
   *   内容があっても誤削除するバグがあった (migration 006 対応で修正)。
   * - **非 self-centered** (X=C primary drilled / レガシー共有並列):
   *   自グリッドの peripherals 8 個が全部空 → 削除。中心は親 X と共有なので
   *   自グリッド側では消せない。
   *   兄弟の有無に関わらず削除する (以前は「単独 drilled」は X 保持のため残していたが、
   *   空グリッドの累積を招くだけで X 自体や UI には影響しないと判明したため廃止)。
   *
   * 判定は DB から再読み込みした merged cells で行う (state の部分更新で position
   * override が崩れていても影響を受けないようにするため)。
   */
  async function cleanupGridIfEmpty(gridId: string): Promise<boolean> {
    try {
      const gridWithCells = await getGrid(gridId)
      const centerCellId = gridWithCells.center_cell_id
      const centerCell = gridWithCells.cells.find((c) => c.id === centerCellId)
      const isSelfCentered = centerCell?.grid_id === gridWithCells.id

      if (isSelfCentered) {
        const center = gridWithCells.cells.find((c) => c.position === CENTER_POSITION)
        const peripherals = gridWithCells.cells.filter((c) => c.position !== CENTER_POSITION)
        const centerEmpty = !center || isCellEmpty(center)
        const peripheralsEmpty = peripherals.every(isCellEmpty)
        if (!centerEmpty || !peripheralsEmpty) return false
        // 自動掃除は復元の意図がないので soft-delete ではなく local + cloud の hard-delete を使う
        // (deleteGrid の soft-delete では cloud に deleted_at 付きゴミが永続的に残るため)
        await permanentDeleteGrid(gridId)
        return true
      }

      // 非 self-centered: peripherals (自 grid 所属のセル = centerCellId 以外) が全て空か?
      const peripherals = gridWithCells.cells.filter((c) => c.id !== centerCellId)
      if (peripherals.some((c) => !isCellEmpty(c))) return false

      await permanentDeleteGrid(gridId)
      return true
    } catch (e) {
      console.error('cleanup permanentDeleteGrid failed:', e)
      return false
    }
  }

  async function handleNavigateHome() {
    if (!gridData) {
      navigate('/dashboard')
      return
    }
    // 唯一の root grid + 中心空 → マンダラート全体を削除する特殊パス。
    // "self-centered な root" は center_cell_id が自グリッドに属する cell を指す。
    const center = gridData.cells.find((c) => c.position === CENTER_POSITION)
    const centerEmpty = !center || isCellEmpty(center)
    const isSoleRoot =
      breadcrumb.length === 1 &&
      parallelGrids.length === 1 &&
      gridData.center_cell_id === center?.id
    const willDelete = centerEmpty && isSoleRoot
    if (willDelete) {
      await deleteMandalart(mandalartId)
    } else {
      // それ以外の "empty" は cleanupGridIfEmpty に判定を委譲
      await cleanupGridIfEmpty(gridData.id)
    }
    // 削除されないケースは「中心セル → ダッシュボードカード」の収束アニメ用に
    // 中心セルの矩形と表示内容を ConvergeOverlay 経由で伝達する。
    // 削除されるケースは対象カードが無いので skip。
    if (!willDelete && center) {
      const centerEl = document.querySelector(`[data-cell-id="${center.id}"]`) as HTMLElement | null
      if (centerEl) {
        const r = centerEl.getBoundingClientRect()
        // overlay 出現時のテキスト位置/サイズを編集中の中心セルに pixel-perfect で揃えるため、
        // Cell.tsx の計算式 (size / borderPx / showCheckbox / fontScale 等の組合せ) を
        // 再現する代わりに、実際に描画されている text wrapper / span の DOM から値を読み出す。
        // これにより 3×3 / 9×9 / checkbox 有無 / fontScale 変動にすべて自動追従する。
        // 構造: [data-cell-id] > div.absolute.z-10 > span (Cell.tsx 497-504)。
        // 画像のみのセルは text wrapper が存在しないが、その場合 overlay も画像のみ表示なので inset は不要 (default 値で fallback)。
        let topInsetPx = 12
        let sideInsetPx = 12
        let fontPx = 28 * fontScale
        const cs = getComputedStyle(centerEl)
        const borderTop = parseFloat(cs.borderTopWidth) || 0
        const borderLeft = parseFloat(cs.borderLeftWidth) || 0
        const borderPx = borderTop
        const radiusPx = parseFloat(cs.borderTopLeftRadius) || 0
        const textWrapper = Array.from(centerEl.children).find(
          (el) => el instanceof HTMLElement
            && el.classList.contains('absolute')
            && el.classList.contains('z-10')
            && !el.classList.contains('inset-0'),
        ) as HTMLElement | undefined
        if (textWrapper) {
          const wRect = textWrapper.getBoundingClientRect()
          topInsetPx = wRect.top - r.top - borderTop
          sideInsetPx = wRect.left - r.left - borderLeft
          const span = textWrapper.querySelector('span')
          if (span) fontPx = parseFloat(getComputedStyle(span).fontSize) || fontPx
        }
        useConvergeStore.getState().setConverge(
          'home',
          mandalartId,
          { left: r.left, top: r.top, width: r.width, height: r.height },
          {
            text: center.text,
            imagePath: center.image_path,
            color: center.color,
            fontPx,
            topInsetPx,
            sideInsetPx,
            borderPx,
            radiusPx,
          },
        )
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

    // 先に cleanup (DB 上のグリッド削除 + 必要なら親セルのクリア) を完了させてから
    // popBreadcrumbTo を呼ぶ。
    // 順序を逆にすると、popBreadcrumbTo で React が再レンダし useGrid が target grid
    // を即座にフェッチしてしまい、cleanup による親セルクリアが反映される前のキャッシュで
    // gridData が固定化される (= 画面上で変化が見えない) ため。
    await cleanupGridIfEmpty(oldGridId)

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
      const deleted = await cleanupGridIfEmpty(oldGridId)
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

    // migration 006 以降: 並列グリッドは独立した center cell を持つ。
    // parent_cell_id は現在 grid から継承し (root なら null、drilled なら drill 元 cell)、
    // center は新 cell を空コンテンツで INSERT する (コピーしない)。
    if (!gridData) return
    const newGrid = await createGrid({
      mandalartId,
      parentCellId: gridData.parent_cell_id,
      centerCellId: null,
      sortOrder: parallelGrids.length,
    })

    // newGrid.cells は getGrid 経由で center merged な 9 要素を持つ
    const toCells: Cell[] = newGrid.cells
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
    let targetCellId = inlineEditingCellId
    if (!targetCellId) {
      setToast({ message: 'ペースト先のセルをインライン編集中にしてください (またはドラッグ&ドロップしてください)', type: 'info' })
      return
    }
    // pending edit (空 slot) の場合、本物の cell をまず INSERT して target id を取り直す
    if (targetCellId.startsWith('pending:') && pendingEdit) {
      const newCell = await upsertCellAt(pendingEdit.gridId, pendingEdit.position, {})
      refreshCell(newCell)
      targetCellId = newCell.id
      setInlineEditingCellId(newCell.id)
      setPendingEdit(null)
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

  // エクスポート (インポートと揃え、JSON / Markdown / インデントテキストに加え、視覚出力として PNG / PDF)。
  // tauri-plugin-fs で $DOWNLOAD に直接書き、保存先ファイル名を toast で通知する
  // (Tauri WebKit は <a download> の click による自動ダウンロードをサポートしないため)。
  async function handleExport(format: 'png' | 'pdf' | 'json' | 'markdown' | 'indent') {
    setExportMenu(false)
    if (!currentGridId) return
    try {
      let filename: string | null = null
      if (format === 'png' && gridRef.current) {
        filename = await exportAsPNG(gridRef.current)
      } else if (format === 'pdf' && gridRef.current) {
        filename = await exportAsPDF(gridRef.current)
      } else if (format === 'json') {
        const data = await exportToJSON(currentGridId)
        filename = await downloadJSON(data)
      } else if (format === 'markdown') {
        const md = await exportToMarkdown(currentGridId)
        filename = await downloadText(md, 'md')
      } else if (format === 'indent') {
        const txt = await exportToIndentText(currentGridId)
        filename = await downloadText(txt, 'txt')
      }
      if (filename) {
        setToast({ message: `ダウンロードフォルダに保存しました: ${filename}`, type: 'success' })
      }
    } catch (e) {
      console.error('[export] failed:', e)
      setToast({ message: `エクスポートに失敗: ${(e as Error).message}`, type: 'error' })
    }
  }

  return (
    <div className="flex flex-col h-screen bg-neutral-50 dark:bg-neutral-950 text-neutral-900 dark:text-neutral-100 overflow-hidden">
      {/* オフラインインジケーター */}
      {isOffline && (
        <div className="bg-yellow-500 text-white text-xs text-center py-1">
          オフライン — 変更はローカルに保存されます
        </div>
      )}

      {/* ヘッダー */}
      <header className="bg-white dark:bg-neutral-900 border-b border-neutral-200 dark:border-neutral-800 px-4 py-2 flex items-center gap-2 shrink-0">
        <Breadcrumb onHome={handleNavigateHome} onNavigate={handleBreadcrumbNavigate} />
        <div className="ml-auto flex items-center gap-2 shrink-0">
          <ThemeToggle />

          {/* 文字サイズ (-10 〜 +10、各段 ×1.1) */}
          <div className="flex items-stretch rounded-lg border border-neutral-200 dark:border-neutral-700 overflow-hidden text-xs">
            <button
              onClick={() => bumpFontLevel(-1)}
              className="px-2 py-1.5 hover:bg-neutral-50 dark:hover:bg-neutral-800 text-neutral-600 dark:text-neutral-300 disabled:opacity-30"
              disabled={fontLevel <= -10}
              title="文字を小さく"
            >
              A−
            </button>
            <button
              onClick={() => resetFontLevel()}
              className="px-2 py-1.5 hover:bg-neutral-50 dark:hover:bg-neutral-800 text-neutral-600 dark:text-neutral-300 border-x border-neutral-200 dark:border-neutral-700 min-w-[3.5rem] text-center tabular-nums"
              title={`100% にリセット (現在 level ${fontLevel >= 0 ? '+' : ''}${fontLevel})`}
            >
              {(fontScale * 100).toFixed(0)}%
            </button>
            <button
              onClick={() => bumpFontLevel(1)}
              className="px-2 py-1.5 hover:bg-neutral-50 dark:hover:bg-neutral-800 text-neutral-600 dark:text-neutral-300 disabled:opacity-30"
              disabled={fontLevel >= 20}
              title="文字を大きく"
            >
              A＋
            </button>
          </div>

          {/* チェックボックス表示 ON/OFF (チェックボックス型ボタン) */}
          <button
            type="button"
            onClick={handleToggleShowCheckbox}
            className={`w-5 h-5 rounded border-2 flex items-center justify-center transition-colors ${
              showCheckbox
                ? 'bg-blue-600 border-blue-600 text-white'
                : 'bg-white dark:bg-neutral-900 border-neutral-400 dark:border-neutral-500 hover:border-neutral-700 dark:hover:border-neutral-300 text-transparent'
            }`}
            title={showCheckbox ? 'チェックボックス表示中 (クリックで非表示)' : 'チェックボックス非表示 (クリックで表示)'}
            aria-label="toggle checkbox display"
            aria-pressed={showCheckbox}
          >
            <svg viewBox="0 0 16 16" className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="3 8 7 12 13 4" />
            </svg>
          </button>

          {/* 表示モード切替 */}
          <div className="flex rounded-lg border border-neutral-200 overflow-hidden text-xs">
            {(['3x3', '9x9'] as const).map((mode) => (
              <button
                key={mode}
                onClick={() => handleViewModeSwitch(mode)}
                disabled={viewSwitch != null}
                className={`px-3 py-1.5 transition-colors disabled:opacity-60 ${viewMode === mode ? 'bg-blue-600 text-white' : 'hover:bg-neutral-50 dark:hover:bg-neutral-800 text-neutral-600 dark:text-neutral-300'}`}
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
              <div className="absolute right-0 top-full mt-1 bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 rounded-xl shadow-lg z-20 min-w-[140px]">
                {(
                  [
                    { fmt: 'png', label: 'PNG' },
                    { fmt: 'pdf', label: 'PDF' },
                    { fmt: 'json', label: 'JSON' },
                    { fmt: 'markdown', label: 'Markdown' },
                    { fmt: 'indent', label: 'インデントテキスト' },
                  ] as const
                ).map(({ fmt, label }) => (
                  <button
                    key={fmt}
                    onClick={() => handleExport(fmt)}
                    className="w-full text-left px-4 py-2 text-sm hover:bg-neutral-50 dark:hover:bg-neutral-800 first:rounded-t-xl last:rounded-b-xl"
                  >
                    {label}
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
                  className="w-12 h-12 rounded-full bg-white dark:bg-neutral-900 border border-neutral-300 dark:border-neutral-600 text-neutral-600 dark:text-neutral-300 hover:bg-neutral-50 dark:hover:bg-neutral-800 shadow-sm flex items-center justify-center"
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
              // ConvergeOverlay の direction='open' (ダッシュボード → エディタ拡大) で
              // 中心セルを polling するときの起点。`[data-mandalart-id="X"] [data-position="4"]` で
              // 自身配下の中心セル DOM を一意に解決する。
              data-mandalart-id={mandalartId}
              className="relative overflow-hidden"
              // converging が設定されている間だけ transform / opacity を上書きして
              // 「マンダラート → セルへ吸い込み」アニメを駆動する。null に戻すと
              // transition: 'none' で瞬時復帰し、戻り用フェードは出さない設計
              style={{
                width: gridSize,
                height: gridSize,
                transition: converging
                  ? `transform ${CONVERGE_DURATION_MS}ms cubic-bezier(0.4, 0, 1, 1), opacity ${CONVERGE_DURATION_MS}ms ease-in`
                  : 'none',
                transform: converging
                  ? `translate(${converging.tx}px, ${converging.ty}px) scale(0.05)`
                  : undefined,
                opacity: converging ? 0 : 1,
              }}
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
                    'grid grid-cols-3 grid-rows-3 gap-px bg-neutral-300 dark:bg-neutral-700 rounded-xl overflow-hidden min-h-0 min-w-0'
                  const innerEmptyCellClass = 'bg-white dark:bg-neutral-900'

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
                      ? 'border-2 border-black dark:border-neutral-300'
                      : 'border-2 border-neutral-300 dark:border-neutral-700'

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
                    // render と同じ構造 (bg-neutral-300 wrapper + 6px 外枠 + size='small' セル) を
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
                            gridId={viewSwitch.rootCells[0]?.grid_id ?? ''}
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

                          // 空 slot: 入力ありセルと同じ transform / transition で展開
                          // (GridView3x3 の空 placeholder と同じ枠 / 背景に揃え、view-switch 終了 swap で
                          // 見た目が pop しないようにする)
                          if (!cell) {
                            return (
                              <div
                                key={`empty-${pos}`}
                                style={{
                                  transform,
                                  transition,
                                  transformOrigin: 'top left',
                                  willChange: 'transform',
                                }}
                                className={`
                                  rounded-lg shadow-sm bg-white dark:bg-neutral-900
                                  ${isCenter
                                    ? 'border-[6px] border-black dark:border-white shadow-md'
                                    : 'border border-neutral-300 dark:border-neutral-700'}
                                `}
                              />
                            )
                          }

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
                              // pointer-events: none で click は飛ばないが、checkbox を
                              // render させるため onToggleDone を渡す
                              onToggleDone={showCheckbox ? handleToggleDone : undefined}
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
                          gridId={cells[0]?.grid_id ?? ''}
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
                          // スライド中も checkbox を表示するため onToggleDone を渡す
                          // (pointer-events: none で click は飛ばない)
                          onToggleDone={showCheckbox ? handleToggleDone : undefined}
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
                    // ダッシュボード → エディタ拡大経由の初回 orbit (initialDelayMs > 0) では、
                    // convergence overlay の morph (CONVERGE_DURATION_MS) が終わるまで全セルを
                    // opacity 0 で隠す。`animation-fill-mode: both` の効果で delay 中は from フレーム
                    // (opacity 0) で固定される。中心セルだけは「overlay 終端と同じ瞬間に instant snap で
                    // opacity 1 になる」必要があるので、duration を 1ms にして delay = initialDelayMs と
                    // 揃える (overlay clear ≒ 中心セル可視化が同時に起きて handoff が seamless)。
                    // duration 1ms は事実上の snap (60fps の 1 frame = 16ms 内で完了) で、
                    // 「フェードしないが overlay 中は隠す」を両立する。
                    const initialDelayMs = orbit.initialDelayMs ?? 0
                    const isFromDashboard =
                      orbit.direction === 'initial' && initialDelayMs > 0
                    return Array.from({ length: GRID_CELL_COUNT }).map((_, pos) => {
                      const cell = orbit.targetCells.find((c) => c.position === pos)
                      const isCenter = isCenterPosition(pos)
                      const isDisabled = !isCenter && centerEmpty
                      const staggerIdx = order.indexOf(pos)
                      // drill-down で pos=4 (= 移動セル) は stagger に含まれないので delay 0
                      const fadeDelay =
                        staggerIdx >= 0 ? staggerIdx * stagger + initialDelayMs : 0
                      // 中心セルのみ snap、それ以外は通常 fade
                      const cellFade = isFromDashboard && isCenter ? 1 : fade

                      // 空 slot: GridView3x3 の空 placeholder と同じ styling + orbit-fade-in
                      // を適用して、入力ありセルと同じタイミングで「内容・背景・外枠」揃って
                      // 表示されるようにする (orbit 終了 swap で見た目が pop しないよう className を一致させる)
                      if (!cell) {
                        return (
                          <div
                            key={`empty-${pos}`}
                            style={{
                              animation: `orbit-fade-in ${cellFade}ms ease-out ${fadeDelay}ms both`,
                              willChange: 'opacity',
                            }}
                            className={`
                              rounded-lg shadow-sm bg-white dark:bg-neutral-900
                              ${isCenter
                                ? 'border-[6px] border-black dark:border-white shadow-md'
                                : 'border border-neutral-300 dark:border-neutral-700'}
                            `}
                          />
                        )
                      }

                      const isMoving = cell.id === orbit.movingCellId

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
                              animation: `orbit-fade-in ${cellFade}ms ease-out ${fadeDelay}ms both`,
                              willChange: 'opacity',
                            }
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
                          // pointer-events: none で click は飛ばないが、checkbox を render
                          // させるため onToggleDone を渡す (現行 showCheckbox 状態を反映)
                          onToggleDone={showCheckbox ? handleToggleDone : undefined}
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
                    'grid grid-cols-3 grid-rows-3 gap-px bg-neutral-300 dark:bg-neutral-700 rounded-xl overflow-hidden min-h-0 min-w-0'
                  const innerEmptyCellClass = 'bg-white dark:bg-neutral-900'
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
                            ? 'border-2 border-black dark:border-neutral-300'
                            : 'border-2 border-neutral-300 dark:border-neutral-700'

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
                      cells={cellsForRender}
                      gridId={gridData.id}
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
                      onStartEmptySlotEdit={handleStartEmptySlotEdit}
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
                      // 9×9 はナビゲーション専用。cut 表示や drag 状態も伝えない
                      // (そもそも drag / cut は 9×9 から開始できないので常に null だが、
                      //  view 切替時に 3×3 の状態が残るのを防ぐために明示的に null)
                      cutCellId={null}
                      dragSourceId={null}
                      dragOverId={null}
                      fontScale={fontScale}
                      inlineEditingCellId={null}
                      userId={userId}
                      mandalartId={mandalartId}
                      // 編集系は全て no-op に
                      onCellSave={NOOP_EDIT_ASYNC}
                      onStartInlineEdit={NOOP_EDIT}
                      onCommitInlineEdit={NOOP_EDIT_ASYNC}
                      onInlineNavigate={NOOP_EDIT}
                      onDrill={handleCellDrill}
                      onDragStart={NOOP_EDIT}
                      onContextMenu={PREVENT_CONTEXT_MENU}
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
                  className="w-12 h-12 rounded-full bg-white dark:bg-neutral-900 border border-neutral-300 dark:border-neutral-600 text-neutral-600 dark:text-neutral-300 hover:bg-neutral-50 dark:hover:bg-neutral-800 shadow-sm flex items-center justify-center"
                  title="次の並列グリッドへ"
                >
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="9 18 15 12 9 6" />
                  </svg>
                </button>
              ) : (() => {
                // "+" は周辺セルに 1 つでも入力がある場合のみ表示する。
                // (中心セルは X=C 統一モデルで drilled grid なら常に親 X の値が入っているため、
                //  中心空チェックは実質常に通ってしまい、ボタンが常時表示される問題を避ける。
                //  また "空の並列" を作れないようにすることで、自動削除ルールとも整合する)
                // 9×9 モードは入力・D&D ができないので、並列作成も禁止して整合を取る
                if (viewMode === '9x9') return null
                const peripherals = gridData?.cells.filter((c) => c.position !== CENTER_POSITION) ?? []
                const hasAnyPeripheralInput = peripherals.some((c) => !isCellEmpty(c))
                if (!hasAnyPeripheralInput) return null
                return (
                  <button
                    onClick={handleAddParallel}
                    className="w-12 h-12 rounded-full bg-white dark:bg-neutral-900 border border-neutral-300 dark:border-neutral-600 text-neutral-600 dark:text-neutral-300 hover:text-blue-600 dark:hover:text-blue-400 hover:border-blue-400 dark:hover:border-blue-500 hover:bg-neutral-50 dark:hover:bg-neutral-800 shadow-sm flex items-center justify-center"
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

        {/* サイドパネル（デスクトップのみ）。
            flex item の `min-width: auto` がコンテンツ intrinsic 幅 (長 URL / pre block 等) を
            拾って w-72 を上書きしてしまう問題があるので `min-w-0` で抑止し、`overflow-hidden`
            で内部の横方向 overflow を確実にクリップする。これで edit / preview / stock の
            3 タブで panel 幅が一定になる。 */}
        <div data-converge-target="stock" className="hidden lg:flex w-72 shrink-0 min-w-0 overflow-hidden">
          <SidePanel
            gridId={currentGridId}
            gridMemo={gridData?.memo ?? null}
            onStockPaste={handleStockPaste}
            isDragging={isDragging}
            hoveredAction={hoveredAction}
            stockReloadKey={stockReloadKey}
            onStockItemDragStart={handleStockItemDragStart}
            dragSourceId={dragSourceId}
          />
        </div>
      </div>

      {/* コンテキストメニュー */}
      {contextMenu && (
        <div
          className="fixed bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 rounded-xl shadow-lg z-30 text-sm min-w-[140px]"
          style={{ top: contextMenu.y, left: contextMenu.x }}
          onMouseLeave={() => setContextMenu(null)}
        >
          <button onClick={() => handleContextAction('cut')} className="w-full text-left px-4 py-2 hover:bg-neutral-50 dark:hover:bg-neutral-800 rounded-t-xl flex justify-between">
            カット <span className="text-neutral-400 dark:text-neutral-500">⌘X</span>
          </button>
          <button onClick={() => handleContextAction('copy')} className="w-full text-left px-4 py-2 hover:bg-neutral-50 dark:hover:bg-neutral-800 flex justify-between">
            コピー <span className="text-neutral-400 dark:text-neutral-500">⌘C</span>
          </button>
          <button
            onClick={() => handleContextAction('paste')}
            disabled={!clipboard.sourceCellId}
            className="w-full text-left px-4 py-2 hover:bg-neutral-50 dark:hover:bg-neutral-800 flex justify-between disabled:opacity-40 disabled:hover:bg-transparent"
          >
            ペースト <span className="text-neutral-400 dark:text-neutral-500">⌘V</span>
          </button>
          <button onClick={() => handleContextAction('stock')} className="w-full text-left px-4 py-2 hover:bg-neutral-50 dark:hover:bg-neutral-800">
            ストックに追加
          </button>
          <button onClick={() => handleContextAction('import')} className="w-full text-left px-4 py-2 hover:bg-neutral-50 dark:hover:bg-neutral-800 rounded-b-xl">
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

      {/* ストック → 入力ありセル drop の置換確認 */}
      <ReplaceConfirmDialog
        open={replaceConfirm !== null}
        targetText={replaceConfirm?.targetText}
        onCancel={() => setReplaceConfirm(null)}
        onConfirm={handleReplaceConfirm}
      />

      {/* シュレッダー drop 確認 */}
      <ShredConfirmDialog
        open={shredConfirm !== null}
        targetText={shredConfirm?.targetText}
        childrenCount={shredConfirm?.childrenCount}
        isPrimaryRoot={shredConfirm?.isPrimaryRoot}
        onCancel={() => setShredConfirm(null)}
        onConfirm={handleShredConfirm}
      />

      {/* エクスポート形式選択 */}
      <ExportFormatPicker
        open={exportPicker !== null}
        targetText={exportPicker?.targetText}
        onCancel={() => setExportPicker(null)}
        onPick={handleExportPick}
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
