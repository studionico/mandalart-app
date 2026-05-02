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
 *
 * migration 006 以降は:
 *  - drilled descendants: peripheral cell を drill 元とする grids (`parent_cell_id = cell.id`)
 *  - parallels of current grid: 同じ `parent_cell_id` を共有する siblings (root なら `parent_cell_id IS NULL`)
 * の 2 軸で traversal する。新並列 (独立 center) も旧並列 (共有 center) も統一クエリで拾える。
 *
 * `visited` で無限再帰を防ぐ (parallel 同士が互いを parallel として見つけるため必要)。
 */
export async function exportToJSON(gridId: string): Promise<GridSnapshot> {
  const visited = new Set<string>()

  async function fetchSnapshot(
    gId: string,
    sortOrder: number,
    parentPosition: number | undefined,
  ): Promise<GridSnapshot> {
    visited.add(gId)

    const grids = await query<Grid & { memo: string | null }>(
      'SELECT * FROM grids WHERE id = ? AND deleted_at IS NULL',
      [gId],
    )
    const grid = grids[0]
    if (!grid) throw new Error('Grid not found')

    // 自 grid に属する cells を取得。X=C な primary drilled は自 grid に center 行が無いので、
    // 親所属の center cell を別途読み込んで position=CENTER_POSITION として merge する
    // (snapshot の整合性のため)。
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

    // 1. drilled descendants: peripheral cell ごとに parent_cell_id でぶら下がる grids を列挙
    for (const cell of allCells) {
      if (cell.position === CENTER_POSITION) continue
      const drilled = await query<{ id: string; sort_order: number }>(
        'SELECT id, sort_order FROM grids WHERE parent_cell_id = ? AND deleted_at IS NULL ORDER BY sort_order',
        [cell.id],
      )
      for (const d of drilled) {
        if (visited.has(d.id)) continue
        children.push(await fetchSnapshot(d.id, d.sort_order, cell.position))
      }
    }

    // 2. parallels of current grid: 同じ parent_cell_id を共有する siblings (自身を除く)
    const parallels = grid.parent_cell_id == null
      ? await query<{ id: string; sort_order: number }>(
          'SELECT id, sort_order FROM grids WHERE mandalart_id = ? AND parent_cell_id IS NULL AND id != ? AND deleted_at IS NULL ORDER BY sort_order',
          [grid.mandalart_id, gId],
        )
      : await query<{ id: string; sort_order: number }>(
          'SELECT id, sort_order FROM grids WHERE parent_cell_id = ? AND id != ? AND deleted_at IS NULL ORDER BY sort_order',
          [grid.parent_cell_id, gId],
        )
    for (const p of parallels) {
      if (visited.has(p.id)) continue
      children.push(await fetchSnapshot(p.id, p.sort_order, undefined))
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
 * 内部表現: tree of { text, memo?, children } — import-parser の ParsedNode を拡張したもの。
 * エクスポート (Markdown / Indent) はこれを経由して文字列化することで、
 * import ↔ export を対称に保つ (memo は Markdown のみ出力対象、Indent では省略)。
 */
type ExportNode = { text: string; memo?: string | null; children: ExportNode[] }

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
    // メモは最初のサブグリッドのものを拾う (並列含め複数あるケースは JSON のみで完全保持)。
    const subs = subsByPos.get(pos) ?? []
    const grandchildren = subs.flatMap((sg) => snapshotToExportNode(sg).children)
    const subMemo = subs.length > 0 ? subs[0].grid.memo : null
    children.push({ text, memo: subMemo, children: grandchildren })
  }

  // 並列グリッド: 同じ中心を共有する兄弟 grid として扱う。
  // インポート側は 8 個を超えた子を overflow として並列に束ねていたので、
  // エクスポートでは逆変換としてそれらを平坦化して同じ階層の peripherals に戻す。
  for (const parallel of parallels) {
    children.push(...snapshotToExportNode(parallel).children)
  }

  return { text: centerText, memo: snap.grid.memo ?? null, children }
}

/**
 * GridSnapshot → Markdown 文字列変換のピュア関数 (DB アクセスなし、テスト容易)。
 * - Level 1..6 は `#` 見出し、7 以降は箇条書き (`- `) にフォールバック
 * - 各ノードの memo は見出し直下に blockquote (`> ...`) で出力
 *   (import-parser は見出し行以外を無視するので round-trip でも安全に落ちる)
 */
export function snapshotToMarkdown(snapshot: GridSnapshot): string {
  const root = snapshotToExportNode(snapshot)

  const lines: string[] = []
  function walk(node: ExportNode, level: number): void {
    if (level <= 6) {
      lines.push(`${'#'.repeat(level)} ${node.text}`)
    } else {
      const indent = '  '.repeat(level - 7)
      lines.push(`${indent}- ${node.text}`)
    }
    if (node.memo && node.memo.trim() !== '') {
      for (const memoLine of node.memo.split('\n')) {
        lines.push(`> ${memoLine}`)
      }
    }
    for (const child of node.children) {
      if (level < 6) lines.push('')
      walk(child, level + 1)
    }
  }
  walk(root, 1)
  return lines.join('\n')
}

export async function exportToMarkdown(gridId: string): Promise<string> {
  const snapshot = await exportToJSON(gridId)
  return snapshotToMarkdown(snapshot)
}

/**
 * GridSnapshot → インデントテキスト文字列 (2 スペースインデント)。
 * インポート側 (parseIndentText) がスペース / タブ双方に対応しているので round-trip 可能。
 * memo は tree 構造と整合しないため省略 (完全保持が必要な場合は JSON を使う)。
 */
export function snapshotToIndentText(snapshot: GridSnapshot): string {
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

export async function exportToIndentText(gridId: string): Promise<string> {
  const snapshot = await exportToJSON(gridId)
  return snapshotToIndentText(snapshot)
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
  // root grid を作成 (parent_cell_id=null, 自身が center cell を INSERT)
  await importIntoGrid(snapshot, mandalartId, rootCenterCellId, null, 0, /* ownsCenter */ true)
  return { id: mandalartId, title: centerText, root_cell_id: rootCenterCellId, show_checkbox: false, pinned: false, sort_order: null, created_at: ts, updated_at: ts, user_id: '' }
}

/**
 * GridSnapshot をローカル DB に挿入する。
 *
 * - `ownsCenter = true`: 自グリッドで center cell 行を INSERT する (root / 独立並列)。
 *   `centerCellId` は呼び出し側が pre-generate した id を使う。
 * - `ownsCenter = false`: X=C primary drilled。`centerCellId` は親 peripheral を指し、
 *   cell 行はすでに親 grid 所属として存在するので INSERT しない。
 *
 * `parentCellId`: 新 grid の drill 元 (root は null、drilled / parallel は親 peripheral cell id)。
 */
async function importIntoGrid(
  snapshot: GridSnapshot,
  mandalartId: string,
  centerCellId: string,
  parentCellId: string | null,
  sortOrder: number,
  ownsCenter = false,
) {
  const gridId = generateId()
  const ts = now()
  await execute(
    'INSERT INTO grids (id, mandalart_id, center_cell_id, parent_cell_id, sort_order, memo, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    [gridId, mandalartId, centerCellId, parentCellId, sortOrder, snapshot.grid.memo ?? null, ts, ts],
  )

  const insertedCellIdByPosition = new Map<number, string>()
  for (let pos = 0; pos < GRID_CELL_COUNT; pos++) {
    const c = snapshot.cells.find((cc) => cc.position === pos)
    if (pos === CENTER_POSITION) {
      if (ownsCenter) {
        // 自グリッドで center cell 行を INSERT (snapshot の内容を保持)。
        // root なら mandalarts.root_cell_id の実体、新並列なら独立テーマ行になる。
        await execute(
          'INSERT INTO cells (id, grid_id, position, text, image_path, color, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
          [centerCellId, gridId, pos, c?.text ?? '', c?.image_path ?? null, c?.color ?? null, ts, ts],
        )
        insertedCellIdByPosition.set(pos, centerCellId)
      }
      // X=C primary drilled の場合は position=4 の行を作らない (親 cell をそのまま使う)
      continue
    }
    // lazy cell creation: 空 peripheral は INSERT しない。
    // ただし drilled child grid から center として参照される場合 (snapshot.children に
    // parentPosition=pos が含まれる) は参照整合性のため空でも INSERT する必要がある。
    const text = c?.text ?? ''
    const imagePath = c?.image_path ?? null
    const color = c?.color ?? null
    const isPopulated = text !== '' || imagePath !== null || color !== null
    const referencedByChild = snapshot.children.some((child) => child.parentPosition === pos)
    if (!isPopulated && !referencedByChild) continue
    const cellId = generateId()
    await execute(
      'INSERT INTO cells (id, grid_id, position, text, image_path, color, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [cellId, gridId, pos, text, imagePath, color, ts, ts],
    )
    insertedCellIdByPosition.set(pos, cellId)
  }

  for (const child of snapshot.children) {
    const parentPos = child.parentPosition
    // 手書き JSON で `"parentPosition": null` と書かれた場合も並列として扱う
    // (undefined と null を同じく "未指定" と見なす)
    if (parentPos === undefined || parentPos === null || parentPos === CENTER_POSITION) {
      // 並列グリッド: 独立した center cell を持つ (migration 006 以降の新モデル)。
      // snapshot の position=4 内容をそのまま新 center cell に INSERT して再現する。
      // parent_cell_id は current grid から継承 (root parallel なら null、drilled parallel なら Y)。
      const newCenterCellId = generateId()
      await importIntoGrid(child, mandalartId, newCenterCellId, parentCellId, child.grid.sort_order, /* ownsCenter */ true)
      continue
    }
    const parentCellIdForDrill = insertedCellIdByPosition.get(parentPos)
    if (!parentCellIdForDrill) continue
    // primary drilled: X=C 維持 (新 cell は作らず親 peripheral を center として共有)
    await importIntoGrid(child, mandalartId, parentCellIdForDrill, parentCellIdForDrill, child.grid.sort_order, /* ownsCenter */ false)
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

  // 新しい子グリッドとして cellId を center (X=C primary drilled) にして挿入
  await importIntoGrid(snapshot, grid.mandalart_id, cellId, cellId, 0, /* ownsCenter */ false)
}
