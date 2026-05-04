---
description: コード変更が docs に反映されているか検査する (書込みは行わずレポートのみ)
---

# /sync-docs

直近のコード変更が [`desktop/docs/`](desktop/docs/) / [`ios/docs/`](ios/docs/) / 各 CLAUDE.md に反映されているか機械的に検査する。**漏れの検出と提案文の生成のみで、docs の書換は行わない**。実際の更新はユーザーが個別に承認した後で通常の Edit ツールで行う。

スキーマ変更 (= desktop migration 追加) は **両プラットフォームに影響** するため、本コマンドは desktop / iOS 両方の docs / コード反映漏れを 1 度の実行で検出する。

## 引数 ($ARGUMENTS)

- 空: uncommitted な変更を対象 (`git status` / `git diff`)
- `HEAD~N`: 最新 N コミット分の差分 (`git diff HEAD~N..HEAD`)
- `main` / `<branch>`: そのブランチとの差分 (`git diff <branch>...HEAD`)
- それ以外: そのまま `git diff` の引数として扱う

## 手順

### 1. 変更ファイル一覧を取得

引数に応じて以下を実行し、変更ファイルパスを集める:

- 空 → `git status -s` + `git diff --stat`
- 非空 → `git diff <args> --stat`

`_old_web/` 配下は対象外。`desktop/` / `ios/` / repo root を対象に拾う。

### 2. ファイルパスをカテゴリ分類

**desktop 側の変更**:

| カテゴリ | パターン | 期待される対応 docs |
|---|---|---|
| migration 追加 | `desktop/src-tauri/migrations/*.sql` (新規) | `desktop/docs/data-model.md` のスキーマ表 + マイグレーション一覧、`desktop/docs/cloud-sync-setup.md` の「必須スキーマ変更」、`desktop/src-tauri/src/lib.rs` の Migration array、★ **iOS 側にも反映必要** (下表参照) |
| constants 追加/変更 | `desktop/src/constants/*.ts` の新規 `export` | `desktop/CLAUDE.md` の「ハードコーディング禁止」表、`desktop/docs/animations.md` の定数表 (timing 系) |
| API 関数追加 | `desktop/src/lib/api/*.ts` / `desktop/src/lib/sync/*.ts` の新規 `export async function` | `desktop/docs/api-spec.md` の対応セクション |
| Zustand store 追加 | `desktop/src/store/*.ts` の新規 store / action | `desktop/docs/api-spec.md` の Zustand セクション |
| 型追加 | `desktop/src/types/index.ts` の新規 `export type` / フィールド追加 | `desktop/docs/api-spec.md`、`desktop/docs/data-model.md` |
| 新規 component | `desktop/src/components/**/*.tsx` の新規ファイル | `desktop/docs/folder-structure.md` |
| 新規 hook | `desktop/src/hooks/*.ts` の新規ファイル | `desktop/docs/folder-structure.md` |
| animation 関連 | `desktop/src/index.css` の新規 `@keyframes`、`desktop/src/constants/timing.ts` の `*_DURATION_MS` / `*_STAGGER_MS`、`desktop/src/components/ConvergeOverlay.tsx` の direction 追加 | `desktop/docs/animations.md` |

**iOS 側の変更**:

| カテゴリ | パターン | 期待される対応 |
|---|---|---|
| @Model フィールド追加 | `ios/Mandalart/Models/*.swift` の `@Model` 構造体への新フィールド | ① `ios/Mandalart/Services/SyncEngine.swift` の `Cloud<Table>` DTO に snake_case で追加 ② 同 SyncEngine の `pullAll` の `.select(...)` 列、`pushPending` の payload に追加 ③ `ios/docs/data-model.md` の対応表 (camelCase ↔ snake_case) に追記 |
| 新規 Service / Repository | `ios/Mandalart/Services/*.swift` の新規ファイル | `ios/docs/architecture.md` のフォルダ構成ツリーに追記 |
| 新規 ViewModel | `ios/Mandalart/ViewModels/*.swift` の新規ファイル | `ios/docs/architecture.md` |
| 新規 View / Component | `ios/Mandalart/Views/**/*.swift` の新規ファイル | `ios/docs/architecture.md` |
| Utils 追加 | `ios/Mandalart/Utils/*.swift` の新規 enum / 定数 | `ios/CLAUDE.md` の「Swift コード規約 / ハードコーディング禁止」表、`ios/docs/architecture.md` |
| 落とし穴に該当する変更 | iOS 開発で踏んだ新しい罠 | `ios/docs/pitfalls.md` に追記 (番号付き、症状 / 原因 / 対処) |

**desktop migration → iOS 反映の連動チェック** (= 落とし穴 #17 PGRST204 thrash 防止):

migration N が追加されたら以下すべて確認:

1. `desktop/src-tauri/migrations/N_<name>.sql` 存在
2. `desktop/src-tauri/src/lib.rs` の Migration array に登録
3. `desktop/docs/data-model.md` 反映
4. `desktop/docs/cloud-sync-setup.md` の Supabase 手動 ALTER 手順
5. ★ `ios/Mandalart/Models/<Table>.swift` の `@Model` に対応 field 追加
6. ★ `ios/Mandalart/Services/SyncEngine.swift` の `Cloud<Table>` DTO に snake_case で追加
7. ★ 同 SyncEngine の `pullAll` の `select(...)` 列に追加
8. ★ 同 SyncEngine の `pushPending` の payload に追加
9. ★ `ios/docs/data-model.md` の対応表に追記

### 3. カテゴリごとに反映状況を検査

各カテゴリで以下を grep / Read ベースで確認:

#### migration 追加 (= desktop / iOS 両方反映必須)

1. 新規 SQL ファイル名から version を抽出 (例: `008_mandalart_last_grid_id.sql` → `008`)
2. `grep -n "version: 8" desktop/src-tauri/src/lib.rs` で Migration array に登録されているか確認
3. `grep -n "migration 008\|008_" desktop/docs/data-model.md` で言及があるか確認 (スキーマ表 + マイグレーション一覧)
4. `grep -n "migration 008\|ALTER TABLE.*<新カラム名>" desktop/docs/cloud-sync-setup.md` で「必須スキーマ変更」節に Supabase ALTER 手順が追記されているか確認
5. **iOS 反映** (= 落とし穴 #17 を両プラットフォームで防ぐ):
   - SQL から新規 / 変更されたテーブル名 + カラム名を抽出 (例: `ALTER TABLE mandalarts ADD COLUMN last_grid_id`)
   - `grep -n '<カラム名 camelCase>' ios/Mandalart/Models/<Table>.swift` で `@Model` の field に存在するか確認
   - `grep -n '<カラム名 snake_case>' ios/Mandalart/Services/SyncEngine.swift` で:
     - `Cloud<Table>` DTO の Codable property に存在するか
     - `pullAll` の `.select(...)` 列名に含まれているか
     - `pushPending` の payload (`<table>Payload`) に追加されているか
   - `grep -n '<カラム名>' ios/docs/data-model.md` で対応表に記載されているか
6. **migration 追加は常に🔴優先度高で報告する** — Supabase 手動 ALTER 忘れは PGRST204 thrash (落とし穴 #17) 直結、iOS 反映漏れは型不整合や同期データ欠損を引き起こす

#### constants 追加

1. `git diff <range> -- desktop/src/constants/` の出力から `^\+export const` を grep して新規 symbol を抽出
2. `CLAUDE.md` の「ハードコーディング禁止」表の対応行 (`timing.ts` / `layout.ts` 等) に symbol が含まれるか grep
3. timing 系 (`*_DURATION_MS` / `*_STAGGER_MS`) は `desktop/docs/animations.md` の定数表にも記載されるべき → grep 確認

#### API / store / 型 / component / hook 追加

1. `git diff <range> -- <該当パス>` から `^\+export ` で始まる新規宣言を抽出
2. 対応する docs ファイル (`api-spec.md` / `folder-structure.md` 等) を Read して symbol 名 / ファイル名が grep でヒットするか確認

#### animation 関連

1. `desktop/src/index.css` の新規 `@keyframes <name>` を抽出 → `desktop/docs/animations.md` に説明があるか
2. `ConvergeOverlay.tsx` の `direction === 'X'` の新規分岐 → `animations.md` "5. Converge Overlay" 節の方向表に X が含まれるか

#### iOS 側変更

1. `git diff <range> -- ios/Mandalart/` から新規ファイルを `^A` (added) で抽出
2. 各カテゴリ別に対応 docs を確認:
   - `ios/Mandalart/Models/*.swift` 変更 → `ios/docs/data-model.md` の対応表に追記済か
   - `ios/Mandalart/Services/*.swift` 新規 → `ios/docs/architecture.md` のフォルダ構成ツリーにファイル名 + 1 行説明があるか
   - `ios/Mandalart/Views/**/*.swift` 新規 → `ios/docs/architecture.md` の Components / Views 節に記載
   - `ios/Mandalart/Utils/*.swift` 新規 enum / 定数 → `ios/CLAUDE.md` の「Swift コード規約」表に含まれるか
3. 落とし穴に該当する新しいバグ修正 (commit message に「落とし穴」「pitfall」「fix」等) → `ios/docs/pitfalls.md` 反映確認

### 4. レポートの構造

```markdown
## docs 同期チェック結果

対象: <range> (変更ファイル <N> 件)

### 🔴 優先度高 (リリース前必須 / 重大事故予防)
- [`desktop/docs/cloud-sync-setup.md`](desktop/docs/cloud-sync-setup.md) — migration 009
  の Supabase ALTER 手順が未記載 (落とし穴 #17 / PGRST204 thrash の温床)
- ...

### 🟡 優先度中
- [`desktop/docs/api-spec.md`](desktop/docs/api-spec.md) — `<関数名>` (`desktop/src/lib/api/<file>.ts`) が未記載
- ...

### 🟢 漏れなし
- migration 008 → data-model.md / cloud-sync-setup.md / lib.rs / api-spec.md に反映済み
- ...

### 提案
各項目について「対応 docs にどう追記すべきか」のドラフト文を提示。
実際の書込みはユーザー承認後に通常の Edit ツールで行う (本コマンドは検査専用)。
```

### 5. 制約

- **書込みは行わない**。Edit / Write ツールは使わずレポートを返すだけ
- 軽微な誤字 / コメント差分は対象外、本質的 API / 仕様レベルのみ
- `_old_web/` (旧 Next.js 試作) は対象外
- 既存ですでに古い記述 (今回の diff 範囲外) は触れない (本コマンドの責務外)
- 削除された symbol も検出 (docs に書かれているのにコードから消えた → docs を消すべき / 関連節を更新すべき)
- 1 つの diff 範囲で 0 件の変更ならば「対象なし」と簡潔に返す
- 完璧な静的解析は目指さない (false positive は人間判断で除外)

## 注意点

1. migration 追加は **常に 🔴 優先度高** にする (Supabase 手動 ALTER 漏れ防止が最重要)
2. constants は CLAUDE.md と animations.md (timing 系のみ) の **両方** を確認すること
3. API 追加検出時は同期 (push / pull / realtime) が絡むなら `cloud-sync-setup.md` も追加チェック対象
4. レポートは 60 秒以内で出力できる粒度に保つ (詳細すぎる diff は最後に「他 N 件」で省略可)
