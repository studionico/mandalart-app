// デスクトップ版: SQLite がプライマリなのでオフライン対応は不要
import type { Grid } from '@/types'

export async function cacheGrid(_grid: Grid & { cells: unknown[] }): Promise<void> {}
export async function getCachedGrid(_id: string): Promise<null> { return null }
export async function queueUpdate(_op: unknown): Promise<void> {}
export async function syncPendingUpdates(): Promise<void> {}
