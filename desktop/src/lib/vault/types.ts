import type { Mandalart, Grid, Cell } from '@/types'

/**
 * vault フォルダモード (Phase 2) のピュア層が扱う型。
 *
 * 設計方針: vault の各ファイルは **DB の行 (Grid / Cell / Mandalart row) を直接シリアライズ**する
 * (GridSnapshot は grid.id / parent_cell_id / center_cell_id を持てず per-grid ファイルを表現できない
 * ため使わない)。これにより Phase 1 の md-lossless-v1 形式・既存 export/import には一切触れず、
 * 行ベースで忠実かつ単純にロスレス往復できる。
 */

/** vault モードの grid ファイル / mandalart ファイルの format 識別子。 */
export const VAULT_FORMAT = 'md-mandalart-v1'

/** vault 内の 1 ファイル (path はマンダラートフォルダからの相対)。 */
export type VaultFile = {
  /** 例: `_mandalart.md` / `<gridId>.md` */
  path: string
  content: string
}

/** 1 マンダラート分の vault ファイル群。 */
export type MandalartVaultFiles = {
  /** マンダラートフォルダ名 (表示用、真の id は中身の frontmatter)。例: `健康-a1b2c3` */
  dirName: string
  files: VaultFile[]
}

/**
 * 1 マンダラート分の DB 行 (ピュア変換の入出力)。folder は id ではなく **name** で持つ
 * (vault は portable な folder_name を正とし、folder_id はキャッシュ再構築時に caller が解決する)。
 */
export type MandalartRows = {
  mandalart: Mandalart
  /** mandalart.folder_id が指すフォルダ名 (vault に書く portable な分類ラベル)。 */
  folderName: string
  grids: Grid[]
  cells: Cell[]
}

/** grid の種別ラベル (行から導出、可読性のために frontmatter に明示記録する)。 */
export type GridKind = 'root' | 'drilled' | 'parallel'

/** grid ファイルの frontmatter に焼く grid 行 (mandalart_id / deleted_at は implied なので省く)。 */
export type SerializedGrid = {
  id: string
  center_cell_id: string
  parent_cell_id: string | null
  sort_order: number
  memo: string | null
  kind: GridKind
  created_at: string
  updated_at: string
}

/** grid ファイルの frontmatter に焼く cell 行 (grid_id / deleted_at は implied なので省く)。 */
export type SerializedCell = {
  id: string
  position: number
  text: string
  image_path: string | null
  color: string | null
  done: boolean
  created_at: string
  updated_at: string
}

/**
 * `_mandalart.md` の frontmatter に焼く mandalart 行。
 * 省くもの: user_id / image_path / folder_id / deleted_at に加え、`last_grid_id` も除外する
 * (= どのサブグリッドを最後に開いたかは**端末ローカルの UI 状態**で、ナビゲーションのたびに
 * 値が動き `_mandalart.md` を churn させるため。import 時は null 復元)。
 */
export type SerializedMandalart = {
  id: string
  title: string
  root_cell_id: string
  show_checkbox: boolean
  sort_order: number | null
  pinned: boolean
  locked: boolean
  created_at: string
  updated_at: string
}

export type { Mandalart, Grid, Cell }
