import { useEffect, useState } from 'react'
import Modal from '@/components/ui/Modal'
import Toast from '@/components/ui/Toast'
import { loadVaultConfig, saveVaultConfig } from '@/lib/vault/config'
import { pickVaultFolder } from '@/lib/vault/vaultDialog'
import { exportAllToVault, flushDbToVault } from '@/lib/vault/_vaultSync'
import { useVaultStore } from '@/store/vaultStore'

type Props = {
  open: boolean
  onClose: () => void
}

type ToastState = { message: string; type: 'info' | 'success' | 'error' }

/**
 * アプリ全体の設定モーダル (Phase 2 productize)。
 *
 * 「Vault (実験的)」セクション: vault フォルダ選択 + 初回書き出し (export) + 差分 flush に加え、
 * **vaultMode トグル** (P3) で「ファイルを正にする (起動時に vault から DB を作り直す)」を切替える。
 * export/flush は DB 無改変だが、vaultMode ON は次回起動から canonical が vault に移る。
 */
export default function SettingsDialog({ open, onClose }: Props) {
  const [vaultPath, setVaultPath] = useState<string | null>(null)
  const [vaultMode, setVaultMode] = useState(false)
  const [busy, setBusy] = useState(false)
  const [toast, setToast] = useState<ToastState | null>(null)
  const setVaultStore = useVaultStore((s) => s.setVault)

  // モーダルを開くたびに永続 config から現在の vault パス + モードを読み直す。
  useEffect(() => {
    if (!open) return
    let cancelled = false
    loadVaultConfig()
      .then((cfg) => {
        if (cancelled) return
        setVaultPath(cfg.vaultPath)
        setVaultMode(cfg.vaultMode)
      })
      .catch(() => {
        if (cancelled) return
        setVaultPath(null)
        setVaultMode(false)
      })
    return () => {
      cancelled = true
    }
  }, [open])

  async function handlePickFolder() {
    try {
      const picked = await pickVaultFolder()
      if (!picked) return // キャンセル
      // 現在の vaultMode は保持したままパスだけ差し替える。
      await saveVaultConfig({ vaultMode, vaultPath: picked })
      setVaultPath(picked)
      setVaultStore({ vaultMode, vaultPath: picked })
      setToast({ message: 'vault フォルダを設定しました', type: 'success' })
    } catch (e) {
      console.error('[settings] フォルダ選択に失敗:', e)
      setToast({ message: 'フォルダ選択に失敗しました', type: 'error' })
    }
  }

  async function handleToggleVaultMode() {
    if (!vaultPath || busy) return
    const next = !vaultMode
    setBusy(true)
    try {
      if (next) {
        // ON 化の直前にベースライン flush (ファイル=DB に揃える) → 初回 flip を no-op rebuild にする。
        await flushDbToVault(vaultPath)
        await saveVaultConfig({ vaultMode: true, vaultPath })
        setVaultMode(true)
        setVaultStore({ vaultMode: true, vaultPath })
        setToast({ message: 'vault モードを有効化しました（次回起動から vault が正・クラウド同期は停止）', type: 'success' })
      } else {
        await saveVaultConfig({ vaultMode: false, vaultPath })
        setVaultMode(false)
        setVaultStore({ vaultMode: false, vaultPath })
        setToast({ message: 'vault モードを無効化しました（DB が正に戻ります）', type: 'success' })
      }
    } catch (e) {
      console.error('[settings] vaultMode 切替に失敗:', e)
      setToast({ message: 'vault モードの切替に失敗しました', type: 'error' })
    } finally {
      setBusy(false)
    }
  }

  async function handleExport() {
    if (!vaultPath || busy) return
    setBusy(true)
    try {
      const r = await exportAllToVault(vaultPath)
      setToast({
        message: `vault に書き出しました (マンダラート ${r.mandalartCount} / ファイル ${r.fileCount} / 画像 ${r.imagesCopied})`,
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
        message: `flush 完了 (書込 ${r.written} / 削除 ${r.deleted} / フォルダ削除 ${r.deletedDirs} / 画像 ${r.imagesCopied})`,
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
            フォルダ設定中は編集後に自動で vault へ反映されます（「今すぐ flush」は即時反映用）。
          </p>

          <div className="rounded-lg border border-neutral-200 dark:border-neutral-700 p-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-sm font-medium">ファイルを正にする</div>
                <div className="mt-0.5 text-xs text-neutral-500 dark:text-neutral-400">
                  起動時に vault から読み込む（vault モード）
                </div>
              </div>
              <button
                onClick={handleToggleVaultMode}
                disabled={!vaultPath || busy}
                role="switch"
                aria-checked={vaultMode}
                aria-label="ファイルを正にする（vault モード）"
                className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors disabled:opacity-40 ${
                  vaultMode ? 'bg-neutral-800 dark:bg-neutral-200' : 'bg-neutral-300 dark:bg-neutral-700'
                }`}
              >
                <span
                  className={`inline-block h-5 w-5 transform rounded-full bg-white dark:bg-neutral-900 shadow transition-transform ${
                    vaultMode ? 'translate-x-5' : 'translate-x-0.5'
                  }`}
                />
              </button>
            </div>
            <p className="mt-2 text-xs text-neutral-400">
              {vaultPath
                ? 'ON にすると vault のファイルが正になり、外部エディタ（Obsidian 等）での編集が DB に反映されます。本文の見出し（## [ ] テキスト #c/色 ^pN）を自然に編集すれば取り込まれ、アプリ起動中の編集はそのまま自動で反映されます。先にバックアップを推奨します。'
                : '先に vault フォルダを選択してください。'}
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
