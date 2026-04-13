import { useEffect, useState } from 'react'
import Modal from '@/components/ui/Modal'
import Button from '@/components/ui/Button'
import {
  getDeletedMandalarts, restoreMandalart, permanentDeleteMandalart,
} from '@/lib/api/mandalarts'
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
  }, [open])

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
    if (!window.confirm(`「${m.title || '無題'}」を完全に削除しますか？この操作は取り消せません。`)) return
    setBusy(m.id)
    try {
      await permanentDeleteMandalart(m.id)
      setItems((prev) => prev.filter((x) => x.id !== m.id))
      onChange()
    } finally {
      setBusy(null)
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
              >
                完全削除
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
