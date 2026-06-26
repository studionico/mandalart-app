import { useCallback, useEffect, useMemo, useState } from 'react'
import { CONFIRM_AUTO_RESET_MS } from '@/constants/timing'

/**
 * 2 クリック確認 UI のための hook (落とし穴 #7 対策)。
 *
 * Tauri v2 WebView では `window.confirm` が動作しないため、危険操作 (削除など) の確認は
 * 「1 回目のクリックで arm → ボタン表記切替、2 回目のクリックで実行」の state ベース UI で
 * 代替する。`autoResetMs` 経過で自動的に disarm されるため、放置による誤爆も避けられる。
 *
 * single-target 用 (例: 「すべて削除」ボタン)。複数行のうちどれが arm されているか
 * を保持したい場合は {@link useTwoClickConfirmKey} を使う。
 *
 * @example
 * ```tsx
 * const { armed, arm, reset } = useTwoClickConfirm()
 * async function handleDeleteAll() {
 *   if (!armed) { arm(); return }
 *   await doDeleteAll()
 *   reset()
 * }
 * <Button onClick={handleDeleteAll}>{armed ? '本当に削除?' : 'すべて削除'}</Button>
 * ```
 */
export function useTwoClickConfirm(autoResetMs: number = CONFIRM_AUTO_RESET_MS) {
  const [armed, setArmed] = useState(false)
  useEffect(() => {
    if (!armed) return
    const t = setTimeout(() => setArmed(false), autoResetMs)
    return () => clearTimeout(t)
  }, [armed, autoResetMs])
  const arm = useCallback(() => setArmed(true), [])
  const reset = useCallback(() => setArmed(false), [])
  return useMemo(() => ({ armed, arm, reset }), [armed, arm, reset])
}

/**
 * {@link useTwoClickConfirm} の key 付き版。
 * 「リスト中のどの行に対して arm されているか」を 1 instance で保持する。
 *
 * @example
 * ```tsx
 * const { isArmed, arm, reset } = useTwoClickConfirmKey<string>()
 * async function handleDelete(item: Item) {
 *   if (!isArmed(item.id)) { arm(item.id); return }
 *   await doDelete(item.id)
 *   reset()
 * }
 * ```
 */
export function useTwoClickConfirmKey<K>(autoResetMs: number = CONFIRM_AUTO_RESET_MS) {
  const [pending, setPending] = useState<K | null>(null)
  useEffect(() => {
    if (pending === null) return
    const t = setTimeout(() => setPending(null), autoResetMs)
    return () => clearTimeout(t)
  }, [pending, autoResetMs])
  const isArmed = useCallback((key: K) => pending === key, [pending])
  const arm = useCallback((key: K) => setPending(key), [])
  const reset = useCallback(() => setPending(null), [])
  return useMemo(() => ({ pending, isArmed, arm, reset }), [pending, isArmed, arm, reset])
}
