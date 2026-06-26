import { supabase } from '../supabase/client'

// ブラウザ版では全書き込みが Supabase に直接反映されるため push/pull 同期は不要。
// deleteGrid から呼ばれるが web 版の deleteGrid は Supabase 直接 delete を使うため
// このシグネチャはほぼ到達しない。互換性のためスタブとして残す。

export async function syncAwareDelete(
  table: 'mandalarts' | 'grids' | 'cells' | 'folders',
  whereClause: string,
  _whereParams: unknown[],
  ts: string,
): Promise<void> {
  // web 版: 常に soft delete (deleted_at をセット)。
  // whereClause は "id = ?" / "grid_id = ?" の形式で来るが、
  // Supabase の eq/in を使う deleteGrid が呼ぶ前に直接処理するため、ここでは警告のみ。
  console.warn('[syncAwareDelete] fallback called — should not reach this in web version', table, whereClause, ts)
  void supabase
}
