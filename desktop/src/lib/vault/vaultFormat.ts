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

/** grid + その cells を `<gridId>.md` の内容に直列化する。 */
export function buildGridDocument(grid: Grid, cells: Cell[]): string {
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
  return buildDoc(VAULT_FORMAT, { grid: sg, cells: sc }, renderGridBody(sorted, grid.memo))
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

/** mandalart 行 + 所属フォルダ名を `_mandalart.md` の内容に直列化する。 */
export function buildMandalartDoc(mandalart: Mandalart, folderName: string): string {
  const sm: SerializedMandalart = {
    id: mandalart.id,
    title: mandalart.title,
    root_cell_id: mandalart.root_cell_id,
    show_checkbox: mandalart.show_checkbox,
    last_grid_id: mandalart.last_grid_id ?? null,
    sort_order: mandalart.sort_order ?? null,
    pinned: mandalart.pinned,
    locked: mandalart.locked,
    created_at: mandalart.created_at,
    updated_at: mandalart.updated_at,
  }
  const body = `# ${mandalart.title.trim() || '(無題)'}`
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
    last_grid_id: sm.last_grid_id,
    sort_order: sm.sort_order,
    pinned: sm.pinned,
    folder_id: null,
    locked: sm.locked,
    created_at: sm.created_at,
    updated_at: sm.updated_at,
  }
  return { mandalart, folderName }
}

/** grid の人間可読ビュー (本文)。中心を H1、非空の周辺を H2、memo を blockquote。parse は読まない。 */
function renderGridBody(cellsSortedByPosition: Cell[], memo: string | null): string {
  const lines: string[] = []
  const center = cellsSortedByPosition.find((c) => c.position === CENTER_POSITION)
  lines.push(`# ${center?.text.trim() || '(中心)'}`)
  if (memo && memo.trim() !== '') {
    for (const memoLine of memo.split('\n')) lines.push(`> ${memoLine}`)
  }
  for (const c of cellsSortedByPosition) {
    if (c.position === CENTER_POSITION) continue
    if (c.text.trim() === '') continue
    lines.push('', `## ${c.text.trim()}`)
  }
  return lines.join('\n')
}
