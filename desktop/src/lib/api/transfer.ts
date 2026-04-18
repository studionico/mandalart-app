import { query, execute, generateId, now } from '@/lib/db'
import type { GridSnapshot, Mandalart, Cell, Grid } from '@/types'
import { parseTextToSnapshot } from '@/lib/import-parser'
import { CENTER_POSITION, GRID_CELL_COUNT } from '@/constants/grid'
import { TAB_ORDER } from '@/constants/tabOrder'

export { parseTextToSnapshot }

// エクスポート時の周辺セル出力順は Tab 移動順から中心 (4) を除いた並び。
// インポート (import-parser) と対称にすることでエクスポート → インポートの round-trip で
// セル配置が保たれる。
const PERIPHERAL_POSITIONS = TAB_ORDER.filter((p) => p !== CENTER_POSITION)

/**
 * グリッドとその配下の全ての子孫を GridSnapshot 形式でエクスポートする。
 * 各子グリッドには `parentPosition` (親グリッドのどのセルから生えているか) を
 * 記録するので、インポート時に正しい位置に復元できる。
 */
export async function exportToJSON(gridId: string): Promise<GridSnapshot> {
  async function fetchSnapshot(
    gId: string,
    sortOrder: number,
    parentPosition: number | undefined,
  ): Promise<GridSnapshot> {
    const grids = await query<Grid & { memo: string | null }>(
      'SELECT * FROM grids WHERE id = ? AND deleted_at IS NULL',
      [gId],
    )
    const grid = grids[0]
    if (!grid) throw new Error('Grid not found')

    // 自 grid に属する cells を取得。child grid の場合は center 行を含まないので、
    // export は center_cell_id の cell を別途読み込んで 9 cells 化する (import 側との
    // 後方互換のため)。
    // child grid では親の cell を position=CENTER_POSITION として merge する
    // (DB 上の position は親内位置だが、snapshot としては中心 = 4 にしないと import
    //  で position=4 の位置に復元されない)。
    const ownCells = await query<Cell>(
      'SELECT * FROM cells WHERE grid_id = ? AND deleted_at IS NULL ORDER BY position',
      [gId],
    )
    const hasCenter = ownCells.some((c) => c.id === grid.center_cell_id)
    const allCells = [...ownCells]
    if (!hasCenter) {
      const centers = await query<Cell>(
        'SELECT * FROM cells WHERE id = ? AND deleted_at IS NULL',
        [grid.center_cell_id],
      )
      if (centers[0]) allCells.push({ ...centers[0], position: CENTER_POSITION })
    }
    allCells.sort((a, b) => a.position - b.position)

    const children: GridSnapshot[] = []
    for (const cell of allCells) {
      // このセルを center として指す他の grids (drilled + 並列), 自 grid 除く
      const childGrids = await query<{ id: string; sort_order: number }>(
        'SELECT id, sort_order FROM grids WHERE center_cell_id = ? AND id != ? AND deleted_at IS NULL ORDER BY sort_order',
        [cell.id, gId],
      )
      for (const cg of childGrids) {
        children.push(await fetchSnapshot(cg.id, cg.sort_order, cell.position))
      }
    }

    return {
      grid: { sort_order: sortOrder, memo: grid.memo ?? null },
      parentPosition,
      cells: allCells.map((c) => ({
        position: c.position, text: c.text, image_path: c.image_path, color: c.color,
      })),
      children,
    }
  }

  const grids = await query<{ sort_order: number }>(
    'SELECT sort_order FROM grids WHERE id = ? AND deleted_at IS NULL',
    [gridId],
  )
  return fetchSnapshot(gridId, grids[0]?.sort_order ?? 0, undefined)
}

/**
 * 内部表現: tree of { text, children } — import-parser の ParsedNode と同形。
 * エクスポート (Markdown / Indent) はこれを経由して文字列化することで、
 * import ↔ export を対称に保つ。
 */
type ExportNode = { text: string; children: ExportNode[] }

function snapshotToExportNode(snap: GridSnapshot): ExportNode {
  const byPosition = new Map(snap.cells.map((c) => [c.position, c]))
  const centerText = byPosition.get(CENTER_POSITION)?.text ?? ''

  // 子グリッドを parentPosition でグルーピング + 並列 (undefined) を分離
  const subsByPos = new Map<number, GridSnapshot[]>()
  const parallels: GridSnapshot[] = []
  for (const child of snap.children) {
    if (child.parentPosition === undefined) {
      parallels.push(child)
    } else {
      const arr = subsByPos.get(child.parentPosition) ?? []
      arr.push(child)
      subsByPos.set(child.parentPosition, arr)
    }
  }

  const children: ExportNode[] = []
  // 周辺セルを PERIPHERAL_POSITIONS 順に展開 (空セルは省略)
  for (const pos of PERIPHERAL_POSITIONS) {
    const cell = byPosition.get(pos)
    const text = cell?.text ?? ''
    if (text.trim() === '') continue
    // このセルにぶら下がるサブグリッド群 (drilled) の peripherals を孫として再帰展開。
    // サブグリッド snapshot の中心セルは X=C 統一によりこのセルと同じテキスト/行なので、
    // 孫として含めると重複するため `.children` だけ取り出す。
    const subs = subsByPos.get(pos) ?? []
    const grandchildren = subs.flatMap((sg) => snapshotToExportNode(sg).children)
    children.push({ text, children: grandchildren })
  }

  // 並列グリッド: 同じ中心を共有する兄弟 grid として扱う。
  // インポート側は 8 個を超えた子を overflow として並列に束ねていたので、
  // エクスポートでは逆変換としてそれらを平坦化して同じ階層の peripherals に戻す。
  for (const parallel of parallels) {
    children.push(...snapshotToExportNode(parallel).children)
  }

  return { text: centerText, children }
}

/**
 * Markdown 見出し形式でエクスポート。
 * Level 1..6 は `#` 見出し、7 以降は箇条書き (`- `) にフォールバック (Markdown 仕様の制約)。
 */
export async function exportToMarkdown(gridId: string): Promise<string> {
  const snapshot = await exportToJSON(gridId)
  const root = snapshotToExportNode(snapshot)

  const lines: string[] = []
  function walk(node: ExportNode, level: number): void {
    if (level <= 6) {
      lines.push(`${'#'.repeat(level)} ${node.text}`)
    } else {
      const indent = '  '.repeat(level - 7)
      lines.push(`${indent}- ${node.text}`)
    }
    for (const child of node.children) {
      if (level < 6) lines.push('') // 見出し同士は空行で区切る (Markdown 慣習)
      walk(child, level + 1)
    }
  }
  walk(root, 1)
  return lines.join('\n')
}

/**
 * インデントテキスト形式でエクスポート (2 スペースインデント)。
 * インポート側 (parseIndentText) がスペース / タブ双方に対応しているので round-trip 可能。
 */
export async function exportToIndentText(gridId: string): Promise<string> {
  const snapshot = await exportToJSON(gridId)
  const root = snapshotToExportNode(snapshot)

  const lines: string[] = []
  function walk(node: ExportNode, depth: number): void {
    const indent = '  '.repeat(depth)
    lines.push(`${indent}${node.text}`)
    for (const child of node.children) {
      walk(child, depth + 1)
    }
  }
  walk(root, 0)
  return lines.join('\n')
}

export async function importFromJSON(snapshot: GridSnapshot): Promise<Mandalart> {
  const mandalartId = generateId()
  const ts = now()
  const centerText = snapshot.cells.find((c) => c.position === CENTER_POSITION)?.text ?? ''

  // root 中心セルの id を先に決めて mandalart を作る
  const rootCenterCellId = generateId()
  await execute(
    'INSERT INTO mandalarts (id, title, root_cell_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
    [mandalartId, centerText, rootCenterCellId, ts, ts],
  )
  // root grid を作成 (center_cell_id = rootCenterCellId)
  await importIntoGrid(snapshot, mandalartId, rootCenterCellId, 0, /* isRoot */ true)
  return { id: mandalartId, title: centerText, root_cell_id: rootCenterCellId, created_at: ts, updated_at: ts, user_id: '' }
}

/**
 * GridSnapshot をローカル DB に挿入する。
 *
 * 新モデル:
 *  - isRoot = true: 9 cells (position=4 を含む) を grid に INSERT。center = position=4 の cell (id = centerCellId)
 *  - isRoot = false: 8 peripherals のみ INSERT (position=4 は skip)。center = 呼び出し側から渡された既存 cell id
 */
async function importIntoGrid(
  snapshot: GridSnapshot,
  mandalartId: string,
  centerCellId: string,
  sortOrder: number,
  isRoot = false,
) {
  const gridId = generateId()
  const ts = now()
  await execute(
    'INSERT INTO grids (id, mandalart_id, center_cell_id, sort_order, memo, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [gridId, mandalartId, centerCellId, sortOrder, snapshot.grid.memo ?? null, ts, ts],
  )

  const insertedCellIdByPosition = new Map<number, string>()
  for (let pos = 0; pos < GRID_CELL_COUNT; pos++) {
    const c = snapshot.cells.find((cc) => cc.position === pos)
    if (pos === CENTER_POSITION) {
      if (isRoot) {
        // root 中心セルは事前に決めた id を使う
        await execute(
          'INSERT INTO cells (id, grid_id, position, text, image_path, color, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
          [centerCellId, gridId, pos, c?.text ?? '', c?.image_path ?? null, c?.color ?? null, ts, ts],
        )
        insertedCellIdByPosition.set(pos, centerCellId)
      }
      // child grid の場合は position=4 の行を作らない (insertedCellIdByPosition にも入れない)
      continue
    }
    const cellId = generateId()
    await execute(
      'INSERT INTO cells (id, grid_id, position, text, image_path, color, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [cellId, gridId, pos, c?.text ?? '', c?.image_path ?? null, c?.color ?? null, ts, ts],
    )
    insertedCellIdByPosition.set(pos, cellId)
  }

  for (const child of snapshot.children) {
    const parentPos = child.parentPosition
    if (parentPos === undefined) {
      // 並列グリッド: 同じ center を共有
      await importIntoGrid(child, mandalartId, centerCellId, child.grid.sort_order, /* isRoot */ false)
      continue
    }
    if (parentPos === CENTER_POSITION) {
      // center 経由でぶら下がるグリッド (並列と同等)
      await importIntoGrid(child, mandalartId, centerCellId, child.grid.sort_order, false)
      continue
    }
    const parentCellId = insertedCellIdByPosition.get(parentPos)
    if (!parentCellId) continue
    // drilled: 新グリッドの center = 親の peripheral cell id
    await importIntoGrid(child, mandalartId, parentCellId, child.grid.sort_order, false)
  }
}

export async function importIntoCell(cellId: string, snapshot: GridSnapshot): Promise<void> {
  const cells = await query<{ grid_id: string }>(
    'SELECT grid_id FROM cells WHERE id = ? AND deleted_at IS NULL',
    [cellId],
  )
  const cell = cells[0]
  if (!cell) throw new Error('Cell not found')

  const grids = await query<{ mandalart_id: string }>(
    'SELECT mandalart_id FROM grids WHERE id = ? AND deleted_at IS NULL',
    [cell.grid_id],
  )
  const grid = grids[0]
  if (!grid) throw new Error('Grid not found')

  // インポート先セルの内容を snapshot の root (position=4) と同期
  const root = snapshot.cells.find((c) => c.position === CENTER_POSITION)
  if (root && (root.text.trim() || root.image_path || root.color)) {
    const ts = now()
    await execute(
      'UPDATE cells SET text=?, image_path=?, color=?, updated_at=? WHERE id=?',
      [root.text, root.image_path, root.color, ts, cellId],
    )
  }

  // 新しい子グリッドとして cellId を center にして挿入
  await importIntoGrid(snapshot, grid.mandalart_id, cellId, 0, false)
}
