import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { Cell as CellType } from '@/types'
import { getColorClasses, PRESET_COLORS } from '@/constants/colors'
import { CLICK_DELAY_MS } from '@/constants/timing'
import {
  CELL_BASE_FONT_PX,
  CELL_TEXT_INSET_NORMAL_PX,
  CELL_TEXT_INSET_SMALL_PX,
} from '@/constants/layout'
import { GRID_SIDE } from '@/constants/grid'
import { getCellImageUrl, uploadCellImage, deleteCellImage } from '@/lib/api/storage'
import { isCellEmpty } from '@/lib/utils/grid'

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
  userId?: string
  mandalartId?: string
  onCellSave?: (cellId: string, params: { text: string; image_path: string | null; color: string | null }) => Promise<void>
  onStartInlineEdit: (cell: CellType) => void
  onCommitInlineEdit: (cell: CellType, text: string) => void
  onInlineNavigate: (currentPosition: number, currentText: string, reverse: boolean) => void
  onDrill: (cell: CellType) => void
  onDragStart?: (cell: CellType) => void
  onContextMenu?: (e: React.MouseEvent, cell: CellType) => void
  /** 指定すると左上にチェックボックスを表示。指定なしなら非表示 (= 機能 OFF / size='small' / アニメ中)。 */
  onToggleDone?: (cell: CellType) => void
  size?: 'normal' | 'small'
  /** 外側ラッパー div に追加するスタイル (アニメーション制御用) */
  wrapperStyle?: React.CSSProperties
}

const DRAG_THRESHOLD = 5   // ドラッグ判定の移動距離（px）
const CLICK_DELAY = CLICK_DELAY_MS    // single vs double click 判定 (ms)

export default function Cell({
  cell, isCenter, isDisabled, isCut, isDragSource, isDragOver, childCount, fontScale,
  isInlineEditing, userId, mandalartId, onCellSave,
  onStartInlineEdit, onCommitInlineEdit, onInlineNavigate,
  onDrill,
  onDragStart, onContextMenu, onToggleDone,
  size = 'normal',
  wrapperStyle,
}: Props) {
  const clickTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const didDrag    = useRef(false)

  // unmount 時に pending な CLICK_DELAY timer を必ずクリアする。
  // Cell は 9〜81 個生成されるので、未クリアだと ⌘Q 時に大量の pending timer が残留し
  // renderer 側の参照保持で window close が遅延する原因になる。
  useEffect(() => {
    return () => {
      if (clickTimer.current) {
        clearTimeout(clickTimer.current)
        clickTimer.current = null
      }
    }
  }, [])
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const cellRef = useRef<HTMLDivElement>(null)
  const { bg, text: textColor } = getColorClasses(cell.color)
  const [imageUrl, setImageUrl] = useState<string | null>(null)
  const [draftText, setDraftText] = useState(cell.text)
  // インライン編集中にテキストエリアをダブルクリックすると 3×3 サイズに拡大表示する
  const [expandedRect, setExpandedRect] = useState<{ top: number; left: number; width: number; height: number } | null>(null)
  const isExpanded = expandedRect !== null

  // 拡大エディタ用の色・画像ローカル state (編集中の暫定値。保存時に onCellSave で伝播)
  const [editingColor, setEditingColor] = useState<string | null>(cell.color)
  const [editingImagePath, setEditingImagePath] = useState<string | null>(cell.image_path)
  const [editingImageUrl, setEditingImageUrl] = useState<string | null>(null)
  const [uploadingImage, setUploadingImage] = useState(false)

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

  // インライン編集が終わったら拡大状態を解除
  useEffect(() => {
    if (!isInlineEditing && expandedRect) setExpandedRect(null)
  }, [isInlineEditing, expandedRect])

  // インライン編集に入るたびに拡大エディタ用のローカル state を cell の値で初期化
  useEffect(() => {
    if (isInlineEditing) {
      setEditingColor(cell.color)
      setEditingImagePath(cell.image_path)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isInlineEditing])

  // editingImagePath から blob URL を解決 (拡大エディタのプレビュー用)
  useEffect(() => {
    let cancelled = false
    if (!editingImagePath) {
      setEditingImageUrl(null)
      return
    }
    getCellImageUrl(editingImagePath).then((url) => {
      if (!cancelled) setEditingImageUrl(url || null)
    })
    return () => { cancelled = true }
  }, [editingImagePath])

  async function handleSelectColor(newColor: string | null) {
    setEditingColor(newColor)
    if (onCellSave) {
      await onCellSave(cell.id, {
        text: draftText,
        image_path: editingImagePath,
        color: newColor,
      })
    }
    setTimeout(() => textareaRef.current?.focus(), 0)
  }

  async function handleUploadImage(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file || !userId || !mandalartId || !onCellSave) return
    setUploadingImage(true)
    try {
      if (editingImagePath) await deleteCellImage(editingImagePath).catch(() => {})
      const path = await uploadCellImage(userId, mandalartId, cell.id, file)
      setEditingImagePath(path)
      await onCellSave(cell.id, {
        text: draftText,
        image_path: path,
        color: editingColor,
      })
    } finally {
      setUploadingImage(false)
      setTimeout(() => textareaRef.current?.focus(), 0)
    }
  }

  async function handleRemoveImage() {
    if (!onCellSave) return
    if (editingImagePath) await deleteCellImage(editingImagePath).catch(() => {})
    setEditingImagePath(null)
    await onCellSave(cell.id, {
      text: draftText,
      image_path: null,
      color: editingColor,
    })
    setTimeout(() => textareaRef.current?.focus(), 0)
  }

  function handleTextareaDoubleClick(e: React.MouseEvent<HTMLTextAreaElement>) {
    e.stopPropagation()
    if (isExpanded) {
      // 拡大中にもう一度ダブルクリックされたら元のサイズに戻す
      setExpandedRect(null)
      setTimeout(() => textareaRef.current?.focus(), 0)
      return
    }
    const cellEl = cellRef.current
    if (!cellEl) return
    const gridEl = cellEl.closest('[data-grid-container]') as HTMLElement | null
    if (!gridEl) return
    const rect = gridEl.getBoundingClientRect()
    setExpandedRect({ top: rect.top, left: rect.left, width: rect.width, height: rect.height })
    // state 更新後に textarea を再フォーカスし直す (blur で編集終了しないように)
    setTimeout(() => textareaRef.current?.focus(), 0)
  }

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

  // セルが空かどうか (text も image も無い)
  const isEmpty = !cell.text.trim() && !cell.image_path

  function handleClick() {
    if (isDisabled || didDrag.current) return
    if (isInlineEditing) return // 編集中は click ハンドラを発火させない（textarea 側に任せる）

    if (isEmpty) {
      // 空セル: シングルクリックで即編集開始。ダブルクリックは無視
      // (2 回目のクリックは「既に編集中」扱いで textarea にフォーカスが残る)
      if (clickTimer.current) {
        clearTimeout(clickTimer.current)
        clickTimer.current = null
        return
      }
      onStartInlineEdit(cell)
      // ダブルクリック検知ウィンドウ中の追加クリックを飲み込むだけのタイマー
      clickTimer.current = setTimeout(() => { clickTimer.current = null }, CLICK_DELAY)
      return
    }

    // 入力ありセル: シングル = ドリル / ダブル = 編集
    if (clickTimer.current) {
      clearTimeout(clickTimer.current)
      clickTimer.current = null
      // 2 回目のクリック = ダブルクリック → インライン編集
      onStartInlineEdit(cell)
    } else {
      clickTimer.current = setTimeout(() => {
        clickTimer.current = null
        // 単一クリック確定 → ドリル
        onDrill(cell)
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

  // 表示テキストを内側の絶対配置 div でラップし、その内側だけを overflow-hidden する。
  // こうすることでセル外周には常に一定の余白が残り、長文が溢れても上下左右の
  // 見えている余白が均等になる。
  //
  // 注意: `position: absolute` は親の padding-box (= border の内側) を基準に配置される
  // ため、border の太さが違うセル同士で inset を固定値にすると「セル外縁からテキストまで
  // の見た目の余白」が border 幅の分だけズレてしまう。それを避けるため、border 幅で補正
  // して「セル外縁からテキストまでの距離」を全セルで共通値にする。
  //
  // 目標余白 (セル外縁からテキストまで): 3×3 (normal) = 12px, 9×9 (small) = 4px
  // ダッシュボードのカード (border 2px + p-3 = 14px) と同程度のゆとりを目指す
  const borderPx = size === 'small'
    ? (isCenter ? 2 : 0)
    : isCenter
      ? 6
      : childCount > 0
        ? 2
        : 1
  const targetPadPx = size === 'small' ? CELL_TEXT_INSET_SMALL_PX : CELL_TEXT_INSET_NORMAL_PX
  const textInsetPx = Math.max(0, targetPadPx - borderPx)
  // チェックボックス表示条件 (下の JSX と揃える)。trueの場合はテキスト上端を
  // チェックボックス (top-2=8px + size 16px + 4px margin ≒ 28px) まで下げて
  // 重なりを避ける。
  const showCheckbox = !!onToggleDone && !isInlineEditing && size !== 'small' && !isCellEmpty(cell)
  const CHECKBOX_BOTTOM_PX = 28
  const topInsetPx = showCheckbox ? Math.max(textInsetPx, CHECKBOX_BOTTOM_PX - borderPx) : textInsetPx
  const textInsetStyle: React.CSSProperties = {
    top: `${topInsetPx}px`,
    right: `${textInsetPx}px`,
    bottom: `${textInsetPx}px`,
    left: `${textInsetPx}px`,
  }

  // 9×9 表示のセルは 3×3 表示の約 1/GRID_SIDE の幅しかないので、
  // 同じテキストが同じ行数で読めるようフォントも 1/GRID_SIDE に縮小する
  const baseFontPx = size === 'small' ? CELL_BASE_FONT_PX / GRID_SIDE : CELL_BASE_FONT_PX
  const fontStyle: React.CSSProperties = { fontSize: `${baseFontPx * fontScale}px`, lineHeight: 1.25 }

  return (
    <div
      ref={cellRef}
      data-cell-id={cell.id}
      data-grid-id={cell.grid_id}
      data-position={cell.position}
      style={wrapperStyle}
      className={`
        relative select-none overflow-hidden
        min-h-0 min-w-0
        transition-shadow transition-colors
        ${bg}
        ${isCenter
          ? size === 'small'
            ? 'rounded-md border-2 border-black dark:border-white -m-px z-10'
            : 'rounded-lg border-[6px] border-black dark:border-white shadow-md'
          : size === 'small'
            ? ''
            : childCount > 0
              ? 'rounded-lg border-2 border-black dark:border-gray-300 shadow-sm'
              : 'rounded-lg border border-gray-300 dark:border-gray-700 shadow-sm'
        }
        ${isDisabled ? 'cursor-not-allowed' : 'cursor-pointer hover:shadow-md'}
        ${isCut || isDragSource ? 'opacity-40' : ''}
        ${isDragOver && !isDisabled ? 'ring-2 ring-blue-400 ring-offset-1' : ''}
        group
      `}
      onMouseDown={handleMouseDown}
      onClick={handleClick}
      onContextMenu={onContextMenu ? (e) => { e.preventDefault(); onContextMenu(e, cell) } : undefined}
    >
      {/* チェックボックス (トグル ON + 非編集中 + 3×3 サイズ + 入力ありセルのみ表示)
          16×16 の角丸四角。チェック時は白背景 + 黒の ✓ が出る。
          セルクリック (ドリル / 編集) と干渉させないよう onMouseDown/onClick は stopPropagation。
          ({cell.done && ...} だと done=0 (integer) の時に React が "0" をそのまま
          描画する罠があるので、三項演算子で null を返すか、論理反転 !!cell.done を使うこと) */}
      {showCheckbox && (
        <button
          type="button"
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => { e.stopPropagation(); onToggleDone!(cell) }}
          className={`absolute top-2 left-2 z-20 w-4 h-4 rounded border flex items-center justify-center transition-colors ${
            cell.done
              ? 'bg-black dark:bg-white border-black dark:border-white'
              : 'bg-white dark:bg-gray-900 border-gray-400 dark:border-gray-500 hover:border-gray-700 dark:hover:border-gray-300'
          }`}
          title={cell.done ? 'チェック済 (クリックで解除)' : '未チェック (クリックで完了)'}
          aria-label={cell.done ? 'done' : 'not done'}
        >
          {cell.done ? (
            <svg viewBox="0 0 16 16" className="w-3 h-3 text-white dark:text-black" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="3 8 7 12 13 4" />
            </svg>
          ) : null}
        </button>
      )}

      {imageUrl && (
        <div className="absolute inset-0 overflow-hidden">
          <img src={imageUrl} alt="" className="w-full h-full object-cover" />
        </div>
      )}

      {isInlineEditing && isExpanded && expandedRect ? (
        // 拡大エディタ: textarea + 背景色/画像ツールバー
        <div
          className={`fixed z-[100] flex flex-col border-[3px] border-black dark:border-white rounded-xl shadow-2xl overflow-hidden ${getColorClasses(editingColor).bg}`}
          style={{
            top: expandedRect.top,
            left: expandedRect.left,
            width: expandedRect.width,
            height: expandedRect.height,
          }}
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
          onContextMenu={(e) => e.stopPropagation()}
        >
          {/* 背景画像 (エリアいっぱい、不透明) */}
          {editingImageUrl && (
            <div className="absolute inset-0 overflow-hidden pointer-events-none">
              <img src={editingImageUrl} alt="" className="w-full h-full object-cover" />
            </div>
          )}
          <textarea
            ref={textareaRef}
            value={draftText}
            onChange={(e) => setDraftText(e.target.value)}
            onBlur={commitDraft}
            onKeyDown={handleTextareaKeyDown}
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
            onDoubleClick={handleTextareaDoubleClick}
            style={{ fontSize: '22px', lineHeight: 1.5 }}
            className={`relative z-10 flex-1 min-h-0 text-left bg-transparent resize-none outline-none overflow-auto p-5 ${getColorClasses(editingColor).text} placeholder-gray-300`}
            placeholder=""
          />
          {/* ツールバー (onMouseDown で focus 移譲を阻止し、textarea のフォーカスを維持) */}
          <div
            onMouseDown={(e) => e.preventDefault()}
            className="relative z-10 shrink-0 border-t border-gray-200 dark:border-gray-700 bg-white/90 dark:bg-gray-900/90 backdrop-blur px-3 py-2 flex items-center gap-3 flex-wrap"
          >
            {/* カラーピッカー */}
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => handleSelectColor(null)}
                className={`w-6 h-6 rounded-full border-2 bg-white ${editingColor === null ? 'border-blue-500 scale-110' : 'border-gray-300 dark:border-gray-600'} transition-transform`}
                title="デフォルト"
              />
              {PRESET_COLORS.map((c) => (
                <button
                  key={c.key}
                  type="button"
                  onClick={() => handleSelectColor(c.key)}
                  className={`w-6 h-6 rounded-full border-2 ${c.bg} ${editingColor === c.key ? 'border-blue-500 scale-110' : 'border-gray-300 dark:border-gray-600'} transition-transform`}
                  title={c.label}
                />
              ))}
            </div>

            {/* 画像 */}
            <div className="flex items-center gap-2 ml-auto">
              {editingImageUrl ? (
                <button
                  type="button"
                  onClick={handleRemoveImage}
                  className="text-xs text-red-500 hover:text-red-700 dark:hover:text-red-400 border border-red-300 dark:border-red-700 rounded px-2 py-1 hover:bg-red-50 dark:hover:bg-red-900/20"
                  title="画像を削除"
                >
                  画像を削除
                </button>
              ) : (
                <label className="cursor-pointer text-xs text-gray-600 dark:text-gray-300 border border-gray-300 dark:border-gray-600 rounded px-2 py-1 hover:bg-gray-100 dark:hover:bg-gray-700 select-none">
                  {uploadingImage ? 'アップロード中...' : '画像を追加'}
                  <input
                    type="file"
                    accept="image/*"
                    onChange={handleUploadImage}
                    className="hidden"
                    disabled={uploadingImage || !userId || !mandalartId}
                  />
                </label>
              )}
            </div>
          </div>
        </div>
      ) : isInlineEditing ? (
        <textarea
          ref={textareaRef}
          value={draftText}
          onChange={(e) => setDraftText(e.target.value)}
          onBlur={commitDraft}
          onKeyDown={handleTextareaKeyDown}
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
          onDoubleClick={handleTextareaDoubleClick}
          style={{ ...fontStyle, ...textInsetStyle }}
          className={`absolute z-10 w-auto h-auto text-left leading-tight bg-transparent resize-none outline-none overflow-auto ${textColor} placeholder-gray-300`}
          placeholder=""
        />
      ) : imageUrl ? (
        // 画像があるセルは画像のみを表示 (テキストは非表示)。
        // 画像レイヤーは上で <div className="absolute inset-0"> として既に描画済み。
        null
      ) : (
        <div style={textInsetStyle} className="absolute z-10 flex items-start overflow-hidden">
          <span
            style={fontStyle}
            className={`block w-full text-left leading-tight break-all whitespace-pre-wrap ${textColor}`}
          >
            {cell.text}
          </span>
        </div>
      )}

    </div>
  )
}
