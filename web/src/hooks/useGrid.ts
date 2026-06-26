
import { useState, useEffect, useCallback } from 'react'
import { getGrid } from '@/lib/api/grids'
import { updateCell } from '@/lib/api/cells'
import type { Grid, Cell } from '@/types'

type GridData = Grid & { cells: Cell[] }

export function useGrid(gridId: string | null) {
  const [data, setData] = useState<GridData | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<Error | null>(null)

  const load = useCallback(async () => {
    if (!gridId) return
    setLoading(true)
    try {
      const d = await getGrid(gridId)
      setData(d)
    } catch (e) {
      setError(e as Error)
    } finally {
      setLoading(false)
    }
  }, [gridId])

  useEffect(() => { load() }, [load])

  const updateCellLocal = useCallback(
    async (cellId: string, params: { text?: string; image_path?: string | null; color?: string | null }) => {
      const updated = await updateCell(cellId, params)
      setData((prev) => {
        if (!prev) return prev
        return {
          ...prev,
          // state 側の position を保持したまま content を差し替える。
          // 子 grid の merged center cell は DB 上の position (親グリッド内位置、例 7) とは別に
          // UI 表示用に CENTER_POSITION (4) で載せているので、DB の値でそのまま上書きすると
          // 中心スロットが空になりレイアウト・cleanup 判定が崩れる。
          cells: prev.cells.map((c) => (c.id === cellId ? { ...updated, position: c.position } : c)),
        }
      })
      return updated
    },
    [],
  )

  const refreshCell = useCallback((updated: Cell) => {
    setData((prev) => {
      if (!prev) return prev
      const idx = prev.cells.findIndex((c) => c.id === updated.id)
      if (idx >= 0) {
        // 既存 cell の置換 (position は state 側を保持: child grid の merged center が
        // DB 上 position=7 等でも UI では CENTER_POSITION=4 で扱うため)
        return {
          ...prev,
          cells: prev.cells.map((c) => (c.id === updated.id ? { ...updated, position: c.position } : c)),
        }
      }
      // 新規 cell の追加 (空 slot で upsertCellAt が INSERT した直後 / D&D drop で target を
      // 新規作成したケース)。position は updated.position をそのまま使う。
      return {
        ...prev,
        cells: [...prev.cells, updated],
      }
    })
  }, [])

  return { data, loading, error, reload: load, updateCell: updateCellLocal, refreshCell }
}
