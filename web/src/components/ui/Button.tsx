import { ButtonHTMLAttributes } from 'react'

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger'

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant
  size?: 'sm' | 'md'
}

// 全 variant を黒/白/グレーで構成。primary は黒地白文字 (ダーク反転)、danger も同形だが
// 呼出側で WarningIcon と組合せて警告性を表現する (色ではなく形で識別、Q3=A 方針)。
const variants: Record<Variant, string> = {
  primary:   'bg-neutral-900 dark:bg-neutral-100 text-white dark:text-neutral-900 hover:bg-neutral-800 dark:hover:bg-neutral-200 disabled:opacity-50',
  secondary: 'bg-white dark:bg-neutral-800 border border-neutral-300 dark:border-neutral-600 text-neutral-700 dark:text-neutral-200 hover:bg-neutral-50 dark:hover:bg-neutral-700 disabled:opacity-50',
  ghost:     'text-neutral-600 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-800 disabled:opacity-50',
  danger:    'bg-neutral-900 dark:bg-neutral-100 text-white dark:text-neutral-900 hover:bg-neutral-800 dark:hover:bg-neutral-200 disabled:opacity-50',
}

const sizes = {
  sm: 'px-3 py-1.5 text-xs',
  md: 'px-4 py-2 text-sm',
}

export default function Button({ variant = 'primary', size = 'md', className = '', ...props }: Props) {
  return (
    <button
      {...props}
      className={`inline-flex items-center justify-center gap-1.5 rounded-lg font-medium transition-colors ${variants[variant]} ${sizes[size]} ${className}`}
    />
  )
}
