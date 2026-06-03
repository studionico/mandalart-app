import { useEffect, useState } from 'react'
import Modal from '@/components/ui/Modal'
import Toast from '@/components/ui/Toast'
import { loadVaultConfig, saveVaultConfig } from '@/lib/vault/config'
import { pickVaultFolder } from '@/lib/vault/vaultDialog'
import { exportAllToVault, flushDbToVault } from '@/lib/vault/_vaultSync'

type Props = {
  open: boolean
  onClose: () => void
}

type ToastState = { message: string; type: 'info' | 'success' | 'error' }

/**
 * アプリ全体の設定モーダル (Phase 2 productize P1)。
 *
 * 現状は「Vault (実験的)」セクションのみ: vault フォルダ選択 + 初回書き出し (export) +
 * 差分 flush。**いずれも DB は無改変・ファイルのみ書く非破壊操作**で、DB は引き続き
 * このアプリが正 (canonical)。`vaultMode` は false 固定で、起動時に vault から DB を
 * 作り直す移行は本フェーズでは行わない (P3 で対応)。
 */
export default function SettingsDialog({ open, onClose }: Props) {
  const [vaultPath, setVaultPath] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [toast, setToast] = useState<ToastState | null>(null)

  // モーダルを開くたびに永続 config から現在の vault パスを読み直す。
  useEffect(() => {
    if (!open) return
    let cancelled = false
    loadVaultConfig()
      .then((cfg) => {
        if (!cancelled) setVaultPath(cfg.vaultPath)
      })
      .catch(() => {
        if (!cancelled) setVaultPath(null)
      })
    return () => {
      cancelled = true
    }
  }, [open])

  async function handlePickFolder() {
    try {
      const picked = await pickVaultFolder()
      if (!picked) return // キャンセル
      // P1 では vaultMode は立てない (canonical 反転しない)。パスのみ永続化。
      await saveVaultConfig({ vaultMode: false, vaultPath: picked })
      setVaultPath(picked)
      setToast({ message: 'vault フォルダを設定しました', type: 'success' })
    } catch (e) {
      console.error('[settings] フォルダ選択に失敗:', e)
      setToast({ message: 'フォルダ選択に失敗しました', type: 'error' })
    }
  }

  async function handleExport() {
    if (!vaultPath || busy) return
    setBusy(true)
    try {
      const r = await exportAllToVault(vaultPath)
      setToast({
        message: `vault に書き出しました (マンダラート ${r.mandalartCount} / ファイル ${r.fileCount})`,
        type: 'success',
      })
    } catch (e) {
      console.error('[settings] export に失敗:', e)
      setToast({ message: '書き出しに失敗しました', type: 'error' })
    } finally {
      setBusy(false)
    }
  }

  async function handleFlush() {
    if (!vaultPath || busy) return
    setBusy(true)
    try {
      const r = await flushDbToVault(vaultPath)
      setToast({
        message: `flush 完了 (書込 ${r.written} / 削除 ${r.deleted} / フォルダ削除 ${r.deletedDirs})`,
        type: 'success',
      })
    } catch (e) {
      console.error('[settings] flush に失敗:', e)
      setToast({ message: 'flush に失敗しました', type: 'error' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <Modal open={open} onClose={onClose} title="設定" size="lg">
        <section className="space-y-4">
          <div>
            <h3 className="text-sm font-semibold">Vault（実験的）</h3>
            <p className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">
              マンダラートを Markdown ファイルとしてフォルダに書き出します。ファイルは vault に
              書き出されますが、アプリのデータ（DB）は引き続きこのアプリが正です。
            </p>
          </div>

          <div className="rounded-lg border border-neutral-200 dark:border-neutral-700 p-3">
            <div className="text-xs text-neutral-500 dark:text-neutral-400">vault フォルダ</div>
            <div className="mt-1 break-all text-sm">
              {vaultPath ?? <span className="text-neutral-400">未設定</span>}
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

          <div className="flex flex-wrap gap-2">
            <button
              onClick={handleExport}
              disabled={!vaultPath || busy}
              className="text-sm font-medium text-neutral-600 dark:text-neutral-300 hover:text-neutral-800 dark:hover:text-neutral-100 border border-neutral-200 dark:border-neutral-700 hover:border-neutral-300 dark:hover:border-neutral-600 px-3 py-2 rounded-lg transition-colors disabled:opacity-50"
            >
              vault に書き出す（初回）
            </button>
            <button
              onClick={handleFlush}
              disabled={!vaultPath || busy}
              className="text-sm font-medium text-neutral-600 dark:text-neutral-300 hover:text-neutral-800 dark:hover:text-neutral-100 border border-neutral-200 dark:border-neutral-700 hover:border-neutral-300 dark:hover:border-neutral-600 px-3 py-2 rounded-lg transition-colors disabled:opacity-50"
            >
              今すぐ flush（差分）
            </button>
          </div>

          <p className="text-xs text-neutral-400">
            ファイルを正にする（vault から起動する）移行は今後対応します。
          </p>
        </section>
      </Modal>
      {toast && (
        <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />
      )}
    </>
  )
}
