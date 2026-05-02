export type Mandalart = {
  id: string
  user_id: string
  title: string
  /**
   * プライマリ root グリッドの中心セル id。
   * レガシー並列ルート (migration 006 以前に作成されたもの) は全員この cell を
   * center_cell_id として指し、共有されている。新規作成される並列ルートは独自の
   * center cell を持ち、root_cell_id は参照しない (ダッシュボードのサムネ等の用途で残存)。
   */
  root_cell_id: string
  // ルート中心セル (position=4) の image_path を join で取得したもの。
  // mandalarts テーブル自体には保存していないので、SELECT の仕方に応じて無い場合もある。
  image_path?: string | null
  /**
   * セル左上 done チェックボックス UI の表示 ON/OFF (マンダラート単位)。migration 007 以降。
   * SQLite では INTEGER 0/1、Supabase では BOOLEAN として保持される。
   * 既存行は DEFAULT 0 (= 非表示) で初期化され、新規マンダラートも 0 で開始。
   * デバイス間で push/pull 同期される (= UI プリファレンスでも DB 同期する設計)。
   */
  show_checkbox: boolean
  /**
   * 前回開いていた sub-grid の id (マンダラート単位、migration 008 以降)。
   * ダッシュボードから再度開いた時の drill 階層復元に使う。一度も drill していなければ null。
   * SQLite / Supabase ともに TEXT (nullable、DEFAULT なし)。push/pull 同期される。
   * 復元時に対象 grid が削除済み (stale) の場合は呼出側で root にフォールバック + DB 側を null に戻す。
   */
  last_grid_id?: string | null
  /**
   * ユーザー定義並び順 (低い方が先頭、migration 009 以降)。NULL = 未指定で、
   * `getMandalarts` の ORDER BY は `pinned DESC, sort_order ASC NULLS LAST,
   * updated_at DESC`。card-to-card D&D で reorder したときに 0..N で振り直す。
   */
  sort_order?: number | null
  /**
   * ピン留めフラグ (migration 009 以降)。1 = 最上位固定。SQLite INTEGER 0/1、
   * Supabase BOOLEAN。pinned 同士・unpinned 同士でそれぞれ sort_order →
   * updated_at で並ぶ。
   */
  pinned: boolean
  created_at: string
  updated_at: string
  deleted_at?: string | null
}

export type Grid = {
  id: string
  mandalart_id: string
  /**
   * このグリッドの中心セル (position=4 相当) を指す cells.id。
   * - root グリッド / primary drilled グリッド (X=C): 親または自グリッドの cell を共有
   * - 並列グリッド (migration 006 以降の新規): 自グリッド所属の独立 cell 行 (grid_id=自 id, position=4)
   * - レガシー並列グリッド (migration 006 以前): 同じ cell を共有 (primary と同じ)
   */
  center_cell_id: string
  /**
   * drill 元の cell id。
   * - root グリッド (mandalart 直下): NULL
   * - drilled グリッド (primary / 並列どちらも): 親グリッドの peripheral cell id
   *
   * 並列グリッドかどうかの判定は sort_order や mandalart 内での同一 parent_cell_id の
   * 存在数で行う (parent_cell_id 自体は primary と parallel で同じ値)。
   */
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
