
import { useState, useEffect, useCallback } from 'react'
import { updateGridMemo } from '@/lib/api/grids'

type Props = {
  gridId: string | null
  initialMemo: string | null
}

export default function MemoTab({ gridId, initialMemo }: Props) {
  const [memo, setMemo] = useState(initialMemo ?? '')
  // 既定はプレビュー表示。編集したいときだけ「編集」タブに切り替える運用にしてマンダラート
  // 表示中の視認性を優先する
  const [preview, setPreview] = useState(true)
  const [saving, setSaving] = useState(false)
  const [showCheatSheet, setShowCheatSheet] = useState(false)

  useEffect(() => {
    setMemo(initialMemo ?? '')
  }, [gridId, initialMemo])

  // gridId 変更 (別グリッド遷移) 時は既定の「プレビュー」モードに戻す。
  // MemoTab は SidePanel の条件分岐で同じインスタンスが使い回されるため、
  // 初期値だけだと preview state が前のグリッドのまま残ってしまう。
  useEffect(() => {
    setPreview(true)
    setShowCheatSheet(false)
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
        <div className="flex items-center gap-2">
          {saving && <span className="text-xs text-gray-400">保存中...</span>}
          {/* Markdown 記法ヘルプ (編集モードのみ表示)。`?` クリックで下部にチートシートを展開 */}
          {!preview && (
            <button
              type="button"
              onClick={() => setShowCheatSheet((v) => !v)}
              className={`w-5 h-5 rounded border text-[10px] font-bold flex items-center justify-center transition-colors ${
                showCheatSheet
                  ? 'bg-blue-600 border-blue-600 text-white'
                  : 'bg-white dark:bg-gray-900 border-gray-400 dark:border-gray-500 text-gray-500 hover:border-gray-700 dark:hover:border-gray-300'
              }`}
              title={showCheatSheet ? 'Markdown 記法ヘルプを閉じる' : 'Markdown 記法ヘルプを表示'}
              aria-label="toggle markdown cheat sheet"
              aria-pressed={showCheatSheet}
            >
              ?
            </button>
          )}
        </div>
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
        <>
          <textarea
            value={memo}
            onChange={(e) => setMemo(e.target.value)}
            placeholder="Markdown でメモを書く..."
            // textarea は cols 属性のデフォルト (~20ch) で intrinsic 幅を持つので w-full を明示
            className="flex-1 w-full text-sm resize-none border border-gray-200 rounded-lg p-2 focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono"
          />
          {showCheatSheet && <MarkdownCheatSheet />}
        </>
      )}
    </div>
  )
}

/**
 * `renderMarkdown` がサポートしている記法だけを載せた最小チートシート。
 * 表記揺れを防ぐため、ここに無いものはアプリ側でも render されない (renderMarkdown と対で更新する)。
 */
function MarkdownCheatSheet() {
  const rows: Array<{ syntax: string; label: string }> = [
    { syntax: '# テキスト', label: '見出し (大)' },
    { syntax: '## テキスト', label: '見出し (中)' },
    { syntax: '### テキスト', label: '見出し (小)' },
    { syntax: '**テキスト**', label: '太字' },
    { syntax: '*テキスト*', label: '斜体' },
    { syntax: '- 項目', label: '箇条書き' },
  ]
  return (
    <div className="shrink-0 text-[11px] border border-gray-200 dark:border-gray-700 rounded-lg p-2 bg-gray-50 dark:bg-gray-800">
      <div className="text-gray-500 dark:text-gray-400 mb-1 font-medium">Markdown 記法</div>
      <ul className="space-y-0.5">
        {rows.map((r) => (
          <li key={r.syntax} className="flex items-center gap-2">
            <code className="font-mono text-gray-800 dark:text-gray-200 whitespace-nowrap">
              {r.syntax}
            </code>
            <span className="text-gray-500 dark:text-gray-400">→ {r.label}</span>
          </li>
        ))}
      </ul>
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
