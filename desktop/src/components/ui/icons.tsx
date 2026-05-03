/**
 * 単色 inline SVG アイコン集。
 *
 * 方針:
 * - すべて `viewBox="0 0 24 24"` + `stroke="currentColor"` ベースで、呼出側が
 *   `text-neutral-900 dark:text-neutral-100` 等で色を当てる (黒/白単色運用)。
 * - ライブラリ依存を避けて bundle size を増やさず、既存 SVG (DragActionPanel /
 *   Breadcrumb / Cell checkbox) と統一スタイル (`strokeWidth=2 round/round`) を踏襲。
 * - サイズは `className` で上書き (デフォルト `w-4 h-4`)。
 *
 * 状態区別が必要なペア (lock / star) は **形** で区別する:
 * - LockClosedIcon: シャックル本体挿入 (= ロック中)
 * - LockOpenIcon: シャックル外れ (= 未ロック)
 * - StarFilledIcon: 塗りつぶし (= ピン留め中)
 * - StarOutlineIcon: 線画 (= 未ピン)
 */

type IconProps = {
  className?: string
  /** aria-hidden を上書きしたい場合 (デフォルトで true)。 */
  ariaHidden?: boolean
}

function svgProps(className: string | undefined, ariaHidden: boolean) {
  return {
    viewBox: '0 0 24 24',
    fill: 'none' as const,
    stroke: 'currentColor',
    strokeWidth: 2,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': ariaHidden,
    className: className ?? 'w-4 h-4',
  }
}

/** ロック中 (closed shackle): 南京錠ボディ + シャックルが本体に挿入された形。 */
export function LockClosedIcon({ className, ariaHidden = true }: IconProps) {
  return (
    <svg {...svgProps(className, ariaHidden)}>
      {/* shackle (U 字) */}
      <path d="M8 11V7a4 4 0 0 1 8 0v4" />
      {/* body (角丸矩形) */}
      <rect x="5" y="11" width="14" height="10" rx="2" />
    </svg>
  )
}

/** 未ロック (open shackle): シャックルが本体右側に外れて持ち上がった形。 */
export function LockOpenIcon({ className, ariaHidden = true }: IconProps) {
  return (
    <svg {...svgProps(className, ariaHidden)}>
      {/* shackle: 左 4 から立ち上がり、右へ抜けた半開状態 */}
      <path d="M8 11V7a4 4 0 0 1 8 0" />
      {/* body */}
      <rect x="5" y="11" width="14" height="10" rx="2" />
    </svg>
  )
}

/** ピン留め中 (filled star)。`fill="currentColor"` で塗りつぶし。 */
export function StarFilledIcon({ className, ariaHidden = true }: IconProps) {
  // 塗りつぶしは fill を currentColor に上書きする必要があるので props を上書き
  const base = svgProps(className, ariaHidden)
  return (
    <svg {...base} fill="currentColor">
      <path d="M12 2.5l2.9 6.3 6.6.6-5 4.7 1.5 6.7L12 17.6 5.9 20.8l1.6-6.7-5-4.7 6.6-.6L12 2.5z" />
    </svg>
  )
}

/** 未ピン (outline star)。 */
export function StarOutlineIcon({ className, ariaHidden = true }: IconProps) {
  return (
    <svg {...svgProps(className, ariaHidden)}>
      <path d="M12 2.5l2.9 6.3 6.6.6-5 4.7 1.5 6.7L12 17.6 5.9 20.8l1.6-6.7-5-4.7 6.6-.6L12 2.5z" />
    </svg>
  )
}

/** 複製 (DocumentDuplicate ベース、二枚重ね矩形)。 */
export function CopyIcon({ className, ariaHidden = true }: IconProps) {
  return (
    <svg {...svgProps(className, ariaHidden)}>
      {/* 後ろの矩形 (右下) */}
      <rect x="9" y="9" width="11" height="11" rx="2" />
      {/* 前の矩形 (左上)。後ろと重なる部分を見せるため別 path */}
      <path d="M5 15V6a2 2 0 0 1 2-2h9" />
    </svg>
  )
}

/** × (削除 / クローズ)。2 本の交差線。 */
export function XMarkIcon({ className, ariaHidden = true }: IconProps) {
  return (
    <svg {...svgProps(className, ariaHidden)}>
      <path d="M6 6l12 12" />
      <path d="M18 6L6 18" />
    </svg>
  )
}

/** ↓ (下矢印、StockTab の貼付けで使用)。 */
export function ArrowDownIcon({ className, ariaHidden = true }: IconProps) {
  return (
    <svg {...svgProps(className, ariaHidden)}>
      <path d="M12 5v14" />
      <path d="M6 13l6 6 6-6" />
    </svg>
  )
}
