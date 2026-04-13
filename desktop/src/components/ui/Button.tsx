import { ButtonHTMLAttributes } from 'react'

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger'

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant
  size?: 'sm' | 'md'
}

const variants: Record<Variant, string> = {
  primary:   'bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50',
  secondary: 'bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50',
  ghost:     'text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-50',
  danger:    'bg-red-600 text-white hover:bg-red-700 disabled:opacity-50',
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
