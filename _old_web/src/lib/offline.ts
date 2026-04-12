import type { Grid, Cell } from '@/types'

const DB_NAME = 'mandalart-offline'
const DB_VERSION = 1
const GRID_STORE = 'grids'
const QUEUE_STORE = 'operations'

export type OfflineOperation = {
  id?: number
  type: 'updateCell' | 'updateGridMemo' | 'createGrid' | 'deleteGrid'
  payload: Record<string, unknown>
  timestamp: number
}

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(GRID_STORE)) {
        db.createObjectStore(GRID_STORE, { keyPath: 'id' })
      }
      if (!db.objectStoreNames.contains(QUEUE_STORE)) {
        db.createObjectStore(QUEUE_STORE, { keyPath: 'id', autoIncrement: true })
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

export async function cacheGrid(gridId: string, data: Grid & { cells: Cell[] }): Promise<void> {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(GRID_STORE, 'readwrite')
    tx.objectStore(GRID_STORE).put({ ...data, id: gridId })
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

export async function getCachedGrid(gridId: string): Promise<(Grid & { cells: Cell[] }) | null> {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(GRID_STORE, 'readonly')
    const req = tx.objectStore(GRID_STORE).get(gridId)
    req.onsuccess = () => resolve(req.result ?? null)
    req.onerror = () => reject(req.error)
  })
}

export async function queueUpdate(operation: OfflineOperation): Promise<void> {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(QUEUE_STORE, 'readwrite')
    tx.objectStore(QUEUE_STORE).add(operation)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

export async function syncPendingUpdates(): Promise<void> {
  const db = await openDB()
  const ops: OfflineOperation[] = await new Promise((resolve, reject) => {
    const tx = db.transaction(QUEUE_STORE, 'readonly')
    const req = tx.objectStore(QUEUE_STORE).getAll()
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })

  for (const op of ops) {
    try {
      // 動的 import で循環参照を回避
      if (op.type === 'updateCell') {
        const { updateCell } = await import('@/lib/api/cells')
        await updateCell(op.payload.id as string, op.payload as Parameters<typeof updateCell>[1])
      } else if (op.type === 'updateGridMemo') {
        const { updateGridMemo } = await import('@/lib/api/grids')
        await updateGridMemo(op.payload.id as string, op.payload.memo as string)
      }

      // 成功したキューアイテムを削除
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(QUEUE_STORE, 'readwrite')
        tx.objectStore(QUEUE_STORE).delete(op.id!)
        tx.oncomplete = () => resolve()
        tx.onerror = () => reject(tx.error)
      })
    } catch {
      // 失敗したものはキューに残す
    }
  }
}
