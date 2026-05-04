# CLAUDE.md

このファイルは Claude Code がこのリポジトリで作業する際の **router** です。
**作業に入る前に必ず該当プラットフォームの CLAUDE.md も読むこと**:

- desktop 配下の作業 → [`desktop/CLAUDE.md`](desktop/CLAUDE.md)
- iOS 配下の作業 → [`ios/CLAUDE.md`](ios/CLAUDE.md)
- 両方触るとき → 両方を読む

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

shared な仕様 (data-model 詳細 / 機能要件 / Supabase setup) は **desktop/docs/ を canonical** とし、iOS docs は差分のみ書いて重複を避ける。
