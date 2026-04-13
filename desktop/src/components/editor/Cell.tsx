import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { Cell as CellType } from '@/types'
import { getColorClasses } from '@/constants/colors'
import { getCellImageUrl } from '@/lib/api/storage'

type Props = {
  cell: CellType
  isCenter: boolean
  isDisabled: boolean
  isCut: boolean
  isDragSource: boolean  // ドラッグ中のセル（半透明）
  isDragOver: boolean    // ドロップ候補（リングハイライト）
  childCount: number
  fontScale: number
  isInlineEditing: boolean
  onStartInlineEdit: (cell: CellType) => void
  onCommitInlineEdit: (cell: CellType, text: string) => void
  onInlineNavigate: (currentPosition: number, currentText: string, reverse: boolean) => void
  onDrill: (cell: CellType) => void
  onOpenModal: (cell: CellType) => void
  onDragStart?: (cell: CellType) => void
  onContextMenu?: (e: React.MouseEvent, cell: CellType) => void
  size?: 'normal' | 'small'
}

const DRAG_THRESHOLD = 5   // ドラッグ判定の移動距離（px）
const CLICK_DELAY = 220    // single vs double click 判定 (ms)

export default function Cell({
  cell, isCenter, isDisabled, isCut, isDragSource, isDragOver, childCount, fontScale,
  isInlineEditing, onStartInlineEdit, onCommitInlineEdit, onInlineNavigate,
  onDrill, onOpenModal,
  onDragStart, onContextMenu,
  size = 'normal',
}: Props) {
  const clickTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const didDrag    = useRef(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const { bg, text: textColor } = getColorClasses(cell.color)
  const [imageUrl, setImageUrl] = useState<string | null>(null)
  const [draftText, setDraftText] = useState(cell.text)

  // 画像読み込み
  useEffect(() => {
    let cancelled = false
    if (!cell.image_path) {
      setImageUrl(null)
      return
    }
    getCellImageUrl(cell.image_path).then((url) => {
      if (!cancelled) setImageUrl(url || null)
    })
    return () => { cancelled = true }
  }, [cell.image_path])

  // 編集モードに入ったら textarea にフォーカス + 末尾にカーソル + ドラフトを初期化
  useLayoutEffect(() => {
    if (isInlineEditing) {
      setDraftText(cell.text)
      const el = textareaRef.current
      if (el) {
        el.focus()
        const len = cell.text.length
        try { el.setSelectionRange(len, len) } catch { /* ignore */ }
      }
    }
  }, [isInlineEditing, cell.text])

  function handleMouseDown(e: React.MouseEvent) {
    if (isDisabled || e.button !== 0) return
    // 既に編集中ならテキスト選択を阻害しない
    if (isInlineEditing) return

    const startX = e.clientX
    const startY = e.clientY
    didDrag.current = false

    function onMove(e2: MouseEvent) {
      const dx = e2.clientX - startX
      const dy = e2.clientY - startY
      if (!didDrag.current && Math.sqrt(dx * dx + dy * dy) > DRAG_THRESHOLD) {
        didDrag.current = true
        document.removeEventListener('mousemove', onMove)
        document.removeEventListener('mouseup',   onUp)
        onDragStart?.(cell)
      }
    }

    function onUp() {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup',   onUp)
    }

    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup',   onUp)
  }

  function handleClick() {
    if (isDisabled || didDrag.current) return
    if (isInlineEditing) return // 編集中は click ハンドラを発火させない（textarea 側に任せる）

    if (clickTimer.current) {
      clearTimeout(clickTimer.current)
      clickTimer.current = null
      // 2 回目のクリック = ダブルクリック → ドリル
      onDrill(cell)
    } else {
      clickTimer.current = setTimeout(() => {
        clickTimer.current = null
        // 単一クリック確定 → インライン編集モードへ
        onStartInlineEdit(cell)
      }, CLICK_DELAY)
    }
  }

  function commitDraft() {
    if (draftText !== cell.text) {
      onCommitInlineEdit(cell, draftText)
    } else {
      // 変更がなくても編集モードを抜ける必要があるので空 commit を送る
      onCommitInlineEdit(cell, draftText)
    }
  }

  function handleTextareaKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    // IME 変換中は無視
    if (e.nativeEvent.isComposing) return

    if (e.key === 'Escape') {
      e.preventDefault()
      commitDraft()
      return
    }
    if (e.key === 'Tab') {
      e.preventDefault()
      // commit してから親に navigate を依頼。
      // navigate 側は中央セルの空判定に「今入力した値」を使う必要があるので draftText を渡す。
      onCommitInlineEdit(cell, draftText)
      onInlineNavigate(cell.position, draftText, e.shiftKey)
      return
    }
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault()
      commitDraft()
      return
    }
  }

  const sizeClasses = size === 'small' ? 'p-0.5' : 'p-1.5'
  const baseFontPx = size === 'small' ? 18 : 28
  const fontStyle: React.CSSProperties = { fontSize: `${baseFontPx * fontScale}px`, lineHeight: 1.25 }

  return (
    <div
      data-cell-id={cell.id}
      // align-items: safe center → 内容がセル内に収まるときは中央、はみ出すときは
      // 上揃えにフォールバック。これによりテキストの先頭は常にセル内に表示される。
      style={{ alignItems: 'safe center' }}
      className={`
        relative flex justify-center rounded-lg border select-none overflow-hidden
        min-h-0 min-w-0
        transition-shadow transition-colors
        ${sizeClasses}
        ${bg}
        ${isCenter ? 'border-blue-400 dark:border-blue-500 border-2 font-semibold shadow-md' : 'border-gray-300 dark:border-gray-700 shadow-sm'}
        ${isDisabled ? 'opacity-30 cursor-not-allowed' : 'cursor-pointer hover:shadow-md hover:border-gray-400 dark:hover:border-gray-500'}
        ${isCut || isDragSource ? 'opacity-40' : ''}
        ${isDragOver && !isDisabled ? 'ring-2 ring-blue-400 ring-offset-1' : ''}
        ${isInlineEditing ? 'ring-2 ring-blue-500' : ''}
        group
      `}
      onMouseDown={handleMouseDown}
      onClick={handleClick}
      onContextMenu={onContextMenu ? (e) => { e.preventDefault(); onContextMenu(e, cell) } : undefined}
    >
      {imageUrl && (
        <div className="absolute inset-0 rounded-lg overflow-hidden">
          <img src={imageUrl} alt="" className="w-full h-full object-cover opacity-60" />
        </div>
      )}

      {isInlineEditing ? (
        <textarea
          ref={textareaRef}
          value={draftText}
          onChange={(e) => setDraftText(e.target.value)}
          onBlur={commitDraft}
          onKeyDown={handleTextareaKeyDown}
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
          style={fontStyle}
          className={`absolute inset-1 z-10 w-auto h-auto text-center leading-tight bg-transparent resize-none outline-none overflow-auto ${textColor} placeholder-gray-300`}
          placeholder=""
        />
      ) : (
        <span
          style={fontStyle}
          className={`relative z-10 text-center leading-tight break-all line-clamp-3 ${textColor}`}
        >
          {cell.text}
        </span>
      )}

      {/* 詳細モーダルを開くボタン (hover 時のみ表示) */}
      {!isInlineEditing && !isDisabled && (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onOpenModal(cell) }}
          onMouseDown={(e) => e.stopPropagation()}
          className="absolute top-0.5 right-0.5 w-4 h-4 rounded-full bg-white/80 dark:bg-gray-800/80 border border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400 text-xs leading-none flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity hover:bg-white dark:hover:bg-gray-800 hover:text-gray-700 dark:hover:text-gray-200 z-20"
          title="詳細編集 (色 / 画像 / 長文)"
        >
          ⋯
        </button>
      )}

      {childCount > 0 && (
        <span className="absolute bottom-0.5 right-0.5 w-1.5 h-1.5 bg-blue-400 rounded-full" />
      )}
    </div>
  )
}
