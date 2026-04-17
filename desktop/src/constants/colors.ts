export type PresetColor = {
  key: string
  label: string
  bg: string    // Tailwind bg class (light + dark)
  text: string  // Tailwind text class for contrast (light + dark)
}

// ダークモードでの塗り色は `*-900/40` (40% 不透明の *-900) を使う。
// これにより cell 背景 (`bg-gray-900`) に対して色が薄く乗った印象になり、
// ライトモードの「パステル *-100」の相対感を保てる。
// テキストはライトモード `*-900` (暗色) → ダーク `*-100` (明色) で反転。
export const PRESET_COLORS: PresetColor[] = [
  { key: 'red-100',    label: '赤',       bg: 'bg-red-100 dark:bg-red-900/40',       text: 'text-red-900 dark:text-red-100' },
  { key: 'orange-100', label: 'オレンジ', bg: 'bg-orange-100 dark:bg-orange-900/40', text: 'text-orange-900 dark:text-orange-100' },
  { key: 'yellow-100', label: '黄',       bg: 'bg-yellow-100 dark:bg-yellow-900/40', text: 'text-yellow-900 dark:text-yellow-100' },
  { key: 'green-100',  label: '緑',       bg: 'bg-green-100 dark:bg-green-900/40',   text: 'text-green-900 dark:text-green-100' },
  { key: 'teal-100',   label: 'ティール', bg: 'bg-teal-100 dark:bg-teal-900/40',     text: 'text-teal-900 dark:text-teal-100' },
  { key: 'blue-100',   label: '青',       bg: 'bg-blue-100 dark:bg-blue-900/40',     text: 'text-blue-900 dark:text-blue-100' },
  { key: 'indigo-100', label: 'インディゴ', bg: 'bg-indigo-100 dark:bg-indigo-900/40', text: 'text-indigo-900 dark:text-indigo-100' },
  { key: 'purple-100', label: '紫',       bg: 'bg-purple-100 dark:bg-purple-900/40', text: 'text-purple-900 dark:text-purple-100' },
  { key: 'pink-100',   label: 'ピンク',   bg: 'bg-pink-100 dark:bg-pink-900/40',     text: 'text-pink-900 dark:text-pink-100' },
  { key: 'gray-100',   label: 'グレー',   bg: 'bg-gray-100 dark:bg-gray-700/40',     text: 'text-gray-900 dark:text-gray-100' },
]

export const DEFAULT_COLOR_KEY = null

// 色未指定セルのデフォルトは白 (ライト) / gray-900 (ダーク)。
// これにより dark モードで暗い背景にセルが馴染み、境界線の光度階調が
// 本来の意図通りに知覚される (中心: 白強 / 子あり: gray-300 中 / 子なし: gray-700 弱)。
export function getColorClasses(colorKey: string | null): { bg: string; text: string } {
  const fallback = {
    bg: 'bg-white dark:bg-gray-900',
    text: 'text-gray-900 dark:text-gray-100',
  }
  if (!colorKey) return fallback
  const color = PRESET_COLORS.find((c) => c.key === colorKey)
  return color ? { bg: color.bg, text: color.text } : fallback
}
