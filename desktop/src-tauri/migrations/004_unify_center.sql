-- X (drill 元の周辺セル) と C (サブグリッドの中心セル) を同一行に統一する。
--
-- 旧: grids.parent_cell_id → cells の row X。別途 child grid 内に position=4 の row C を作って
--     手動で text/image/color/done を X ↔ C 同期していた。
-- 新: grids.center_cell_id TEXT NOT NULL を追加し、各 grid は自身の中心セルを直接参照する。
--     - root grid (mandalart 直下) は自 grid の position=4 の行を center として持つ
--     - 子 grid (drilled) は position=4 の行を作らず、center_cell_id は親 grid に属する drill 元の
--       cell (= 旧 X) を指す
--     - 同一 center_cell_id を共有する複数 grid は "並列グリッド" となり、中心が DB レベルで強制共有
--
-- 既存データは未公開アプリのため保持しない。全テーブル DROP して再作成する。

DROP TABLE IF EXISTS stock_items;
DROP TABLE IF EXISTS cells;
DROP TABLE IF EXISTS grids;
DROP TABLE IF EXISTS mandalarts;

CREATE TABLE mandalarts (
  id            TEXT PRIMARY KEY,
  title         TEXT NOT NULL DEFAULT '',
  -- ルートグリッド群の共有中心セル id。createMandalart で center cell を先に作って id をここに入れる。
  -- 並列ルートグリッドは全員この id を center_cell_id として共有し、セントラル編集が DB レベルで同期される。
  -- 旧モデルの "title" は中心セルの text キャッシュだったが、root_cell_id があれば JOIN で直接参照できる
  -- (title は後方互換のため維持)。
  root_cell_id  TEXT NOT NULL,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now')),
  synced_at     TEXT,
  remote_id     TEXT,
  deleted_at    TEXT
);

-- NOTE: FK 制約は 001 と同じ理由 (循環 FK 再帰 + sqlx プール問題) で一切張らない。
-- center_cell_id の整合性は API 層 (lib/api/grids.ts) で保証する。
CREATE TABLE grids (
  id              TEXT PRIMARY KEY,
  mandalart_id    TEXT NOT NULL,
  center_cell_id  TEXT NOT NULL,
  sort_order      INTEGER NOT NULL DEFAULT 0,
  memo            TEXT,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now')),
  synced_at       TEXT,
  remote_id       TEXT,
  deleted_at      TEXT
);

CREATE TABLE cells (
  id          TEXT PRIMARY KEY,
  grid_id     TEXT NOT NULL,
  position    INTEGER NOT NULL CHECK (position BETWEEN 0 AND 8),
  text        TEXT NOT NULL DEFAULT '',
  image_path  TEXT,
  color       TEXT,
  done        INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
  synced_at   TEXT,
  remote_id   TEXT,
  deleted_at  TEXT,
  UNIQUE(grid_id, position)
);

CREATE TABLE stock_items (
  id          TEXT PRIMARY KEY,
  snapshot    TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_grids_mandalart        ON grids(mandalart_id);
CREATE INDEX idx_grids_center_cell      ON grids(center_cell_id, sort_order);
CREATE INDEX idx_grids_deleted_at       ON grids(deleted_at);
CREATE INDEX idx_cells_grid             ON cells(grid_id);
CREATE INDEX idx_cells_done             ON cells(done);
CREATE INDEX idx_cells_deleted_at       ON cells(deleted_at);
CREATE INDEX idx_mandalarts_deleted_at  ON mandalarts(deleted_at);
