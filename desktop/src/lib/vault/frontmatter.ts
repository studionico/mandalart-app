/**
 * vault ファイル共通の frontmatter コーデック (ピュア、I/O なし)。
 *
 * Phase 1 の [markdown-frontmatter.ts](../markdown-frontmatter.ts) と同じ block-scalar 方式を
 * 汎用化したもの: 各値を YAML block-scalar (`key: |-`) に **compact JSON 1 行**で格納するため、
 * JSON 内の任意文字 (`"` `:` `#` `'` 改行=`\n` エスケープ) をエスケープ不要で書ける。YAML
 * ライブラリには依存しない。`format` だけは tooling から見えるよう inline プレーン文字列で持つ。
 */

const FENCE = '---'

/**
 * frontmatter + 本文ドキュメントを組み立てる。
 * @param format `format:` に書く識別子 (改行を含まない前提)
 * @param fields block-scalar JSON で書く key→値 (object/array/string/number/null いずれも可)
 * @param body frontmatter 直後の本文 (人間可読ビュー、parse 側は読まない)
 */
export function buildDoc(format: string, fields: Record<string, unknown>, body: string): string {
  const lines: string[] = [FENCE, `format: ${format}`]
  for (const [key, value] of Object.entries(fields)) {
    lines.push(`${key}: |-`)
    lines.push(`  ${JSON.stringify(value)}`)
  }
  lines.push(FENCE, '', body)
  return lines.join('\n')
}

export type ParsedDoc = {
  format: string | null
  /** block-scalar から JSON.parse した値。キー欠損時は undefined。 */
  fields: Record<string, unknown>
  body: string
}

/**
 * buildDoc の逆。先頭 frontmatter を持たない / 壊れている場合は format=null・fields={} を返す
 * (呼び出し側で skip+warn する)。CRLF も許容。
 */
export function parseDoc(text: string): ParsedDoc {
  const normalized = text.replace(/\r\n/g, '\n')
  const lines = normalized.split('\n')
  if (lines[0]?.trim() !== FENCE) {
    return { format: null, fields: {}, body: normalized }
  }

  let close = -1
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === FENCE) {
      close = i
      break
    }
  }
  if (close === -1) return { format: null, fields: {}, body: normalized }

  const fm = lines.slice(1, close)
  const body = lines.slice(close + 1).join('\n').replace(/^\n+/, '')

  let format: string | null = null
  const fields: Record<string, unknown> = {}

  for (let i = 0; i < fm.length; i++) {
    const line = fm[i]
    const inline = line.match(/^format:\s*(.*)$/)
    if (inline) {
      format = inline[1].trim() || null
      continue
    }
    const block = line.match(/^(\w+):\s*\|-?\s*$/)
    if (block) {
      const key = block[1]
      const jsonLines: string[] = []
      let j = i + 1
      for (; j < fm.length; j++) {
        const l = fm[j]
        const hasIndent = /^\s+\S/.test(l)
        if (hasIndent) jsonLines.push(l.replace(/^\s+/, ''))
        else if (l.trim() === '') continue
        else break
      }
      i = j - 1
      const json = jsonLines.join('\n').trim()
      if (json) {
        try {
          fields[key] = JSON.parse(json)
        } catch {
          // 壊れた値はキー欠損扱い (呼び出し側で skip+warn)
        }
      }
    }
  }

  return { format, fields, body }
}
