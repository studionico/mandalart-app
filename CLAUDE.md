# CLAUDE.md

このファイルは Claude Code がこのリポジトリで作業する際の **router** です。
**作業に入る前に必ず該当プラットフォームの CLAUDE.md も読むこと**:

- desktop 配下の作業 → [`desktop/CLAUDE.md`](desktop/CLAUDE.md)
- iOS 配下の作業 → [`ios/CLAUDE.md`](ios/CLAUDE.md)
- web 配下の作業 → [`desktop/CLAUDE.md`](desktop/CLAUDE.md) を参照 (UI コンポーネント / API 仕様は desktop と共通。Tauri 固有箇所は web/src 側で置換済み)
- 両方触るとき → 両方を読む

## ⚠️ Supabase Realtime 段階復帰中 (2026-05-04 緊急停止 → 2026-06-08 復帰着手)

Supabase 運営から **Realtime Messages 過剰使用警告** (10.4M / 2.2M 制限、約 5 倍超過) を受け緊急停止していた自動同期経路を、恒久対策込みで **段階復帰中**。コード側の復帰実装は完了し、残るは Supabase 設定適用 + Dashboard 監視を挟む運用ロールアウト。

**復帰実装の要点** (2026-06-08 実装済・コード実体で確認済):
1. **subscribe を 1 本に統合** — desktop は App レベルの [`useRealtimeSync`](desktop/src/hooks/useRealtimeSync.ts) 1 箇所のみが購読。[`useSync`](desktop/src/hooks/useSync.ts) / [`useRealtime`](desktop/src/hooks/useRealtime.ts) は購読を持たず `app:sync-pulled` イベントの reload 経路に徹する ✅
2. **echo skip** — desktop は [`realtime.ts`](desktop/src/lib/realtime.ts) の content 比較で実装済。iOS は「任意 change → 1 秒 debounce `pullAll`」方式で echo を冪等吸収 (pull は GET + 非 dirty write で broadcast を生まない) ✅
3. **iOS の 15 秒 polling を永久廃止** — mutation 駆動の [`SyncDirtyTracker`](ios/Mandalart/Services/SyncDirtyTracker.swift) (`ModelContext.didSave` 観測 + `dirtyPushDebounceSec`=60 秒 sliding debounce) に置換。`scenePhase .background` で即 flush ✅
4. **BEFORE UPDATE トリガ無効化** — `updated_at` をクライアント所有にし echo を即 settle させる。**Supabase 側で手動 SQL 適用が必要** ([`cloud-sync-setup.md`](desktop/docs/cloud-sync-setup.md) ステップ 5「Realtime 復帰時: `BEFORE UPDATE` トリガの無効化」)

**段階ロールアウト** (各段階の間に最低 24h、Dashboard → Reports → Realtime Messages グラフの水平維持を確認。最重要監視: 「編集を止めたら Messages が平らになるか」= runaway の有無):
- 段階 0: トリガ無効化 SQL を適用 (購読停止中なので Messages は増えない)
- 段階 1: desktop 購読 1 本 (`useRealtimeSync` マウント済)
- 段階 2: desktop visibility pullAll 復帰 (`useVisibilityResync` 復帰済)
- 段階 3: iOS subscribe 復帰
- 段階 4: iOS dirty-debounce push (`SyncDirtyTracker`)

> 前提ゲート: 着手前に緊急停止以降 Messages グラフが既に水平に張り付いていることを Dashboard で確認すること。異常 (編集停止後も上昇継続) を見たら直前段階に revert。

> ⚠️ **realtime postgres_changes は現在配信不達 (2026-06-09 判明)**: プロジェクトが Supabase の**非対称 JWT 署名キー (ES256)** に移行済で、Realtime の postgres_changes 認可 (JWT 検証) が機能せず、subscribe 成功 (status=subscribed/heartbeat OK) でも変更イベントがゼロ配信 (publication 4 テーブル登録・`setAuth`・プロジェクト再起動でも変わらず)。PostgREST(REST pull/push) は ES256 を検証できるので **手動同期・前面復帰 pull は正常**。よって **desktop→iOS の実反映は「前面復帰 pull」が主経路** — iOS は `scenePhase==.active` で `pullAll` ([`MandalartApp.foregroundResync`](ios/Mandalart/App/MandalartApp.swift))、desktop は [`useVisibilityResync`](desktop/src/hooks/useVisibilityResync.ts)。realtime 購読は heartbeat のみで quota ほぼゼロのため残置 (将来サーバ側修正で自動復活)。真の realtime 復活は Supabase 側対応 (サポート issue / 署名キー rotate back) が必要でアプリ側スコープ外。

詳細経緯と計画: [`/Users/maro02/.claude/plans/subscribe-realtime-tidy-meerkat.md`](/Users/maro02/.claude/plans/subscribe-realtime-tidy-meerkat.md)
desktop 側落とし穴: [`desktop/CLAUDE.md`](desktop/CLAUDE.md) #24

## プロジェクト概要

マンダラート — 3×3 グリッドで思考を階層的に展開するアプリ。**3 つの並列実装** が存在する:

| プラットフォーム | スタック | 配置 | 状態 |
|---|---|---|---|
| **desktop** | Tauri v2 + Vite + React 19 + TypeScript + SQLite | [`desktop/`](desktop/) | リリース運用中 |
| **iOS** | Swift + SwiftUI + SwiftData | [`ios/`](ios/) | Phase 0-3 完了 / Landscape 限定の技術検証段階 |
| **web** | Vite + React 19 + TypeScript (online-only / Supabase 直接) | [`web/`](web/) | 2026-06-26 実装完了 / Vercel 静的ホスト向け |

両者は **同一 Supabase project (Postgres)** を共有してクロスデバイス同期する。スキーマ仕様は desktop 側 ([`desktop/docs/data-model.md`](desktop/docs/data-model.md), [`desktop/docs/cloud-sync-setup.md`](desktop/docs/cloud-sync-setup.md)) を canonical 扱い、iOS 側 ([`ios/Mandalart/Models/`](ios/Mandalart/Models/)) は等価な @Model で定義する ([`ios/docs/data-model.md`](ios/docs/data-model.md))。

[`web/`](web/) はブラウザ版 (Tauri 非依存 / online-only)。[`_old_web/`](_old_web/) は旧 Next.js 試作でメンテ停止 (別物)。

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
- [`web/`](web/): ブラウザ版。`desktop/src/` から Tauri 依存を除去した実装。`@tauri-apps/*` / `lib/db/` / `lib/sync/` は削除済み。`web/.env` に `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY` を設定して `cd web && npm run dev`。デプロイ先: Vercel (`web/vercel.json` 参照)
- [`shared/DIVERGENCES.md`](shared/DIVERGENCES.md): **desktop ↔ iOS の既知の乖離レジストリ** (停止中 / 意図的非対称=unify 禁止 / 解消済 / 要確認)。クロスプラットフォーム作業で「この表に無い挙動差 = 偶発の乖離 (バグ) を疑う」起点。乖離を見つけ/解消したら更新する

shared な仕様 (data-model 詳細 / 機能要件 / Supabase setup) は **desktop/docs/ を canonical** とし、iOS docs は差分のみ書いて重複を避ける。
