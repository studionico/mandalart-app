
import { useEffect } from 'react'
import { InfoIcon, WarningIcon, CheckIcon } from './icons'

type Props = {
  message: string
  type?: 'info' | 'error' | 'success'
  onClose: () => void
  action?: { label: string; onClick: () => void }
  duration?: number
}

// 全 type を「黒地白文字」で統一 (ダーク反転 = 白地黒文字)。状態区別はアイコン形状で行う:
// - info → ℹ
// - error → ⚠
// - success → ✓
// (Q3=A 方針: 状態色を完全廃止、形で識別)
const TOAST_BG = 'bg-neutral-900 dark:bg-neutral-100 text-white dark:text-neutral-900'

const TYPE_ICON = {
  info: InfoIcon,
  error: WarningIcon,
  success: CheckIcon,
} as const

export default function Toast({ message, type = 'info', onClose, action, duration = 4000 }: Props) {
  useEffect(() => {
    const timer = setTimeout(onClose, duration)
    return () => clearTimeout(timer)
  }, [onClose, duration])

  const Icon = TYPE_ICON[type]

  return (
    <div className={`fixed bottom-6 left-1/2 -translate-x-1/2 flex items-center gap-3 px-4 py-3 rounded-xl shadow-lg text-sm z-50 ${TOAST_BG}`}>
      <Icon className="w-4 h-4 shrink-0" />
      <span>{message}</span>
      {action && (
        <button
          onClick={() => { action.onClick(); onClose() }}
          className="underline font-medium hover:opacity-80"
        >
          {action.label}
        </button>
      )}
    </div>
  )
}
