import { query, execute } from '@/lib/db'
import { supabase } from '@/lib/supabase/client'
import type { Cell, Grid, Mandalart } from '@/types'

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

  async function upsertOne(
    table: string,
    id: string,
    row: Record<string, unknown>,
    onSuccess: () => Promise<void>,
  ): Promise<boolean> {
    const { error } = await (supabase.from(table) as unknown as {
      upsert: (r: Record<string, unknown>) => Promise<{ error: { message: string; code?: string; details?: string; hint?: string } | null }>
    }).upsert(row)
    if (error) {
      // エラー詳細をオブジェクトに畳み込まず、message / code / details / hint を個別に展開して表示
      console.error(
        `[push] ${table} upsert failed`,
        `id=${id}`,
        `code=${(error as { code?: string }).code ?? '?'}`,
        `message=${error.message}`,
        `details=${(error as { details?: string }).details ?? ''}`,
        `hint=${(error as { hint?: string }).hint ?? ''}`,
        'row=', row,
      )
      failures.push({
        table,
        id,
        message: error.message,
        code: (error as { code?: string }).code,
      })
      return false
    }
    await onSuccess()
    return true
  }

  // 1. mandalarts
  const dirtyMandalarts = await query<Mandalart>(
    'SELECT * FROM mandalarts WHERE synced_at IS NULL OR synced_at < updated_at',
  )
  for (const m of dirtyMandalarts) {
    const ok = await upsertOne('mandalarts', m.id, {
      id: m.id,
      user_id: userId,
      title: m.title,
      root_cell_id: m.root_cell_id,
      created_at: m.created_at,
      updated_at: m.updated_at,
      deleted_at: m.deleted_at ?? null,
    }, async () => {
      await execute('UPDATE mandalarts SET synced_at = ? WHERE id = ?', [m.updated_at, m.id])
      mCount++
    })
    if (!ok) continue
  }

  // 2. grids
  const dirtyGrids = await query<Grid>(
    'SELECT * FROM grids WHERE synced_at IS NULL OR synced_at < updated_at',
  )
  for (const g of dirtyGrids) {
    const ok = await upsertOne('grids', g.id, {
      id: g.id,
      mandalart_id: g.mandalart_id,
      center_cell_id: g.center_cell_id,
      sort_order: g.sort_order,
      memo: g.memo,
      created_at: g.created_at,
      updated_at: g.updated_at,
      deleted_at: g.deleted_at ?? null,
    }, async () => {
      await execute('UPDATE grids SET synced_at = ? WHERE id = ?', [g.updated_at, g.id])
      gCount++
    })
    if (!ok) continue
  }

  // 3. cells
  const dirtyCells = await query<Cell>(
    'SELECT * FROM cells WHERE synced_at IS NULL OR synced_at < updated_at',
  )
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
    })
    if (!ok) continue
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
