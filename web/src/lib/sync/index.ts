// ブラウザ版では全書き込みが Supabase に直接反映されるため push/pull 同期は不要。
// useSync hook の型互換性を保つためだけにスタブとして残す。

export type SyncStats = {
  pushed: { mandalarts: number; grids: number; cells: number; folders: number }
  pulled: { mandalarts: number; grids: number; cells: number; folders: number }
}

export async function syncAll(_userId: string): Promise<SyncStats> {
  return {
    pushed: { mandalarts: 0, grids: 0, cells: 0, folders: 0 },
    pulled: { mandalarts: 0, grids: 0, cells: 0, folders: 0 },
  }
}

export async function pushAll(_userId: string): Promise<SyncStats['pushed']> {
  return { mandalarts: 0, grids: 0, cells: 0, folders: 0 }
}

export async function pullAll(): Promise<SyncStats['pulled']> {
  return { mandalarts: 0, grids: 0, cells: 0, folders: 0 }
}
