CREATE TABLE IF NOT EXISTS mandalarts (
  id          TEXT PRIMARY KEY,
  title       TEXT NOT NULL DEFAULT '',
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
  synced_at   TEXT,
  remote_id   TEXT
);

CREATE TABLE IF NOT EXISTS grids (
  id             TEXT PRIMARY KEY,
  mandalart_id   TEXT NOT NULL REFERENCES mandalarts(id) ON DELETE CASCADE,
  parent_cell_id TEXT REFERENCES cells(id) ON DELETE CASCADE,
  sort_order     INTEGER NOT NULL DEFAULT 0,
  memo           TEXT,
  created_at     TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at     TEXT NOT NULL DEFAULT (datetime('now')),
  synced_at      TEXT,
  remote_id      TEXT
);

CREATE TABLE IF NOT EXISTS cells (
  id          TEXT PRIMARY KEY,
  grid_id     TEXT NOT NULL REFERENCES grids(id) ON DELETE CASCADE,
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
