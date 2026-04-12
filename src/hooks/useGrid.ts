'use client'

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
          cells: prev.cells.map((c) => (c.id === cellId ? updated : c)),
        }
      })
      return updated
    },
    [],
  )

  const refreshCell = useCallback((updated: Cell) => {
    setData((prev) => {
      if (!prev) return prev
      return {
        ...prev,
        cells: prev.cells.map((c) => (c.id === updated.id ? updated : c)),
      }
    })
  }, [])

  return { data, loading, error, reload: load, updateCell: updateCellLocal, refreshCell }
}
