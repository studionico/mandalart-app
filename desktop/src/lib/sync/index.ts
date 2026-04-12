import { pushAll } from './push'
import { pullAll } from './pull'

export type SyncStats = {
  pushed: { mandalarts: number; grids: number; cells: number }
  pulled: { mandalarts: number; grids: number; cells: number }
}

/**
 * フル同期: pull → push の順で実行する。
 * pull を先にすることで、リモートで先に作られたエンティティを取り込んでから
 * 自分のローカル変更を上書きアップロードできる。
 */
export async function syncAll(userId: string): Promise<SyncStats> {
  const pulled = await pullAll()
  const pushed = await pushAll(userId)
  return { pulled, pushed }
}

export { pushAll, pullAll }
