'use client'

import { useEffect } from 'react'

type Props = {
  message: string
  type?: 'info' | 'error' | 'success'
  onClose: () => void
  action?: { label: string; onClick: () => void }
  duration?: number
}

export default function Toast({ message, type = 'info', onClose, action, duration = 4000 }: Props) {
  useEffect(() => {
    const timer = setTimeout(onClose, duration)
    return () => clearTimeout(timer)
  }, [onClose, duration])

  const colors = {
    info:    'bg-gray-800 text-white',
    error:   'bg-red-600 text-white',
    success: 'bg-green-600 text-white',
  }

  return (
    <div className={`fixed bottom-6 left-1/2 -translate-x-1/2 flex items-center gap-3 px-4 py-3 rounded-xl shadow-lg text-sm z-50 ${colors[type]}`}>
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
