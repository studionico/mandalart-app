import type { ReactNode } from 'react'

/**
 * カード/タイル右上に hover 時のみフェードインで現れるアクションアイコン群。
 *
 * 親要素は `relative group` を持っている前提 (`group-hover` で opacity 制御)。
 * 各 button は内部で `onClick` / `onMouseDown` を `stopPropagation` するので、
 * 外側の D&D mousedown ハンドラには伝搬しない (StockTab / Dashboard カード両方で必要)。
 */

type ActionVariant = 'neutral' | 'blue' | 'red'

export type HoverAction = {
  icon: ReactNode
  variant: ActionVariant
  onClick: () => void
  title: string
}

type Props = {
  actions: HoverAction[]
  /**
   * - `sm`: w-4 / gap-0.5 / text-[8px] / inset-0.5 (StockEntry の正方形タイル向け)
   * - `md`: w-5 / gap-1 / text-[10px] / inset-1 (Dashboard カード向け)
   */
  size?: 'sm' | 'md'
}

const SIZE_CLASSES = {
  sm: { wrapper: 'top-0.5 right-0.5 gap-0.5', btn: 'w-4 h-4 text-[8px]' },
  md: { wrapper: 'top-1 right-1 gap-1', btn: 'w-5 h-5 text-[10px]' },
} as const

// neutral は「黒/白単色」運用 (ロック / ピン / 複製アイコンの基本色)。on/off は
// アイコン形状で区別しているので color に役割を持たせない。
// red は削除アクション専用 (hover で警告色を出して誤操作を防ぐ)。
// blue は「目立たせる必要のある active 状態」用に残しているが、現状未使用 (将来取り除いてよい)。
const VARIANT_CLASSES: Record<ActionVariant, string> = {
  neutral: 'text-neutral-900 dark:text-neutral-100 hover:text-black dark:hover:text-white',
  blue: 'text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-200',
  red: 'text-red-500 dark:text-red-300 hover:text-red-700',
}

export function HoverActionButtons({ actions, size = 'md' }: Props) {
  const sz = SIZE_CLASSES[size]
  return (
    <div className={`absolute ${sz.wrapper} flex opacity-0 group-hover:opacity-100 transition-opacity`}>
      {actions.map((a, i) => (
        <button
          key={i}
          type="button"
          onClick={(e) => { e.stopPropagation(); a.onClick() }}
          onMouseDown={(e) => e.stopPropagation()}
          className={`${sz.btn} rounded bg-white/90 dark:bg-neutral-800/90 border border-neutral-200 dark:border-neutral-700 ${VARIANT_CLASSES[a.variant]} flex items-center justify-center`}
          title={a.title}
        >
          {a.icon}
        </button>
      ))}
    </div>
  )
}
