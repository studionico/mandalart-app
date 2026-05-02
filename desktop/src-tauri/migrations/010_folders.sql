-- ダッシュボード整理機能 (Phase B): フォルダタブ。
--
-- 全マンダラートを必ず 1 つのフォルダに所属させる。「すべて」タブは廃止し、
-- 各タブ = 1 フォルダで全カードを排他的に分類する。Inbox は system folder
-- (削除不可、必ず存在) として bootstrap で自動生成。ユーザーは「+」タブから
-- 任意のフォルダ (Archive 等) を追加できる。
--
-- folders.is_system = 1: Inbox (削除拒否、ただし名前変更は可)。それ以外は 0。
-- folder_id は ALTER 時点では NULL を許容するが、ensureInboxFolder bootstrap
-- 後は API 層で「常に値あり」に揃える (DB 制約は migration の互換性のため付けない)。

CREATE TABLE folders (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  is_system   INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
  synced_at   TEXT,
  remote_id   TEXT,
  deleted_at  TEXT
);

CREATE INDEX idx_folders_sort    ON folders(sort_order);
CREATE INDEX idx_folders_deleted ON folders(deleted_at);

ALTER TABLE mandalarts ADD COLUMN folder_id TEXT;
CREATE INDEX idx_mandalarts_folder ON mandalarts(folder_id, deleted_at);
