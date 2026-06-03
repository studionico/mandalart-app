import {
  buildGridDocument,
  parseGridDocument,
  buildMandalartDoc,
  parseMandalartDoc,
} from './vaultFormat'
import type { MandalartRows, MandalartVaultFiles, VaultFile } from './types'

/**
 * 1 マンダラート分の DB 行 ⇄ vault ファイル群 の純変換 (I/O なし、INSERT しない)。
 *
 * vault レイアウト (マンダラートフォルダ内):
 *   _mandalart.md     ... マンダラート単位メタ + 所属フォルダ名
 *   <gridId>.md       ... grid 1 つ + その cells (lazy: 空 peripheral は含めない)
 *
 * 真の id は各ファイルの frontmatter にあり、フォルダ名 / ファイル名は表示用。
 */

export const MANDALART_DOC_NAME = '_mandalart.md'

/** パス/ファイル名に使えない文字を `-` に畳み、空なら untitled。 */
export function slugifyTitle(title: string): string {
  const unsafe = /[/\\:*?"<>|]+/g
  const cleaned = title
    .trim()
    .replace(unsafe, '-')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
  return cleaned || 'untitled'
}

/** マンダラートフォルダ名 = `<title-slug>-<id6>` (表示用)。 */
export function mandalartDirName(title: string, id: string): string {
  return `${slugifyTitle(title)}-${id.slice(0, 6)}`
}

/** DB 行 → vault ファイル群。 */
export function mandalartToVaultFiles(rows: MandalartRows): MandalartVaultFiles {
  const { mandalart, folderName, grids, cells } = rows
  const cellsByGrid = new Map<string, typeof cells>()
  for (const c of cells) {
    const arr = cellsByGrid.get(c.grid_id) ?? []
    arr.push(c)
    cellsByGrid.set(c.grid_id, arr)
  }

  const files: VaultFile[] = [
    { path: MANDALART_DOC_NAME, content: buildMandalartDoc(mandalart, folderName) },
  ]
  // grid は sort_order → id の決定的順序でファイル化 (差分を安定させる)
  const orderedGrids = [...grids].sort(
    (a, b) => a.sort_order - b.sort_order || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  )
  for (const grid of orderedGrids) {
    const gridCells = cellsByGrid.get(grid.id) ?? []
    // lazy grid: cells も memo も無い空グリッドは vault に焼かない。drill で生成され drill-up で
    // auto-cleanup される空 X=C drilled grid (= ナビゲーション由来) がファイル churn を起こすのを防ぐ。
    // ルート/並列は中心セル行を必ず持ち、子を持つ X=C grid は drill 元の周辺セルを必ず持つので落ちない。
    const isEmpty = gridCells.length === 0 && (grid.memo == null || grid.memo.trim() === '')
    if (isEmpty) continue
    files.push({ path: `${grid.id}.md`, content: buildGridDocument(grid, gridCells) })
  }

  return { dirName: mandalartDirName(mandalart.title, mandalart.id), files }
}

/**
 * vault ファイル群 → DB 行。`_mandalart.md` が無い / 壊れている場合は null。
 * grid ファイルの parse 失敗は skip+warn (誤削除しない方針、parse できた分だけ返す)。
 */
export function vaultFilesToRows(files: VaultFile[]): MandalartRows | null {
  const mandalartFile = files.find((f) => f.path === MANDALART_DOC_NAME)
  if (!mandalartFile) return null
  const parsedMandalart = parseMandalartDoc(mandalartFile.content)
  if (!parsedMandalart) return null

  const { mandalart, folderName } = parsedMandalart
  const grids: MandalartRows['grids'] = []
  const cells: MandalartRows['cells'] = []

  for (const file of files) {
    if (file.path === MANDALART_DOC_NAME) continue
    if (!file.path.endsWith('.md')) continue
    const parsed = parseGridDocument(file.content, mandalart.id)
    if (!parsed) {
      console.warn(`[vault] grid ファイルの parse をスキップ: ${file.path}`)
      continue
    }
    grids.push(parsed.grid)
    cells.push(...parsed.cells)
  }

  return { mandalart, folderName, grids, cells }
}
