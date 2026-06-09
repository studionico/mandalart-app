/**
 * pull の reconcile 用 純粋ロジック (iOS `RemoteDeletionReconciler.swift` と同値仕様)。
 *
 * **背景**: pull は upsert 専用なので「cloud から物理 hard delete されて SELECT 結果に
 * 現れない行」を検知できない。desktop の `permanentDeleteMandalart` / `permanentDeleteGrid`
 * (および対向 iOS の permanent delete) は cloud から行を物理削除するため、その削除を
 * ローカルへ伝播させるには「ローカルに在るが cloud に居ない synced 行 = 削除済み」と
 * 判定して消す必要がある。本関数はその判定だけを純粋に行う (DB I/O は呼び出し側)。
 *
 * 安全性の非対称: 消し損ね (false negative) は次回 pull で回収できるので許容するが、
 * 誤削除 (false positive) は不許容。よって:
 *  - `synced == false` (= まだ cloud に push していない local-only 行) は絶対に消さない。
 *  - `truncated == true` (= cloud fetch が PostgREST max-rows で切れている疑い) なら
 *    cloud id 集合が不完全なので一切消さない。
 */
export type LocalRow = { id: string; synced: boolean }

export function idsToDelete(
  local: LocalRow[],
  cloudIds: Set<string>,
  truncated: boolean,
): Set<string> {
  if (truncated) return new Set()
  const result = new Set<string>()
  for (const row of local) {
    if (!row.synced) continue
    if (!cloudIds.has(row.id)) result.add(row.id)
  }
  return result
}
