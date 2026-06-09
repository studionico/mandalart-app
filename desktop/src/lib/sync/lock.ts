/**
 * SQLite への書き込み手 (pullAll / pushAll / realtime apply*) を **直列化** する単純な promise-chain mutex。
 *
 * **背景** (落とし穴 #24 Realtime 復帰): 緊急停止前は signin の syncAll 1 本だけが SQLite に書いて
 * いたが、Realtime 復帰で書き込み手が 3 つ同時並行になった — ① syncAll (pullAll+push) ②
 * useVisibilityResync の pullAll ③ realtime.ts の apply* 直接書き込み。[`pull.ts`](./pull.ts) は
 * 「id で SELECT → 無ければ INSERT」の read-then-write なので、SELECT 空判定の後 INSERT 前に別の
 * 書き込み手が同 id を入れると `UNIQUE constraint failed: grids.id` 等で衝突する (レース)。
 *
 * 各書き込み操作の **全体** を本ロックで囲むことで、ある操作の read-then-write 窓が他の操作と
 * 交錯しなくなりレースを根絶する。per-row の last-write-wins ロジックは無改修 (= 意味論リスクなし)。
 *
 * 非再入 (reentrant ではない): ロック中の関数が再び withSyncLock を呼ぶとデッドロックするので、
 * pullAll / pushAll / apply* は互いを呼ばないこと (現状そうなっている)。
 */
let chain: Promise<unknown> = Promise.resolve()

export function withSyncLock<T>(fn: () => Promise<T>): Promise<T> {
  // 直前の操作が成功/失敗どちらで settle しても、その後に fn を実行する。
  const run = chain.then(fn, fn)
  // 次の待ち手は run の settle を待つ (fn の結果/例外は飲み込んでチェーンを継続)。
  chain = run.then(() => {}, () => {})
  return run
}
