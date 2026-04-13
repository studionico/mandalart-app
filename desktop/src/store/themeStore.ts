import { create } from 'zustand'

export type ThemePreference = 'light' | 'dark' | 'system'

const KEY = 'mandalart.theme'

function loadPreference(): ThemePreference {
  try {
    const v = localStorage.getItem(KEY)
    if (v === 'light' || v === 'dark' || v === 'system') return v
  } catch { /* noop */ }
  return 'system'
}

function persistPreference(pref: ThemePreference) {
  try { localStorage.setItem(KEY, pref) } catch { /* noop */ }
}

type ThemeState = {
  preference: ThemePreference
  setPreference: (pref: ThemePreference) => void
}

export const useThemeStore = create<ThemeState>((set) => ({
  preference: loadPreference(),
  setPreference: (pref) => {
    persistPreference(pref)
    set({ preference: pref })
  },
}))
