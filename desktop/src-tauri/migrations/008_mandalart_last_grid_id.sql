-- マンダラートごとの「前回開いていた sub-grid id」を記憶。
--
-- 背景: ダッシュボードからマンダラートを開いた時に、これまでは常に root grid から始まるため、
-- ユーザーが drill した深い階層で作業した後、ホームに戻ってから再度同じマンダラートを開くと
-- 最初の階層からやり直しになっていた。再ドリルの手間を省くため、最後に開いていた grid を
-- マンダラート単位で記憶し、再オープン時に同じ階層から復元できるようにする。
--
-- カラム意味:
--   - NULL: 一度も drill していない / 値なし → 復元時は root にフォールバック
--   - <gridId>: 最後に表示していた grid の id (root 自身を指していてもよい)
--
-- 既存行は自動で NULL になる (DEFAULT なし)。Supabase 側でも同じ ADD COLUMN を手動実行する必要
-- あり (cloud-sync-setup.md 参照)。TEXT なので push/pull 時の型変換は不要。
-- 復元時に対象 grid が削除済み (stale) の場合は呼出側で root にフォールバック + DB 側を NULL に戻す。

ALTER TABLE mandalarts ADD COLUMN last_grid_id TEXT;
