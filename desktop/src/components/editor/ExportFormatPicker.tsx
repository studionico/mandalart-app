import Modal from '@/components/ui/Modal'
import Button from '@/components/ui/Button'

export type ExportFormat = 'json' | 'markdown' | 'indent'

type Props = {
  open: boolean
  /** 元セルの簡易ラベル (タイトル表示用) */
  targetText?: string
  onCancel: () => void
  onPick: (format: ExportFormat) => void | Promise<void>
}

/**
 * エクスポートアイコンへの drop 後に表示する形式選択 popup。
 *
 * - JSON: GridSnapshot をそのまま JSON 化 (構造を完全保持)
 * - Markdown: 見出しベースの round-trip 可能な形式
 * - Indent: スペース 2 文字インデントの round-trip 可能な形式
 */
export default function ExportFormatPicker({ open, targetText, onCancel, onPick }: Props) {
  return (
    <Modal open={open} onClose={onCancel} title="エクスポート形式を選択" size="sm">
      <div className="flex flex-col gap-4">
        <p className="text-sm text-gray-700 dark:text-gray-300">
          {targetText ? <span className="font-semibold">「{targetText}」</span> : '対象セル'}
          配下のサブグリッドをファイルとして書き出します。
        </p>
        <div className="flex flex-col gap-2">
          <Button variant="primary" size="md" onClick={() => onPick('json')}>
            JSON （構造を完全保持）
          </Button>
          <Button variant="secondary" size="md" onClick={() => onPick('markdown')}>
            Markdown （見出し階層）
          </Button>
          <Button variant="secondary" size="md" onClick={() => onPick('indent')}>
            インデントテキスト
          </Button>
        </div>
        <div className="flex justify-end pt-1">
          <Button variant="ghost" size="sm" onClick={onCancel}>キャンセル</Button>
        </div>
      </div>
    </Modal>
  )
}
