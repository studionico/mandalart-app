import { useEffect, useState } from 'react'
import Modal from '@/components/ui/Modal'
import Toast from '@/components/ui/Toast'
import { loadMirrorConfig, saveMirrorConfig } from '@/lib/mirror/mirrorConfig'
import { pickMirrorFolder } from '@/lib/mirror/mirrorDialog'
import { mirrorAllToFolder } from '@/lib/mirror/mirrorSync'

type Props = {
  open: boolean
  onClose: () => void
}

type ToastState = { message: string; type: 'info' | 'success' | 'error' }

/**
 * アプリ全体の設定モーダル。
 *
 * 「ローカル JSON ミラー」セクション: 出力先フォルダ選択 + 有効トグル + 手動「今すぐ書き出す」。
 * 有効化すると DB 編集が debounce 後に各マンダラート `<slug>-<id>.json` として書き出される
 * (一方向 DB→ファイル)。**取り込みは行わず、クラウド同期にも干渉しない**。
 */
export default function SettingsDialog({ open, onClose }: Props) {
  const [mirrorPath, setMirrorPath] = useState<string | null>(null)
  const [mirrorEnabled, setMirrorEnabled] = useState(false)
  const [busy, setBusy] = useState(false)
  const [toast, setToast] = useState<ToastState | null>(null)

  // モーダルを開くたびに永続 config から現在の出力先 + 有効状態を読み直す。
  useEffect(() => {
    if (!open) return
    let cancelled = false
    loadMirrorConfig()
      .then((cfg) => {
        if (cancelled) return
        setMirrorPath(cfg.mirrorPath)
        setMirrorEnabled(cfg.mirrorEnabled)
      })
      .catch(() => {
        if (cancelled) return
        setMirrorPath(null)
        setMirrorEnabled(false)
      })
    return () => {
      cancelled = true
    }
  }, [open])

  async function handlePickFolder() {
    try {
      const picked = await pickMirrorFolder()
      if (!picked) return // キャンセル
      await saveMirrorConfig({ mirrorEnabled, mirrorPath: picked })
      setMirrorPath(picked)
      setToast({ message: '出力先フォルダを設定しました', type: 'success' })
    } catch (e) {
      console.error('[settings] フォルダ選択に失敗:', e)
      setToast({ message: 'フォルダ選択に失敗しました', type: 'error' })
    }
  }

  async function handleToggleEnabled() {
    if (!mirrorPath || busy) return
    const next = !mirrorEnabled
    setBusy(true)
    try {
      await saveMirrorConfig({ mirrorEnabled: next, mirrorPath })
      setMirrorEnabled(next)
      if (next) {
        // 有効化直後に 1 回書き出してフォルダを現状に揃える。
        await mirrorAllToFolder(mirrorPath)
        setToast({ message: '自動ミラーを有効化しました', type: 'success' })
      } else {
        setToast({ message: '自動ミラーを無効化しました', type: 'success' })
      }
    } catch (e) {
      console.error('[settings] ミラー切替に失敗:', e)
      setToast({ message: 'ミラーの切替に失敗しました', type: 'error' })
    } finally {
      setBusy(false)
    }
  }

  async function handleExportNow() {
    if (!mirrorPath || busy) return
    setBusy(true)
    try {
      const r = await mirrorAllToFolder(mirrorPath)
      setToast({
        message: `書き出しました (更新 ${r.written} / 削除 ${r.deleted})`,
        type: 'success',
      })
    } catch (e) {
      console.error('[settings] 書き出しに失敗:', e)
      setToast({ message: '書き出しに失敗しました', type: 'error' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <Modal open={open} onClose={onClose} title="設定" size="lg">
        <section className="space-y-4">
          <div>
            <h3 className="text-sm font-semibold">ローカル JSON ミラー</h3>
            <p className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">
              各マンダラートを JSON ファイルとして選択フォルダに自動で書き出します（バックアップ用）。
              ファイルは読み取り専用の控えで、アプリのデータ（DB）が引き続き正です。
            </p>
          </div>

          <div className="rounded-lg border border-neutral-200 dark:border-neutral-700 p-3">
            <div className="text-xs text-neutral-500 dark:text-neutral-400">出力先フォルダ</div>
            <div className="mt-1 break-all text-sm">
              {mirrorPath ?? <span className="text-neutral-400">未設定</span>}
            </div>
            <button
              onClick={handlePickFolder}
              disabled={busy}
              className="mt-3 text-sm font-medium text-neutral-600 dark:text-neutral-300 hover:text-neutral-800 dark:hover:text-neutral-100 border border-neutral-200 dark:border-neutral-700 hover:border-neutral-300 dark:hover:border-neutral-600 px-3 py-2 rounded-lg transition-colors disabled:opacity-50"
            >
              フォルダを選択
            </button>
            <p className="mt-2 text-xs text-neutral-400">
              ホーム / 書類 / デスクトップ / ダウンロード / ピクチャ のいずれか配下を選んでください。
            </p>
          </div>

          <div className="rounded-lg border border-neutral-200 dark:border-neutral-700 p-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-sm font-medium">自動ミラー</div>
                <div className="mt-0.5 text-xs text-neutral-500 dark:text-neutral-400">
                  編集のたびにフォルダへ自動で書き出す（一方向）
                </div>
              </div>
              <button
                onClick={handleToggleEnabled}
                disabled={!mirrorPath || busy}
                role="switch"
                aria-checked={mirrorEnabled}
                aria-label="自動ミラー"
                className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors disabled:opacity-40 ${
                  mirrorEnabled ? 'bg-neutral-800 dark:bg-neutral-200' : 'bg-neutral-300 dark:bg-neutral-700'
                }`}
              >
                <span
                  className={`inline-block h-5 w-5 transform rounded-full bg-white dark:bg-neutral-900 shadow transition-transform ${
                    mirrorEnabled ? 'translate-x-5' : 'translate-x-0.5'
                  }`}
                />
              </button>
            </div>
            <button
              onClick={handleExportNow}
              disabled={!mirrorPath || busy}
              className="mt-3 text-sm font-medium text-neutral-600 dark:text-neutral-300 hover:text-neutral-800 dark:hover:text-neutral-100 border border-neutral-200 dark:border-neutral-700 hover:border-neutral-300 dark:hover:border-neutral-600 px-3 py-2 rounded-lg transition-colors disabled:opacity-50"
            >
              今すぐ書き出す
            </button>
            <p className="mt-2 text-xs text-neutral-400">
              {mirrorPath
                ? '外部エディタでファイルを編集してもアプリには取り込まれません（一方向の控えです）。'
                : '先に出力先フォルダを選択してください。'}
            </p>
          </div>
        </section>
      </Modal>
      {toast && (
        <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />
      )}
    </>
  )
}
