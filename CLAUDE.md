# CLAUDE.md

このファイルは Claude Code がこのリポジトリで作業する際の **router** です。
**作業に入る前に必ず該当プラットフォームの CLAUDE.md も読むこと**:

- desktop 配下の作業 → [`desktop/CLAUDE.md`](desktop/CLAUDE.md)
- iOS 配下の作業 → [`ios/CLAUDE.md`](ios/CLAUDE.md)
- 両方触るとき → 両方を読む

## ⚠️ Supabase Realtime 緊急停止中 (2026-05-04 〜)

Supabase 運営から **Realtime Messages 過剰使用警告** (10.4M / 2.2M 制限、約 5 倍超過) を受け、両プラットフォームの自動同期経路を緊急停止中。

**停止中の経路**:
- iOS: `RealtimeService.subscribe` / 15 秒 auto-push polling / `scenePhase` 遷移時の pull/push (= [`MandalartApp.swift`](ios/Mandalart/App/MandalartApp.swift))
- desktop: [`useSync`](desktop/src/hooks/useSync.ts) と [`useRealtime`](desktop/src/hooks/useRealtime.ts) の `subscribeRemoteChanges` / [`useVisibilityResync`](desktop/src/hooks/useVisibilityResync.ts) の `pullAll`

**残している経路**: サインイン直後 1 回の syncAll/fullSync + 設定画面の手動「今すぐ同期」ボタン

**復帰前のチェックリスト** (現状は 2026-06-07 時点。コード実体で確認済):
1. Supabase Dashboard → Project → Reports → Realtime Messages の累積グラフが水平に張り付くこと — 現状(2026-06-07): 運用タスク・未実施
2. Supabase 側の `BEFORE UPDATE` トリガによる `updated_at = NOW()` 書き換え動作を確認 (echo を防ぐには無効化が必須かもしれない) — 現状(2026-06-07): トリガ存在は確認済 ([`cloud-sync-setup.md`](desktop/docs/cloud-sync-setup.md))、無効化要否の判断は復帰時
3. echo skip ロジックを iOS / desktop 両方で完全実装 — 現状(2026-06-08): **cloud realtime 経路は未完成** (旧 vault 経路の write ledger は Markdown vault 廃止に伴い消滅)
4. subscribe 経路を 1 本に統合 (`useSync` と `useRealtime` の重複排除) — 現状(2026-06-07): ❌ 未着手。両者とも別々に `subscribeRemoteChanges` をコメントアウト保持したまま並存
5. iOS の 15 秒 polling は永久に廃止し、mutation 駆動の dirty flag + 60 秒以上 debounce に置換 — 現状(2026-06-07): polling 廃止済 (コメントアウト) ✅ / **dirty flag + 60 秒 debounce への置換は未実装** ❌

> 復帰には最低でも #4 (subscribe 統合) と #5 (dirty flag 実装) の追加実装が残っている。

詳細経緯と段階復帰計画: [`/Users/maro02/.claude/plans/ios-swift-glistening-thacker.md`](/Users/maro02/.claude/plans/ios-swift-glistening-thacker.md)
desktop 側落とし穴: [`desktop/CLAUDE.md`](desktop/CLAUDE.md) #24

## プロジェクト概要

マンダラート — 3×3 グリッドで思考を階層的に展開するアプリ。**2 つの並列実装** が存在する:

| プラットフォーム | スタック | 配置 | 状態 |
|---|---|---|---|
| **desktop** | Tauri v2 + Vite + React 19 + TypeScript + SQLite | [`desktop/`](desktop/) | リリース運用中 |
| **iOS** | Swift + SwiftUI + SwiftData | [`ios/`](ios/) | Phase 0-3 完了 / Landscape 限定の技術検証段階 |

両者は **同一 Supabase project (Postgres)** を共有してクロスデバイス同期する。スキーマ仕様は desktop 側 ([`desktop/docs/data-model.md`](desktop/docs/data-model.md), [`desktop/docs/cloud-sync-setup.md`](desktop/docs/cloud-sync-setup.md)) を canonical 扱い、iOS 側 ([`ios/Mandalart/Models/`](ios/Mandalart/Models/)) は等価な @Model で定義する ([`ios/docs/data-model.md`](ios/docs/data-model.md))。

[`_old_web/`](_old_web/) は旧 Next.js 試作でメンテ停止。

## 共通の git / コミットポリシー

- コミット message は **日本語**、`feat(scope): ...` / `fix(scope): ...` / `refactor(scope): ...` / `docs(scope): ...` の Conventional Commits 風
- scope 例: `editor` / `dashboard` / `welcome` / `sync` / `lock` / `ios` / `menu`
- Co-Authored-By trailer を付ける (Claude が書いた commit 全般)
- pre-commit hook (desktop 側 typecheck + lint-staged) を **`--no-verify` でスキップしない**。失敗したら原因を直して新規 commit を作る (`--amend` 避ける)
- 機密ファイル (`.env`, `Secrets.swift`, credentials.json 等) を含めない
- destructive な git 操作 (`reset --hard` / `push --force` / branch -D) は **明示指示** がない限り実行しない

## 共通のデバッグ / 原因調査の方針

バグ調査では **推測・憶測で修正を当てない**。原因が不確実なときは、まず実体を観測してから対処する:

1. **診断ログを先に仕込む** — 失敗経路の catch で `console.error` (desktop) / `print`・`logger` (iOS) を使い、**raw error オブジェクト全体** (message だけでなく `error.code` / 失敗した SQL / 関連 id 等) を出す。曖昧なら複数の候補経路すべてに仕込む
2. **再現させてエラー実体を確定** — 推定したエラー名 (例「database is locked」) が**本当にそれか**をログで確認してから修正する。表面的な現象 (「起動直後」「再現性が低い」) と真因 (実際は pending synthetic cell の id すり抜け) はしばしば無関係
3. **影響範囲が広い箇所ほど慎重に** — core / DB / 同期など全体に効く修正は、仮説が強くても runtime 証拠を取ってから着手する ([`desktop/CLAUDE.md`](desktop/CLAUDE.md) 落とし穴 #3 / #12 の「database is locked」のように、もっともらしい仮説が外れることがある)
4. **一時診断ログは原因特定後に撤去** — コメントに「診断用 (一時)」と明記し、修正完了時に削除する

> 実例 (2026-05-24): 「周辺セルへのインポート失敗」を当初「起動時 syncAll との DB ロック競合」と推測したが、診断ログで真因が `pending:<gridId>:<position>` という synthetic cell の id を `importIntoCell` にそのまま渡していた (`Cell not found`) と判明し、的確に修正できた。

## 共通の Supabase ポリシー

- desktop と iOS は同一 project を使う。ローカル env: desktop は [`desktop/.env`](desktop/.env)、iOS は [`ios/Mandalart/Services/Secrets.swift`](ios/Mandalart/Services/Secrets.swift) (gitignore 済、`Secrets.swift.template` をコピーして埋める)
- **スキーマ変更フロー**:
  1. desktop 側で migration SQL 追加 ([`desktop/src-tauri/migrations/`](desktop/src-tauri/migrations/))
  2. [`desktop/src-tauri/src/lib.rs`](desktop/src-tauri/src/lib.rs) に Migration 登録
  3. [`desktop/docs/data-model.md`](desktop/docs/data-model.md) 更新
  4. **Supabase 側で手動 ALTER TABLE を実行** ([`desktop/docs/cloud-sync-setup.md`](desktop/docs/cloud-sync-setup.md) の手順に従う、未実行だと PGRST204 thrash 化 — desktop 側落とし穴 #17 参照)
  5. iOS 側の @Model も同等に更新 (`ios/Mandalart/Models/*.swift`、[`ios/docs/data-model.md`](ios/docs/data-model.md))
- migration 追加時は `migration-release-check` subagent ([`.claude/agents/migration-release-check.md`](.claude/agents/migration-release-check.md)) を proactively 起動して漏れチェック
- 同期戦略 (last-write-wins / soft delete / zombie cleanup / postgres_changes realtime) は両プラットフォームで同等。詳細は [`desktop/CLAUDE.md`](desktop/CLAUDE.md) 「知っておくべき落とし穴」 #2 / #10 / #12 / #17 と [`ios/docs/sync.md`](ios/docs/sync.md) を相互参照

## docs / CLAUDE.md 構造

- ルート (このファイル): 共通方針 + プラットフォーム CLAUDE.md への router
- [`desktop/CLAUDE.md`](desktop/CLAUDE.md): Tauri / desktop 固有のコマンド・規約・落とし穴 (21 件) — desktop 触るときは必読
- [`desktop/docs/`](desktop/docs/): 機能要件 / data-model / API / アニメ / Supabase setup / リリース手順 等の詳細仕様 (canonical)
- [`ios/CLAUDE.md`](ios/CLAUDE.md): iOS 固有のビルド手順・Swift 規約・iOS 落とし穴インデックス
- [`ios/docs/`](ios/docs/): xcodegen workflow / Swift モデル ↔ Supabase スキーマ対応 / SyncEngine 詳細 / iOS 固有 pitfalls 等
- [`shared/DIVERGENCES.md`](shared/DIVERGENCES.md): **desktop ↔ iOS の既知の乖離レジストリ** (停止中 / 意図的非対称=unify 禁止 / 解消済 / 要確認)。クロスプラットフォーム作業で「この表に無い挙動差 = 偶発の乖離 (バグ) を疑う」起点。乖離を見つけ/解消したら更新する

shared な仕様 (data-model 詳細 / 機能要件 / Supabase setup) は **desktop/docs/ を canonical** とし、iOS docs は差分のみ書いて重複を避ける。
