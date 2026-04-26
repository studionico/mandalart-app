import { useEffect, useState } from 'react'
import Modal from '@/components/ui/Modal'
import Button from '@/components/ui/Button'

type Props = {
  open: boolean
  /** ターゲットセルの簡易情報 (確認文言に使用) */
  targetText?: string
  onCancel: () => void
  onConfirm: () => void | Promise<void>
}

/**
 * ストック → 入力ありの周辺セルへの drop 時に表示する置換確認ダイアログ。
 *
 * 1 クリックで上書きを実行 (キャンセル可)。
 * 上書き対象は「ターゲットセル本体 + ターゲットを drill 元とするサブグリッド全体」。
 */
export default function ReplaceConfirmDialog({ open, targetText, onCancel, onConfirm }: Props) {
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!open) setBusy(false)
  }, [open])

  async function handleConfirm() {
    setBusy(true)
    try {
      await onConfirm()
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal open={open} onClose={onCancel} title="セルを上書きしますか？" size="sm">
      <div className="flex flex-col gap-4">
        <p className="text-sm text-gray-700 dark:text-gray-300">
          ターゲットセル
          {targetText ? <span className="font-semibold">「{targetText}」</span> : ''}
          とそのサブグリッド全体を破棄して、ストックの内容で上書きします。
        </p>
        <p className="text-xs text-gray-500 dark:text-gray-400">
          ※ 上書きされた内容は元に戻せません。
        </p>
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="secondary" size="sm" onClick={onCancel} disabled={busy}>
            キャンセル
          </Button>
          <Button variant="danger" size="sm" onClick={handleConfirm} disabled={busy}>
            上書きする
          </Button>
        </div>
      </div>
    </Modal>
  )
}
