
import { useState, useEffect, useCallback } from 'react'
import { updateGridMemo } from '@/lib/api/grids'

type Props = {
  gridId: string | null
  initialMemo: string | null
}

/**
 * `renderMarkdown` がサポートしている記法だけを並べたチートシート。
 * textarea の placeholder に表示するために多行文字列で構築する。
 * 表記揺れを防ぐため、ここに無いものはアプリ側でも render されない (renderMarkdown と対で更新する)。
 */
const MEMO_PLACEHOLDER = [
  'Markdown でメモを書く...',
  '',
  '# テキスト       → 見出し (大)',
  '## テキスト      → 見出し (中)',
  '### テキスト     → 見出し (小)',
  '**テキスト**     → 太字',
  '*テキスト*       → 斜体',
  '- 項目           → 箇条書き',
].join('\n')

export default function MemoTab({ gridId, initialMemo }: Props) {
  const [memo, setMemo] = useState(initialMemo ?? '')
  // 既定はプレビュー表示。編集したいときだけ「編集」タブに切り替える運用にしてマンダラート
  // 表示中の視認性を優先する
  const [preview, setPreview] = useState(true)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    setMemo(initialMemo ?? '')
  }, [gridId, initialMemo])

  // gridId 変更 (別グリッド遷移) 時は既定の「プレビュー」モードに戻す。
  // MemoTab は SidePanel の条件分岐で同じインスタンスが使い回されるため、
  // 初期値だけだと preview state が前のグリッドのまま残ってしまう。
  useEffect(() => {
    setPreview(true)
  }, [gridId])

  const save = useCallback(
    async (value: string) => {
      if (!gridId) return
      setSaving(true)
      try {
        await updateGridMemo(gridId, value)
      } finally {
        setSaving(false)
      }
    },
    [gridId],
  )

  // debounce 保存
  useEffect(() => {
    if (!gridId) return
    const timer = setTimeout(() => save(memo), 800)
    return () => clearTimeout(timer)
  }, [memo, save, gridId])

  return (
    <div className="flex flex-col h-full gap-2">
      <div className="flex items-center justify-between gap-2">
        <div className="flex gap-1">
          <button
            onClick={() => setPreview(false)}
            className={`text-xs px-2 py-1 rounded-md transition-colors ${!preview ? 'bg-gray-200 font-medium' : 'hover:bg-gray-100 text-gray-500'}`}
          >
            編集
          </button>
          <button
            onClick={() => setPreview(true)}
            className={`text-xs px-2 py-1 rounded-md transition-colors ${preview ? 'bg-gray-200 font-medium' : 'hover:bg-gray-100 text-gray-500'}`}
          >
            プレビュー
          </button>
        </div>
        {saving && <span className="text-xs text-gray-400">保存中...</span>}
      </div>

      {preview ? (
        <div
          // edit / preview / stock の 3 タブで横幅が揃って見えるよう、prose の max-width 制約を
          // 解除して w-full で SidePanel 親要素 (w-72) の内幅にフィットさせる。
          // break-words で長い URL や英単語を折り返して intrinsic 幅を抑える
          className="prose prose-sm w-full max-w-none flex-1 overflow-y-auto break-words"
          dangerouslySetInnerHTML={{ __html: renderMarkdown(memo) }}
        />
      ) : (
        <textarea
          value={memo}
          onChange={(e) => setMemo(e.target.value)}
          placeholder={MEMO_PLACEHOLDER}
          // textarea は cols 属性のデフォルト (~20ch) で intrinsic 幅を持つので w-full を明示。
          // placeholder を多行で表示するため whitespace-pre-line を当てて改行を保つ
          // (textarea の placeholder は \n を改行として描画するが、念のため明示)
          className="flex-1 w-full text-sm resize-none border border-gray-200 rounded-lg p-2 focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono whitespace-pre-line"
        />
      )}
    </div>
  )
}

// 簡易 Markdown レンダラー（最小限）
function renderMarkdown(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/^### (.+)$/gm, '<h3 class="text-sm font-semibold mt-2">$1</h3>')
    .replace(/^## (.+)$/gm, '<h2 class="text-base font-semibold mt-3">$1</h2>')
    .replace(/^# (.+)$/gm, '<h1 class="text-lg font-bold mt-4">$1</h1>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/^- (.+)$/gm, '<li class="ml-4 list-disc">$1</li>')
    .replace(/\n/g, '<br/>')
}
