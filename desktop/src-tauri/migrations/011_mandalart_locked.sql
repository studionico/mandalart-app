-- マンダラート単位の「ロック」フラグ (= 編集不可状態)。
--
-- 用途: 完成版の保護や誤操作による内容破壊の予防。ロック中は cell の編集
-- (commit / 拡大エディタ / inline edit / drill 新規 / 並列追加・削除 / メモ / clipboard
-- ⌘X⌘V / D&D の move・shred・stock 貼付け) を block する。閲覧 (drill / 9×9 / parallel
-- switch / breadcrumb / copy / export / ⌘C) と マンダラート 操作 (pin / 複製 / フォルダ
-- 移動 / ゴミ箱 / 完全削除) は **通す** (落とし穴: ロック ≠ 削除権の制限)。
--
-- カラム意味:
--   - 0: 編集可能 (default — 新規マンダラートも既存マンダラートも初期 OFF)
--   - 1: ロック中 (read-only)
--
-- DEFAULT 0 で既存行は自動的に OFF になる。Supabase 側でも同じ ADD COLUMN を
-- 手動実行する必要あり (cloud-sync-setup.md 参照、落とし穴 #17 PGRST204 thrash 防止)。
-- show_checkbox / pinned と同じく SQLite INTEGER ↔ Supabase BOOLEAN の自動 boolean
-- 正規化に依存。

ALTER TABLE mandalarts ADD COLUMN locked INTEGER NOT NULL DEFAULT 0;
