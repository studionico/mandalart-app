-- セルのチェックボックス (done 状態) カラムを追加。
-- SQLite に BOOLEAN 型は無いので INTEGER 0/1 で表現 (tauri-plugin-sql が
-- 自動的に TS 側の boolean に変換する)。
-- デフォルト 0 (= 未チェック) で、既存行にもその値が入る。
-- 階層的なカスケード (親チェック → 子も全てチェック 等) は API 層で実装。

ALTER TABLE cells ADD COLUMN done INTEGER NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS idx_cells_done ON cells(done);
