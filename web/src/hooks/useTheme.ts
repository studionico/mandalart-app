import { useEffect } from 'react'
import { useThemeStore } from '@/store/themeStore'

/**
 * 設定値 (light / dark / system) に応じて <html> に .dark クラスを付け外しする。
 * system の場合は prefers-color-scheme を監視して自動追従する。
 */
export function useTheme() {
  const preference = useThemeStore((s) => s.preference)

  useEffect(() => {
    const root = document.documentElement
    const mq = window.matchMedia('(prefers-color-scheme: dark)')

    function apply() {
      const dark = preference === 'dark' || (preference === 'system' && mq.matches)
      root.classList.toggle('dark', dark)
    }

    apply()
    if (preference === 'system') {
      mq.addEventListener('change', apply)
      return () => mq.removeEventListener('change', apply)
    }
  }, [preference])
}
