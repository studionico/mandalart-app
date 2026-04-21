-- 並列グリッドの独立 center 対応: grids.parent_cell_id カラムを追加する。
--
-- 背景: X=C 統一モデル (migration 004) では並列グリッドが `grids.center_cell_id` を共有する
-- ため、並列上で中心セルを編集すると全並列に波及する問題があった。
-- 新モデルでは各 grid が「drill 元」を明示する `parent_cell_id` を持ち、新規作成される
-- 並列グリッドは独自の center cell 行を持つことで独立したテーマを保持できるようになる。
--
-- カラム意味:
--   - root grid (mandalart 直下): parent_cell_id = NULL
--   - drilled grid: parent_cell_id = drill 元 cell の id (親グリッドの peripheral cell)
--
-- バックフィル:
--   - 既存 root grid: center_cell_id = mandalarts.root_cell_id → parent_cell_id は NULL のまま
--   - 既存 drilled grid (primary / 並列どちらも): center_cell_id は drill 元 cell を指していたので
--     parent_cell_id = center_cell_id で初期化する
--   既存並列グリッドは引き続き center_cell_id を共有するため、移行後も旧挙動 (共有中心) のまま動作する。
--   新規作成される並列だけが独立化する。

ALTER TABLE grids ADD COLUMN parent_cell_id TEXT;

UPDATE grids
SET parent_cell_id = center_cell_id
WHERE id IN (
  SELECT g.id FROM grids g
  JOIN mandalarts m ON m.id = g.mandalart_id
  WHERE g.center_cell_id != m.root_cell_id
);
