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
6. `006_storage.sql` (画像ストレージ用、cloud 画像同期を後で実装するときに必要)

> **⚠️ 重要**: スキーマ適用後、下記「既知のスキーマ修正」を必ず実施してください。

### 既知のスキーマ修正: 循環 FK の削除

`002_create_grids.sql` で定義されている `grids.parent_cell_id → cells(id)` の FK 制約は、`cells.grid_id → grids(id)` との組み合わせで循環を作り、以下の問題を起こします:

- **push 時**: `mandalarts → grids → cells` の順に upsert するが、grids の parent_cell_id が参照する cells はまだ存在せず FK 違反 (PostgreSQL error 23503)
- **delete 時**: 削除時に循環カスケードが走り "too many levels of trigger recursion" エラー

ローカル側 ([`migration 001`](../src-tauri/migrations/001_initial.sql)) でも同じ理由でこの FK は付けていません。クラウド側も同じく削除してください:

```sql
ALTER TABLE grids DROP CONSTRAINT grids_parent_cell_id_fkey;
```

`parent_cell_id` カラム自体は残り、引き続き UUID として `cells.id` を指しますが、参照整合性は API レイヤで明示的に管理します。

### 必須スキーマ変更: ソフトデリート用の `deleted_at` カラム

削除のオフライン対応と複数デバイス間伝播のため、3 テーブルすべてに `deleted_at` カラムを追加してください。UI と API 層は `WHERE deleted_at IS NULL` で論理削除された行を隠し、同期は updated_at last-write-wins でクラウドに反映します。

```sql
ALTER TABLE mandalarts ADD COLUMN deleted_at timestamptz;
ALTER TABLE grids      ADD COLUMN deleted_at timestamptz;
ALTER TABLE cells      ADD COLUMN deleted_at timestamptz;
```

ローカル側は migration 002 で自動追加されます (`rm ~/Library/Application\ Support/jp.mandalart.app/mandalart.db` で DB を作り直した場合は 001 + 002 が連続実行されます)。

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

1. SQL Editor で以下を実行して、`mandalarts` / `grids` / `cells` テーブルを `supabase_realtime` publication に含める:

```sql
ALTER PUBLICATION supabase_realtime ADD TABLE mandalarts, grids, cells;
```

2. 確認:

```sql
SELECT tablename FROM pg_publication_tables WHERE pubname = 'supabase_realtime';
```

`mandalarts` / `grids` / `cells` が含まれていれば OK。

> 古い web プロトタイプで `005_triggers_and_functions.sql` の `REPLICA IDENTITY FULL` 設定済みなら、DELETE も含めて実運用できます。

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

### `insert or update on table "grids" violates foreign key constraint "grids_parent_cell_id_fkey"` (23503)

- クラウドスキーマで循環 FK を削除していない
- 対策: 「既知のスキーマ修正」の `ALTER TABLE grids DROP CONSTRAINT ...` を実行

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
