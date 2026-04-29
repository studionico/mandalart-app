import { useEffect, useRef, useState } from 'react'
import { useConvergeStore } from '@/store/convergeStore'
import { CONVERGE_DURATION_MS } from '@/constants/timing'
import { getColorClasses } from '@/constants/colors'
import { getCellImageUrl } from '@/lib/api/storage'

/**
 * App 直下にマウントされる単一の overlay。
 *
 * EditorLayout のホーム遷移時に `convergeStore.setConverge(...)` で中心セルの矩形と
 * 表示内容がセットされる → 本コンポーネントが固定 overlay を `sourceRect` の位置・
 * サイズ・border 6px / radius 8px / 中心セルの font/inset で描画 → ダッシュボード
 * カード (`[data-converge-card="<id>"]`) を polling で探し、見つかったら **位置/寸法/枠/
 * 角丸/inset/font-size を並列 CSS transition でカードと同一値に向けて補間する**。
 * transform scale を使わないので終端の overlay とカードはどちらも素 CSS で描画され、
 * subpixel rendering の差が原理的に発生しない (overlay → card swap 時の visual snap が消える)。
 *
 * Route 切替で unmount しないよう、App 直下に常駐。state が null のときは何も描画しない。
 */
export default function ConvergeOverlay() {
  const mandalartId = useConvergeStore((s) => s.mandalartId)
  const sourceRect = useConvergeStore((s) => s.sourceRect)
  const centerCell = useConvergeStore((s) => s.centerCell)
  const clear = useConvergeStore((s) => s.clear)
  const overlayRef = useRef<HTMLDivElement>(null)
  const textWrapperRef = useRef<HTMLDivElement>(null)
  const textSpanRef = useRef<HTMLSpanElement>(null)
  const animatingRef = useRef(false)
  const [imageUrl, setImageUrl] = useState<string | null>(null)

  // 中心セルが画像を持つ場合は blob URL を解決
  useEffect(() => {
    let cancelled = false
    if (!centerCell?.imagePath) {
      setImageUrl(null)
      return
    }
    getCellImageUrl(centerCell.imagePath)
      .then((url) => { if (!cancelled) setImageUrl(url || null) })
      .catch(() => { if (!cancelled) setImageUrl(null) })
    return () => { cancelled = true }
  }, [centerCell?.imagePath])

  // overlay → カード位置への収束アニメ駆動 (寸法/プロパティ並列 transition)
  useEffect(() => {
    if (!mandalartId || !sourceRect || !centerCell) {
      animatingRef.current = false
      return
    }
    if (animatingRef.current) return  // 既に走行中
    animatingRef.current = true

    let pollTimer: ReturnType<typeof setTimeout> | null = null
    let safetyTimer: ReturnType<typeof setTimeout> | null = null
    let attempts = 0

    function tryAnimate() {
      const overlay = overlayRef.current
      if (!overlay) {
        // overlay 自身がまだマウントされていない → 次フレーム再試行
        if (++attempts > 30) { finalize(); return }
        pollTimer = setTimeout(tryAnimate, 50)
        return
      }
      const card = document.querySelector(`[data-converge-card="${mandalartId}"]`) as HTMLElement | null
      if (!card) {
        if (++attempts > 30) { finalize(); return }
        pollTimer = setTimeout(tryAnimate, 50)
        return
      }

      // END 値はカード DOM の getComputedStyle / getBoundingClientRect から実測する。
      // (START 値は EditorLayout で編集中セルの DOM 実測を経由しており、両端を対称に DOM 由来に揃える)
      const tgt = card.getBoundingClientRect()
      const cs = getComputedStyle(card)
      const endBorderPx = parseFloat(cs.borderTopWidth) || 0
      const endRadiusPx = parseFloat(cs.borderTopLeftRadius) || 0

      // text wrapper / span 終端値: 画像のみのカードでは text wrapper 不在のため null
      // (テキスト系 transition は skip)。card の構造は `[data-converge-card] > div.absolute.z-10 > span`
      // を期待 (DashboardPage MandalartCard 参照)。
      let endTopInsetPx: number | null = null
      let endSideInsetPx: number | null = null
      let endFontPx: number | null = null
      const cardText = Array.from(card.children).find(
        (el) => el instanceof HTMLElement
          && el.classList.contains('absolute')
          && el.classList.contains('z-10')
          && !el.classList.contains('inset-0'),
      ) as HTMLElement | undefined
      if (cardText) {
        const tcs = getComputedStyle(cardText)
        endTopInsetPx = parseFloat(tcs.top) || 0
        endSideInsetPx = parseFloat(tcs.left) || 0
        const span = cardText.querySelector('span')
        if (span) endFontPx = parseFloat(getComputedStyle(span).fontSize) || null
      }

      const dur = CONVERGE_DURATION_MS
      const easing = 'cubic-bezier(0.4, 0, 0.2, 1)'

      // overlay 自体の寸法/枠/角丸を並列 transition
      overlay.style.transition = ['left', 'top', 'width', 'height', 'border-width', 'border-radius']
        .map((p) => `${p} ${dur}ms ${easing}`).join(', ')
      overlay.style.left = `${tgt.left}px`
      overlay.style.top = `${tgt.top}px`
      overlay.style.width = `${tgt.width}px`
      overlay.style.height = `${tgt.height}px`
      overlay.style.borderWidth = `${endBorderPx}px`
      overlay.style.borderRadius = `${endRadiusPx}px`

      // text wrapper の inset を並列 transition (画像ケースでは skip)
      const tw = textWrapperRef.current
      if (tw && endTopInsetPx != null && endSideInsetPx != null) {
        tw.style.transition = ['top', 'right', 'bottom', 'left']
          .map((p) => `${p} ${dur}ms ${easing}`).join(', ')
        tw.style.top = `${endTopInsetPx}px`
        tw.style.right = `${endSideInsetPx}px`
        tw.style.bottom = `${endSideInsetPx}px`
        tw.style.left = `${endSideInsetPx}px`
      }

      // text span の font-size を transition (画像ケースでは skip)
      const sp = textSpanRef.current
      if (sp && endFontPx != null) {
        sp.style.transition = `font-size ${dur}ms ${easing}`
        sp.style.fontSize = `${endFontPx}px`
      }

      // 並列 transition は各プロパティで transitionend が発火するので width に絞って終了検知
      const onEnd = (e: TransitionEvent) => {
        if (e.propertyName !== 'width') return
        overlay.removeEventListener('transitionend', onEnd)
        finalize()
      }
      overlay.addEventListener('transitionend', onEnd)
      safetyTimer = setTimeout(finalize, dur + 200)
    }

    function finalize() {
      if (pollTimer) { clearTimeout(pollTimer); pollTimer = null }
      if (safetyTimer) { clearTimeout(safetyTimer); safetyTimer = null }
      animatingRef.current = false
      clear()
    }

    // overlay が DOM にマウントされるのを待ってから start (1 frame 後)。
    // この 1 frame で初期 inline style (sourceRect 位置/寸法 + border 6 / radius 8 等) が
    // browser に反映されてから transition + 終端値を設定するので、始点→終点が補間される。
    pollTimer = setTimeout(tryAnimate, 16)
    return () => {
      if (pollTimer) clearTimeout(pollTimer)
      if (safetyTimer) clearTimeout(safetyTimer)
    }
  }, [mandalartId, sourceRect, centerCell, clear])

  if (!sourceRect || !centerCell) return null

  const colorClasses = getColorClasses(centerCell.color)
  const showImage = !!(imageUrl && centerCell.imagePath)
  const text = centerCell.text || ''

  return (
    <div
      ref={overlayRef}
      // 中心セルの見た目を踏襲: white / dark:neutral-950 + 黒/白枠 + shadow。
      // border-width / border-radius は transition 対象なので inline style 側で初期値を持たせる
      // (className の `border-[6px] rounded-lg` は使わない: 後から JS で書き換えるとき
      // initial render の class 値と inline 値の競合を避けるため、最初から inline で統一)。
      // pointer-events: none で下のクリックを邪魔しない。
      className={`fixed border-solid border-black dark:border-white shadow-md overflow-hidden ${colorClasses.bg}`}
      style={{
        left: sourceRect.left,
        top: sourceRect.top,
        width: sourceRect.width,
        height: sourceRect.height,
        borderWidth: 6,        // 中心セル initial (Cell.tsx isCenter && size==='normal')
        borderRadius: 8,       // rounded-lg = 8px initial
        zIndex: 100,
        pointerEvents: 'none',
      }}
    >
      {showImage ? (
        <img src={imageUrl!} alt="" className="absolute inset-0 w-full h-full object-cover" />
      ) : (
        <div
          ref={textWrapperRef}
          style={{
            top: centerCell.topInsetPx,
            right: centerCell.sideInsetPx,
            bottom: centerCell.sideInsetPx,
            left: centerCell.sideInsetPx,
          }}
          className="absolute z-10 flex items-start overflow-hidden"
        >
          <span
            ref={textSpanRef}
            style={{ fontSize: `${centerCell.fontPx}px`, lineHeight: 1.25 }}
            className={`block w-full text-left leading-tight break-all whitespace-pre-wrap ${colorClasses.text}`}
          >
            {text}
          </span>
        </div>
      )}
    </div>
  )
}
