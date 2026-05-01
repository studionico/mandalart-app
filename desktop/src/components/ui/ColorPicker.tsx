import { PRESET_COLORS } from '@/constants/colors'

/**
 * セルの背景色プリセットピッカー。「デフォルト (null)」 + `PRESET_COLORS` の N 色を
 * 円形アイコンで横並びにし、選択中は `border-blue-500 + scale-110` でハイライトする。
 *
 * 拡大エディタのツールバー (Cell.tsx) と CellEditModal の両方で使用。
 */

type Props = {
  value: string | null
  onChange: (color: string | null) => void
  /**
   * - `sm`: w-6 / gap-1.5 (拡大エディタ toolbar 向け、コンパクト)
   * - `md`: w-7 / gap-2 (CellEditModal 向け、ゆとりあり)
   */
  size?: 'sm' | 'md'
}

const SIZE_CLASSES = {
  sm: { wrapper: 'gap-1.5', btn: 'w-6 h-6' },
  md: { wrapper: 'gap-2', btn: 'w-7 h-7' },
} as const

const SELECTED = 'border-blue-500 scale-110'
const UNSELECTED = 'border-neutral-300 dark:border-neutral-600'

export function ColorPicker({ value, onChange, size = 'sm' }: Props) {
  const sz = SIZE_CLASSES[size]
  return (
    <div className={`flex flex-wrap items-center ${sz.wrapper}`}>
      <button
        type="button"
        onClick={() => onChange(null)}
        className={`${sz.btn} rounded-full border-2 bg-white ${value === null ? SELECTED : UNSELECTED} transition-transform`}
        title="デフォルト"
      />
      {PRESET_COLORS.map((c) => (
        <button
          key={c.key}
          type="button"
          onClick={() => onChange(c.key)}
          className={`${sz.btn} rounded-full border-2 ${c.bg} ${value === c.key ? SELECTED : UNSELECTED} transition-transform`}
          title={c.label}
        />
      ))}
    </div>
  )
}
