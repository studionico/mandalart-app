import { useEffect, useState } from 'react'
import Modal from '@/components/ui/Modal'
import Button from '@/components/ui/Button'
import { WarningIcon } from '@/components/ui/icons'

type Props = {
  open: boolean
  onCancel: () => void
  onConfirm: () => void | Promise<void>
}

/**
 * 中心セル右クリックの「周辺セルのクリア」で表示される確認ダイアログ。
 *
 * 周辺 8 セルとその配下サブグリッドを一括クリアする (中心セルは残る)。1 クリックで実行 (キャンセル可)。
 * Undo 非対象なので、シュレッダーと同様に「元に戻せません」と明示する。
 */
export default function ClearPeripheralsConfirmDialog({ open, onCancel, onConfirm }: Props) {
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
    <Modal open={open} onClose={onCancel} title="周辺セルをクリアしますか？" size="sm">
      <div className="flex flex-col gap-4">
        <p className="text-sm text-neutral-700 dark:text-neutral-300">
          このグリッドの周辺 8 セルとその配下のサブグリッドをすべてクリアします。中心セルは残ります。
        </p>
        <p className="text-xs text-neutral-900 dark:text-neutral-100 font-bold flex items-center gap-1">
          <WarningIcon className="w-3.5 h-3.5 shrink-0" />
          この操作は元に戻せません。
        </p>
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="secondary" size="sm" onClick={onCancel} disabled={busy}>
            キャンセル
          </Button>
          <Button variant="danger" size="sm" onClick={handleConfirm} disabled={busy}>
            クリアする
          </Button>
        </div>
      </div>
    </Modal>
  )
}
