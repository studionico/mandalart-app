import { useEffect, useState } from 'react'
import { getCellImageUrl, getCachedCellImageUrl } from '@/lib/api/storage'

/**
 * セル / カード相当の `image_path` から blob URL を解決する共通フック。
 *
 * 同期キャッシュ ([`getCachedCellImageUrl`](../lib/api/storage.ts) — 既ロード済 blob URL を即時取得)
 * を `useState` 初期値で覗き、未キャッシュなら `useEffect` 内で `getCellImageUrl` の async fetch に
 * フォールバックする。これにより:
 *
 * - **remount 時のまばたき抑止** (落とし穴 #18): orbit / view-switch アニメ完了で Cell が unmount →
 *   通常 grid 描画で remount される際、`useState(null)` → `useEffect` の async load パターンだと
 *   キャッシュ hit でも 1 frame だけ `imageUrl=null` の状態が挟まり画像が一瞬消える。本フックでは
 *   `useState(() => getCachedCellImageUrl(path))` で 1 frame 目から画像を出す
 * - **新規 image_path (未キャッシュ) は async fallback** で従来通り解決
 * - **path が null になった**場合は state を null にリセット
 *
 * 用途: [`Cell.tsx`](../components/editor/Cell.tsx) / [`DashboardPage.tsx`](../pages/DashboardPage.tsx)
 * (MandalartCard) / [`StockTab.tsx`](../components/editor/StockTab.tsx) (StockEntry) で重複していた
 * 画像ロードロジックを共通化。
 */
export function useCellImageUrl(imagePath: string | null | undefined): string | null {
  const [imageUrl, setImageUrl] = useState<string | null>(() =>
    getCachedCellImageUrl(imagePath),
  )
  useEffect(() => {
    let cancelled = false
    if (!imagePath) {
      setImageUrl(null)
      return
    }
    const cached = getCachedCellImageUrl(imagePath)
    if (cached) {
      setImageUrl(cached)
      return
    }
    getCellImageUrl(imagePath).then((url) => {
      if (!cancelled) setImageUrl(url || null)
    })
    return () => { cancelled = true }
  }, [imagePath])
  return imageUrl
}
