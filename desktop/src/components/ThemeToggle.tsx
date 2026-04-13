import { useThemeStore, type ThemePreference } from '@/store/themeStore'

const OPTIONS: { value: ThemePreference; label: string; title: string }[] = [
  { value: 'light',  label: '☀', title: 'ライトモード' },
  { value: 'system', label: '◐', title: 'システム設定に追従' },
  { value: 'dark',   label: '☾', title: 'ダークモード' },
]

export default function ThemeToggle() {
  const preference = useThemeStore((s) => s.preference)
  const setPreference = useThemeStore((s) => s.setPreference)

  return (
    <div className="flex rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden text-xs">
      {OPTIONS.map((opt) => (
        <button
          key={opt.value}
          onClick={() => setPreference(opt.value)}
          title={opt.title}
          className={`px-2 py-1.5 transition-colors ${
            preference === opt.value
              ? 'bg-blue-600 text-white'
              : 'hover:bg-gray-50 dark:hover:bg-gray-800 text-gray-600 dark:text-gray-300'
          }`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  )
}
