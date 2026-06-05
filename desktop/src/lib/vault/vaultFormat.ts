import type { Grid, Cell, Mandalart } from '@/types'
import { CENTER_POSITION } from '@/constants/grid'
import { buildDoc, parseDoc } from './frontmatter'
import {
  VAULT_FORMAT,
  type GridKind,
  type SerializedGrid,
  type SerializedCell,
  type SerializedMandalart,
} from './types'

/**
 * vault の grid ファイル (`<gridId>.md`) と mandalart ファイル (`_mandalart.md`) の
 * build / parse (ピュア、I/O なし)。frontmatter に DB 行を焼き、本文は人間可読ビュー。
 */

/** grid 行から種別ラベルを導出 (frontmatter に明示記録して 3 種推論を排除)。 */
export function gridKind(grid: Pick<Grid, 'parent_cell_id' | 'center_cell_id'>): GridKind {
  if (grid.parent_cell_id === null) return 'root'
  if (grid.center_cell_id === grid.parent_cell_id) return 'drilled'
  return 'parallel'
}

/**
 * 本文ビューに焼く Obsidian リンク情報 (任意)。本文は表示専用で parse は読まないので、リンクの
 * 有無はデータ往復に影響しない。
 * - `childByCell`: セル id → そのセルが drill した子グリッド id (親→子リンク)。
 * - `parent`: 自グリッドの親グリッドへの戻りリンク (子→親リンク、ルートは無し)。
 */
export type GridBodyLinks = {
  childByCell?: Map<string, string>
  parent?: { gridId: string; label: string }
}

/** grid + その cells を `<gridId>.md` の内容に直列化する。`links` で本文に親子 wiki-link を出す。 */
export function buildGridDocument(grid: Grid, cells: Cell[], links?: GridBodyLinks): string {
  const sg: SerializedGrid = {
    id: grid.id,
    center_cell_id: grid.center_cell_id,
    parent_cell_id: grid.parent_cell_id,
    sort_order: grid.sort_order,
    memo: grid.memo,
    kind: gridKind(grid),
    created_at: grid.created_at,
    updated_at: grid.updated_at,
  }
  const sorted = [...cells].sort((a, b) => a.position - b.position)
  const sc: SerializedCell[] = sorted.map((c) => ({
    id: c.id,
    position: c.position,
    text: c.text,
    image_path: c.image_path,
    color: c.color,
    done: c.done,
    created_at: c.created_at,
    updated_at: c.updated_at,
  }))
  return buildDoc(VAULT_FORMAT, { grid: sg, cells: sc }, renderGridBody(sorted, grid.memo, links))
}

/**
 * `<gridId>.md` を Grid + Cell[] に復元する。format 不一致 / grid 欠損は null (skip+warn)。
 * mandalart_id は file からは判らないので caller (vaultModel) が渡す。grid_id は file の grid.id。
 */
export function parseGridDocument(
  content: string,
  mandalartId: string,
): { grid: Grid; cells: Cell[] } | null {
  const { format, fields } = parseDoc(content)
  if (format !== VAULT_FORMAT) return null
  const sg = fields.grid as SerializedGrid | undefined
  if (!sg || typeof sg.id !== 'string') return null
  const sc = (Array.isArray(fields.cells) ? fields.cells : []) as SerializedCell[]

  const grid: Grid = {
    id: sg.id,
    mandalart_id: mandalartId,
    center_cell_id: sg.center_cell_id,
    parent_cell_id: sg.parent_cell_id,
    sort_order: sg.sort_order,
    memo: sg.memo,
    created_at: sg.created_at,
    updated_at: sg.updated_at,
  }
  const cells: Cell[] = sc.map((c) => ({
    id: c.id,
    grid_id: sg.id,
    position: c.position,
    text: c.text,
    image_path: c.image_path,
    color: c.color,
    done: c.done,
    created_at: c.created_at,
    updated_at: c.updated_at,
  }))
  return { grid, cells }
}

/**
 * mandalart 行 + 所属フォルダ名を `_mandalart.md` の内容に直列化する。
 * `rootGridId` を渡すと本文 H1 をルートグリッドへの wiki-link にする (順方向リンク)。
 */
export function buildMandalartDoc(mandalart: Mandalart, folderName: string, rootGridId?: string): string {
  const sm: SerializedMandalart = {
    id: mandalart.id,
    title: mandalart.title,
    root_cell_id: mandalart.root_cell_id,
    show_checkbox: mandalart.show_checkbox,
    sort_order: mandalart.sort_order ?? null,
    pinned: mandalart.pinned,
    locked: mandalart.locked,
    created_at: mandalart.created_at,
    updated_at: mandalart.updated_at,
  }
  const title = mandalart.title.trim() || '(無題)'
  const body = rootGridId ? `# ${wikiLink(rootGridId, title)}` : `# ${title}`
  return buildDoc(VAULT_FORMAT, { mandalart: sm, folder_name: folderName }, body)
}

/**
 * `_mandalart.md` を Mandalart + folderName に復元する。format 不一致 / mandalart 欠損は null。
 * folder_id は vault には無い (folder_name が正) ので null。user_id は local 専用なので ''。
 */
export function parseMandalartDoc(content: string): { mandalart: Mandalart; folderName: string } | null {
  const { format, fields } = parseDoc(content)
  if (format !== VAULT_FORMAT) return null
  const sm = fields.mandalart as SerializedMandalart | undefined
  if (!sm || typeof sm.id !== 'string') return null
  const folderName = typeof fields.folder_name === 'string' ? fields.folder_name : ''

  const mandalart: Mandalart = {
    id: sm.id,
    user_id: '',
    title: sm.title,
    root_cell_id: sm.root_cell_id,
    show_checkbox: sm.show_checkbox,
    last_grid_id: null, // 端末ローカル UI 状態。vault には保存しない (import で null 復元)
    sort_order: sm.sort_order,
    pinned: sm.pinned,
    folder_id: null,
    locked: sm.locked,
    created_at: sm.created_at,
    updated_at: sm.updated_at,
  }
  return { mandalart, folderName }
}

/** object/array を再帰的に辿り `updated_at` キーを除去する (純粋、比較用)。 */
function stripUpdatedAt(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripUpdatedAt)
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (k === 'updated_at') continue
      out[k] = stripUpdatedAt(v)
    }
    return out
  }
  return value
}

/**
 * 2 つの vault ドキュメント (grid / mandalart どちら向きでも) が **`updated_at` を除いて** 内容
 * 等価かを判定する純関数。`updated_at` (grid / 各 cell / mandalart) はナビゲーション等で content
 * 未編集でも bump されるため、これを無視することで flush の churn (timestamp だけ違うファイルを
 * 書き換える) を防ぐ。frontmatter を JSON として比較するので grid 行・cells 行・mandalart 行すべてに効く。
 */
export function docContentEquivalent(a: string, b: string): boolean {
  const pa = parseDoc(a)
  const pb = parseDoc(b)
  // 本文 (人間可読ビュー) も比較する。本文は updated_at を含まず frontmatter から決定的に生成されるので、
  // 「updated_at だけ bump」では本文は不変 (= churn 抑止は維持)。本文テンプレ変更 (リンク追加等) や実データ
  // 変更のときだけ本文が変わり、既存ファイルへ再書き出しで伝播する。
  if (pa.body !== pb.body) return false
  return JSON.stringify(stripUpdatedAt(pa.fields)) === JSON.stringify(stripUpdatedAt(pb.fields))
}

/** Obsidian wiki-link (エイリアス記法)。リンク先はファイル名 (= `<gridId>.md` の basename)。 */
function wikiLink(gridId: string, label: string): string {
  return `[[${gridId}|${label}]]`
}

/** セル見出し。子グリッドがあれば見出しを子へのリンクにする (親→子)。 */
function renderCellHeading(
  prefix: string,
  cell: Cell,
  fallback: string,
  childByCell?: Map<string, string>,
): string {
  const label = cell.text.trim() || fallback
  const childId = childByCell?.get(cell.id)
  return childId ? `${prefix} ${wikiLink(childId, label)}` : `${prefix} ${label}`
}

/**
 * grid の人間可読ビュー (本文)。中心を H1、非空の周辺を H2、memo を blockquote。parse は読まない。
 * `links` 指定時は親子の Obsidian wiki-link を出す (親→子 = 子持ちセル見出し、子→親 = 先頭の戻りリンク)。
 */
function renderGridBody(
  cellsSortedByPosition: Cell[],
  memo: string | null,
  links?: GridBodyLinks,
): string {
  const lines: string[] = []
  // 子→親: 先頭に親グリッドへの戻りリンク (ルートは parent 無しなので出ない)。
  if (links?.parent) {
    lines.push(`親: ${wikiLink(links.parent.gridId, links.parent.label)}`, '')
  }
  const center = cellsSortedByPosition.find((c) => c.position === CENTER_POSITION)
  lines.push(center ? renderCellHeading('#', center, '(中心)', links?.childByCell) : '# (中心)')
  if (memo && memo.trim() !== '') {
    for (const memoLine of memo.split('\n')) lines.push(`> ${memoLine}`)
  }
  for (const c of cellsSortedByPosition) {
    if (c.position === CENTER_POSITION) continue
    if (c.text.trim() === '') continue
    lines.push('', renderCellHeading('##', c, '(無題)', links?.childByCell))
  }
  return lines.join('\n')
}
