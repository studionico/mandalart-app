import { query, execute } from '@/lib/db'
import { supabase } from '@/lib/supabase/client'
import type { Cell, Grid, Mandalart, Folder } from '@/types'

/**
 * 未同期 (synced_at が NULL or updated_at < synced_at) のローカル行を Supabase にアップサートする。
 * 一方向 (ローカル → クラウド)。deleted_at を含むので soft delete も正しく伝播する。
 */
export async function pushAll(userId: string): Promise<{ mandalarts: number; grids: number; cells: number }> {
  if (!userId) throw new Error('Not signed in')

  let mCount = 0
  let gCount = 0
  let cCount = 0

  // dirty 判定は deleted_at の有無によらず一律 synced_at < updated_at で行う。
  // soft delete で deleted_at を立てたときも updated_at を進めているので自然に dirty 扱いされる。

  // エラーを 1 箇所にまとめて最後に投げる。途中で 1 行失敗しても他の行は進められるように
  // per-row upsert で処理する。
  const failures: { table: string; id: string; message: string; code?: string }[] = []
  // 永続失敗 (retry しても解決しない) を静かに mark synced した行のカウンター。警告サマリに使う。
  let permanentFailures = 0

  // 永続的に解決できない Postgres エラー:
  // - 42501: RLS policy 違反 (親 mandalart が cloud に無い / 所有権なし → retry しても常に同じ結果)
  // - 23503: FK 制約違反 (親 grid が cloud に無い → retry しても同じ)
  // これらは何度 push しても 403/409 が返るだけで、error spam の原因になる。
  // ローカルで `synced_at = updated_at` を立てて dirty 判定から外すことで、retry を止める。
  // データは local に残るので user の作業は失われない (cloud 側との divergence は受け入れる)。
  function isPermanentFailure(code?: string): boolean {
    return code === '42501' || code === '23503'
  }

  async function upsertOne(
    table: string,
    id: string,
    row: Record<string, unknown>,
    onSuccess: () => Promise<void>,
    onConflict?: string,
    updatedAt?: string,
  ): Promise<boolean> {
    // onConflict 指定時は `ON CONFLICT (cols) DO UPDATE` として扱うので primary key (id) ではない
    // カラム組の一意制約違反 (例: cells の (grid_id, position)) でも cloud 側を local で上書きする。
    // NOTE: supabase.from(table).upsert を変数に代入してから呼ぶと this 束縛が外れて
    // `this.cloneRequestState` undefined エラーになるため、必ず method chain で直接呼ぶ。
    const builder = supabase.from(table) as unknown as {
      upsert: (
        r: Record<string, unknown>,
        opts?: { onConflict?: string },
      ) => Promise<{ error: { message: string; code?: string; details?: string; hint?: string } | null }>
    }
    const { error } = onConflict
      ? await builder.upsert(row, { onConflict })
      : await builder.upsert(row)
    if (error) {
      const code = (error as { code?: string }).code
      // 永続失敗: local で synced_at を立てて retry 対象から外す。error ではなく warn で 1 行のみ記録。
      if (isPermanentFailure(code) && updatedAt) {
        await execute(`UPDATE ${table} SET synced_at = ? WHERE id = ?`, [updatedAt, id])
        permanentFailures++
        console.warn(`[push] ${table} ${id} 永続失敗 (code=${code}) → local synced 扱いで retry 停止`)
        return false
      }
      // 一時的 / 未分類の失敗: 従来どおり error で出して failures に積む
      console.error(
        `[push] ${table} upsert failed`,
        `id=${id}`,
        `code=${code ?? '?'}`,
        `message=${error.message}`,
        `details=${(error as { details?: string }).details ?? ''}`,
        `hint=${(error as { hint?: string }).hint ?? ''}`,
        'row=', row,
      )
      failures.push({ table, id, message: error.message, code })
      return false
    }
    await onSuccess()
    return true
  }

  // 「cloud に一度も行ったことがない行 (synced_at IS NULL) の soft-delete」は push 対象外。
  // cloud 側に対応する行が無いので upsert しても意味がないうえ、RLS (親テーブル所有者チェック)
  // に弾かれて毎回 403 が出る。ローカルで synced_at を立てて dirty 判定から外す。
  // (構造的には削除系 API 側で hard-delete にするのが根本対応。ここは既存データ救済用。)
  async function skipOrphanDirtyDelete<T extends { id: string; deleted_at?: string | null; updated_at: string }>(
    table: string,
    rows: T[],
  ): Promise<T[]> {
    // synced_at は TS 型 (Mandalart/Grid/Cell) に入っていないが SELECT * で runtime には来る
    const withSync = rows as Array<T & { synced_at: string | null }>
    const orphan = withSync.filter((r) => r.deleted_at && !r.synced_at)
    for (const r of orphan) {
      await execute(`UPDATE ${table} SET synced_at = ? WHERE id = ?`, [r.updated_at, r.id])
    }
    return withSync.filter((r) => !(r.deleted_at && !r.synced_at)) as T[]
  }

  // 参照整合性のサニタイズ: 親が local DB に存在しない行は zombie データなので hard delete する。
  // 過去のバグ (mandalart 削除時に子が残った / 部分同期で分裂) で生まれた zombie grid / cell を
  // push 前に一掃する。これらは cloud 側に親がないため push しても必ず RLS 403 になるので、
  // local から消すのが唯一の出口。
  // 順序: cells を先に消す (grid が先に消えると cells の grid_id 参照先がなくなり重複判定になる)
  await execute(`DELETE FROM cells WHERE grid_id NOT IN (SELECT id FROM grids)`)
  await execute(`DELETE FROM grids WHERE mandalart_id NOT IN (SELECT id FROM mandalarts)`)
  // grid を消した結果、その grid に属していた cells も追加で orphan 化するので再度掃除
  await execute(`DELETE FROM cells WHERE grid_id NOT IN (SELECT id FROM grids)`)

  // 0. folders (mandalarts.folder_id が参照するため最初に)
  const dirtyFoldersRaw = await query<Folder & { synced_at: string | null }>(
    'SELECT * FROM folders WHERE synced_at IS NULL OR synced_at < updated_at',
  )
  const dirtyFolders = await skipOrphanDirtyDelete('folders', dirtyFoldersRaw)
  for (const f of dirtyFolders) {
    const ok = await upsertOne('folders', f.id, {
      id: f.id,
      user_id: userId,
      name: f.name,
      sort_order: f.sort_order,
      is_system: !!f.is_system,
      created_at: f.created_at,
      updated_at: f.updated_at,
      deleted_at: f.deleted_at ?? null,
    }, async () => {
      await execute('UPDATE folders SET synced_at = ? WHERE id = ?', [f.updated_at, f.id])
    }, undefined, f.updated_at)
    if (!ok) continue
  }

  // 1. mandalarts
  const dirtyMandalartsRaw = await query<Mandalart>(
    'SELECT * FROM mandalarts WHERE synced_at IS NULL OR synced_at < updated_at',
  )
  const dirtyMandalarts = await skipOrphanDirtyDelete('mandalarts', dirtyMandalartsRaw)
  for (const m of dirtyMandalarts) {
    const ok = await upsertOne('mandalarts', m.id, {
      id: m.id,
      user_id: userId,
      title: m.title,
      root_cell_id: m.root_cell_id,
      show_checkbox: !!m.show_checkbox,
      last_grid_id: m.last_grid_id ?? null,
      sort_order: m.sort_order ?? null,
      pinned: !!m.pinned,
      folder_id: m.folder_id ?? null,
      created_at: m.created_at,
      updated_at: m.updated_at,
      deleted_at: m.deleted_at ?? null,
    }, async () => {
      await execute('UPDATE mandalarts SET synced_at = ? WHERE id = ?', [m.updated_at, m.id])
      mCount++
    }, undefined, m.updated_at)
    if (!ok) continue
  }

  // 2. grids
  const dirtyGridsRaw = await query<Grid>(
    'SELECT * FROM grids WHERE synced_at IS NULL OR synced_at < updated_at',
  )
  const dirtyGrids = await skipOrphanDirtyDelete('grids', dirtyGridsRaw)
  for (const g of dirtyGrids) {
    const ok = await upsertOne('grids', g.id, {
      id: g.id,
      mandalart_id: g.mandalart_id,
      center_cell_id: g.center_cell_id,
      parent_cell_id: g.parent_cell_id ?? null,
      sort_order: g.sort_order,
      memo: g.memo,
      created_at: g.created_at,
      updated_at: g.updated_at,
      deleted_at: g.deleted_at ?? null,
    }, async () => {
      await execute('UPDATE grids SET synced_at = ? WHERE id = ?', [g.updated_at, g.id])
      gCount++
    }, undefined, g.updated_at)
    if (!ok) continue
  }

  // 3. cells
  const dirtyCellsRaw = await query<Cell>(
    'SELECT * FROM cells WHERE synced_at IS NULL OR synced_at < updated_at',
  )
  const dirtyCells = await skipOrphanDirtyDelete('cells', dirtyCellsRaw)
  for (const c of dirtyCells) {
    const ok = await upsertOne('cells', c.id, {
      id: c.id,
      grid_id: c.grid_id,
      position: c.position,
      text: c.text,
      image_path: c.image_path,
      color: c.color,
      done: c.done ?? false,
      created_at: c.created_at,
      updated_at: c.updated_at,
      deleted_at: c.deleted_at ?? null,
    }, async () => {
      await execute('UPDATE cells SET synced_at = ? WHERE id = ?', [c.updated_at, c.id])
      cCount++
    },
      // 複数デバイス / 歴史的な sync ズレで、同じ (grid_id, position) に local と cloud で
      // 異なる cell id が並ぶケースがある。このとき通常の upsert (PK=id) では INSERT と見なされ、
      // cloud の UNIQUE(grid_id, position) 制約に弾かれて code=23505 になる。onConflict で
      // 一意制約側を指定すると「同じ (grid_id, position) の既存行を local の内容で UPDATE」
      // として処理され、cloud の stale cell が local 値で上書きされる (local 勝ち)。
      // cells は leaf エンティティで他テーブルから id 参照されない (grids.center_cell_id は
      // cells のまま unchange) ので、cloud 側の id がこの upsert で変わっても整合性に影響なし。
      'grid_id,position',
      c.updated_at,
    )
    if (!ok) continue
  }

  if (permanentFailures > 0) {
    console.warn(`[push] ${permanentFailures} 行が永続失敗 (RLS/FK) で local-only に固定されました。cloud との同期は諦めています`)
  }

  if (failures.length > 0) {
    // 失敗行の要約をまとめて 1 つの Error にして投げる (useSync の catch で表示される)
    const first = failures[0]
    const summary = `${failures.length} 行の push が失敗: ${first.table} id=${first.id} (${first.code ?? '?'}) ${first.message}${failures.length > 1 ? ` ほか ${failures.length - 1} 件` : ''}`
    const err = new Error(summary)
    ;(err as Error & { failures?: typeof failures }).failures = failures
    throw err
  }

  return { mandalarts: mCount, grids: gCount, cells: cCount }
}
