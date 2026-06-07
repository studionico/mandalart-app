export type PresetColor = {
  key: string
  label: string
  bg: string    // Tailwind bg class (light + dark)
  text: string  // Tailwind text class for contrast (light + dark)
}

// PRESET_COLORS のデータは単一ソース [shared/constants/colors.json] から codegen される
// (iOS PresetColors.swift と同じ値を保つため、`cd desktop && npm run codegen` で再生成)。
// 設計メモ: ダークモードの塗り色は `*-900/40` (40% 不透明)、テキストは light `*-900`→dark `*-100` で反転。
import { PRESET_COLORS } from './colors.generated'
export { PRESET_COLORS }

export const DEFAULT_COLOR_KEY = null

// 色未指定セルのデフォルトは白 (ライト) / gray-900 (ダーク)。
// これにより dark モードで暗い背景にセルが馴染み、境界線の光度階調が
// 本来の意図通りに知覚される (中心: 白強 / 子あり: gray-300 中 / 子なし: gray-700 弱)。
export function getColorClasses(colorKey: string | null): { bg: string; text: string } {
  const fallback = {
    bg: 'bg-white dark:bg-neutral-900',
    text: 'text-neutral-900 dark:text-neutral-100',
  }
  if (!colorKey) return fallback
  const color = PRESET_COLORS.find((c) => c.key === colorKey)
  return color ? { bg: color.bg, text: color.text } : fallback
}
