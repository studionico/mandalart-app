/**
 * 「カード相当」の DOM 要素から ConvergeOverlay の morph source 値を計測するユーティリティ。
 *
 * editor の中心セル / ダッシュボードカード / ストックエントリは、いずれも以下の構造を共有する:
 *
 *   <div data-converge-X="<id>" border>     <-- root (引数 `el`)
 *     <div absolute z-10 not-inset-0>        <-- text wrapper (任意、画像のみ要素では不在)
 *       <span fontSize=...>...</span>        <-- text span
 *     </div>
 *     ... (image / アクションボタン etc.)
 *   </div>
 *
 * 本関数は root の `getBoundingClientRect()` + `getComputedStyle()` から rect / border / radius を
 * 取得し、子の text wrapper / span が存在すればその inset / font-size も読み取って返す。
 *
 * 用途: ConvergeOverlay の direction='home' / 'open' / 'stock' で source DOM を計測する箇所
 * ([`EditorLayout.captureCellSource`](../../components/editor/EditorLayout.tsx) /
 * [`DashboardPage.captureCardSource`](../../pages/DashboardPage.tsx)) で重複していたロジックの
 * 共通化。各呼び出し側で text / imagePath / color など data 由来の値を組合せて
 * `convergeStore.setConverge` に渡す。
 *
 * text wrapper が存在しないケース (例: 画像のみカード) では `defaults` の inset / font 値を
 * 使う。これにより呼び出し側が「未測定でも reasonable な default」を指定できる。
 */
export type CardLikeSourceMeasurement = {
  rect: { left: number; top: number; width: number; height: number }
  borderPx: number
  radiusPx: number
  topInsetPx: number
  sideInsetPx: number
  fontPx: number
}

export function captureCardLikeSource(
  el: HTMLElement,
  defaults: { topInsetPx: number; sideInsetPx: number; fontPx: number },
): CardLikeSourceMeasurement {
  const r = el.getBoundingClientRect()
  const cs = getComputedStyle(el)
  const borderTop = parseFloat(cs.borderTopWidth) || 0
  const borderLeft = parseFloat(cs.borderLeftWidth) || 0
  const result: CardLikeSourceMeasurement = {
    rect: { left: r.left, top: r.top, width: r.width, height: r.height },
    borderPx: borderTop,
    radiusPx: parseFloat(cs.borderTopLeftRadius) || 0,
    topInsetPx: defaults.topInsetPx,
    sideInsetPx: defaults.sideInsetPx,
    fontPx: defaults.fontPx,
  }
  // text wrapper を子要素から探索: `absolute z-10 not-inset-0` (ConvergeOverlay と統一構造)
  const textWrapper = Array.from(el.children).find(
    (e) => e instanceof HTMLElement
      && e.classList.contains('absolute')
      && e.classList.contains('z-10')
      && !e.classList.contains('inset-0'),
  ) as HTMLElement | undefined
  if (textWrapper) {
    const wRect = textWrapper.getBoundingClientRect()
    result.topInsetPx = wRect.top - r.top - borderTop
    result.sideInsetPx = wRect.left - r.left - borderLeft
    const span = textWrapper.querySelector('span')
    if (span) {
      const fs = parseFloat(getComputedStyle(span).fontSize)
      if (fs) result.fontPx = fs
    }
  }
  return result
}
