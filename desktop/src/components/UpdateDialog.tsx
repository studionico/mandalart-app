import Modal from '@/components/ui/Modal'
import Button from '@/components/ui/Button'
import type { UpdateStatus } from '@/hooks/useAppUpdate'

type Props = {
  status: UpdateStatus
  onInstall: () => void
  onDismiss: () => void
}

export default function UpdateDialog({ status, onInstall, onDismiss }: Props) {
  // 'available' / 'downloading' / 'installed' / 'error' の時だけ表示
  // 'idle' / 'checking' / 'none' / 'error'(設定未完了) は非表示
  const visible =
    status.kind === 'available' ||
    status.kind === 'downloading' ||
    status.kind === 'installed'

  if (!visible) return null

  return (
    <Modal open onClose={onDismiss} title="アップデートが利用可能">
      {status.kind === 'available' && (
        <div className="flex flex-col gap-4">
          <div className="text-sm">
            <p className="font-medium">新しいバージョン {status.update.version} が利用できます</p>
            {status.update.body && (
              <pre className="mt-3 text-xs text-gray-600 bg-gray-50 rounded-lg p-3 max-h-40 overflow-y-auto whitespace-pre-wrap">
                {status.update.body}
              </pre>
            )}
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={onDismiss}>後で</Button>
            <Button onClick={onInstall}>ダウンロードしてインストール</Button>
          </div>
        </div>
      )}

      {status.kind === 'downloading' && (
        <div className="flex flex-col gap-3">
          <p className="text-sm">ダウンロード中... {status.progress}%</p>
          <div className="w-full h-2 bg-gray-100 rounded-full overflow-hidden">
            <div
              className="h-full bg-blue-500 transition-all"
              style={{ width: `${status.progress}%` }}
            />
          </div>
        </div>
      )}

      {status.kind === 'installed' && (
        <div className="flex flex-col gap-3">
          <p className="text-sm">インストール完了。再起動しています...</p>
        </div>
      )}
    </Modal>
  )
}
