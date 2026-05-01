import { useEffect, useState } from 'react'
import Modal from '@/components/ui/Modal'
import Button from '@/components/ui/Button'
import {
  getDeletedMandalarts, restoreMandalart, permanentDeleteMandalart,
} from '@/lib/api/mandalarts'
import { useTwoClickConfirm, useTwoClickConfirmKey } from '@/hooks/useTwoClickConfirm'
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
  // busy: 'all' = 全削除中、string (id) = 個別操作中
  const [busy, setBusy] = useState<string | null>(null)
  // Tauri v2 の WebView は window.confirm が動作しないため、2 クリック方式で確認する (落とし穴 #7)。
  // 個別 / 全削除はそれぞれ独立に arm され、CONFIRM_AUTO_RESET_MS で自動解除。
  const idConfirm = useTwoClickConfirmKey<string>()
  const allConfirm = useTwoClickConfirm()

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
    // 閉じたら confirm 状態もリセット (idConfirm.reset / allConfirm.reset は useCallback で stable)
    if (!open) {
      idConfirm.reset()
      allConfirm.reset()
    }
  }, [open, idConfirm, allConfirm])

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
    if (!idConfirm.isArmed(m.id)) {
      idConfirm.arm(m.id)
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
      idConfirm.reset()
    }
  }

  async function handleDeleteAll() {
    // 1 回目: confirm 状態へ
    if (!allConfirm.armed) {
      allConfirm.arm()
      return
    }
    // 2 回目: 全件削除
    setBusy('all')
    const targets = [...items]
    setItems([]) // 楽観的 UI
    try {
      const results = await Promise.allSettled(
        targets.map((m) => permanentDeleteMandalart(m.id)),
      )
      const failed = results.filter((r) => r.status === 'rejected')
      if (failed.length > 0) {
        console.warn(`[emptyTrash] ${failed.length} 件の完全削除が失敗しました`)
        // 失敗分を一覧に戻すため再取得
        await load()
      }
      onChange()
    } finally {
      setBusy(null)
      allConfirm.reset()
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="ゴミ箱" size="lg">
      {loading ? (
        <p className="text-sm text-neutral-400 text-center py-6">読み込み中...</p>
      ) : items.length === 0 ? (
        <p className="text-sm text-neutral-400 text-center py-6">ゴミ箱は空です</p>
      ) : (
        <>
          {/* すべて削除ボタン (件数付き、2 クリック確認) */}
          <div className="flex justify-end mb-3">
            <Button
              variant="danger"
              size="sm"
              onClick={handleDeleteAll}
              disabled={busy !== null}
              title={allConfirm.armed ? 'もう一度押すとすべて完全削除されます' : 'ゴミ箱のすべてのアイテムを完全削除'}
            >
              {allConfirm.armed
                ? `本当に全削除? (${items.length}件)`
                : `すべて削除 (${items.length}件)`}
            </Button>
          </div>
          <div className="flex flex-col gap-2 max-h-[60vh] overflow-y-auto">
            {items.map((m) => (
              <div
                key={m.id}
                className="flex items-center gap-3 border border-neutral-200 rounded-xl p-3"
              >
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-neutral-800 truncate">
                    {m.title || '無題'}
                  </p>
                  <p className="text-xs text-neutral-400 mt-0.5">
                    削除日時: {m.deleted_at ? new Date(m.deleted_at).toLocaleString('ja-JP') : '?'}
                  </p>
                </div>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => handleRestore(m)}
                  disabled={busy !== null}
                >
                  復元
                </Button>
                <Button
                  variant="danger"
                  size="sm"
                  onClick={() => handlePermanentDelete(m)}
                  disabled={busy !== null}
                  title={idConfirm.isArmed(m.id) ? 'もう一度押すと完全削除されます' : '完全削除 (取り消せません)'}
                >
                  {idConfirm.isArmed(m.id) ? '本当に削除?' : '完全削除'}
                </Button>
              </div>
            ))}
          </div>
        </>
      )}

      <div className="flex justify-end mt-4 border-t border-neutral-100 pt-4">
        <Button variant="ghost" onClick={onClose}>閉じる</Button>
      </div>
    </Modal>
  )
}
