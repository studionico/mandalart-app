import type { GridSnapshot } from '@/types'

/**
 * Markdown ロスレス形式 (Phase 1)。
 *
 * 方式: frontmatter (YAML) に GridSnapshot 全体を compact JSON で保持し、本文の `#` 見出しは
 * 人間可読ビュー (export のたびに再生成) とする。インポートは frontmatter を信頼し本文を読まない。
 * これにより memo / color / image_path / done / 空セルの位置 / 6 階層超のネスト / 並列グリッドが
 * JSON 経路と同等にロスレス往復する (本文レンダリングの制約が往復に影響しない)。
 *
 * 実装メモ:
 *  - `data` は YAML block-scalar (`|-`) に **JSON 1 行**を 2 スペース字下げで格納する。block-scalar は
 *    内容をリテラル扱いするので JSON 内の `"` `:` `#` `'` をエスケープ不要で書ける。JSON.stringify は
 *    改行を `\n` (リテラル) にエスケープするため物理的な改行は混ざらず、常に 1 行に収まる。
 *  - YAML ライブラリには依存せず、frontmatter 領域と `data:` キーの抽出だけを自前で行う
 *    (両プラットフォームで既存の JSON コーデックを再利用するため)。Obsidian からは普通の property
 *    として読める valid YAML になっている。
 */
export const MD_LOSSLESS_FORMAT = 'md-lossless-v1'

const FENCE = '---'

/** GridSnapshot を md-lossless-v1 の frontmatter ブロックに直列化する (末尾の閉じ `---` まで)。 */
export function buildFrontmatter(snapshot: GridSnapshot): string {
  const json = JSON.stringify(snapshot)
  return [FENCE, `mandalart_format: ${MD_LOSSLESS_FORMAT}`, 'data: |-', `  ${json}`, FENCE].join('\n')
}

/**
 * 先頭が md-lossless-v1 frontmatter なら GridSnapshot を復元する。該当しなければ `null`
 * (呼び出し側は従来の JSON / parseTextToSnapshot にフォールバックする)。
 */
export function extractFrontmatterSnapshot(text: string): GridSnapshot | null {
  const lines = text.replace(/\r\n/g, '\n').split('\n')
  if (lines[0]?.trim() !== FENCE) return null

  // 閉じ fence を探す
  let close = -1
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === FENCE) {
      close = i
      break
    }
  }
  if (close === -1) return null

  const fm = lines.slice(1, close)
  const dataIdx = fm.findIndex((l) => l.trim() === 'data: |-' || l.trim() === 'data: |')
  if (dataIdx === -1) return null

  // data: の後ろの字下げ行 (block-scalar 本文) を集める
  const jsonLines: string[] = []
  for (let i = dataIdx + 1; i < fm.length; i++) {
    const l = fm[i]
    if (/^\s+\S/.test(l)) jsonLines.push(l.replace(/^\s+/, ''))
    else if (l.trim() === '') continue
    else break
  }
  const json = jsonLines.join('\n').trim()
  if (!json) return null

  try {
    const obj = JSON.parse(json) as unknown
    if (!isGridSnapshotShape(obj)) return null
    return obj as GridSnapshot
  } catch {
    return null
  }
}

/** GridSnapshot の最小限の構造チェック (ImportDialog の isGridSnapshot と同等)。 */
function isGridSnapshotShape(obj: unknown): obj is GridSnapshot {
  if (typeof obj !== 'object' || obj === null) return false
  const o = obj as Record<string, unknown>
  return Array.isArray(o.cells) && Array.isArray(o.children) && typeof o.grid === 'object'
}
