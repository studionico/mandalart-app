// デスクトップ版: Realtime は不要（単一デバイス）
import type { Cell, Grid } from '@/types'

export function subscribeToCells(
  _mandalartId: string,
  _onInsert: (c: Cell) => void,
  _onUpdate: (c: Cell) => void,
): () => void {
  return () => {}
}

export function subscribeToGrids(
  _mandalartId: string,
  _onInsert: (g: Grid) => void,
  _onUpdate: (g: Grid) => void,
): () => void {
  return () => {}
}

export function unsubscribe(_sub: () => void): void {
  _sub()
}
