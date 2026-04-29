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
    <div className="flex rounded-lg border border-neutral-200 dark:border-neutral-700 overflow-hidden text-xs">
      {OPTIONS.map((opt) => (
        <button
          key={opt.value}
          onClick={() => setPreference(opt.value)}
          title={opt.title}
          className={`px-2 py-1.5 transition-colors ${
            preference === opt.value
              ? 'bg-blue-600 text-white'
              : 'hover:bg-neutral-50 dark:hover:bg-neutral-800 text-neutral-600 dark:text-neutral-300'
          }`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  )
}
