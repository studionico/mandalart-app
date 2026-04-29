import { useEffect, useState } from 'react'
import Modal from '@/components/ui/Modal'
import Button from '@/components/ui/Button'

type Props = {
  open: boolean
  /** ターゲットセルの簡易情報 (確認文言に使用) */
  targetText?: string
  /** 配下サブグリッド数のヒント (任意。文言内の警告強度に使う) */
  childrenCount?: number
  /** primary root center セルの場合は文言を「マンダラート全体を削除」に切り替える */
  isPrimaryRoot?: boolean
  onCancel: () => void
  onConfirm: () => void | Promise<void>
}

/**
 * シュレッダーアイコンへの drop で表示される確認ダイアログ。
 *
 * セルとサブグリッド全体を **完全削除** する。1 クリックで実行 (キャンセル可)。
 * primary root の中心セルへの shred はマンダラート全体の削除を意味するので、文言を切り替える。
 */
export default function ShredConfirmDialog({
  open, targetText, childrenCount, isPrimaryRoot, onCancel, onConfirm,
}: Props) {
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

  const title = isPrimaryRoot ? 'マンダラートを削除しますか？' : '完全に削除しますか？'

  return (
    <Modal open={open} onClose={onCancel} title={title} size="sm">
      <div className="flex flex-col gap-4">
        <p className="text-sm text-neutral-700 dark:text-neutral-300">
          {isPrimaryRoot ? (
            <>
              マンダラート
              {targetText ? <span className="font-semibold">「{targetText}」</span> : ''}
              全体を完全に削除します（ダッシュボードからも消えます）。
            </>
          ) : (
            <>
              セル
              {targetText ? <span className="font-semibold">「{targetText}」</span> : ''}
              とその配下のサブグリッド
              {childrenCount && childrenCount > 0 ? `（${childrenCount} 件のサブグリッド）` : ''}
              を完全に削除します。
            </>
          )}
        </p>
        <p className="text-xs text-red-600 dark:text-red-400">
          ※ この操作は元に戻せません。
        </p>
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="secondary" size="sm" onClick={onCancel} disabled={busy}>
            キャンセル
          </Button>
          <Button variant="danger" size="sm" onClick={handleConfirm} disabled={busy}>
            削除する
          </Button>
        </div>
      </div>
    </Modal>
  )
}
