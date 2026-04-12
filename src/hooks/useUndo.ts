'use client'

import { useEffect } from 'react'
import { useUndoStore } from '@/store/undoStore'

export function useUndo() {
  const { undo, redo, push } = useUndoStore()

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const mod = e.metaKey || e.ctrlKey
      if (!mod) return
      if (e.key === 'z') { e.preventDefault(); undo() }
      if (e.key === 'y') { e.preventDefault(); redo() }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [undo, redo])

  return { push }
}
