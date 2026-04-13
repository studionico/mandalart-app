-- ソフトデリート対応: deleted_at カラムを追加する。
-- 物理削除の代わりに deleted_at に ISO8601 タイムスタンプをセットし、
-- 全ての SELECT は WHERE deleted_at IS NULL でフィルタする。
-- これにより:
--   - オフラインで削除してもタイムスタンプ付きで残る → 次回同期で cloud に反映
--   - 別デバイスで削除された行も pull で deleted_at が進み、自動で不可視化される
--   - 復元機能の将来実装も容易 (NULL に戻すだけ)

ALTER TABLE mandalarts ADD COLUMN deleted_at TEXT;
ALTER TABLE grids      ADD COLUMN deleted_at TEXT;
ALTER TABLE cells      ADD COLUMN deleted_at TEXT;

CREATE INDEX IF NOT EXISTS idx_mandalarts_deleted_at ON mandalarts(deleted_at);
CREATE INDEX IF NOT EXISTS idx_grids_deleted_at      ON grids(deleted_at);
CREATE INDEX IF NOT EXISTS idx_cells_deleted_at      ON cells(deleted_at);
