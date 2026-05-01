/**
 * 「カード相当」要素 (中心セル / ダッシュボードカード / ストックエントリ) のテキスト描画
 * 共通コンポーネント。ConvergeOverlay の polling が読み取る統一構造
 * (`<div absolute z-10 not-inset-0> <span>` ) を提供する。
 *
 * Cell.tsx / MandalartCard / StockEntry で個別実装していた同型 JSX を集約することで、
 * ConvergeOverlay の構造前提 (落とし穴 #19) が破られないようにする。terminal inset / font /
 * text-color はすべて props 経由で受け取る (固定 vs 動的のバリエーションに対応)。
 */
type Props = {
  text: string
  /** font-size (px)。Cell の動的 fontScale や StockEntry の固定 10px などを受ける */
  fontPx: number
  /** root から見た top inset (px、border-box 内側)。
   * Cell では showCheckbox に応じて top のみ大きくなる。未指定なら sideInsetPx と同値。 */
  topInsetPx?: number
  /** root から見た right / bottom / left inset (px、border-box 内側) */
  sideInsetPx: number
  /** Tailwind text color class. デフォルト: `text-neutral-800 dark:text-neutral-100` */
  textColorClass?: string
  /** font-medium / font-bold 等の追加 class (Cell では未使用、必要なら指定) */
  extraSpanClass?: string
}

export function CardLikeText({
  text,
  fontPx,
  topInsetPx,
  sideInsetPx,
  textColorClass = 'text-neutral-800 dark:text-neutral-100',
  extraSpanClass = '',
}: Props) {
  const top = topInsetPx ?? sideInsetPx
  return (
    <div
      style={{ top, right: sideInsetPx, bottom: sideInsetPx, left: sideInsetPx }}
      className="absolute z-10 flex items-start overflow-hidden"
    >
      <span
        style={{ fontSize: fontPx, lineHeight: 1.25 }}
        className={`block w-full text-left leading-tight break-all whitespace-pre-wrap ${textColorClass} ${extraSpanClass}`}
      >
        {text}
      </span>
    </div>
  )
}
