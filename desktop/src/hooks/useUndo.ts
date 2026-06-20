
import { useEffect } from 'react'
import { useUndoStore } from '@/store/undoStore'

// テキスト入力フォーカス中かを判定。input / textarea / contentEditable では
// ネイティブのテキスト undo に委ね、グローバルな app-level undo を発火させない。
// (セル編集 textarea 中の ⌘Z が window へ伝播し中心セルを誤クリアする落とし穴の対策)
function isEditableTarget(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null
  if (!el) return false
  return el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable
}

export function useUndo() {
  const { undo, redo, push, clear } = useUndoStore()

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const mod = e.metaKey || e.ctrlKey
      if (!mod) return
      // テキスト編集中は preventDefault せずネイティブ undo に委ねる
      if (isEditableTarget(e.target)) return
      // Shift を押しているときに e.key は 'Z' になるので小文字に正規化
      const key = e.key.toLowerCase()
      if (key === 'z' && !e.shiftKey) { e.preventDefault(); undo() }
      // ⌘⇧Z (macOS 標準) と ⌘Y (Windows 慣例) の両方を Redo に割り当て
      else if ((key === 'z' && e.shiftKey) || key === 'y') { e.preventDefault(); redo() }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [undo, redo])

  return { push, clear }
}
