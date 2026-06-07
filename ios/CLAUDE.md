# ios/CLAUDE.md

このファイルは Claude Code が **iOS 版 (Swift + SwiftUI)** のコードを触るときに読むガイドです。
プロジェクト全体の方針 / desktop 版との関係は [`../CLAUDE.md`](../CLAUDE.md) を先に読むこと。
詳細仕様は [`docs/`](docs/) に分散しているので、ここはコマンド・構造・行動指針・docs ポインタに絞る。

## iOS 版 概要

- **スタック**: Swift 6 + SwiftUI + SwiftData (`@Model`) + supabase-swift SDK / iOS 17+ / Landscape 限定 / iPhone + iPad Universal
- **状態**: Phase 0-3 完了 (commit 0d375c9) — 基盤 / SwiftData モデル / Supabase 認証 + pull/push 同期まで動作実証済
- **未着手**: Phase 4 (Dashboard 詳細) / Phase 5 (Editor 3×3 グリッド) / Phase 6-11 (アニメ / メモ / ストック / lock / Welcome / 仕上げ / 配布)
- **Supabase**: desktop と同一 project を共有 (詳細は [`../desktop/docs/cloud-sync-setup.md`](../desktop/docs/cloud-sync-setup.md) を canonical 参照)

## タスク逆引き index

作業を始める前に該当行を確認し、先に docs を読むこと。

| 触るもの | 先に読む docs |
|---|---|
| 初回ビルド / 環境構築 / Secrets セットアップ | [`docs/getting-started.md`](docs/getting-started.md) |
| フォルダ構成 / xcodegen workflow / project.yml | [`docs/architecture.md`](docs/architecture.md) |
| Swift モデル定義 / Postgres スキーマとの対応 | [`docs/data-model.md`](docs/data-model.md), 詳細 schema は [`../desktop/docs/data-model.md`](../desktop/docs/data-model.md) |
| 同期 (push / pull / realtime) / RLS user_id / SyncEngine | [`docs/sync.md`](docs/sync.md), Supabase setup は [`../desktop/docs/cloud-sync-setup.md`](../desktop/docs/cloud-sync-setup.md) |
| iOS 固有のハマりポイント | [`docs/pitfalls.md`](docs/pitfalls.md) |
| UX / Landscape / 2 ペイン構成 / SF Symbols | [`docs/requirements.md`](docs/requirements.md), 機能要件本体は [`../desktop/docs/requirements.md`](../desktop/docs/requirements.md) |
| 進捗 / 次にやること | [`docs/tasks.md`](docs/tasks.md) |

## ビルド / 実行 (Xcode GUI 推奨)

⚠️ **重要**: `xcodebuild` CLI は SPM 依存追加で iOS Simulator destination を見失う既知の不具合あり ([`docs/pitfalls.md`](docs/pitfalls.md) #1)。**Xcode GUI から build / run すること**。

| 手順 | コマンド / 操作 |
|---|---|
| 1. xcodegen install (初回のみ) | `brew install xcodegen` |
| 2. project.xcodeproj 生成 | `cd ios && xcodegen generate` |
| 3. Secrets セットアップ (初回のみ) | `cp Mandalart/Services/Secrets.swift.template Mandalart/Services/Secrets.swift` → desktop/.env の値を貼る |
| 4. Xcode で開く | `open Mandalart.xcodeproj` |
| 5. ターゲット選択 | iPhone 17 Pro (iOS 26.4) Simulator など |
| 6. Run | `Cmd+R` |
| 7. Clean (必要時) | `Shift+Cmd+K` |
| 8. SwiftData schema 不整合クラッシュ時 | Simulator アプリ長押し→削除して再 Run (or VersionedSchema 移行) |

**CI**: vault ピュア層のユニットテスト (`VaultTests` スキーム) は [`.github/workflows/ios-ci.yml`](../.github/workflows/ios-ci.yml) が `ios/**` 変更時に macOS runner で自動実行する (`xcodegen generate` → `xcodebuild test -scheme VaultTests`)。Supabase 非リンク・Secrets 不要。desktop フロント/Rust は [`ci.yml`](../.github/workflows/ci.yml) / `release.yml` 担当。

## Swift コード規約

### ハードコーディング禁止

マジックナンバー・繰返し文字列は [`Mandalart/Utils/Constants.swift`](Mandalart/Utils/Constants.swift) を経由する。

| カテゴリ | 場所 | 代表定数 |
|---|---|---|
| グリッド構造 | `GridConstants` | `centerPosition`, `gridSide`, `gridCellCount`, `orbitOrder`, `tabOrder`, `peripheralPositionsByTab` |
| レイアウト (pt) | `LayoutConstants` | `outerGridGap`, `cellBaseFontSize`, `cellNineByNineFontSize`, `dashboardCardSize`, `locationMapCellSize` |
| タイミング (ms) | `TimingConstants` | `animStaggerMs`, `animFadeMs`, `convergeDurationMs` |
| フォントスケール | `FontConstants` | `levelMin`, `levelMax`, `levelDefault`, `stepFactor`, `scale(for:)`、legacy `levelStorageKey` |
| マンダラート単位設定 | `MandalartFontPreference` | `load(for:)`, `save(_:for:)` — UserDefaults キー `mandalart.fontLevel.<mandalartId>` (per-device、cross-device 同期なし) |
| テーマ override | [`ThemePreference`](Mandalart/Utils/ThemePreference.swift) | `storageKey = "app.theme"` (グローバル UserDefaults、cross-device 同期なし) / rawValue `light` / `system` / `dark` / `colorScheme` で `.preferredColorScheme(_:)` に渡し `system` 時は `nil` で OS 追従 |
| カラープリセット | [`PresetColors`](Mandalart/Utils/PresetColors.swift) | `all` (10 色)、`find(_:)`。desktop の `constants/colors.ts` と完全に同じ key 文字列 |

### モデル / 同期

- SwiftData `@Model` の **field 名は camelCase**、Supabase / desktop SQLite は **snake_case**。Codable DTO (`Cloud*`) は snake_case のまま定義し、SyncEngine で SwiftData 側に詰め替える ([`docs/sync.md`](docs/sync.md))
- desktop 側 schema との対応 (`Cell.text` / `Grid.sortOrder` / `Folder.isSystem` 等) を破ると pull のデコード or push の RLS で失敗する ([`docs/pitfalls.md`](docs/pitfalls.md) #4)
- 新しい schema 列を追加するときは **必ず desktop 側を canonical** とし、migration / 手動 ALTER → @Model 追加 → DTO 追加 → SyncEngine の payload / select 列追加 → ios/docs/data-model.md 対応表更新 の順
- `StockItem` は **local-only** (Supabase 同期しない)。desktop 側と同様に `snapshot: String` (JSON) を 1 列に持つ

### 環境

- secrets は [`Mandalart/Services/Secrets.swift`](Mandalart/Services/Secrets.swift) (gitignore 済)、テンプレは [`Secrets.swift.template`](Mandalart/Services/Secrets.swift.template)
- xcodeproj は **gitignore 済** (xcodegen で再生成)。`project.yml` を source of truth にすること
- bundle identifier は `jp.mandalart.app.ios` (desktop と区別)
- 向きは Landscape Left/Right 限定 (`INFOPLIST_KEY_UISupportedInterfaceOrientations_iPhone/iPad`)
- target settings に `SUPPORTED_PLATFORMS = "iphoneos iphonesimulator"` / `SUPPORTS_MACCATALYST = NO` を明示 ([`docs/pitfalls.md`](docs/pitfalls.md) #1 の defensive)

## アーキテクチャ概要

```
Views → ViewModels (@Observable) → Services → SwiftData (local) / supabase-swift (cloud)
```

- **App/**: `MandalartApp` (`@main`) / `ContentView` (router)
- **Models/**: `Mandalart` / `Grid` / `Cell` / `Folder` / `StockItem` の 5 つの SwiftData `@Model`
- **Views/**: `DashboardView` / `EditorView` / `SettingsView` / `SignInView` (Phase 0-3 時点)。Components/ は今後追加
- **ViewModels/**: `AuthStore` (@Observable / @MainActor、サインイン状態 + Auth セッション)
- **Services/**: `SupabaseService` (umbrella SupabaseClient wrapper) / `MandalartFactory` (root grid + center cell 同時 INSERT) / `SyncEngine` (pullAll / pushPending、last-write-wins)
- **Utils/**: `Constants` (定数)
- **Vault/**: vault フォルダモード (Phase 2) のピュア層を desktop から移植した Stage 0/1 (VaultTypes / VaultFrontmatter / VaultFormat / VaultModel / VaultReconcile)。Foundation + CryptoKit のみ依存・SwiftData/Supabase 非依存で、**本番未配線 (dead code)**。I/O (UIDocumentPicker + iCloud Drive bookmark) / DB (SwiftData upsert) / 同期 gate は後続 Stage。詳細は [`docs/architecture.md`](docs/architecture.md)
- **Resources/**: 将来の `help/*.mp4` 等

ユニットテストは `ios/MandalartTests/` (XCTest)。専用スキーム **`VaultTests`** が `Mandalart/Vault/*` を app (Supabase) 非依存で直接コンパイルするので、`xcodebuild test -scheme VaultTests -destination 'platform=iOS Simulator,name=iPhone 16'` が CLI で通る (落とし穴 #1 回避)。`project.yml` 編集後は `xcodegen generate`。

詳細は [`docs/architecture.md`](docs/architecture.md)。

## iOS 固有の落とし穴 インデックス

詳細は [`docs/pitfalls.md`](docs/pitfalls.md) を読むこと。

1. **xcodebuild CLI が SPM 依存で iOS Simulator destination を見失う** → Xcode GUI で build/run
2. **Nested `.sheet` 内で `@Environment(AuthStore)` が伝搬しない** → 明示 `.environment(auth)` inject
3. **SwiftData モデル変更後の起動クラッシュ** → Simulator のアプリを削除 (or VersionedSchema migration)
4. **Cell.text / Grid.sortOrder / Folder.isSystem は desktop schema と完全一致**
5. **umbrella `Supabase` product を使う** (個別 module 直 init は API が頻繁に変わる)
6. **SwiftUI deeply-chained modifier が SourceKit を timeout させる** → Live Issues に偽の `Cannot find type` 連鎖が出るが Build (`xcodebuild`) は通る。ViewModifier 化 + 別ファイル切り出しで解消 ([`docs/pitfalls.md`](docs/pitfalls.md) #12)

**desktop と共通する落とし穴**: [`../desktop/CLAUDE.md`](../desktop/CLAUDE.md) #2 (FK 制約) / #10 (中心セル 3 パターン) / #12 (zombie cleanup) / #17 (PGRST204 thrash) は iOS 側でも同等の対策が必要。

## ドキュメント一覧

| ファイル | 内容 |
|---|---|
| [`getting-started.md`](docs/getting-started.md) | xcodegen install / Xcode GUI ビルド / Secrets セットアップ手順 |
| [`architecture.md`](docs/architecture.md) | フォルダ構成 / レイヤー / xcodegen + project.yml / 設計分離方針 |
| [`data-model.md`](docs/data-model.md) | 5 つの @Model 定義 / desktop SQLite + Postgres スキーマとの対応表 (camelCase ↔ snake_case) |
| [`sync.md`](docs/sync.md) | SyncEngine.pullAll / pushPending / RLS user_id / last-write-wins / realtime (将来) |
| [`pitfalls.md`](docs/pitfalls.md) | iOS 固有の落とし穴詳細 + desktop 共通落とし穴への参照 |
| [`requirements.md`](docs/requirements.md) | iOS 固有 UX (Landscape / 2 ペイン / SF Symbols) — 機能要件本体は desktop/docs/requirements.md |
| [`tasks.md`](docs/tasks.md) | Phase 0-11 進捗チェックリスト |
