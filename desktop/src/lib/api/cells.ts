import { query, execute, now, generateId } from '../db'
import { CENTER_POSITION } from '@/constants/grid'
import { isCellEmpty } from '@/lib/utils/grid'
import { deleteGrid } from './grids'
import type { Cell } from '../../types'

/**
 * (grid_id, position) スロットに対する upsert。
 *
 * 新設計では空セルは DB に存在しない。よって peripheral slot の編集 / D&D drop / paste 等で
 * 「この slot に書き込みたいが cell 行はまだ無い」状態を扱う必要がある。
 *
 * 動作:
 * - 既に cell 行がある → UPDATE して返す
 * - 行が無い → INSERT して返す
 *
 * 戻り値は upsert 後の cell。呼出側はこの cell.id を使って後続処理 (state 反映等) を行う。
 *
 * UNIQUE(grid_id, position) 制約を利用するため SQLite の `INSERT ... ON CONFLICT(...) DO UPDATE`
 * を使えば 1 query で済むが、id 取り直しの都合で SELECT-then-UPDATE/INSERT の 2 手段を採る。
 */
export async function upsertCellAt(
  gridId: string,
  position: number,
  params: { text?: string; image_path?: string | null; color?: string | null },
): Promise<Cell> {
  const existing = await query<Cell>(
    'SELECT * FROM cells WHERE grid_id = ? AND position = ? AND deleted_at IS NULL',
    [gridId, position],
  )
  if (existing[0]) {
    return updateCell(existing[0].id, params)
  }
  // INSERT new cell with generated id
  const id = generateId()
  const ts = now()
  await execute(
    'INSERT INTO cells (id, grid_id, position, text, image_path, color, done, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?)',
    [id, gridId, position, params.text ?? '', params.image_path ?? null, params.color ?? null, 0, ts, ts],
  )
  // root center cell の title ミラー / done propagate は updateCell 経由でないと走らない。
  // INSERT した cell が新規 root center として参照されているケース (createMandalart の初回作成)
  // は通常 createMandalart が title を別途扱うのでここでは propagate しない。
  // 必要なら呼出側で改めて updateCell を呼ぶ。
  const rows = await query<Cell>('SELECT * FROM cells WHERE id = ? AND deleted_at IS NULL', [id])
  return rows[0]
}

/**
 * cell の content を更新する。
 *
 * 新設計 (空セルは DB に存在しない) との整合性:
 * - 既存 cell (id がある) を UPDATE する経路として残る
 * - 「空 slot に新規書込」したい場合は `upsertCellAt(gridId, position, ...)` を使う
 * - cell 行が無い id を指定された場合: UPDATE は no-op になり SELECT は空。caller は cell が
 *   消えた / 別端末で削除されたケースとして扱う必要がある (現状ほぼ起きない)
 */
export async function updateCell(
  id: string,
  params: { text?: string; image_path?: string | null; color?: string | null }
): Promise<Cell> {
  // 空 → 非空 への遷移を検出するため、更新前のセルを読む
  const prevRows = await query<Cell>('SELECT * FROM cells WHERE id = ? AND deleted_at IS NULL', [id])
  const prevCell = prevRows[0]
  const wasEmpty = prevCell ? isCellEmpty(prevCell) : false

  const fields: string[] = []
  const values: unknown[] = []
  if (params.text !== undefined) { fields.push('text = ?'); values.push(params.text) }
  if (params.image_path !== undefined) { fields.push('image_path = ?'); values.push(params.image_path) }
  if (params.color !== undefined) { fields.push('color = ?'); values.push(params.color) }
  const ts = now()
  fields.push('updated_at = ?'); values.push(ts)
  values.push(id)
  await execute(`UPDATE cells SET ${fields.join(', ')} WHERE id = ?`, values)
  const rows = await query<Cell>(
    'SELECT * FROM cells WHERE id = ? AND deleted_at IS NULL',
    [id],
  )
  const cell = rows[0]

  // ルート中心セル (mandalarts.root_cell_id が指すセル) のテキスト更新を
  // mandalarts.title にミラーする。title はダッシュボードの表示/検索/ソートで使う。
  if (cell && params.text !== undefined) {
    const rootOwners = await query<{ id: string }>(
      'SELECT id FROM mandalarts WHERE root_cell_id = ? AND deleted_at IS NULL',
      [id],
    )
    if (rootOwners[0]) {
      await execute(
        'UPDATE mandalarts SET title = ?, updated_at = ? WHERE id = ?',
        [params.text, ts, rootOwners[0].id],
      )
    }
  }

  // 空 → 非空 への遷移 + そのセルが done=0 のとき: 新しいタスクが生まれたので、
  // 親セルの done=1 を解除して invariant を維持する。
  if (cell && wasEmpty && !isCellEmpty(cell) && Number(cell.done) !== 1) {
    await propagateUndoneUp(cell.id, ts)
  }

  return cell
}

export async function swapCellContent(cellIdA: string, cellIdB: string): Promise<void> {
  const [a, b] = await Promise.all([
    query<Cell>('SELECT * FROM cells WHERE id = ? AND deleted_at IS NULL', [cellIdA]),
    query<Cell>('SELECT * FROM cells WHERE id = ? AND deleted_at IS NULL', [cellIdB]),
  ])
  const ca = a[0]; const cb = b[0]
  const ts = now()
  await execute('UPDATE cells SET text=?, image_path=?, color=?, updated_at=? WHERE id=?',
    [cb.text, cb.image_path, cb.color, ts, cellIdA])
  await execute('UPDATE cells SET text=?, image_path=?, color=?, updated_at=? WHERE id=?',
    [ca.text, ca.image_path, ca.color, ts, cellIdB])
}

/**
 * 2 つの cell のサブツリー (drilled 子グリッド群) を入れ替える。
 *
 * 新モデル (migration 006: parent_cell_id + center_cell_id 二軸):
 *  - `getChildGrids(cellId)` は `parent_cell_id = cellId` で引く → drill の経路選定
 *  - `getGrid(id)` は `center_cell_id` を merged center として描画 → drill 後の中央セル
 *  - X=C 統一モデルでは parent_cell_id = center_cell_id (drilled 先の中心はそのセル自身)
 *  - 独立並列モードでは parent_cell_id は親 peripheral、center_cell_id は別 cell
 *  - レガシー並列も migration 006 の backfill で parent_cell_id = center_cell_id
 *
 * subtree swap の意味は「A 位置から drill したら B の旧 subtree、B 位置から drill したら A の旧
 * subtree が見える」状態にすること。これを実現するには **parent_cell_id と center_cell_id の両方**
 * を swap する必要がある。
 *
 * 旧実装は center_cell_id だけを swap していたため、drill (parent_cell_id 経由) は元のままで
 * 中央セル (center_cell_id 経由) だけが入れ替わり、見た目は「内容だけ swap」になっていた。
 *
 * 自グリッド (= 自セルが center を担当している自身の grid 行) は除外する (root 中心の自己参照を壊すため)。
 */
export async function swapCellSubtree(cellIdA: string, cellIdB: string): Promise<void> {
  const [aInfo, bInfo] = await Promise.all([
    query<{ grid_id: string }>('SELECT grid_id FROM cells WHERE id = ? AND deleted_at IS NULL', [cellIdA]),
    query<{ grid_id: string }>('SELECT grid_id FROM cells WHERE id = ? AND deleted_at IS NULL', [cellIdB]),
  ])
  const gridIdA = aInfo[0]?.grid_id ?? ''
  const gridIdB = bInfo[0]?.grid_id ?? ''

  // parent_cell_id 付け替え対象 (drill の経路): A を親としていた grids → B を親とする、逆も。
  // root 自身は parent_cell_id IS NULL なので影響なし。
  const childrenOfA = await query<{ id: string }>(
    'SELECT id FROM grids WHERE parent_cell_id = ? AND deleted_at IS NULL',
    [cellIdA],
  )
  const childrenOfB = await query<{ id: string }>(
    'SELECT id FROM grids WHERE parent_cell_id = ? AND deleted_at IS NULL',
    [cellIdB],
  )
  // center_cell_id 付け替え対象 (drill 先の中央セル): A を center としていた grids → B を center に。
  // 自グリッド (id = gridIdA / gridIdB) は除外。X=C モデルでは childrenOf* と重複するが、
  // 独立並列モードで parent ≠ center のときのために独立にクエリする。
  const centeredOnA = await query<{ id: string }>(
    'SELECT id FROM grids WHERE center_cell_id = ? AND id != ? AND deleted_at IS NULL',
    [cellIdA, gridIdA],
  )
  const centeredOnB = await query<{ id: string }>(
    'SELECT id FROM grids WHERE center_cell_id = ? AND id != ? AND deleted_at IS NULL',
    [cellIdB, gridIdB],
  )
  const ts = now()
  // parent_cell_id swap
  for (const g of childrenOfA) {
    await execute('UPDATE grids SET parent_cell_id=?, updated_at=? WHERE id=?', [cellIdB, ts, g.id])
  }
  for (const g of childrenOfB) {
    await execute('UPDATE grids SET parent_cell_id=?, updated_at=? WHERE id=?', [cellIdA, ts, g.id])
  }
  // center_cell_id swap
  for (const g of centeredOnA) {
    await execute('UPDATE grids SET center_cell_id=?, updated_at=? WHERE id=?', [cellIdB, ts, g.id])
  }
  for (const g of centeredOnB) {
    await execute('UPDATE grids SET center_cell_id=?, updated_at=? WHERE id=?', [cellIdA, ts, g.id])
  }
  await swapCellContent(cellIdA, cellIdB)
}

/**
 * クリップボード (カット/コピー) からのペースト。
 */
export async function pasteCell(
  sourceCellId: string,
  targetCellId: string,
  mode: 'cut' | 'copy',
): Promise<void> {
  if (sourceCellId === targetCellId) return

  const targetRows = await query<{ grid_id: string; position: number }>(
    'SELECT grid_id, position FROM cells WHERE id = ? AND deleted_at IS NULL',
    [targetCellId],
  )
  const target = targetRows[0]
  if (target && target.position !== CENTER_POSITION) {
    // 新モデル: 中心セル = 所属グリッドの center_cell_id が指すセル
    const gridRow = await query<{ center_cell_id: string }>(
      'SELECT center_cell_id FROM grids WHERE id = ? AND deleted_at IS NULL',
      [target.grid_id],
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

  await copyCellSubtree(sourceCellId, targetCellId)

  if (mode === 'cut') {
    const ts = now()
    await execute(
      'UPDATE cells SET text=?, image_path=?, color=?, updated_at=? WHERE id=?',
      ['', null, null, ts, sourceCellId],
    )
    const sourceGridRow = await query<{ grid_id: string }>(
      'SELECT grid_id FROM cells WHERE id = ?',
      [sourceCellId],
    )
    const sourceGridId = sourceGridRow[0]?.grid_id ?? ''
    const childGrids = await query<{ id: string }>(
      'SELECT id FROM grids WHERE center_cell_id = ? AND id != ? AND deleted_at IS NULL',
      [sourceCellId, sourceGridId],
    )
    for (const cg of childGrids) {
      const { deleteGrid } = await import('./grids')
      await deleteGrid(cg.id)
    }
  }
}

/**
 * source のサブツリー (drilled 子グリッド群) + content を target に複製する。
 */
/**
 * source のサブツリー全体を target にコピーする。
 *
 * 実装方針: **mandalart 全 grids + 全 cells を 2 query で先読み → in-memory で BFS + bulk INSERT**
 *
 * - 以前の再帰実装は 1 grid あたり ~5 query で 286 grid = ~1400 往復 ≈ 15 秒かかっていた
 * - BFS レベル単位の読み込みは per-query overhead で 20 query × 200ms ≈ 4.5 秒だった
 * - 再帰 CTE は SQLite optimizer が効かず逆に 48 秒に悪化した
 * - 現行の mandalart 全先読み方式は 2 query で完結 ≈ 1.5 秒が JS 層の理論下限
 *
 * X=C 統一モデル対策: BFS ループで `sc.id === sourceCenterId` の cell (merged center) を
 * skip し、peripheral cell 経由だけで child grid を辿る。これで root ↔ drilled-root-center
 * 間の循環を回避 (トップレベルの topLevelGrids 列挙で全親は既に拾われている)。
 */
export async function copyCellSubtree(sourceCellId: string, targetCellId: string): Promise<void> {
  const srcs = await query<Cell>(
    'SELECT * FROM cells WHERE id = ? AND deleted_at IS NULL',
    [sourceCellId],
  )
  const src = srcs[0]
  if (!src) return

  // ---- 1. source cell が所属する mandalart の全 grids を 1 query で取得 ----
  type AnyGrid = {
    id: string
    center_cell_id: string
    sort_order: number
    mandalart_id: string
    memo: string | null
  }
  const allGridsInMandalart = await query<AnyGrid>(
    `SELECT id, center_cell_id, sort_order, mandalart_id, memo FROM grids
     WHERE mandalart_id = (SELECT mandalart_id FROM grids WHERE id = ? AND deleted_at IS NULL LIMIT 1)
       AND deleted_at IS NULL`,
    [src.grid_id],
  )

  // source cell を center とする grid が subtree に存在しない = 何もコピーするものなし
  const topLevelGrids = allGridsInMandalart.filter((g) => g.center_cell_id === sourceCellId)
  if (topLevelGrids.length === 0) {
    await execute(
      'UPDATE cells SET text=?, image_path=?, color=?, updated_at=? WHERE id=?',
      [src.text, src.image_path, src.color, now(), targetCellId],
    )
    return
  }

  // ---- 2. mandalart 全 cells を IN 句で取得 (single-pass) ----
  // 2-pass (thin fetch で subtree 特定 → full fetch) を試したが、tauri-plugin-sql の per-row
  // IPC コストがカラム数に依存せず ~0.6ms/row 定数だったため、クエリ往復を増やすだけ悪化した。
  // 結論: single-fetch + in-memory BFS で subtree 抽出 + bulk INSERT が JS 層での理論下限。
  // 必要カラム (7 列) だけ SELECT することで転送量を抑える。
  const allGridIds = allGridsInMandalart.map((g) => g.id)
  const QUERY_CHUNK = 500
  type NarrowCell = Pick<Cell, 'id' | 'grid_id' | 'position' | 'text' | 'image_path' | 'color' | 'done'>
  const allCells: NarrowCell[] = []
  for (let i = 0; i < allGridIds.length; i += QUERY_CHUNK) {
    const chunk = allGridIds.slice(i, i + QUERY_CHUNK)
    const ph = chunk.map(() => '?').join(',')
    const chunkCells = await query<NarrowCell>(
      `SELECT id, grid_id, position, text, image_path, color, done FROM cells
       WHERE grid_id IN (${ph}) AND deleted_at IS NULL`,
      chunk,
    )
    allCells.push(...chunkCells)
  }

  // ---- 3. in-memory map 構築 ----
  const cellsByGrid = new Map<string, NarrowCell[]>()
  for (const c of allCells) {
    const arr = cellsByGrid.get(c.grid_id) ?? []
    arr.push(c)
    cellsByGrid.set(c.grid_id, arr)
  }
  const gridsByCenterCell = new Map<string, AnyGrid[]>()
  for (const g of allGridsInMandalart) {
    const arr = gridsByCenterCell.get(g.center_cell_id) ?? []
    arr.push(g)
    gridsByCenterCell.set(g.center_cell_id, arr)
  }

  // ---- 4. in-memory BFS で ID 割り当て + insert 集計 ----
  type Node = {
    sourceGridId: string
    newGridId: string
    newCenterCellId: string
    sortOrder: number
    mandalartId: string
    memo: string | null
    sourceCenterId: string
  }

  const ts = now()
  const cellIdMap = new Map<string, string>()
  // grid INSERT: id, mandalart_id, center_cell_id, parent_cell_id, sort_order, memo, created_at, updated_at (8 cols)
  const gridInserts: Array<[string, string, string, string, number, string | null, string, string]> = []
  const cellInserts: Array<[string, string, number, string, string | null, string | null, number, string, string]> = []
  const processedGridIds = new Set<string>()

  // Top level: source cell を center とする grid 群 (parallel 含む)。
  // topLevelGrids は上で既に計算済 (no-subtree 早期 return のため)。
  let queue: Node[] = topLevelGrids.map((g) => ({
    sourceGridId: g.id,
    newGridId: generateId(),
    newCenterCellId: targetCellId,
    sortOrder: g.sort_order,
    mandalartId: g.mandalart_id,
    memo: g.memo,
    sourceCenterId: g.center_cell_id,
  }))

  while (queue.length > 0) {
    const batch = queue
    queue = []

    for (const n of batch) {
      if (processedGridIds.has(n.sourceGridId)) continue
      processedGridIds.add(n.sourceGridId)

      // X=C モデル: 新 grid の center_cell_id = parent_cell_id = newCenterCellId (drill 元 cell)
      gridInserts.push([n.newGridId, n.mandalartId, n.newCenterCellId, n.newCenterCellId, n.sortOrder, n.memo, ts, ts])
      cellIdMap.set(n.sourceCenterId, n.newCenterCellId)

      const ownCells = cellsByGrid.get(n.sourceGridId) ?? []
      for (const sc of ownCells) {
        if (sc.id === n.sourceCenterId) continue
        const newCellId = generateId()
        cellIdMap.set(sc.id, newCellId)
        // このペリフェラルを center とする child grids
        const children = gridsByCenterCell.get(sc.id) ?? []
        const childrenToCopy = children.filter((c) => c.id !== n.sourceGridId)
        // 新設計: 空 source cell は INSERT しない (DB に空行を作らない)。
        // ただし drilled 子 grid から center として参照されている場合 (バグ由来データ等) は
        // 参照先がダングル参照にならないよう INSERT する必要がある (text='' のまま)
        const isPopulated = sc.text !== '' || sc.image_path !== null || sc.color !== null
        const referencedByChild = childrenToCopy.length > 0
        if (isPopulated || referencedByChild) {
          cellInserts.push([newCellId, n.newGridId, sc.position, sc.text, sc.image_path, sc.color, sc.done ? 1 : 0, ts, ts])
        }

        // 子 grids を queue へ
        for (const child of childrenToCopy) {
          if (processedGridIds.has(child.id)) continue
          queue.push({
            sourceGridId: child.id,
            newGridId: generateId(),
            newCenterCellId: newCellId,
            sortOrder: child.sort_order,
            mandalartId: child.mandalart_id,
            memo: child.memo,
            sourceCenterId: child.center_cell_id,
          })
        }
      }
    }
  }

  // ---- 全 INSERT を chunk 単位で実行 ----
  // SQLite の ? 上限 999: grid=8 cols なら 120 行/chunk, cell=9 cols なら 110 行/chunk まで。
  // 明示トランザクション (BEGIN IMMEDIATE) は tauri-plugin-sql / realtime sync と衝突して
  // 'database is locked' を誘発することがあったので使わない。chunk サイズを上限近くまで
  // 拡大して statement 数自体を減らすことで fsync 回数を抑える。
  const GRID_CHUNK = 120
  const CELL_CHUNK = 110
  for (let i = 0; i < gridInserts.length; i += GRID_CHUNK) {
    const chunk = gridInserts.slice(i, i + GRID_CHUNK)
    const valuesSql = chunk.map(() => '(?,?,?,?,?,?,?,?)').join(',')
    await execute(
      `INSERT INTO grids (id, mandalart_id, center_cell_id, parent_cell_id, sort_order, memo, created_at, updated_at) VALUES ${valuesSql}`,
      chunk.flat(),
    )
  }
  for (let i = 0; i < cellInserts.length; i += CELL_CHUNK) {
    const chunk = cellInserts.slice(i, i + CELL_CHUNK)
    const valuesSql = chunk.map(() => '(?,?,?,?,?,?,?,?,?)').join(',')
    await execute(
      `INSERT INTO cells (id, grid_id, position, text, image_path, color, done, created_at, updated_at) VALUES ${valuesSql}`,
      chunk.flat(),
    )
  }
  // target に source の content を上書き
  await execute(
    'UPDATE cells SET text=?, image_path=?, color=?, updated_at=? WHERE id=?',
    [src.text, src.image_path, src.color, now(), targetCellId],
  )
}

// ---------------------------------------------------------------------------
// シュレッダー / 移動 用: セル内容クリア + 配下サブグリッド再帰削除
// ---------------------------------------------------------------------------

/**
 * セル内容を空クリアし、配下サブグリッド (`grids.parent_cell_id = cellId`) を再帰削除する。
 *
 * - cell row 自体は残し、text/image_path/color を空に UPDATE (lazy 設計と整合)
 * - done フラグは false にリセット
 * - 配下 grids は既存 `deleteGrid` 経由で再帰 cascade (synced_at による hard/soft 自動分岐)
 *
 * 呼出側 (D&D シュレッダー / 移動) で確認 dialog や undo / navigate up を制御する想定。
 */
export async function shredCellSubtree(cellId: string): Promise<void> {
  // 1. 配下の全 sub-grid (parent_cell_id = cellId) を再帰削除
  const subGrids = await query<{ id: string }>(
    'SELECT id FROM grids WHERE parent_cell_id = ? AND deleted_at IS NULL',
    [cellId],
  )
  for (const g of subGrids) {
    await deleteGrid(g.id)
  }
  // 2. セル本体の content をクリア
  await execute(
    'UPDATE cells SET text=?, image_path=?, color=?, done=?, updated_at=? WHERE id=?',
    ['', null, null, 0, now(), cellId],
  )
}

// ---------------------------------------------------------------------------
// チェックボックス (done) 関連
// ---------------------------------------------------------------------------

/**
 * 指定 grid の非空セルの done 状態を一括設定する (子グリッドへの再帰はしない)。
 * 新モデル: child grid は 8 cells (center 行なし) なので、この UPDATE は peripherals のみ対象。
 * root grid は 9 cells なので center も含まれる。
 */
export async function setGridDone(gridId: string, done: boolean): Promise<void> {
  const ts = now()
  const flag = done ? 1 : 0
  await execute(
    `UPDATE cells SET done = ?, updated_at = ?
     WHERE grid_id = ? AND deleted_at IS NULL AND done != ?
       AND (TRIM(text) != '' OR image_path IS NOT NULL)`,
    [flag, ts, gridId, flag],
  )
}

/**
 * セルの done 状態をトグルし、階層全体にカスケード適用する。
 *
 * 新モデル (center_cell_id ベース) のツリー:
 *  - Cell C の子 = すべての grid g (WHERE g.center_cell_id = C.id) の peripheral cells
 *  - Cell C の親 = C.grid_id の grid の center_cell (自分自身なら親なし = root 中心)
 *
 * (旧モデルの「中心/周辺」二分岐は廃止 — 新モデルでは peripheral と center の役割が
 *  同じ cell で両立し、ツリー操作は一般化できる)
 */
export async function toggleCellDone(cellId: string): Promise<void> {
  const cells = await query<Cell>('SELECT * FROM cells WHERE id = ? AND deleted_at IS NULL', [cellId])
  const cell = cells[0]
  if (!cell) return
  const nextDone: 0 | 1 = Number(cell.done) === 1 ? 0 : 1
  const ts = now()

  await markSubtreeDone(cellId, nextDone, ts)

  if (nextDone === 1) {
    await propagateDoneUp(cellId, ts)
  } else {
    await propagateUndoneUp(cellId, ts)
  }
}

/**
 * 指定セルのサブツリー全体 (自身 + 子孫) を done に設定する。
 * 空セルは done 更新の対象外 (= skip) だが、再帰対象にはしない。
 */
async function markSubtreeDone(cellId: string, done: 0 | 1, ts: string): Promise<void> {
  // 自身
  await execute(
    `UPDATE cells SET done = ?, updated_at = ?
     WHERE id = ? AND done != ?
       AND (TRIM(text) != '' OR image_path IS NOT NULL)`,
    [done, ts, cellId, done],
  )
  // この cell を center とする grid 群の peripherals に再帰
  const centeringGrids = await query<{ id: string }>(
    'SELECT id FROM grids WHERE center_cell_id = ? AND deleted_at IS NULL',
    [cellId],
  )
  for (const g of centeringGrids) {
    const peripherals = await query<{ id: string }>(
      `SELECT id FROM cells WHERE grid_id = ? AND id != ? AND deleted_at IS NULL
         AND (TRIM(text) != '' OR image_path IS NOT NULL)`,
      [g.id, cellId],
    )
    for (const p of peripherals) {
      await markSubtreeDone(p.id, done, ts)
    }
  }
}

/**
 * ツリー上の親セルを取得する。
 *  - 自グリッドの center_cell_id が自 cell と同じなら root 中心 → 親なし
 *  - それ以外は自グリッドの center cell が親
 */
async function getParentCellInTree(cellId: string): Promise<{ id: string } | null> {
  const cellRows = await query<{ grid_id: string }>(
    'SELECT grid_id FROM cells WHERE id = ? AND deleted_at IS NULL',
    [cellId],
  )
  const cell = cellRows[0]
  if (!cell) return null
  const grids = await query<{ center_cell_id: string }>(
    'SELECT center_cell_id FROM grids WHERE id = ? AND deleted_at IS NULL',
    [cell.grid_id],
  )
  const centerCellId = grids[0]?.center_cell_id
  if (!centerCellId || centerCellId === cellId) return null
  return { id: centerCellId }
}

/**
 * 指定セルの子孫 (= 自身を除く配下すべて) が全て done=1 か判定する。
 * 空セルは「タスクではない」として判定から除外する (= done 扱い)。
 */
async function areDescendantsAllDone(cellId: string): Promise<boolean> {
  const centeringGrids = await query<{ id: string }>(
    'SELECT id FROM grids WHERE center_cell_id = ? AND deleted_at IS NULL',
    [cellId],
  )
  for (const g of centeringGrids) {
    const peripherals = await query<{ id: string; done: number; text: string; image_path: string | null }>(
      `SELECT id, done, text, image_path FROM cells WHERE grid_id = ? AND id != ? AND deleted_at IS NULL`,
      [g.id, cellId],
    )
    for (const p of peripherals) {
      if (isCellEmpty(p)) continue
      if (Number(p.done) !== 1) return false
      if (!(await areDescendantsAllDone(p.id))) return false
    }
  }
  return true
}

/**
 * セルの done=1 を受けて親方向へ伝搬。
 * 親のすべての子孫が done=1 (= 親を done にしても invariant OK) なら親も done=1。
 */
async function propagateDoneUp(cellId: string, ts: string): Promise<void> {
  const parent = await getParentCellInTree(cellId)
  if (!parent) return
  if (!(await areDescendantsAllDone(parent.id))) return
  await execute(
    'UPDATE cells SET done = 1, updated_at = ? WHERE id = ? AND done = 0',
    [ts, parent.id],
  )
  await propagateDoneUp(parent.id, ts)
}

/** セルの done=0 を受けて親方向へ伝搬: 親が done=1 なら done=0 に解除し再帰。 */
async function propagateUndoneUp(cellId: string, ts: string): Promise<void> {
  const parent = await getParentCellInTree(cellId)
  if (!parent) return
  const parentDone = await query<{ done: number }>(
    'SELECT done FROM cells WHERE id = ? AND deleted_at IS NULL',
    [parent.id],
  )
  if (!parentDone[0] || Number(parentDone[0].done) !== 1) return
  await execute(
    'UPDATE cells SET done = 0, updated_at = ? WHERE id = ?',
    [ts, parent.id],
  )
  await propagateUndoneUp(parent.id, ts)
}
