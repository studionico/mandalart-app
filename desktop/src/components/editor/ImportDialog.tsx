import { useState } from 'react'
import Modal from '@/components/ui/Modal'
import Button from '@/components/ui/Button'
import type { GridSnapshot } from '@/types'
import { parseTextToSnapshot, importFromJSON, importIntoCell } from '@/lib/api/transfer'
import { CENTER_POSITION, PERIPHERAL_POSITIONS } from '@/constants/grid'

type Mode =
  | { kind: 'new' }
  | { kind: 'cell'; cellId: string; cellLabel: string }

type Props = {
  open: boolean
  mode: Mode
  onClose: () => void
  onComplete: (result: { mandalartId?: string }) => void
}

type ParseResult =
  | { ok: true; snapshot: GridSnapshot }
  | { ok: false; error: string }

/**
 * インポートダイアログ
 * ① テキスト入力 or ファイル選択 or クリップボード貼付
 * ② 自動でフォーマット判定（JSON / Markdown / インデントテキスト）
 * ③ パース結果をツリープレビュー
 * ④ 実行（新規マンダラート / 既存セル配下）
 */
export default function ImportDialog({ open, mode, onClose, onComplete }: Props) {
  const [rawText, setRawText] = useState('')
  const [parsed, setParsed] = useState<ParseResult | null>(null)
  const [running, setRunning] = useState(false)

  function reset() {
    setRawText('')
    setParsed(null)
    setRunning(false)
  }

  function handleClose() {
    reset()
    onClose()
  }

  function tryParse(text: string): ParseResult {
    const trimmed = text.trim()
    if (!trimmed) return { ok: false, error: 'テキストを入力してください' }

    // JSON と判定できる場合は JSON パースを試す
    if (trimmed.startsWith('{')) {
      try {
        const obj = JSON.parse(trimmed) as unknown
        if (!isGridSnapshot(obj)) {
          return { ok: false, error: 'JSON の構造が GridSnapshot ではありません' }
        }
        return { ok: true, snapshot: obj }
      } catch (e) {
        return { ok: false, error: `JSON のパースに失敗: ${(e as Error).message}` }
      }
    }

    // それ以外はインデントテキスト / Markdown としてパース
    try {
      const snapshot = parseTextToSnapshot(trimmed)
      if (snapshot.cells.length === 0 && snapshot.children.length === 0) {
        return { ok: false, error: 'パース結果が空です' }
      }
      return { ok: true, snapshot }
    } catch (e) {
      return { ok: false, error: `パース失敗: ${(e as Error).message}` }
    }
  }

  function handlePreview() {
    setParsed(tryParse(rawText))
  }

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    const text = await file.text()
    setRawText(text)
    setParsed(tryParse(text))
  }

  async function handlePasteClipboard() {
    try {
      const text = await navigator.clipboard.readText()
      setRawText(text)
      setParsed(tryParse(text))
    } catch (e) {
      setParsed({ ok: false, error: `クリップボード読み取り失敗: ${(e as Error).message}` })
    }
  }

  async function handleExecute() {
    if (!parsed || !parsed.ok) return
    setRunning(true)
    try {
      if (mode.kind === 'new') {
        const m = await importFromJSON(parsed.snapshot)
        onComplete({ mandalartId: m.id })
      } else {
        await importIntoCell(mode.cellId, parsed.snapshot)
        onComplete({})
      }
      reset()
    } catch (e) {
      setParsed({ ok: false, error: `インポート失敗: ${(e as Error).message}` })
    } finally {
      setRunning(false)
    }
  }

  const title = mode.kind === 'new'
    ? 'インポート（新規マンダラート）'
    : `インポート → ${mode.cellLabel}`

  return (
    <Modal open={open} onClose={handleClose} title={title} size="xl">
      <div className="flex flex-col gap-4">
        {/* 入力方法 */}
        <div className="flex gap-2">
          <label className="flex-1">
            <span className="sr-only">ファイルを選択</span>
            <input
              type="file"
              accept=".json,.md,.txt,text/plain,application/json,text/markdown"
              onChange={handleFile}
              className="block w-full text-xs text-gray-700 dark:text-gray-300 file:mr-3 file:py-2 file:px-3 file:rounded-lg file:border-0 file:bg-gray-100 dark:file:bg-gray-800 file:text-gray-700 dark:file:text-gray-200 hover:file:bg-gray-200 dark:hover:file:bg-gray-700 file:cursor-pointer"
            />
          </label>
          <Button variant="secondary" size="sm" onClick={handlePasteClipboard}>
            クリップボードから貼付
          </Button>
        </div>

        {/* テキスト入力エリア */}
        <div>
          <label className="text-xs text-gray-500 dark:text-gray-400 mb-1 block">
            または直接貼り付け（JSON / Markdown 見出し / インデントテキスト）
          </label>
          <textarea
            value={rawText}
            onChange={(e) => setRawText(e.target.value)}
            rows={8}
            placeholder={EXAMPLE_PLACEHOLDER}
            className="w-full text-sm font-mono border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 rounded-lg p-3 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-y"
          />
          <div className="flex justify-end mt-2">
            <Button size="sm" variant="secondary" onClick={handlePreview} disabled={!rawText.trim()}>
              プレビュー
            </Button>
          </div>
        </div>

        {/* プレビュー */}
        {parsed && (
          <div className="border-t border-gray-100 dark:border-gray-800 pt-4">
            {parsed.ok ? (
              <>
                <p className="text-xs text-gray-500 dark:text-gray-400 mb-2">プレビュー（インポートされる構造）</p>
                <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-3 max-h-64 overflow-y-auto">
                  <SnapshotPreview snapshot={parsed.snapshot} />
                </div>
              </>
            ) : (
              <p className="text-sm text-red-500">{parsed.error}</p>
            )}
          </div>
        )}

        {/* 実行ボタン */}
        <div className="flex justify-end gap-2 border-t border-gray-100 dark:border-gray-800 pt-4">
          <Button variant="ghost" onClick={handleClose}>キャンセル</Button>
          <Button
            onClick={handleExecute}
            disabled={!parsed?.ok || running}
          >
            {running ? '実行中...' : '実行'}
          </Button>
        </div>
      </div>
    </Modal>
  )
}

function SnapshotPreview({ snapshot, depth = 0 }: { snapshot: GridSnapshot; depth?: number }) {
  const center = snapshot.cells.find((c) => c.position === CENTER_POSITION)
  // 周辺セルを position 順に並べて表示 (中心は除く)
  const peripherals = PERIPHERAL_POSITIONS
    .map((pos) => snapshot.cells.find((c) => c.position === pos))
    .filter((c): c is NonNullable<typeof c> => !!c && c.text.trim() !== '')

  // 子を attach 先ごとに分類
  const subgridsByPos = new Map<number, GridSnapshot[]>()
  const parallelSiblings: GridSnapshot[] = []
  for (const child of snapshot.children) {
    if (child.parentPosition === undefined) {
      parallelSiblings.push(child)
    } else {
      const arr = subgridsByPos.get(child.parentPosition) ?? []
      arr.push(child)
      subgridsByPos.set(child.parentPosition, arr)
    }
  }

  const marker = depth === 0
    ? '◆'
    : snapshot.parentPosition === undefined
      ? '≈'  // parallel grid
      : '▸'  // subgrid

  return (
    <div className="text-xs" style={{ paddingLeft: depth * 12 }}>
      <div className="font-medium text-gray-700 dark:text-gray-200">
        {marker} {center?.text || '(空)'}
      </div>
      {peripherals.length > 0 && (
        <ul className="ml-4 mt-0.5 text-gray-500 dark:text-gray-400 space-y-0.5">
          {peripherals.map((c) => {
            const subs = subgridsByPos.get(c.position) ?? []
            return (
              <li key={c.position}>
                <div className="truncate">• {c.text}</div>
                {subs.length > 0 && (
                  <div className="ml-3 mt-0.5">
                    {subs.map((sub, i) => (
                      <SnapshotPreview key={i} snapshot={sub} depth={depth + 1} />
                    ))}
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}
      {parallelSiblings.map((sib, i) => (
        <SnapshotPreview key={`para-${i}`} snapshot={sib} depth={depth} />
      ))}
    </div>
  )
}

// GridSnapshot かどうかの最小限のチェック
function isGridSnapshot(obj: unknown): obj is GridSnapshot {
  if (typeof obj !== 'object' || obj === null) return false
  const o = obj as Record<string, unknown>
  return Array.isArray(o.cells) && Array.isArray(o.children) && typeof o.grid === 'object'
}

const EXAMPLE_PLACEHOLDER = `例 (Markdown):
# 目標
## 健康
### 食事
### 運動
## 仕事

または (インデントテキスト):
目標
  健康
    食事
    運動
  仕事`
