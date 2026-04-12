
import { useEffect } from 'react'
import { useUndoStore } from '@/store/undoStore'

export function useUndo() {
  const { undo, redo, push } = useUndoStore()

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const mod = e.metaKey || e.ctrlKey
      if (!mod) return
      // Shift を押しているときに e.key は 'Z' になるので小文字に正規化
      const key = e.key.toLowerCase()
      if (key === 'z' && !e.shiftKey) { e.preventDefault(); undo() }
      // ⌘⇧Z (macOS 標準) と ⌘Y (Windows 慣例) の両方を Redo に割り当て
      else if ((key === 'z' && e.shiftKey) || key === 'y') { e.preventDefault(); redo() }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [undo, redo])

  return { push }
}
