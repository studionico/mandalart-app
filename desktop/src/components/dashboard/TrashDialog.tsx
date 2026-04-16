import { useEffect, useState } from 'react'
import Modal from '@/components/ui/Modal'
import Button from '@/components/ui/Button'
import {
  getDeletedMandalarts, restoreMandalart, permanentDeleteMandalart,
} from '@/lib/api/mandalarts'
import { CONFIRM_AUTO_RESET_MS } from '@/constants/timing'
import type { Mandalart } from '@/types'

type Props = {
  open: boolean
  onClose: () => void
  /** 復元 / 完全削除で一覧に変更があった場合に親へ通知 */
  onChange: () => void
}

export default function TrashDialog({ open, onClose, onChange }: Props) {
  const [items, setItems] = useState<Mandalart[]>([])
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  // Tauri v2 の WebView は window.confirm が動作しないため、2 クリック方式で確認する。
  // 1 回目のクリックで confirmingId を立ててボタン表記を「本当に削除?」に切替え、
  // 2 回目のクリックで実削除。CONFIRM_AUTO_RESET_MS ms 放置したら自動解除。
  const [confirmingId, setConfirmingId] = useState<string | null>(null)

  async function load() {
    setLoading(true)
    try {
      setItems(await getDeletedMandalarts())
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (open) load()
    // 閉じたら confirm 状態もリセット
    if (!open) setConfirmingId(null)
  }, [open])

  // confirm 状態は 4 秒で自動解除
  useEffect(() => {
    if (!confirmingId) return
    const t = setTimeout(() => setConfirmingId(null), CONFIRM_AUTO_RESET_MS)
    return () => clearTimeout(t)
  }, [confirmingId])

  async function handleRestore(m: Mandalart) {
    setBusy(m.id)
    try {
      await restoreMandalart(m.id)
      setItems((prev) => prev.filter((x) => x.id !== m.id))
      onChange()
    } finally {
      setBusy(null)
    }
  }

  async function handlePermanentDelete(m: Mandalart) {
    // 1 回目: confirm 状態へ
    if (confirmingId !== m.id) {
      setConfirmingId(m.id)
      return
    }
    // 2 回目: 実削除
    setBusy(m.id)
    try {
      await permanentDeleteMandalart(m.id)
      setItems((prev) => prev.filter((x) => x.id !== m.id))
      onChange()
    } finally {
      setBusy(null)
      setConfirmingId(null)
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="ゴミ箱" size="lg">
      {loading ? (
        <p className="text-sm text-gray-400 text-center py-6">読み込み中...</p>
      ) : items.length === 0 ? (
        <p className="text-sm text-gray-400 text-center py-6">ゴミ箱は空です</p>
      ) : (
        <div className="flex flex-col gap-2 max-h-[60vh] overflow-y-auto">
          {items.map((m) => (
            <div
              key={m.id}
              className="flex items-center gap-3 border border-gray-200 rounded-xl p-3"
            >
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-gray-800 truncate">
                  {m.title || '無題'}
                </p>
                <p className="text-xs text-gray-400 mt-0.5">
                  削除日時: {m.deleted_at ? new Date(m.deleted_at).toLocaleString('ja-JP') : '?'}
                </p>
              </div>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => handleRestore(m)}
                disabled={busy === m.id}
              >
                復元
              </Button>
              <Button
                variant="danger"
                size="sm"
                onClick={() => handlePermanentDelete(m)}
                disabled={busy === m.id}
                title={confirmingId === m.id ? 'もう一度押すと完全削除されます' : '完全削除 (取り消せません)'}
              >
                {confirmingId === m.id ? '本当に削除?' : '完全削除'}
              </Button>
            </div>
          ))}
        </div>
      )}

      <div className="flex justify-end mt-4 border-t border-gray-100 pt-4">
        <Button variant="ghost" onClick={onClose}>閉じる</Button>
      </div>
    </Modal>
  )
}
