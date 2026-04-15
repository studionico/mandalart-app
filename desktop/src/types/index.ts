export type Mandalart = {
  id: string
  user_id: string
  title: string
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
  parent_cell_id: string | null
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
   *    (parent_cell_id を共有し、sort_order で順序付け)
   */
  children: GridSnapshot[]
}
