import { execute } from '../db'

/**
 * 同期状態 (synced_at) に応じて hard delete か soft delete を出し分ける内部 helper。
 *
 * 落とし穴 #12 対策として `deleteMandalart` / `deleteGrid` の cascade 全段で同じ分岐
 * (未同期は物理削除、同期済みは deleted_at をセット) を繰り返していたのを集約する。
 *
 * - **未同期 (`synced_at IS NULL`)**: cloud に存在しない行 → hard delete。soft で残すと
 *   push のたびに RLS 403 を誘発する zombie 行になる
 * - **同期済み (`synced_at IS NOT NULL`)**: soft delete。次回 push で `deleted_at` が
 *   cloud に伝播し、別デバイスからも見えなくなる
 *
 * SQL injection 安全性: `table` は型レベルでホワイトリスト化、`whereClause` は呼出元で
 * 静的文字列として与える前提 (params のみ動的)。
 *
 * @param table 対象テーブル
 * @param whereClause `WHERE` 以降の条件式 (synced_at 句は内部で AND される)。例: `'mandalart_id = ?'`
 * @param whereParams `whereClause` 内の `?` を埋めるパラメータ配列
 * @param ts 呼出元で `now()` 済みの timestamp。cascade 全段で同じ値を使うため引数化
 */
export async function syncAwareDelete(
  table: 'mandalarts' | 'grids' | 'cells' | 'folders',
  whereClause: string,
  whereParams: unknown[],
  ts: string,
): Promise<void> {
  // 未同期: hard delete (cloud に行ったことがないので消して問題なし)
  await execute(
    `DELETE FROM ${table} WHERE ${whereClause} AND synced_at IS NULL`,
    whereParams,
  )
  // 同期済み: soft delete (push で cloud に deleted_at を伝播するため updated_at も更新)
  await execute(
    `UPDATE ${table} SET deleted_at = ?, updated_at = ? WHERE ${whereClause} AND synced_at IS NOT NULL`,
    [ts, ts, ...whereParams],
  )
}
