-- ダッシュボードカードの整理機能 (Phase A): 手動並び替え + ピン留め。
--
-- カラム意味:
--   - sort_order: ユーザー定義並び順 (低い方が先頭)。NULL は「未指定」で、既存
--     行は NULL のまま残す。getMandalarts の ORDER BY は `sort_order ASC NULLS LAST,
--     updated_at DESC` で、未指定行は updated_at fallback で並ぶ
--   - pinned: 1 で「最上位固定」。0 = 通常。pinned 同士の中でも sort_order →
--     updated_at で順序が決まる
--
-- DEFAULT 0 (pinned) で既存行は自動的に未ピン扱い。Supabase 側でも同 ALTER を
-- 手動実行する必要あり (cloud-sync-setup.md 参照)。SQLite INTEGER ↔ Supabase BOOLEAN
-- の自動 boolean 正規化に依存 (done / show_checkbox と同パターン)。

ALTER TABLE mandalarts ADD COLUMN sort_order INTEGER;
ALTER TABLE mandalarts ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0;
