
import { useState, useEffect, useRef, useCallback } from 'react'
import Modal from '@/components/ui/Modal'
import BottomSheet from '@/components/ui/BottomSheet'
import Button from '@/components/ui/Button'
import { PRESET_COLORS } from '@/constants/colors'
import { nextTabPosition } from '@/constants/tabOrder'
import { CENTER_POSITION } from '@/constants/grid'
import type { Cell } from '@/types'
import { uploadCellImage, getCellImageUrl, deleteCellImage } from '@/lib/api/storage'

type Props = {
  cell: Cell | null
  allCells?: Cell[]
  userId: string
  mandalartId: string
  onSave: (cellId: string, params: { text: string; image_path: string | null; color: string | null }) => Promise<void>
  onClose: () => void
  onNavigate: (position: number) => void  // Tab ナビゲーション
  isMobile: boolean
}

export default function CellEditModal({
  cell, userId, mandalartId, onSave, onClose, onNavigate, isMobile,
}: Props) {
  const [text, setText] = useState('')
  const [imagePath, setImagePath] = useState<string | null>(null)
  const [imageUrl, setImageUrl] = useState<string | null>(null)
  const [color, setColor] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const textRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (!cell) return
    setText(cell.text)
    setImagePath(cell.image_path)
    setColor(cell.color)

    if (cell.image_path) {
      getCellImageUrl(cell.image_path).then(setImageUrl).catch(() => setImageUrl(null))
    } else {
      setImageUrl(null)
    }

    setTimeout(() => textRef.current?.focus(), 50)
  }, [cell])

  // 保存のみ（モーダルは閉じない）
  const saveCell = useCallback(async () => {
    if (!cell) return
    await onSave(cell.id, { text, image_path: imagePath, color })
  }, [cell, text, imagePath, color, onSave])

  // 保存して閉じる
  const handleSave = useCallback(async () => {
    await saveCell()
    onClose()
  }, [saveCell, onClose])

  async function handleImageUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file || !cell) return
    setUploading(true)
    try {
      if (imagePath) await deleteCellImage(imagePath).catch(() => {})
      const path = await uploadCellImage(userId, mandalartId, cell.id, file)
      const url = await getCellImageUrl(path)
      setImagePath(path)
      setImageUrl(url)
    } finally {
      setUploading(false)
    }
  }

  async function handleImageRemove() {
    if (imagePath) await deleteCellImage(imagePath).catch(() => {})
    setImagePath(null)
    setImageUrl(null)
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      handleSave()
      return
    }

    if (e.key === 'Tab') {
      // IME変換中（日本語変換候補選択など）は無視
      if (e.nativeEvent.isComposing) return

      e.preventDefault()
      if (!cell) return

      // 中心セルが空（入力中のテキストも含めて）なら移動しない
      if (cell.position === CENTER_POSITION && !text.trim() && !imagePath) return

      // 現在のセルを保存してから次へ移動
      saveCell().then(() => {
        const nextPos = nextTabPosition(cell.position, e.shiftKey)
        onNavigate(nextPos)
      })
    }
  }

  const content = cell ? (
    <div className="flex flex-col gap-4">
      <div>
        <label className="block text-xs font-medium text-gray-500 mb-1.5">テキスト</label>
        <textarea
          ref={textRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          rows={3}
          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-blue-500"
          placeholder="テキストを入力..."
        />
      </div>

      <div>
        <label className="block text-xs font-medium text-gray-500 mb-1.5">画像</label>
        {imageUrl ? (
          <div className="relative inline-block">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={imageUrl} alt="" className="h-24 w-24 object-cover rounded-lg border border-gray-200" />
            <button
              onClick={handleImageRemove}
              className="absolute -top-1.5 -right-1.5 bg-red-500 text-white rounded-full w-5 h-5 flex items-center justify-center text-xs"
            >
              ×
            </button>
          </div>
        ) : (
          <label className="flex items-center gap-2 cursor-pointer">
            <div className="border border-dashed border-gray-300 rounded-lg px-4 py-2.5 text-sm text-gray-500 hover:bg-gray-50 transition-colors">
              {uploading ? 'アップロード中...' : '画像をアップロード'}
            </div>
            <input type="file" accept="image/*" onChange={handleImageUpload} className="hidden" disabled={uploading} />
          </label>
        )}
      </div>

      <div>
        <label className="block text-xs font-medium text-gray-500 mb-1.5">背景色</label>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => setColor(null)}
            className={`w-7 h-7 rounded-full border-2 bg-white ${color === null ? 'border-blue-500 scale-110' : 'border-gray-200'} transition-transform`}
            title="デフォルト"
          />
          {PRESET_COLORS.map((c) => (
            <button
              key={c.key}
              onClick={() => setColor(c.key)}
              className={`w-7 h-7 rounded-full border-2 ${c.bg} ${color === c.key ? 'border-blue-500 scale-110' : 'border-gray-200'} transition-transform`}
              title={c.label}
            />
          ))}
        </div>
      </div>

      <div className="flex justify-end gap-2 pt-1">
        <Button variant="secondary" onClick={onClose}>キャンセル</Button>
        <Button onClick={handleSave}>確定</Button>
      </div>
    </div>
  ) : null

  if (isMobile) {
    return (
      <BottomSheet open={!!cell} onClose={handleSave} title="セルを編集">
        {content}
      </BottomSheet>
    )
  }

  return (
    <Modal open={!!cell} onClose={handleSave} title="セルを編集">
      {content}
    </Modal>
  )
}
