-- マンダラートごとの「セル左上 done チェックボックス UI 表示 ON/OFF」設定。
--
-- 背景: 旧設計では `mandalart.showCheckbox` の単一 localStorage キーで全マンダラート共通だった。
-- しかし「マンダラートごとに ON/OFF を記憶 + マルチデバイス同期したい」という要件があり、
-- UI preference でありながら mandalarts テーブルに付帯メタデータとして格納するように変更する。
--
-- カラム意味:
--   - 0: 非表示 (default — 新規マンダラートも既存マンダラートも初期 OFF)
--   - 1: 表示
--
-- DEFAULT 0 で既存行は自動的に OFF になる。Supabase 側でも同じ ADD COLUMN を手動実行する必要あり
-- (cloud-sync-setup.md 参照)。done カラムと同じく SQLite INTEGER ↔ Supabase BOOLEAN の
-- 自動 boolean 正規化に依存。

ALTER TABLE mandalarts ADD COLUMN show_checkbox INTEGER NOT NULL DEFAULT 0;
