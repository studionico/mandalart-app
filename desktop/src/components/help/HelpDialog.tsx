import { useCallback, useEffect, useState } from 'react'
import Modal from '@/components/ui/Modal'
import { WELCOME_SLIDES } from './helpContent'
import ConceptSlide from './ConceptSlide'
import FeatureSlide from './FeatureSlide'

/**
 * Welcome / ヘルプの Carousel モーダル。
 *
 * - 7 スライド (1 = コンセプト動画 / 2-7 = 機能概要) を 1 枚ずつ大きく表示
 * - 自動進行 (`autoAdvance=true`): スライドの `durationMs` ごとに次へ。最終スライドで停止
 * - dialog 内 mouse hover で一時停止。離れると再開
 * - 手動操作: ← / → ボタン、dots indicator、キーボード ← → / Esc
 * - `showDontShowAgain=true` のとき footer にチェックボックス。チェック時 close で
 *   現行 WELCOME_VERSION を localStorage に保存 → 次回起動で再表示しない
 *
 * 呼出側 (App.tsx) の使い分け:
 *   初回起動 (welcome) → autoAdvance=true / showDontShowAgain=true
 *   メニュー手動 (再訪) → autoAdvance=false / showDontShowAgain=false
 */

type Props = {
  open: boolean
  onClose: () => void
  /** 自動進行の初期値。デフォルト false (= 手動のみ) */
  autoAdvance?: boolean
  /**
   * 「次回以降表示しない」チェックボックスを footer に表示するか。デフォルト false。
   * チェックして閉じた場合に呼出側でローカル永続化したい時のために `onDismiss(persist)` を渡す。
   */
  showDontShowAgain?: boolean
  /** showDontShowAgain=true 時、close 時に persist 値 (= チェック有無) を伝える callback */
  onDismiss?: (persist: boolean) => void
}

export default function HelpDialog({
  open, onClose, autoAdvance = false, showDontShowAgain = false, onDismiss,
}: Props) {
  const total = WELCOME_SLIDES.length
  const [currentIndex, setCurrentIndex] = useState(0)
  const [isPaused, setIsPaused] = useState(false)
  const [dontShowAgainChecked, setDontShowAgainChecked] = useState(false)

  // dialog open 時に state を初期化 (前回閉じた位置を引きずらない)
  useEffect(() => {
    if (open) {
      setCurrentIndex(0)
      setIsPaused(false)
      setDontShowAgainChecked(false)
    }
  }, [open])

  // 自動進行タイマー
  const isLastSlide = currentIndex >= total - 1
  useEffect(() => {
    if (!open) return
    if (isLastSlide) return
    if (isPaused) return
    const slide = WELCOME_SLIDES[currentIndex]
    // Concept (フルスクリーン演出) は autoAdvance フラグに関わらず必ず時間で自動進行する
    // (= メニュー経由でも 12 秒のアニメ完了後にスライド 2 へ抜ける)
    const shouldAdvance = autoAdvance || slide.kind === 'concept'
    if (!shouldAdvance) return
    const t = setTimeout(() => {
      setCurrentIndex((i) => Math.min(total - 1, i + 1))
    }, slide.durationMs)
    return () => clearTimeout(t)
  }, [open, autoAdvance, isPaused, currentIndex, isLastSlide, total])

  // キーボードナビ
  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'ArrowRight') setCurrentIndex((i) => Math.min(total - 1, i + 1))
      else if (e.key === 'ArrowLeft') setCurrentIndex((i) => Math.max(0, i - 1))
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, total])

  const handleClose = useCallback(() => {
    if (showDontShowAgain) onDismiss?.(dontShowAgainChecked)
    onClose()
  }, [showDontShowAgain, onDismiss, dontShowAgainChecked, onClose])

  const slide = WELCOME_SLIDES[currentIndex]
  const isConcept = slide.kind === 'concept'

  // Concept スライドはフルスクリーン演出 (`fixed inset-0 z-50` の自前 overlay) なので、
  // Modal の header (× ボタン) / 内部 nav UI / footer はすべて隠す。title 未指定で Modal の
  // 上部バーごと render されない (× ボタンも消える) が、Esc で閉じる動作は Modal が
  // 維持しているので問題なし。ConceptSlide 中は完全な没入演出。

  return (
    <Modal open={open} onClose={handleClose} size="xl" title={isConcept ? undefined : 'マンダラートの使い方'}>
      <div
        className="flex flex-col"
        // Concept (フルスクリーン演出) 中はホバー pause を無効化。fixed overlay が DOM tree 上は
        // この div の子として render されるので、cursor が overlay 上にあっても mouseenter が
        // 発火する。Concept は時間ベースの guided animation なので止めず流すのが正解。
        onMouseEnter={() => { if (!isConcept) setIsPaused(true) }}
        onMouseLeave={() => { if (!isConcept) setIsPaused(false) }}
      >
        {/* スライド本体。Concept は自前 fixed overlay で render するので min-h を確保する必要なし */}
        {isConcept ? (
          <ConceptSlide />
        ) : (
          <div className="min-h-[420px]">
            <FeatureSlide
              title={slide.kind === 'feature' ? slide.title : ''}
              description={slide.kind === 'feature' ? slide.description : ''}
              screenshot={slide.kind === 'feature' ? slide.screenshot : undefined}
              screenshotAlt={slide.kind === 'feature' ? slide.screenshotAlt : undefined}
            />
          </div>
        )}

        {/* ナビ + dots + ステップ表示 (Concept 中は z-50 overlay の下に隠れるが、念のため非表示にする) */}
        <div className={`flex items-center justify-between gap-4 pt-4 border-t border-neutral-100 dark:border-neutral-800 ${isConcept ? 'invisible' : ''}`}>
          <button
            type="button"
            onClick={() => setCurrentIndex((i) => Math.max(0, i - 1))}
            disabled={currentIndex === 0}
            className="px-3 py-1.5 text-sm rounded-lg border border-neutral-200 dark:border-neutral-700 text-neutral-600 dark:text-neutral-300 hover:text-neutral-900 dark:hover:text-neutral-100 hover:border-neutral-300 dark:hover:border-neutral-600 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            aria-label="前のスライド"
          >
            ←
          </button>

          <div className="flex items-center gap-3">
            {/* dots */}
            <div className="flex items-center gap-1.5">
              {WELCOME_SLIDES.map((_, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => setCurrentIndex(i)}
                  className={`w-2 h-2 rounded-full transition-colors ${
                    i === currentIndex
                      ? 'bg-blue-600 dark:bg-blue-400'
                      : 'bg-neutral-300 dark:bg-neutral-700 hover:bg-neutral-400 dark:hover:bg-neutral-500'
                  }`}
                  aria-label={`スライド ${i + 1}`}
                  aria-current={i === currentIndex ? 'true' : 'false'}
                />
              ))}
            </div>
            {/* ステップ数字 */}
            <span className="text-xs text-neutral-500 dark:text-neutral-400 tabular-nums">
              {currentIndex + 1} / {total}
            </span>
          </div>

          <button
            type="button"
            onClick={() => setCurrentIndex((i) => Math.min(total - 1, i + 1))}
            disabled={isLastSlide}
            className="px-3 py-1.5 text-sm rounded-lg border border-neutral-200 dark:border-neutral-700 text-neutral-600 dark:text-neutral-300 hover:text-neutral-900 dark:hover:text-neutral-100 hover:border-neutral-300 dark:hover:border-neutral-600 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            aria-label="次のスライド"
          >
            →
          </button>
        </div>

        {/* footer: 「次回以降表示しない」 + 閉じる (welcome 経由のみ表示、Concept 中は隠す) */}
        {showDontShowAgain && !isConcept && (
          <div className="flex items-center justify-between gap-4 pt-4 mt-4 border-t border-neutral-100 dark:border-neutral-800">
            <label className="flex items-center gap-2 text-xs text-neutral-600 dark:text-neutral-400 cursor-pointer">
              <input
                type="checkbox"
                checked={dontShowAgainChecked}
                onChange={(e) => setDontShowAgainChecked(e.target.checked)}
                className="rounded border-neutral-300 dark:border-neutral-600"
              />
              次回以降は表示しない
            </label>
            <button
              type="button"
              onClick={handleClose}
              className={`px-4 py-1.5 text-sm rounded-lg transition-colors ${
                isLastSlide
                  ? 'bg-blue-600 hover:bg-blue-700 text-white border border-blue-600'
                  : 'border border-neutral-200 dark:border-neutral-700 text-neutral-700 dark:text-neutral-200 hover:border-neutral-300 dark:hover:border-neutral-600'
              }`}
            >
              閉じる
            </button>
          </div>
        )}
      </div>
    </Modal>
  )
}
