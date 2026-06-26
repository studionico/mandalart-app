# クラウド同期 セットアップ手順

このドキュメントでは、マンダラートデスクトップアプリの Supabase 連携（認証 + 同期 + Realtime）を有効化するための手動作業を説明します。コード側の実装はすでに完了していますが、**Supabase プロジェクトの設定、スキーマのパッチ、環境変数の配置は手動で行う必要があります**。

---

## 概要

- **認証**: Supabase Auth（メール + Google / GitHub OAuth）、PKCE フロー + deep link コールバック
- **同期**: ローカル SQLite ↔ Supabase Postgres の双方向同期 (`lib/sync/push.ts` + `lib/sync/pull.ts`)
- **競合解決**: `updated_at` による last-write-wins
- **Realtime**: `postgres_changes` 購読で別デバイスの変更を即時反映
- **トリガ**: サインイン時フル同期 / 手動同期ボタン / Realtime 受信時

---

## ステップ 1: Supabase プロジェクト

既存プロジェクトがあれば再利用。新規なら [supabase.com](https://supabase.com) でプロジェクト作成。

以下の情報を控える:

- **Project URL**: `https://xxxxxxxxxxxx.supabase.co`
- **anon key** (Settings → API → Project API keys → `anon public`)

---

## ステップ 2: 環境変数

`desktop/.env` を作成 (gitignore 済み):

```bash
VITE_SUPABASE_URL=https://xxxxxxxxxxxx.supabase.co
VITE_SUPABASE_ANON_KEY=sb_publishable_xxxxxxxxxxxxxxxxxxxxxxxx
```

サンプルは `desktop/.env.example` にあります。

---

## ステップ 3: スキーマ適用

`_old_web/supabase/migrations/` にある SQL を順番に Supabase SQL Editor で実行:

1. `001_create_mandalarts.sql`
2. `002_create_grids.sql`
3. `003_create_cells.sql`
4. `004_create_stock_items.sql`
5. `005_triggers_and_functions.sql`
6. `006_storage.sql` (画像クラウド同期用 — 下記「必須: 画像同期用 Storage バケット」を参照)

> **⚠️ 重要**: スキーマ適用後、下記の「必須スキーマ変更」を **全て** 実施してください。
> 特に `done` カラムと `center_cell_id` (X=C 統一) への移行はローカル側 migration と整合させる必要があります。

> **ローカルの FK 排除について**: ローカル側 ([`migration 001`](../src-tauri/migrations/001_initial.sql)) は
> `grids → cells` の循環 FK による `too many levels of trigger recursion` を避けるため FK 制約を付けていません。
> クラウド側は `_old_web/supabase/migrations/002_create_grids.sql` で FK (`grids_parent_cell_id_fkey`) を
> 張っていましたが、後続の X=C 統一移行 (下記 `center_cell_id`) でカラム自体を入れ替えるため、
> 旧 FK 制約は自動的に消滅します。

### 必須: 画像同期用 Storage バケット (`cell-images`)

セル画像を別デバイスでも表示するため、画像本体を Supabase Storage に置く。**この設定が未適用だと画像 upload が 403、別デバイスでの download が空振り**になる (PGRST204 thrash と同型の手動前提作業 — desktop 落とし穴 #17 参照)。Supabase SQL Editor で以下を実行 (= [`_old_web/supabase/migrations/006_storage.sql`](../../_old_web/supabase/migrations/006_storage.sql)):

```sql
-- cell-images バケット (非公開)
INSERT INTO storage.buckets (id, name, public)
VALUES ('cell-images', 'cell-images', false)
ON CONFLICT (id) DO NOTHING;

-- 自分の user_id フォルダ配下のみ upload / read / delete 可
CREATE POLICY "自分のファイルのみアップロード可"
  ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'cell-images' AND auth.uid()::text = (storage.foldername(name))[1]);
CREATE POLICY "自分のファイルのみ読み取り可"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'cell-images' AND auth.uid()::text = (storage.foldername(name))[1]);
CREATE POLICY "自分のファイルのみ削除可"
  ON storage.objects FOR DELETE
  USING (bucket_id = 'cell-images' AND auth.uid()::text = (storage.foldername(name))[1]);
```

**設計** (desktop [`imageSync.ts`](../src/lib/api/imageSync.ts) / iOS [`ImageStorage.swift`](../../ios/Mandalart/Services/ImageStorage.swift) 共通):

- `cells.image_path` は **ローカル相対パスのまま** (`images/<cellId>-<ts>.jpg`)。スキーマ変更なし。
- Storage オブジェクトキーは実行時に **`<userId>/<basename(image_path)>`** で導出。RLS policy が先頭フォルダ = `auth.uid()` を要求するため。
- **userId は小文字化必須**: Postgres の `auth.uid()::text` は小文字 UUID、iOS の `UUID.uuidString` は大文字 → 揃えないと RLS 403 + キー不一致 (落とし穴 #23)。
- アップロード時に JPEG 圧縮 (desktop: 長辺 1600px/q0.8、iOS: 1200px/q0.7)。
- 表示時、ローカルに実ファイルが無ければ Storage から download してローカルにキャッシュ。
- サインイン直後の同期 + 手動「今すぐ同期」で backfill (ローカルにあるが Storage 未アップロードの画像を回収)。
- 削除は v1 では Storage 側を消さない (`image_path` 共有あり)。orphan 整理は将来課題。
- Storage は **Realtime Messages quota とは無関係** (緊急停止中の同期問題を悪化させない)。

### 必須スキーマ変更: `synced_at` カラム (web 版共存に必須)

web 版 (`web/src/`) は全 Supabase write で `synced_at` を送信します (desktop の pull が「未同期」と誤判定して再 push するレースを防ぐため)。このカラムが Supabase 側にないと PGRST204 "Could not find the 'synced_at' column" が発生します。

```sql
ALTER TABLE mandalarts  ADD COLUMN IF NOT EXISTS synced_at TIMESTAMPTZ;
ALTER TABLE grids        ADD COLUMN IF NOT EXISTS synced_at TIMESTAMPTZ;
ALTER TABLE cells        ADD COLUMN IF NOT EXISTS synced_at TIMESTAMPTZ;
ALTER TABLE folders      ADD COLUMN IF NOT EXISTS synced_at TIMESTAMPTZ;
ALTER TABLE stock_items  ADD COLUMN IF NOT EXISTS synced_at TIMESTAMPTZ;
```

desktop の push.ts は `synced_at` を Supabase payload に含めないため、desktop 単体では問題は起きません。web 版を有効化するときに初めて必要になります。

---

### 必須スキーマ変更: ソフトデリート用の `deleted_at` カラム

削除のオフライン対応と複数デバイス間伝播のため、3 テーブルすべてに `deleted_at` カラムを追加してください。UI と API 層は `WHERE deleted_at IS NULL` で論理削除された行を隠し、同期は updated_at last-write-wins でクラウドに反映します。

```sql
ALTER TABLE mandalarts ADD COLUMN deleted_at timestamptz;
ALTER TABLE grids      ADD COLUMN deleted_at timestamptz;
ALTER TABLE cells      ADD COLUMN deleted_at timestamptz;
```

ローカル側は migration 002 で自動追加されます (`rm ~/Library/Application\ Support/jp.mandalart.app/mandalart.db` で DB を作り直した場合は 001 + 002 が連続実行されます)。

### 必須スキーマ変更: チェックボックス用の `done` カラム

セル単位の「完了状態」を保存するため cells テーブルに `done` カラムを追加してください (migration 003 に対応):

```sql
ALTER TABLE cells ADD COLUMN done BOOLEAN NOT NULL DEFAULT FALSE;
```

ローカル側は migration 003 で自動追加されます。

### 必須スキーマ変更: X と C の統一 (`center_cell_id`)

旧スキーマの `grids.parent_cell_id` を廃止し、代わりに `grids.center_cell_id TEXT NOT NULL` を採用します (migration 004 に対応)。子グリッドは自グリッド内に `position=4` の cell 行を持たなくなり、その代わり `center_cell_id` で親グリッドの drill 元 cell を直接参照します。

本アプリはまだ一般公開していないため、**既存データを破棄して再作成**することを前提とします。Supabase 側では以下を実行してください:

```sql
-- 既存データを保持する必要がなければ、3 テーブルを一旦 TRUNCATE してから DDL を適用
TRUNCATE TABLE cells, grids, mandalarts CASCADE;

-- カラム入れ替え
ALTER TABLE grids DROP COLUMN parent_cell_id;
ALTER TABLE grids ADD COLUMN center_cell_id TEXT NOT NULL;
CREATE INDEX IF NOT EXISTS idx_grids_center_cell ON grids(center_cell_id, sort_order);
```

ローカル側は migration 004 で自動的に全テーブルを DROP & CREATE します (既存の `mandalart.db` ファイルは再作成されます)。

### 必須スキーマ変更: 独立並列 center (`parent_cell_id`)

migration 006 で並列グリッドが独自の center cell を持てるようにするため、`grids.parent_cell_id TEXT` (nullable) を追加します。Supabase 側では以下を実行してください:

```sql
ALTER TABLE grids ADD COLUMN parent_cell_id TEXT;

-- 既存 drilled grid のバックフィル (root グリッドは NULL のまま)
UPDATE grids g
SET parent_cell_id = g.center_cell_id
FROM mandalarts m
WHERE g.mandalart_id = m.id
  AND g.center_cell_id != m.root_cell_id;
```

ローカル側は migration 006 で自動的に適用されます。
RLS ポリシーへの影響はなし (既存の `user_id` ベース policy は parent_cell_id を参照しません)。

### 必須スキーマ変更: チェックボックス表示設定 (`show_checkbox`)

migration 007 で「セル左上 done チェックボックス UI 表示 ON/OFF」をマンダラート単位で記憶 + クラウド同期する仕様に移行しました。Supabase 側では以下を実行してください:

```sql
ALTER TABLE mandalarts ADD COLUMN show_checkbox boolean NOT NULL DEFAULT false;
```

ローカル側は migration 007 で自動的に適用されます (SQLite は `INTEGER NOT NULL DEFAULT 0`)。
RLS ポリシーへの影響はなし。
旧 `mandalart.showCheckbox` localStorage は廃止 (新規 / 既存ともに OFF からスタートする)。

### 必須スキーマ変更: 前回開いていた sub-grid の記憶 (`last_grid_id`)

migration 008 で「ダッシュボードからマンダラートを再オープンしたときに、前回 drill していた sub-grid の階層を復元する」仕様を追加しました。Supabase 側では以下を実行してください:

```sql
ALTER TABLE mandalarts ADD COLUMN last_grid_id text;
```

ローカル側は migration 008 で自動的に適用されます (SQLite も TEXT、nullable、DEFAULT なし)。
TEXT なので push/pull 時の型変換は不要、null は「未設定 = root を開く」を意味します。
RLS ポリシーへの影響はなし。EditorLayout の `currentGridId` 変化監視 useEffect で都度書込・push 同期で他デバイスに伝播。stale (削除済み grid) の場合は復元時に root にフォールバック + DB 値を null に戻すクリーンアップが走ります。

### 必須スキーマ変更: ダッシュボード整理 (`sort_order` / `pinned`)

migration 009 で「ダッシュボードカードの手動並び替え + ピン留め」を追加しました。Supabase 側では以下を実行してください:

```sql
ALTER TABLE mandalarts ADD COLUMN sort_order integer;
ALTER TABLE mandalarts ADD COLUMN pinned boolean NOT NULL DEFAULT false;
```

ローカル側は migration 009 で自動的に適用されます (SQLite では INTEGER nullable / INTEGER NOT NULL DEFAULT 0)。
SQLite INTEGER 0/1 ↔ Supabase BOOLEAN は自動 boolean 正規化で互換 (`done` / `show_checkbox` と同パターン)。
RLS ポリシーへの影響はなし。card-to-card D&D で `reorderMandalarts` が一括 0..N で振り直し、★ ボタンで `pinned` を切替えて push 同期。

### 必須スキーマ変更: フォルダタブ (`folders` テーブル + `mandalarts.folder_id`)

migration 010 でダッシュボードのフォルダタブ機能を追加しました。Supabase 側では以下を実行してください:

```sql
-- folders テーブル
CREATE TABLE folders (
  id          text PRIMARY KEY,
  user_id     uuid NOT NULL REFERENCES auth.users(id),
  name        text NOT NULL,
  sort_order  integer NOT NULL DEFAULT 0,
  is_system   boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  deleted_at  timestamptz
);
ALTER TABLE folders ENABLE ROW LEVEL SECURITY;
CREATE POLICY "folders own" ON folders FOR ALL USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
-- updated_at 自動更新トリガー (他テーブルと同じパターン)
CREATE TRIGGER set_updated_at_folders BEFORE UPDATE ON folders FOR EACH ROW EXECUTE FUNCTION update_updated_at();
-- realtime 配信を有効化 (mandalarts/grids/cells と同じく)
ALTER PUBLICATION supabase_realtime ADD TABLE folders;

-- mandalarts.folder_id カラム
ALTER TABLE mandalarts ADD COLUMN folder_id text;
```

ローカル側は migration 010 で自動的に適用されます。
- `folders` テーブルは Supabase の `id text PRIMARY KEY` (mandalarts と同じく client 生成 UUID) と整合
- `is_system` は SQLite INTEGER 0/1 ↔ Supabase BOOLEAN の自動正規化で互換
- `mandalarts.folder_id` は client 側が `ensureInboxFolder()` bootstrap で必ず値を入れるため NOT NULL 制約は付けない (migration 順序の互換性確保)

RLS は user_id ベースで他デバイスと折衝なし。タブ追加 / 名前変更 / 削除 / カードのフォルダ移動はすべて push/pull/realtime で同期されます。

### 必須スキーマ変更: マンダラート ロック (`locked`)

migration 011 で「マンダラート単位のロック (= 編集不可)」を追加しました。Supabase 側では以下を実行してください:

```sql
ALTER TABLE mandalarts ADD COLUMN locked boolean NOT NULL DEFAULT false;
```

ローカル側は migration 011 で自動的に適用されます (SQLite は `INTEGER NOT NULL DEFAULT 0`)。
SQLite INTEGER 0/1 ↔ Supabase BOOLEAN は自動 boolean 正規化で互換 (`done` / `show_checkbox` / `pinned` と同パターン)。
RLS ポリシーへの影響はなし。ロック切替は別端末・別タブにも realtime で即時反映されエディタも自動 read-only に切り替わります。

---

## 新規 schema オブジェクト追加時の必須テンプレート

### 新規テーブル: 明示 GRANT + RLS (2026-10-30 〜 既存 project に enforce)

2026-10-30 以降、Supabase の Data API (supabase-js / REST `/rest/v1/` / GraphQL `/graphql/v1/`) は **明示的に GRANT されたテーブルしか公開しない** 仕様に変わります。**既存テーブルの grants は保持**されるので mandalarts / grids / cells / folders / stock_items は影響なしですが、**今後 `CREATE TABLE` する migration では必ず以下を同梱**してください (GRANT 漏れだと PostgREST が `42501` で 403 を返し、push が thrash 化 = 落とし穴 #17 と同症状):

```sql
-- (1) ロール別 GRANT
grant select on public.<table> to anon;
grant select, insert, update, delete on public.<table> to authenticated;
grant select, insert, update, delete on public.<table> to service_role;

-- (2) RLS 有効化
alter table public.<table> enable row level security;

-- (3) user_id ベース policy (既存テーブルと同じパターン)
create policy "<table> own" on public.<table>
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());
```

参考: 既存の `folders` テーブル (migration 010 節) はこのテンプレートに沿っているが GRANT が省略されている。`folders` は 2026-05-30 以前に作成されているため既存 grants が継承され enforce 後も動作するが、将来の新規テーブルからは GRANT 必須。

### 新規 function: `SET search_path` を明示

新規 function (`CREATE FUNCTION` / `CREATE OR REPLACE FUNCTION`) を作るときは **必ず `search_path` を明示**してください。Supabase Security Advisor が `function_search_path_mutable` WARN で検出する項目で、未指定だと search path hijack 攻撃の可能性が残ります:

```sql
create or replace function public.<func>(...)
returns ...
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  -- ...
end;
$$;
```

既存の `update_updated_at` (migration 005) は未指定のまま作成されており、以下で後追い修正可能:

```sql
alter function public.update_updated_at() set search_path = pg_catalog, public;
```

> 注: `update_updated_at` は落とし穴 #24 (Realtime echo) の根本原因。**Realtime subscribe 復帰時はこの `BEFORE UPDATE` トリガを無効化する** (ステップ 5「Realtime 復帰時: `BEFORE UPDATE` トリガの無効化」参照)。トリガを残す限り echo が settle しない。関数自体を残す場合の `search_path` 修正は上記 ALTER。

---

## ステップ 4: Auth 設定

### Email / Password

1. Authentication → **Sign In / Providers** → **Email** を有効化
2. 開発中は **Confirm email を OFF** にすると新規登録後すぐサインインできてテストが楽

### Google OAuth（オプション）

1. [Google Cloud Console](https://console.cloud.google.com/apis/credentials) で OAuth 2.0 Client ID を作成
2. 承認済みリダイレクト URI に Supabase の OAuth コールバック URL を追加:
   `https://xxxxxxxxxxxx.supabase.co/auth/v1/callback`
3. Client ID / Client Secret を Supabase の Authentication → Providers → Google に設定

### GitHub OAuth（オプション）

1. [GitHub OAuth Apps](https://github.com/settings/developers) で新規アプリ作成
2. Authorization callback URL に同じく `https://xxxxxxxxxxxx.supabase.co/auth/v1/callback`
3. Client ID / Client Secret を Supabase の Providers → GitHub に設定

### Redirect URLs (OAuth 共通)

Authentication → **URL Configuration** → **Redirect URLs** に以下を追加:

```
mandalart://auth/callback
```

これが無いと OAuth コールバックがアプリに戻ってきません。

---

## ステップ 5: Realtime の有効化

1. SQL Editor で以下を実行して、`folders` / `mandalarts` / `grids` / `cells` テーブルを `supabase_realtime` publication に含める:

```sql
ALTER PUBLICATION supabase_realtime ADD TABLE folders, mandalarts, grids, cells;
```

> 既存 setup (Phase A 以前) でこのステップを実行済みのユーザーは、上記の代わりに migration 010 節に記載の `ALTER PUBLICATION supabase_realtime ADD TABLE folders;` のみを実行 (差分のみ)。新規 setup ではこのステップ 5 で 4 テーブル一括登録すれば migration 010 節の同 ALTER は不要 (idempotent エラーは出ないが冗長)。

2. 確認:

```sql
SELECT tablename FROM pg_publication_tables WHERE pubname = 'supabase_realtime';
```

`mandalarts` / `grids` / `cells` が含まれていれば OK。

> 古い web プロトタイプで `005_triggers_and_functions.sql` の `REPLICA IDENTITY FULL` 設定済みなら、DELETE も含めて実運用できます。

### Realtime 復帰時: `BEFORE UPDATE` トリガの無効化 (必須・落とし穴 #24)

Realtime subscribe を復帰させる前に、`updated_at = NOW()` を書き換える `BEFORE UPDATE` トリガを **無効化** すること。これが残っていると、自分の push でも cloud 側 `updated_at` が進み、同一行が settle せず再 push され続けて Realtime Messages を量産する (= 2026-05-04 の 5 倍超過の温床)。両クライアントは既に `updated_at` を生成・送信しているので、トリガを外して `updated_at` をクライアント所有にしても last-write-wins は壊れない。

1. まず実機でトリガ名を確認 (docs では folders 分のみ確証):

```sql
SELECT tgname, tgrelid::regclass FROM pg_trigger WHERE NOT tgisinternal;
```

2. 4 テーブルのトリガを DROP (名前は手順 1 の結果に合わせる):

```sql
DROP TRIGGER IF EXISTS set_updated_at_folders    ON folders;
DROP TRIGGER IF EXISTS set_updated_at_mandalarts ON mandalarts;
DROP TRIGGER IF EXISTS set_updated_at_grids      ON grids;
DROP TRIGGER IF EXISTS set_updated_at_cells      ON cells;
-- update_updated_at() 関数は他参照が無ければ DROP FUNCTION public.update_updated_at(); も可
```

3. これは段階復帰の **段階 0** (購読を戻す前に適用)。適用しても購読停止中は Messages は増えないので安全に先行できる。

---

## ステップ 6: 動作確認

### メール認証

1. アプリ起動 → ダッシュボードの「サインイン」ボタン
2. 新規登録 (任意のメール + 6 文字以上のパスワード)
3. SyncIndicator が「⟳ 同期中...」→「⟳ HH:MM 同期済み」になれば OK

### Push

1. マンダラートを作成・編集 → ダッシュボードに戻る
2. 自動同期後、Supabase Table Editor で `mandalarts` / `grids` / `cells` に行が追加されているか確認

### Pull + 競合解決

1. Supabase Table Editor で `cells.text` を直接書き換え
2. アプリの「⟳ 今すぐ同期」ボタン → 該当マンダラートを開いて変更が反映されているか

### Realtime

1. アプリでマンダラートのエディタを開いたまま
2. Supabase Table Editor で `cells.text` を書き換え → Save
3. アプリ側で **手動同期せずに** セルが自動更新される

### OAuth (本番ビルド推奨)

1. `npm run tauri build` で本番ビルド → `/Applications/Mandalart.app` にインストール
2. 起動 → サインインダイアログ → Google / GitHub ボタン
3. ブラウザで認証 → コールバック → OS から「マンダラートで開く?」プロンプト → 許可 → アプリ側でサインイン完了

> `npm run tauri dev` のまま OAuth をテストすると、OS が `mandalart://` をどのアプリに紐付けるか曖昧なので、本番ビルドでの確認を推奨。

---

## 既知の制限（MVP スコープ外）

### マルチユーザー対応

現在のコードは **1 ローカル DB = 1 ユーザー** を前提にしています。同じ PC で別アカウントにサインインすると、前のユーザーのデータがそのアカウントに混ざります。マルチユーザー対応には `user_id` カラムをローカル側にも追加するなどの変更が必要です。

---

## トラブルシューティング

RLS 周りで疑いが出たら、まず [`security.md`](./security.md) の「再検証 SQL」で現在のポリシー状態を確認する。

### `同期エラー` / `permission denied for table mandalarts`

- RLS 有効で `user_id = auth.uid()` を満たしていない行がある
- 対策: サインイン状態を確認、`user_id` が正しく `auth.users.id` にマッチしているか
- RLS ポリシー自体の検証は [`security.md`](./security.md) 参照

### `PGRST 42501` / `permission denied for table <name>` (新規テーブル)

- 2026-10-30 以降に作成した新規テーブルで GRANT 漏れ。Data API がデフォルトで公開しない仕様変更の影響
- 対策: 上記「新規 schema オブジェクト追加時の必須テンプレート」の (1)〜(3) を Supabase SQL Editor で実行
- 既存テーブル (mandalarts / grids / cells / folders / stock_items) では発生しない (grants 保持される)

### `relation "mandalarts" does not exist`

- スキーマ未適用
- 対策: ステップ 3 のマイグレーション SQL をすべて実行

### サインアップで 422 Bad Request + `identities: []` の偽ユーザーレスポンス

- そのメールアドレスは既に登録済み。Supabase の email enumeration 防止機能で偽ユーザー情報を返している
- 対策: サインインに切り替える、または Authentication → Users で既存ユーザーを削除

### Realtime で変更が届かない

- publication に対象テーブルが入っていない
- 対策: `SELECT tablename FROM pg_publication_tables WHERE pubname = 'supabase_realtime';` で確認 → 足りなければ `ALTER PUBLICATION supabase_realtime ADD TABLE ...`

### OAuth でアプリに戻ってこない (dev ビルド)

- `mandalart://` のハンドラ登録が OS 上で確定していない
- 対策: `npm run tauri build` で本番ビルドを作ってインストールしてからテスト

### `Network error` / `fetch failed`

- `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` が `.env` にない、または Vite が読み込めていない
- 対策: `desktop/.env` の存在確認、Tauri を完全終了して `npm run tauri dev` で再起動
