import type { Cell } from '@/types'
import { CENTER_POSITION } from '@/constants/grid'

/**
 * 中心セルを自前で持たない (X=C drilled) グリッドの本文 H1 placeholder。`^pN` を持たないが
 * **parse 失敗ではなく正規の出力**なので、本文「クリーン」判定 (削除可否) で例外扱いする。
 * vaultFormat.renderGridBody がこの文字列を出力する (単一情報源)。
 */
export const CENTER_PLACEHOLDER_LINE = '# (中心)'

/**
 * 本文ラウンドトリップのパース層 (ピュア、I/O なし)。iOS [VaultBody.swift](../../../../ios/Mandalart/Vault/VaultBody.swift) の TS 移植。
 *
 * vault の `.md` 本文 (人間可読ビュー、`vaultFormat.renderGridBody` が生成) を読み取り、frontmatter から
 * 組んだセルに text/color/done/image と grid.memo を上書きする。frontmatter は id/created_at/position/構造の
 * バックボーン (母集合)、本文がこれらフィールドの正、という canonical マージ。
 *
 * 本文編集が部分的に壊れても **フィールド単位でフォールバック** する (`.absent` = frontmatter 値を使う)
 * ことでサイレント全損を防ぐ。
 */

/** 本文に該当マーカーが「あった/なかった」を区別する三値。`absent` は frontmatter 値へフォールバック。 */
export type BodyField<T> = { set: true; value: T } | { set: false }

const ABSENT = { set: false } as const
function setField<T>(value: T): BodyField<T> {
  return { set: true, value }
}

/** 本文の 1 見出しから読み取ったセルの編集値。 */
export type BodyCellEdit = {
  text: BodyField<string>
  done: BodyField<boolean>
  color: BodyField<string>
  /** 見出しの次行に `![[ ]]` embed があるか。set true=画像維持 / set false=画像クリア。 */
  hasImage: BodyField<boolean>
}

/** 本文全体の parse 結果。 */
export type BodyParse = {
  cellsByPosition: Map<number, BodyCellEdit>
  memo: BodyField<string>
  /**
   * 本文が「クリーン」か = 全ての見出し (`#`/`##`) が有効に parse できた (`^pN` 付き or 中心 placeholder)。
   * false = `^pN` を持たない見出し (グリッチ/手編集ミス) があった → mergeBody は安全のため削除を行わない。
   * true のときだけ「本文に無い position は削除」を許可する (= ユーザーが見出し行を消した = 意図的削除)。
   */
  clean: boolean
}

/** `gridId` + position から決定的な新規セル id を作る (本文でセルを足したとき用)。 */
export function synthCellId(gridId: string, position: number): string {
  return `${gridId}-p${position}`
}

/**
 * wiki-link エイリアス用に改行を畳む。Obsidian の `[[id|alias]]` は alias に改行を含められない
 * (改行があると `]]` が次行に回りリンクが壊れる) ため、改行 + 前後空白の連を半角スペース 1 個に
 * 畳んで両端を trim する。リンク生成 (vaultFormat.wikiLink) と本文ラウンドトリップの no-op 判定
 * (applyEdit) で**同一関数を共用**することで、畳んだエイリアスを再取り込みしても改行を保持できる。
 */
export function collapseLinkLabel(s: string): string {
  return s.replace(/\s*\r?\n\s*/g, ' ').trim()
}

/** 色タグの値 (`#c/` の後) → `Cell.color` 文字列。`hex-<digits>` は `#<digits>` に戻す。 */
export function decodeColorTag(tag: string): string {
  if (tag.startsWith('hex-')) return `#${tag.slice(4)}`
  return tag
}

/**
 * 本文を parse して position → 編集値、および memo を返す。
 *
 * 見出しは **複数行ブロック** で扱う: `# `/`## ` 行から次の見出し / memo (`>`) までを 1 ブロックに
 * 集約し、`^pN` (末尾の最後の出現)・`[done]`・`#c/color`・embed をブロック全体から抽出する。これにより
 * **改行を含むセル本文** (`## 発揮\n\n窮地に… ^p1` のように `^pN` が `##` と別行に来るケース) も
 * 取りこぼさない。`^pN` を持たないブロック (例 `# (中心)` placeholder) は round-trip 対象外。
 */
export function parseGridBody(body: string): BodyParse {
  const lines = body.split('\n')
  const cells = new Map<number, BodyCellEdit>()
  const memoLines: string[] = []
  let sawMemo = false
  let clean = true

  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    if (isHeadingLine(line)) {
      // 見出しブロックを次の見出し / memo まで集める (空行・本文継続・embed を含む)。
      const block = [line]
      let j = i + 1
      for (; j < lines.length; j++) {
        if (isHeadingLine(lines[j]) || lines[j].startsWith('>')) break
        block.push(lines[j])
      }
      i = j
      const parsed = parseHeadingBlock(block)
      if (parsed) cells.set(parsed[0], parsed[1])
      else if (block[0] !== CENTER_PLACEHOLDER_LINE) clean = false // ^pN 無し見出し (中心 placeholder 以外) = グリッチ
      continue
    }
    if (line.startsWith('>')) {
      sawMemo = true
      let rest = line.slice(1) // ">" を除去
      if (rest.startsWith(' ')) rest = rest.slice(1)
      memoLines.push(rest)
    }
    i++
  }

  return {
    cellsByPosition: cells,
    memo: sawMemo ? setField(memoLines.join('\n')) : ABSENT,
    clean,
  }
}

/** `# ` / `## ` で始まる見出し行か。 */
function isHeadingLine(line: string): boolean {
  return line.startsWith('## ') || line.startsWith('# ')
}

/**
 * frontmatter のセル群に本文の編集を適用する。
 * - 既存 position はマッチして text/color/done/image を上書き (`.absent` は維持)。
 * - 本文にあり frontmatter に無い position は `synthCellId` で新規セル化。
 * - frontmatter にあり本文に無い position:
 *   - **本文がクリーン (parse.clean) なら削除** (= ユーザーが見出し行を消した = 意図的削除)。
 *     ただし**中心セル (CENTER_POSITION) は削除しない** (構造の要)。子グリッドを持つ親セルの誤削除=孤児化は
 *     applyToDb 側の参照ガードが別途防ぐ。
 *   - **クリーンでないなら維持** (誤削除回避。`^pN` を壊した等のグリッチで黙ってセルを消さない)。
 * updated_at は触らない (既存セルはそのまま、新セルは grid の timestamp を共有)。
 */
export function mergeBody(
  frontCells: Cell[],
  parse: BodyParse,
  gridId: string,
  timestamp: string,
): Cell[] {
  const result: Cell[] = []
  const usedPositions = new Set<number>()
  for (const cell of frontCells) {
    const edit = parse.cellsByPosition.get(cell.position)
    if (edit) {
      result.push(applyEdit(edit, cell))
      usedPositions.add(cell.position)
    } else if (parse.clean && cell.position !== CENTER_POSITION) {
      // クリーンな本文に見出しが無い = 意図的削除 → result から除外 (DB 側で applyToDb が削除)。
      continue
    } else {
      result.push(cell) // 維持 (unclean fallback / 中心セル)
      usedPositions.add(cell.position)
    }
  }
  // 本文で追加された新 position (誤って順序が変わらないよう昇順)。
  for (const position of [...parse.cellsByPosition.keys()].sort((a, b) => a - b)) {
    if (usedPositions.has(position)) continue
    const base: Cell = {
      id: synthCellId(gridId, position),
      grid_id: gridId,
      position,
      text: '',
      image_path: null,
      color: null,
      done: false,
      created_at: timestamp,
      updated_at: timestamp,
    }
    result.push(applyEdit(parse.cellsByPosition.get(position)!, base))
  }
  return result
}

/** edit を 1 セルに適用した新しい Cell を返す (`.absent` は元の値を維持)。 */
function applyEdit(edit: BodyCellEdit, cell: Cell): Cell {
  const next: Cell = { ...cell }
  if (edit.text.set) {
    // 子リンクのエイリアスは改行を空白に畳むため、本文値が frontmatter text の畳み形と
    // 一致するなら実編集ではない → 改行を保持 (リンク単一行化と改行保持の両立)。
    if (cell.text.includes('\n') && edit.text.value === collapseLinkLabel(cell.text)) {
      // keep cell.text (frontmatter の改行を維持)
    } else {
      next.text = edit.text.value
    }
  }
  if (edit.done.set) next.done = edit.done.value
  if (edit.color.set) next.color = edit.color.value
  // 本文から embed が消えた = 画像クリア (embed 維持なら frontmatter の image_path を保持)。
  if (edit.hasImage.set && !edit.hasImage.value) next.image_path = null
  return next
}

// MARK: - 行パース

/** `![[ ... ]]` の embed 行か。 */
function isEmbedLine(line: string): boolean {
  const t = line.trim()
  return t.startsWith('![[') && t.endsWith(']]')
}

/**
 * 見出しブロック `<#/##> [done] <text or [[id|label]]> #c/<color> ^p<N>` (+ 改行を含む本文 + embed 行)
 * を分解する。先頭行から `#`/`##` マーカーを剥がし、embed 行を除いた残りから position (末尾の最後の
 * `^pN`)・done・color を抽出し、残りを text とする。`^pN` を持たないブロック (例 `# (中心)`) は null。
 */
function parseHeadingBlock(block: string[]): [number, BodyCellEdit] | null {
  const first = block[0]
  let head: string
  if (first.startsWith('## ')) head = first.slice(3)
  else if (first.startsWith('# ')) head = first.slice(2)
  else return null

  // embed (`![[ ]]`) 行を分離 (= 画像あり判定。text には含めない)。
  let hasImage = false
  const contentLines: string[] = []
  for (const l of [head, ...block.slice(1)]) {
    if (isEmbedLine(l)) hasImage = true
    else contentLines.push(l)
  }
  let s = contentLines.join('\n')

  // position: ブロック全体の末尾側 `^pN` (最後の出現)。改行入り本文では別行末に来る。
  const posMatches = [...s.matchAll(/\^p(\d+)/g)]
  if (posMatches.length === 0) return null
  const last = posMatches[posMatches.length - 1]
  const position = Number(last[1])
  s = s.slice(0, last.index) + s.slice(last.index! + last[0].length)

  const edit: BodyCellEdit = { text: ABSENT, done: ABSENT, color: ABSENT, hasImage: setField(hasImage) }

  // done: 先頭側の `[x]`/`[ ]`
  const doneMatch = s.match(/\[[ xX]\]/)
  if (doneMatch) {
    const marker = doneMatch[0]
    edit.done = setField(marker.includes('x') || marker.includes('X'))
    s = s.slice(0, doneMatch.index) + s.slice(doneMatch.index! + marker.length)
  }

  // color: `#c/<tag>` (改行を跨がない)
  const colorMatch = s.match(/#c\/[^ \t\n]+/)
  if (colorMatch) {
    const tag = colorMatch[0].slice(3)
    edit.color = setField(decodeColorTag(tag))
    s = s.slice(0, colorMatch.index) + s.slice(colorMatch.index! + colorMatch[0].length)
  }

  // text: 残りを trim (改行は保持)。`[[id|label]]` 単体なら label を取る。
  const remaining = s.trim()
  edit.text = setField(wikiLinkLabel(remaining) ?? remaining)

  return [position, edit]
}

/** `[[id|label]]` から label を取り出す。wiki-link でなければ null。 */
function wikiLinkLabel(text: string): string | null {
  if (!text.startsWith('[[') || !text.endsWith(']]')) return null
  const inner = text.slice(2, -2)
  const bar = inner.indexOf('|')
  return bar >= 0 ? inner.slice(bar + 1) : inner
}
