export type Mandalart = {
  id: string
  user_id: string
  title: string
  /**
   * 並列ルートグリッド群が共有する中心セルの id。
   * 並列ルートグリッド (mandalart 直下の parallel grids) は全員この cell を
   * center_cell_id として指す → 中心変更が DB レベルで全並列に反映される。
   */
  root_cell_id: string
  // ルート中心セル (position=4) の image_path を join で取得したもの。
  // mandalarts テーブル自体には保存していないので、SELECT の仕方に応じて無い場合もある。
  image_path?: string | null
  created_at: string
  updated_at: string
  deleted_at?: string | null
}

export type Grid = {
  id: string
  mandalart_id: string
  /**
   * このグリッドの中心セル (position=4 相当) を指す cells.id。
   * - root グリッド: 自グリッド (grid_id == 自 id) の position=4 の cell
   * - 子グリッド: 親グリッドに属する drill 元 cell (旧 X)。子グリッド内に position=4 行は存在しない
   * - 並列グリッド: 同じ center_cell_id を共有する複数の grid (sort_order で順序付け)
   */
  center_cell_id: string
  sort_order: number
  memo: string | null
  created_at: string
  updated_at: string
  deleted_at?: string | null
}

export type Cell = {
  id: string
  grid_id: string
  position: number // 0〜8（4 = 中心）
  text: string
  image_path: string | null
  color: string | null
  /**
   * チェックボックスのチェック状態。
   * SQLite では INTEGER 0/1、Supabase では BOOLEAN として保持される。
   * tauri-plugin-sql と @supabase/supabase-js 双方が boolean として返すので
   * TS 型としては単一の boolean で扱う。
   * 既存行 (migration 003 適用前) は 0 (false) で埋まる。
   */
  done: boolean
  created_at: string
  updated_at: string
  deleted_at?: string | null
}

export type StockItem = {
  id: string
  user_id: string
  snapshot: CellSnapshot
  created_at: string
}

export type CellSnapshot = {
  cell: Pick<Cell, 'text' | 'image_path' | 'color'>
  /** ストック元セルの position。中心 (4) の場合は所属グリッド全体をスナップショットしている */
  position?: number
  children: GridSnapshot[]
}

export type GridSnapshot = {
  grid: Pick<Grid, 'sort_order' | 'memo'>
  cells: Pick<Cell, 'position' | 'text' | 'image_path' | 'color'>[]
  /**
   * 親グリッドのどのセル (position 0..8) から生えているか。
   *  - undefined: ルート階層のグリッド、または parent grid と同階層の並列グリッド
   *  - 0..8: 親グリッドの該当位置のセル配下にぶら下がる通常のサブグリッド
   */
  parentPosition?: number
  /**
   * このグリッドに紐付く他のグリッド (sub-grids + parallel grids)。
   *  - parentPosition が 0..8 の子: 自分のセル N の下にぶら下がるサブグリッド
   *  - parentPosition が undefined の子: 自分と並列な兄弟グリッド
   *    (center_cell_id を共有し、sort_order で順序付け)
   */
  children: GridSnapshot[]
}
