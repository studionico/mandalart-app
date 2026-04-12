export type PresetColor = {
  key: string
  label: string
  bg: string    // Tailwind bg class
  text: string  // Tailwind text class for contrast
}

export const PRESET_COLORS: PresetColor[] = [
  { key: 'red-100',    label: '赤',   bg: 'bg-red-100',    text: 'text-red-900' },
  { key: 'orange-100', label: 'オレンジ', bg: 'bg-orange-100', text: 'text-orange-900' },
  { key: 'yellow-100', label: '黄',   bg: 'bg-yellow-100', text: 'text-yellow-900' },
  { key: 'green-100',  label: '緑',   bg: 'bg-green-100',  text: 'text-green-900' },
  { key: 'teal-100',   label: 'ティール', bg: 'bg-teal-100',   text: 'text-teal-900' },
  { key: 'blue-100',   label: '青',   bg: 'bg-blue-100',   text: 'text-blue-900' },
  { key: 'indigo-100', label: 'インディゴ', bg: 'bg-indigo-100', text: 'text-indigo-900' },
  { key: 'purple-100', label: '紫',   bg: 'bg-purple-100', text: 'text-purple-900' },
  { key: 'pink-100',   label: 'ピンク', bg: 'bg-pink-100',   text: 'text-pink-900' },
  { key: 'gray-100',   label: 'グレー', bg: 'bg-gray-100',   text: 'text-gray-900' },
]

export const DEFAULT_COLOR_KEY = null

export function getColorClasses(colorKey: string | null): { bg: string; text: string } {
  if (!colorKey) return { bg: 'bg-white', text: 'text-gray-900' }
  const color = PRESET_COLORS.find((c) => c.key === colorKey)
  return color ? { bg: color.bg, text: color.text } : { bg: 'bg-white', text: 'text-gray-900' }
}
