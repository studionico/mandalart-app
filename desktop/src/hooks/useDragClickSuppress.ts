import { useCallback, useRef } from 'react'
import { DRAG_CLICK_SUPPRESS_MS } from '@/constants/timing'

/**
 * drag 終了直後に発火する click を一定期間 (DRAG_CLICK_SUPPRESS_MS) 抑止するための小 hook。
 *
 * HTML5 D&D の dragend は click event を必ずしも抑制しない (ブラウザによる) ため、
 * 例: dashboard card を drag しただけで navigate されるのを防ぎたい。
 *
 * 使い方:
 *   const drag = useDragClickSuppress()
 *   <Card onClick={() => { if (drag.wasRecentlyDragged()) return; navigate(...) }}
 *         onDragStart={drag.markDragged}
 *         onDragEnd={drag.markDragged} />
 */
export function useDragClickSuppress() {
  const lastDragEnd = useRef<number>(0)

  const markDragged = useCallback(() => {
    lastDragEnd.current = Date.now()
  }, [])

  const wasRecentlyDragged = useCallback(() => {
    return Date.now() - lastDragEnd.current < DRAG_CLICK_SUPPRESS_MS
  }, [])

  return { markDragged, wasRecentlyDragged }
}
