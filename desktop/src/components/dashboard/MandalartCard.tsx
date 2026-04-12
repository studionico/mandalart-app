
import { useNavigate } from 'react-router-dom'
import { useState } from 'react'
import type { Mandalart, Cell } from '@/types'
import { deleteMandalart, updateMandalartTitle } from '@/lib/api/mandalarts'
import Modal from '@/components/ui/Modal'
import Button from '@/components/ui/Button'

type Props = {
  mandalart: Mandalart
  previewCells: Cell[]
  onDeleted: (id: string) => void
  onUpdated: (m: Mandalart) => void
}

export default function MandalartCard({ mandalart, previewCells, onDeleted, onUpdated }: Props) {
  const navigate = useNavigate()
  const [renameOpen, setRenameOpen] = useState(false)
  const [renameValue, setRenameValue] = useState(mandalart.title)
  const [menuOpen, setMenuOpen] = useState(false)

  function handleOpen() {
    navigate(`/mandalart/${mandalart.id}`)
  }

  async function handleDelete() {
    if (!confirm('このマンダラートを削除しますか？')) return
    await deleteMandalart(mandalart.id)
    onDeleted(mandalart.id)
  }

  async function handleDuplicate() {
    // TODO: 複製機能は未実装
  }

  async function handleRename() {
    await updateMandalartTitle(mandalart.id, renameValue)
    onUpdated({ ...mandalart, title: renameValue })
    setRenameOpen(false)
  }

  const cellMap = new Map(previewCells.map((c) => [c.position, c]))

  return (
    <>
      <div
        className="bg-white border border-gray-200 rounded-2xl p-4 hover:shadow-md transition-shadow cursor-pointer relative"
        onClick={handleOpen}
      >
        {/* ミニプレビュー 3×3 */}
        <div className="grid grid-cols-3 gap-0.5 mb-3 aspect-square">
          {Array.from({ length: 9 }).map((_, i) => {
            const cell = cellMap.get(i)
            return (
              <div
                key={i}
                className={`rounded-sm flex items-center justify-center text-[6px] overflow-hidden p-0.5 ${
                  i === 4 ? 'bg-blue-100' : 'bg-gray-100'
                }`}
              >
                {cell?.text && (
                  <span className="truncate text-gray-700 leading-tight">{cell.text}</span>
                )}
              </div>
            )
          })}
        </div>

        <p className="font-medium text-sm truncate">{mandalart.title || '（タイトルなし）'}</p>
        <p className="text-xs text-gray-400 mt-0.5">
          {new Date(mandalart.updated_at).toLocaleDateString('ja-JP')}
        </p>

        {/* 3点メニュー */}
        <button
          onClick={(e) => { e.stopPropagation(); setMenuOpen((v) => !v) }}
          className="absolute top-3 right-3 p-1 rounded-lg hover:bg-gray-100 text-gray-400"
        >
          ···
        </button>

        {menuOpen && (
          <div
            className="absolute top-8 right-3 bg-white border border-gray-200 rounded-xl shadow-lg z-10 text-sm min-w-[120px]"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              onClick={() => { setRenameOpen(true); setMenuOpen(false) }}
              className="w-full text-left px-4 py-2 hover:bg-gray-50 rounded-t-xl"
            >
              リネーム
            </button>
            <button
              onClick={() => { handleDuplicate(); setMenuOpen(false) }}
              className="w-full text-left px-4 py-2 hover:bg-gray-50"
            >
              複製
            </button>
            <button
              onClick={() => { handleDelete(); setMenuOpen(false) }}
              className="w-full text-left px-4 py-2 hover:bg-gray-50 text-red-600 rounded-b-xl"
            >
              削除
            </button>
          </div>
        )}
      </div>

      <Modal open={renameOpen} onClose={() => setRenameOpen(false)} title="タイトルを変更">
        <input
          type="text"
          value={renameValue}
          onChange={(e) => setRenameValue(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') handleRename() }}
          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm mb-4 focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setRenameOpen(false)}>キャンセル</Button>
          <Button onClick={handleRename}>保存</Button>
        </div>
      </Modal>
    </>
  )
}
