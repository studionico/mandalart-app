-- 空セル (text='' AND image_path IS NULL AND color IS NULL) を物理削除する。
--
-- 経緯: createGrid が grid 作成時に 8/9 cells (うちほとんど空) を先行 INSERT する旧設計から、
-- 「user が書込んだ瞬間に upsertCellAt で初めて INSERT する」lazy 設計へ移行した。
-- 移行前データには大量の空 cell 行が DB に残っており、
--   - storage を食う
--   - 同期で cloud にも空行を撒く (RLS 干渉や thrash の遠因にもなりうる)
-- ため hard delete で一掃する。
--
-- 残す条件 (誤って消さないため):
--   - center_cell_id として grids から参照されている cell (= root grid の中心セル等)
--     これを消すと grids.center_cell_id がダングルする
--   - root_cell_id として mandalarts から参照されている cell (実質 1. の subset だが念のため)
--   - 何らかの content (text 非空 / image_path / color / done=1) を持つ cell

DELETE FROM cells
WHERE (text IS NULL OR text = '')
  AND image_path IS NULL
  AND color IS NULL
  AND (done IS NULL OR done = 0)
  AND id NOT IN (SELECT center_cell_id FROM grids WHERE center_cell_id IS NOT NULL)
  AND id NOT IN (SELECT root_cell_id FROM mandalarts WHERE root_cell_id IS NOT NULL);
