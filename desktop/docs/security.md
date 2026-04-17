# セキュリティ設計と監査手順 — マンダラート デスクトップアプリ

このドキュメントは Supabase クラウド同期を有効にした場合のセキュリティ境界と、その設定が維持されているかを定期的に再検証するための手順をまとめる。設定変更 (新テーブル追加 / 新バケット追加) のたびにこのチェックリストを通すこと。

---

## 脅威モデル

- **ユーザー**: 個人利用を想定。複数ユーザーが同じ Supabase プロジェクトにサインインする可能性あり
- **配布物**: Tauri バンドル (.dmg / .msi) に `VITE_SUPABASE_URL` と `VITE_SUPABASE_ANON_KEY` が埋め込まれる
- **前提**: anon key は誰でも入手可能 (配布バイナリから抽出可)。このキー単体で「認証された状態」にはならない

## 防御層

```
Layer 1: Tauri バンドル内の anon key (誰でも入手可)
  ↓ (認証なしではどのテーブルも読めない)
Layer 2: Supabase Auth (サインイン成功時のみ auth.uid() が JWT に入る)
  ↓ (リクエストに JWT 必須)
Layer 3: RLS (各テーブルで auth.uid() = user_id の行のみ許可)
```

**重要**: Layer 3 の RLS が壊れると Layer 1・2 を突破した攻撃者 (= サインイン済みの悪意あるユーザー) が他人のデータを読める。新テーブル追加時に RLS をかけ忘れるのが最大のリスク。

---

## 現状の監査結果

最後に確認した日: 2026-04-18

### ✅ テーブル RLS (public スキーマ)

| テーブル | RLS 有効 | ポリシー条件 |
|---|---|---|
| `mandalarts` | ✅ | `auth.uid() = user_id` |
| `stock_items` | ✅ | `auth.uid() = user_id` |
| `grids` | ✅ | 親 `mandalart.user_id = auth.uid()` を EXISTS で確認 |
| `cells` | ✅ | 祖父 `mandalart.user_id = auth.uid()` を 2 段 join |

すべて `cmd = ALL` / `roles = {public}`、`with_check` は null だが PostgreSQL 仕様で `USING` (qual) が fallback されるので INSERT / UPDATE 後の値検証も同条件で行われる。

### ✅ Storage ポリシー (`storage.objects`)

| コマンド | 条件 |
|---|---|
| INSERT / SELECT / DELETE | `bucket_id = 'cell-images' AND auth.uid() = storage.foldername(name)[1]` |

ファイルは `<user_id>/...` のフォルダ配下に保存され、自分の user_id ディレクトリ以外は触れない。

### ✅ その他

- **`service_role` key 不使用**: フロント / Tauri / CI どこにも存在しない (grep 済)
- **`.env` は gitignore 済み**: `desktop/.env` は commit 対象外

### ⚠️ 残確認項目

- `storage.buckets.public` の値確認 (下記 SQL) — `cell-images` バケットは現在アプリから未使用 (画像は local `$APPDATA/images/` のみ保存) なので cloud 画像同期を実装するまでの猶予あり

---

## 再検証 SQL

Supabase Dashboard → SQL Editor で定期的に実行し、上記の監査結果と一致するか確認する。

### 1. RLS が全テーブルで有効か

```sql
SELECT tablename, rowsecurity
FROM pg_tables
WHERE schemaname = 'public';
```

期待: `mandalarts` / `grids` / `cells` / `stock_items` がすべて `rowsecurity = true`。新テーブルを追加した場合はそれも `true` であること。

### 2. ポリシー条件式の確認

```sql
SELECT tablename, policyname, cmd, qual, with_check
FROM pg_policies
WHERE schemaname = 'public';
```

期待: `qual` に `auth.uid()` が含まれること。新テーブルに対応するポリシーが存在すること。

### 3. Storage ポリシー

```sql
SELECT policyname, cmd, qual, with_check
FROM pg_policies
WHERE schemaname = 'storage' AND tablename = 'objects';
```

期待: INSERT / SELECT / DELETE すべてに `bucket_id = '<バケット名>' AND auth.uid() = storage.foldername(name)[1]` 相当の条件があること。

### 4. Storage バケットの公開設定

```sql
SELECT id, name, public
FROM storage.buckets;
```

期待: **`public = false`**。`true` だと URL 直叩きで RLS バイパスされ、誰でも読める。

---

## 変更時のチェックリスト

### 新テーブルを追加するとき

- [ ] マイグレーション SQL で `ALTER TABLE <name> ENABLE ROW LEVEL SECURITY;` を必ず含める
- [ ] `CREATE POLICY` で `auth.uid() = user_id` または親テーブル経由の所有者チェックを追加
- [ ] 上記「再検証 SQL」1 と 2 を実行して期待通りか確認
- [ ] 本ドキュメントの「テーブル RLS」表に新テーブルを追加

### 新 Storage バケットを追加するとき

- [ ] バケット作成時に `public = false` を設定
- [ ] `storage.objects` に対し INSERT / SELECT / DELETE のポリシーを追加 (自分のフォルダのみアクセス可)
- [ ] 「再検証 SQL」3 と 4 で確認
- [ ] 本ドキュメントの「Storage ポリシー」表を更新

### 設定変更で疑いが出たとき

- [ ] `storage.buckets.public = true` になっていないか (最大リスク)
- [ ] いずれかのテーブルで `rowsecurity = false` になっていないか
- [ ] `service_role` key が GitHub Actions / `.env` / コードに混入していないか (`git grep -i service_role`)

---

## Supabase Dashboard で追加確認する項目

SQL では見えない設定。年 1〜2 回チェック:

| 項目 | 場所 | 推奨値 |
|---|---|---|
| Confirm email | Authentication → Providers → Email | **ON** (開発中は OFF で可、本番は ON 推奨) |
| Allow new signups | Authentication → Policies | 個人利用なら **OFF** (自分がサインアップ後) |
| 月次 usage アラート | Project Settings → Usage | プリペイド上限を設定 |
| OAuth redirect URLs | Authentication → URL Configuration | `mandalart://auth/callback` のみ許可 |

---

## 関連ドキュメント

- [`cloud-sync-setup.md`](./cloud-sync-setup.md) — Supabase プロジェクトの初期セットアップ手順 (RLS ポリシー作成 SQL 含む)
- [`data-model.md`](./data-model.md) — テーブルスキーマと FK 設計の根拠
