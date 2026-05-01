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
 * 200ms / 300ms 運用で「時々シングルクリックと誤判定される」ケースが残ったため 400ms に緩和。
 * macOS システム設定の double click 最大間隔 (~500ms) に近く、ゆっくりした double click まで
 * 確実に拾える。drill レイテンシが +100ms 増えるが体感的には許容範囲。
 */
export const CLICK_DELAY_MS = 400

/**
 * mousedown ベース drag の終了直後に発火する click を抑止するための guard 期間 (ms)。
 * Tauri WebKit では HTML5 D&D が動かないため自前 mousedown 実装をしているが、drag 終了の
 * mouseup は通常の click event も連発する。この期間内の click は drag 余韻と見なして無視。
 */
export const DRAG_CLICK_SUPPRESS_MS = 150

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

// --- 収束アニメ (stock copy/move、ダッシュボード遷移時) ---

/**
 * 収束アニメ全体の速度倍率。動作確認用に > 1 にすると全 convergence が等比でスローになる
 * (ConvergeOverlay の各プロパティ transition、EditorLayout のストック収束、すべて連動)。
 * **リリース時は必ず 1 に戻すこと。** */
export const CONVERGE_DEBUG_SLOW_FACTOR = 1

/**
 * グリッド全体を収束先 (ストックタイル / ダッシュボードカード = ホームアイコン位置)
 * へ向けて translate + scale + fade-out するアニメの duration (ms)。
 * 戻りは transition: none で瞬時復帰させるため戻りアニメ duration は別途持たない。
 */
export const CONVERGE_DURATION_MS = 400 * CONVERGE_DEBUG_SLOW_FACTOR

// --- 同期 ---

/** Supabase realtime 受信後の reload を間引く debounce (ms) */
export const SYNC_DEBOUNCE_MS = 300

// --- メモ ---

/** MemoTab の auto-save debounce (ms)。typing 後この時間内に追加入力が無ければ保存。 */
export const MEMO_SAVE_DEBOUNCE_MS = 800

// --- UI 確認ダイアログ ---

/**
 * TrashDialog の 2 クリック確認 (「本当に削除?」表示) を自動解除するまでの時間 (ms)。
 * Tauri v2 WebView は window.confirm が動かないので、この「2 回押すと消える」方式に
 * している。長すぎると誤爆、短すぎると 1 回目が消える前に 2 回目が押せないので中庸の 4 秒。
 */
export const CONFIRM_AUTO_RESET_MS = 4000
