import { query, execute, generateId, now } from '../db'
import { CENTER_POSITION, GRID_CELL_COUNT } from '@/constants/grid'
import { deleteGrid } from './grids'
import { shredCellSubtree } from './cells'
import type { Cell, StockItem, CellSnapshot, GridSnapshot } from '../../types'

type RawStockItem = { id: string; snapshot: string; created_at: string }

export async function getStockItems(): Promise<StockItem[]> {
  const rows = await query<RawStockItem>('SELECT * FROM stock_items ORDER BY created_at DESC')
  return rows.map((r) => ({ ...r, snapshot: JSON.parse(r.snapshot), user_id: '' }))
}

export async function addToStock(cellId: string): Promise<StockItem> {
  const snapshot = await buildCellSnapshot(cellId)
  const id = generateId()
  const ts = now()
  await execute(
    'INSERT INTO stock_items (id, snapshot, created_at) VALUES (?, ?, ?)',
    [id, JSON.stringify(snapshot), ts],
  )
  return { id, snapshot, created_at: ts, user_id: '' }
}

export async function deleteStockItem(id: string): Promise<void> {
  await execute('DELETE FROM stock_items WHERE id = ?', [id])
}

/**
 * 「移動」アクション: snapshot をストックに保存してから、元セル + 配下サブグリッドをクリア (= shred)。
 *
 * Copy (`addToStock` 単体) との違い: 元セルの content と配下が削除される。ユーザーは
 * その後ストックから別の場所にペーストすることで「カット → ペースト」を完成できる。
 *
 * ※ atomic 性は保証しない (snapshot 保存後に shred 失敗した場合、ストックには残るが元も残る)。
 *    実害は小さい (ユーザーが目視で気付ける) ので現状は補正処理を入れない。
 */
export async function moveCellToStock(cellId: string): Promise<StockItem> {
  const item = await addToStock(cellId)
  await shredCellSubtree(cellId)
  return item
}

/**
 * 入力ありセルへのストックペースト (置換版)。
 *
 * 既存の cell content + 配下サブグリッド (parent_cell_id = targetCellId の grids) を破棄してから
 * 通常の `pasteFromStock` を実行する。これにより新スナップショットの内容で完全に置き換わる。
 *
 * 呼出側 (EditorLayout) で確認 dialog を経由するのが前提。
 */
export async function pasteFromStockReplacing(stockItemId: string, targetCellId: string): Promise<void> {
  // 1. ターゲットセルを drill 元とする全 grids (primary + 並列) を再帰削除
  const subGrids = await query<{ id: string }>(
    'SELECT id FROM grids WHERE parent_cell_id = ? AND deleted_at IS NULL',
    [targetCellId],
  )
  for (const g of subGrids) {
    await deleteGrid(g.id)
  }
  // 2. 通常の paste で content + 新サブグリッドを上書き挿入
  await pasteFromStock(stockItemId, targetCellId)
}

/**
 * ストックアイテムをセルにペースト。
 *
 * 新モデル (X=C 統一):
 *  - 子グリッドには position=4 の cell 行がないため、GridSnapshot は 8 peripherals のみを持つ。
 *  - 新しい drilled grid 作成時は center_cell_id = ターゲットの cell.id とする。
 */
export async function pasteFromStock(stockItemId: string, targetCellId: string): Promise<void> {
  const rows = await query<RawStockItem>('SELECT * FROM stock_items WHERE id = ?', [stockItemId])
  if (!rows[0]) return
  const snapshot: CellSnapshot = JSON.parse(rows[0].snapshot)

  const targetCells = await query<{ grid_id: string; position: number }>(
    'SELECT grid_id, position FROM cells WHERE id = ? AND deleted_at IS NULL', [targetCellId],
  )
  const targetCell = targetCells[0]
  if (!targetCell) return

  // 防御チェック: 周辺セルなのに中心セルが空ならペースト不可
  if (targetCell.position !== CENTER_POSITION) {
    const gridRow = await query<{ center_cell_id: string }>(
      'SELECT center_cell_id FROM grids WHERE id = ? AND deleted_at IS NULL',
      [targetCell.grid_id],
    )
    const centerId = gridRow[0]?.center_cell_id
    const centerRows = centerId
      ? await query<{ text: string; image_path: string | null }>(
          'SELECT text, image_path FROM cells WHERE id = ? AND deleted_at IS NULL',
          [centerId],
        )
      : []
    const center = centerRows[0]
    if (!center || (center.text.trim() === '' && center.image_path === null)) {
      throw new Error('中心セルが空のグリッドの周辺セルにはペーストできません')
    }
  }

  const grids = await query<{ mandalart_id: string }>(
    'SELECT mandalart_id FROM grids WHERE id = ? AND deleted_at IS NULL', [targetCell.grid_id],
  )
  const mandalartId = grids[0]?.mandalart_id
  if (!mandalartId) return

  const ts = now()

  // 1) ターゲットセル内容を上書き
  await execute(
    'UPDATE cells SET text=?, image_path=?, color=?, updated_at=? WHERE id=?',
    [snapshot.cell.text, snapshot.cell.image_path, snapshot.cell.color, ts, targetCellId],
  )

  // 1b) ターゲットがマンダラートの root_cell_id ならば mandalarts.title も同期する。
  // 通常は `updateCell` (cells.ts) が title を mirror するが、本関数は直接 UPDATE するため
  // 明示的に同期しないと新規マンダラート作成 (createMandalartFromStockItem) で title=「無題」のまま残る。
  const rootOwners = await query<{ id: string }>(
    'SELECT id FROM mandalarts WHERE root_cell_id = ? AND deleted_at IS NULL',
    [targetCellId],
  )
  if (rootOwners[0]) {
    await execute(
      'UPDATE mandalarts SET title = ?, updated_at = ? WHERE id = ?',
      [snapshot.cell.text, ts, rootOwners[0].id],
    )
  }

  // 2) 中心セル snapshot 判定 (ストック元が root 中心で、grid 全体を保存している)
  const isCenterSnapshot = snapshot.position === CENTER_POSITION

  // 3) 中心セル snapshot かつターゲットも中心セル → グリッド展開
  if (isCenterSnapshot && targetCell.position === CENTER_POSITION && snapshot.children.length > 0) {
    const gridSnap = snapshot.children[0]
    await expandGridSnapshotInto(gridSnap, targetCell.grid_id, mandalartId)
    return
  }

  // 4) それ以外: children を子グリッドとしてターゲットセル配下に再帰挿入
  for (const child of snapshot.children) {
    await insertGridSnapshot(child, targetCellId, mandalartId)
  }
}

/**
 * 中心セル snapshot のグリッド展開。
 * GridSnapshot の内容 (周辺 8 セル + 各セルの子グリッド) を、
 * 既存のターゲットグリッドに上書き挿入する。
 */
async function expandGridSnapshotInto(
  gridSnap: GridSnapshot,
  targetGridId: string,
  mandalartId: string,
): Promise<void> {
  const ts = now()

  // ターゲットグリッドの既存セル (peripherals を position で引けるマップに)
  const existingCells = await query<{ id: string; position: number }>(
    'SELECT id, position FROM cells WHERE grid_id = ? AND deleted_at IS NULL ORDER BY position',
    [targetGridId],
  )
  const cellIdByPos = new Map(existingCells.map((c) => [c.position, c.id]))

  // snapshot の peripherals で 8 枠を上書き / 不足分は新規 INSERT (lazy creation 対応)。
  // 新規マンダラートに paste するケースでは root grid に center cell しか存在しないため、
  // 既存 cell ベースのループだけでは peripherals が永遠に作成されない (旧バグ)。
  const snapByPos = new Map(gridSnap.cells.map((c) => [c.position, c]))
  for (let pos = 0; pos < GRID_CELL_COUNT; pos++) {
    if (pos === CENTER_POSITION) continue
    const sc = snapByPos.get(pos)
    const existingId = cellIdByPos.get(pos)
    if (existingId) {
      // 既存 cell を上書き (空でも UPDATE する旧挙動踏襲)
      await execute(
        'UPDATE cells SET text=?, image_path=?, color=?, updated_at=? WHERE id=?',
        [sc?.text ?? '', sc?.image_path ?? null, sc?.color ?? null, ts, existingId],
      )
    } else if (sc && (sc.text !== '' || sc.image_path !== null || sc.color !== null)) {
      // 不足セルを新規 INSERT (空セルは lazy policy により skip)
      const newCellId = generateId()
      await execute(
        'INSERT INTO cells (id, grid_id, position, text, image_path, color, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)',
        [newCellId, targetGridId, pos, sc.text, sc.image_path, sc.color, ts, ts],
      )
      cellIdByPos.set(pos, newCellId)
    }
  }

  // 子グリッドを parentPosition に従って正しいセルに紐付け
  for (const child of gridSnap.children) {
    const parentPos = child.parentPosition
    const parentCellId = parentPos !== undefined ? cellIdByPos.get(parentPos) : null
    if (parentCellId) {
      await insertGridSnapshot(child, parentCellId, mandalartId)
    }
  }
}

/**
 * GridSnapshot を新しい drilled グリッドとして DB に挿入する (再帰)。
 *
 * 新モデル: center_cell_id = parentCellId。新グリッドには 8 peripherals のみ INSERT
 * (position=4 の cell 行は作らない)。
 */
async function insertGridSnapshot(
  snap: GridSnapshot,
  parentCellId: string,
  mandalartId: string,
): Promise<void> {
  const gridId = generateId()
  const ts = now()
  // X=C 統一モデルでは center_cell_id = parent peripheral cell id。parent_cell_id も同じ値で OK
  // (migration 006 以降の独立並列ではない、通常の drilled grid 扱い)
  await execute(
    'INSERT INTO grids (id, mandalart_id, center_cell_id, parent_cell_id, sort_order, memo, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)',
    [gridId, mandalartId, parentCellId, parentCellId, snap.grid.sort_order, snap.grid.memo, ts, ts],
  )

  // peripherals 8 個を挿入 (position=4 は skip)
  const byPos = new Map(snap.cells.map((c) => [c.position, c]))
  const newCellIds = new Map<number, string>()
  for (let i = 0; i < GRID_CELL_COUNT; i++) {
    if (i === CENTER_POSITION) continue
    const c = byPos.get(i)
    const cellId = generateId()
    newCellIds.set(i, cellId)
    await execute(
      'INSERT INTO cells (id, grid_id, position, text, image_path, color, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)',
      [cellId, gridId, i, c?.text ?? '', c?.image_path ?? null, c?.color ?? null, ts, ts],
    )
  }

  // 子グリッド再帰
  for (const child of snap.children) {
    const parentPos = child.parentPosition
    if (parentPos !== undefined) {
      if (parentPos === CENTER_POSITION) {
        // 新グリッドの center は parentCellId を再利用
        await insertGridSnapshot(child, parentCellId, mandalartId)
      } else {
        const cellId = newCellIds.get(parentPos)
        if (cellId) {
          await insertGridSnapshot(child, cellId, mandalartId)
        }
      }
    } else {
      // parentPosition 未設定 = 並列グリッド (parentCellId と同じ中心を共有)
      await insertGridSnapshot(child, parentCellId, mandalartId)
    }
  }
}

// ── snapshot 構築 ──

async function buildCellSnapshot(cellId: string): Promise<CellSnapshot> {
  const cells = await query<Pick<Cell, 'text' | 'image_path' | 'color' | 'position' | 'grid_id'>>(
    'SELECT text, image_path, color, position, grid_id FROM cells WHERE id = ? AND deleted_at IS NULL',
    [cellId],
  )
  const c = cells[0]
  if (!c) throw new Error(`Cell not found: ${cellId}`)

  const children: GridSnapshot[] = []

  // セル種別で snapshot 対象 grid の選び方が異なる:
  //  - 中心セル (DB 上の position=4 = 自グリッド所属の root / 独立並列 center): center_cell_id ベース。
  //    自グリッド + (root center なら) center を共有するレガシー並列ルートを拾う
  //  - 周辺セル (DB 上の position!=4 = X=C primary の center も含む): parent_cell_id ベース。
  //    primary + 新独立並列 + レガシー並列が backfill 済みで統一的にヒットする
  const targetGrids = c.position === CENTER_POSITION
    ? await query<{ id: string; memo: string | null; sort_order: number }>(
        'SELECT id, memo, sort_order FROM grids WHERE center_cell_id = ? AND deleted_at IS NULL ORDER BY sort_order',
        [cellId],
      )
    : await query<{ id: string; memo: string | null; sort_order: number }>(
        'SELECT id, memo, sort_order FROM grids WHERE parent_cell_id = ? AND deleted_at IS NULL ORDER BY sort_order',
        [cellId],
      )
  for (const g of targetGrids) {
    children.push(await buildGridSnapshot(g.id, g.memo, g.sort_order))
  }

  return {
    cell: { text: c.text, image_path: c.image_path, color: c.color },
    position: c.position,
    children,
  }
}

/**
 * グリッドのスナップショットを構築する。
 *
 * 新モデル: このグリッドの center cell は center_cell_id が指す (親グリッドに属す or 自グリッドの position=4)。
 * snapshot 上は 8 peripherals のみ保存 (center は paste 時にターゲットセルが担うため)。
 */
async function buildGridSnapshot(
  gridId: string,
  memo: string | null,
  sortOrder: number,
): Promise<GridSnapshot> {
  const gridRow = await query<{ center_cell_id: string }>(
    'SELECT center_cell_id FROM grids WHERE id = ? AND deleted_at IS NULL',
    [gridId],
  )
  const centerId = gridRow[0]?.center_cell_id

  const gridCells = await query<Cell>(
    'SELECT * FROM cells WHERE grid_id = ? AND deleted_at IS NULL ORDER BY position',
    [gridId],
  )
  // peripherals のみ (center は snapshot に含めない)
  const peripherals = gridCells.filter((c) => c.id !== centerId)
  const cellSnaps = peripherals.map((c) => ({
    position: c.position,
    text: c.text,
    image_path: c.image_path,
    color: c.color,
  }))

  const children: GridSnapshot[] = []
  for (const sc of peripherals) {
    // この peripheral を drill 元とする全 grids (primary + 新独立並列 + レガシー並列を統一的に拾う)
    const sub = await query<{ id: string; memo: string | null; sort_order: number }>(
      'SELECT id, memo, sort_order FROM grids WHERE parent_cell_id = ? AND id != ? AND deleted_at IS NULL ORDER BY sort_order',
      [sc.id, gridId],
    )
    for (const subGrid of sub) {
      const childSnap = await buildGridSnapshot(subGrid.id, subGrid.memo, subGrid.sort_order)
      children.push({ ...childSnap, parentPosition: sc.position })
    }
  }

  return {
    grid: { memo, sort_order: sortOrder },
    cells: cellSnaps,
    children,
  }
}
