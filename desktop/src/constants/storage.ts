/**
 * localStorage キーを一元管理する。
 *
 * 命名は `mandalart.<area>.<key>` (ドット区切り) に統一。直接 `localStorage.setItem('mandalart.xxx', ...)` と
 * 書かず、このファイルの定数を参照すること。
 */
const PREFIX = 'mandalart.'

export const STORAGE_KEYS = {
  /** エディタ文字サイズ level (整数、-10 〜 +20) */
  fontLevel: `${PREFIX}fontLevel`,
  /** テーマ設定 'light' | 'dark' | 'system' */
  theme: `${PREFIX}theme`,
  /** セル左上チェックボックス UI の表示 ON/OFF ('1' or '0') */
  showCheckbox: `${PREFIX}showCheckbox`,
} as const
