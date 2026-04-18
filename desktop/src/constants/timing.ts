/**
 * UI / 同期 / アニメーションのタイミング定数 (ms)。
 *
 * 動画的な演出は 85ms (stagger) / 400ms (fade / transform) を共通ビートにして、
 * orbit・view switch 間で見た目の速度感を揃えている。スピードを全体調整したい
 * 場合はここの値を書き換える。
 */

// --- クリック判定 ---

/**
 * シングル vs ダブルクリックを識別するタイマー (ms)。
 * 入力ありセルはこのぶんの遅延でドリルが始まる (空セルはドリル先が無いので即編集)。
 */
export const CLICK_DELAY_MS = 220

// --- 並列グリッドスライド ---

/** 並列グリッド切替時の横スライド duration (ms) */
export const SLIDE_DURATION_MS = 320

// --- Orbit / View Switch 共通ビート ---

/** 各セル / ブロックの登場間隔 (ms、stagger) */
export const ANIM_STAGGER_MS = 85
/** 各セル / ブロックの fade / transform duration (ms) */
export const ANIM_FADE_MS = 400

// --- View Switch 固有 ---

/** to-9x9 で周辺ブロック fade-in が始まるまでの遅延 (ms、shrink の前半を見せる分) */
export const VIEW_SWITCH_TO_9_DELAY_MS = 200

// --- 同期 ---

/** Supabase realtime 受信後の reload を間引く debounce (ms) */
export const SYNC_DEBOUNCE_MS = 300

// --- D&D アニメーション ---

/** ドラッグゴースト (マウス追従浮遊セル) の揺れ周期 (ms)。ゆったりの 3 往復/秒くらい */
export const DRAG_WOBBLE_PERIOD_MS = 700
/** D&D ターゲットが source 位置へスライドする transition 時間 (ms) */
export const DRAG_TARGET_SHIFT_MS = 220

// --- UI 確認ダイアログ ---

/**
 * TrashDialog の 2 クリック確認 (「本当に削除?」表示) を自動解除するまでの時間 (ms)。
 * Tauri v2 WebView は window.confirm が動かないので、この「2 回押すと消える」方式に
 * している。長すぎると誤爆、短すぎると 1 回目が消える前に 2 回目が押せないので中庸の 4 秒。
 */
export const CONFIRM_AUTO_RESET_MS = 4000
