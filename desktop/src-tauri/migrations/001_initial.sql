CREATE TABLE IF NOT EXISTS mandalarts (
  id          TEXT PRIMARY KEY,
  title       TEXT NOT NULL DEFAULT '',
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
  synced_at   TEXT,
  remote_id   TEXT
);

-- NOTE: ローカルスキーマでは FK 制約を一切張らない。
-- 理由:
--  1. grids.parent_cell_id → cells と cells.grid_id → grids の組み合わせは
--     循環 FK を作り、削除時に "too many levels of trigger recursion" を起こす
--  2. tauri-plugin-sql の sqlx プールは接続ごとに PRAGMA foreign_keys が独立し、
--     トランザクション境界も共有されないため、pull で順序が揃っていても
--     別コネクションで FK 違反が発生する
-- 代わりに、削除時のカスケードは API 層（lib/api/*.ts）で明示的に行う。
CREATE TABLE IF NOT EXISTS grids (
  id             TEXT PRIMARY KEY,
  mandalart_id   TEXT NOT NULL,
  parent_cell_id TEXT,
  sort_order     INTEGER NOT NULL DEFAULT 0,
  memo           TEXT,
  created_at     TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at     TEXT NOT NULL DEFAULT (datetime('now')),
  synced_at      TEXT,
  remote_id      TEXT
);

CREATE TABLE IF NOT EXISTS cells (
  id          TEXT PRIMARY KEY,
  grid_id     TEXT NOT NULL,
  position    INTEGER NOT NULL CHECK (position BETWEEN 0 AND 8),
  text        TEXT NOT NULL DEFAULT '',
  image_path  TEXT,
  color       TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
  synced_at   TEXT,
  remote_id   TEXT,
  UNIQUE(grid_id, position)
);

CREATE TABLE IF NOT EXISTS stock_items (
  id          TEXT PRIMARY KEY,
  snapshot    TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_grids_mandalart ON grids(mandalart_id);
CREATE INDEX IF NOT EXISTS idx_grids_parent_cell ON grids(parent_cell_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_cells_grid ON cells(grid_id);
