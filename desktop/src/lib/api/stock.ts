import { query, execute, generateId, now } from '../db'
import { CENTER_POSITION } from '@/constants/grid'
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

  // snapshot の peripherals で既存 peripherals を上書き
  const snapByPos = new Map(gridSnap.cells.map((c) => [c.position, c]))
  for (const [pos, existingId] of cellIdByPos) {
    if (pos === CENTER_POSITION) continue
    const sc = snapByPos.get(pos)
    await execute(
      'UPDATE cells SET text=?, image_path=?, color=?, updated_at=? WHERE id=?',
      [sc?.text ?? '', sc?.image_path ?? null, sc?.color ?? null, ts, existingId],
    )
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
  await execute(
    'INSERT INTO grids (id, mandalart_id, center_cell_id, sort_order, memo, created_at, updated_at) VALUES (?,?,?,?,?,?,?)',
    [gridId, mandalartId, parentCellId, snap.grid.sort_order, snap.grid.memo, ts, ts],
  )

  // peripherals 8 個を挿入 (position=4 は skip)
  const byPos = new Map(snap.cells.map((c) => [c.position, c]))
  const newCellIds = new Map<number, string>()
  for (let i = 0; i < 9; i++) {
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

  // 新モデル: このセルを center として指しているすべての grid をスナップショット
  // (自グリッドを含む root center, drilled grids, 並列 grids が統一的にヒットする)
  const centeringGrids = await query<{ id: string; memo: string | null; sort_order: number }>(
    'SELECT id, memo, sort_order FROM grids WHERE center_cell_id = ? AND deleted_at IS NULL ORDER BY sort_order',
    [cellId],
  )
  for (const g of centeringGrids) {
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
    // この peripheral を center として指す他の grids (drilled + 並列)
    const sub = await query<{ id: string; memo: string | null; sort_order: number }>(
      'SELECT id, memo, sort_order FROM grids WHERE center_cell_id = ? AND id != ? AND deleted_at IS NULL ORDER BY sort_order',
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
