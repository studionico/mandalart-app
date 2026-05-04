# pitfalls.md (iOS)

iOS 開発中に踏んだ落とし穴の一覧。同じ穴を二度踏まないために残す。

## desktop 版と共通する落とし穴

以下は [`../../desktop/CLAUDE.md`](../../desktop/CLAUDE.md) の「知っておくべき落とし穴」節を直接参照すること:

- **#2 FK 制約を張らない** — Supabase / SwiftData / desktop SQLite すべてで cells ↔ grids 間の FK は張らない方針 (循環 FK 回避)。カスケード削除は API 層で明示
- **#5 Realtime DELETE は子行を連鎖しない** — iOS 側で realtime 実装時 (Phase 3 残) は明示カスケード必須
- **#10 中心セル行の有無は grid 種別で 3 パターン** (root / X=C primary drilled / レガシー共有並列) — エディタ画面 (Phase 5) を組むとき必読
- **#12 zombie cleanup** — push 失敗 thrash 対策 (iOS 側は現状未実装、Phase 3 残)
- **#17 PGRST204 thrash** — Supabase 手動 ALTER 漏れ防止。スキーマ追加時は両プラットフォーム同時更新
- **#6 完全削除は cloud + local 両方** — `MandalartFactory.permanentDelete` は現状 local のみ、cloud 連動は Phase 3 残

## iOS 固有の落とし穴

### #1. xcodebuild CLI が SPM 依存追加で iOS Simulator destination を見失う

**症状**: `supabase-swift` を SPM 依存に追加した後、`xcodebuild ... -destination 'platform=iOS Simulator,...' build` を実行すると:

```
[MT] IDERunDestination: Supported platforms for the buildables in the current scheme is empty.
xcodebuild: error: Unable to find a destination matching ...
    Ineligible destinations for the "Mandalart" scheme:
        { platform:iOS, ..., error:iOS 26.4 is not installed. ... }
```

iOS Simulator destination が候補から消え、物理 device のみが ineligible として表示される。

**原因の推測**: `xctest-dynamic-overlay` 等の SPM transitive 依存が macros target を含んでおり、Xcode 26 + xcodegen 環境下で scheme の supported platforms 推論を壊す。Apple 公式の知られたバグなのか xcodegen 側の生成方式の問題なのかは不明。

**選んだ対処 (A 案)**: app target の build settings に以下を明示:

```yaml
# project.yml
settings:
  base:
    SUPPORTED_PLATFORMS: "iphoneos iphonesimulator"
    SUPPORTS_MACCATALYST: NO
```

これだけでは `xcodebuild` の destination 解決は治らない (= CLI ビルドは引き続きダメ) が、defensive な意味で残置。

**運用上の対処**: **Xcode GUI で開いて build / run する** ([`getting-started.md`](getting-started.md))。GUI 側は同じ scheme でも destination を正しく列挙してビルドできる。CI で xcodebuild を使いたくなったら別途調査。

### #2. Nested `.sheet` 内で `@Environment(AuthStore)` が伝搬しない

**症状**: `DashboardView` → `.sheet { SettingsView() }` → `.sheet { SignInView() }` のネスト構造で SignInView が表示されない (or サイレントクラッシュ)。原因は `@Environment(AuthStore.self)` がネスト sheet を貫通しないため。

**対処**: 各 `.sheet` で明示 inject:

```swift
.sheet(isPresented: $showSignIn) {
    SignInView()
        .environment(auth)   // ← 明示
}
```

`DashboardView → SettingsView` も同様 (`.environment(auth)` を SettingsView に渡す)。

### #3. SwiftData モデル変更後の起動クラッシュ

**症状**: `@Model` のフィールドを追加・削除・rename したあと、Simulator で起動すると `Thread 1: Fatal error` でクラッシュ。debug area には schema migration エラーが出る。

**原因**: SwiftData の persistent store (= 内部 SQLite) は前回起動時のスキーマで初期化されており、新しい `@Model` 定義と互換性がないと crash する。

**対処** (技術検証段階):
- **Simulator のアプリを長押しで削除** → 再 Run。store が消えて新スキーマで作り直される

**対処** (本番運用時):
- `VersionedSchema` + `SchemaMigrationPlan` を [`MandalartApp`](../Mandalart/App/MandalartApp.swift) の ModelContainer 設定に組み込む。Phase 10 仕上げで実装予定

### #4. Cell.text / Grid.sortOrder / Folder.isSystem は desktop schema と完全一致

**症状**: `Cell.content` (= 自分で命名した Swift 側名) でフィールドを定義 → desktop と同期したら pull で全 cell の text が空になる / push で 400 エラー。

**原因**: desktop schema は `cells.text` (NOT `content`)、`grids.sort_order`、`folders.is_system`。SwiftData @Model 側の field は camelCase で OK だが、SyncEngine の DTO (`Cloud*` 構造体) と payload は **必ず snake_case** で desktop schema に揃える必要がある。

**対処**: [`data-model.md`](data-model.md) の対応表を参照して修正。新規列を足すときは desktop の migration を canonical にして両プラットフォーム揃える ([`sync.md`](sync.md) "新しい列を足すフロー" 節)。

### #7. SwiftUI `.alert` の `TextField` は日本語 IME (予測変換) と相性が悪い

**症状**: `.alert("...", isPresented: ...) { TextField(...) }` で日本語入力しようとしても、IME 変換候補が出ない / 確定できない / 文字が消える等で実用にならない。

**原因**: SwiftUI の `.alert` 内 `TextField` は UIKit の `UIAlertController` をラップしているが、IME インタラクションの一部 (確定 / 取り消し / 変換) が SwiftUI binding に正しく伝搬しない iOS の既知不具合。英数字入力では問題なし。

**対処**: 日本語入力が必要な簡易 input UI は **`.sheet` ベースに置き換え** る。`NavigationStack { Form { TextField } }` を `.presentationDetents([.height(200)])` で popup 風に出すと alert 同等の UX で IME 完全動作する。実装例: [`FolderNameSheet`](../Mandalart/Views/DashboardView.swift) (`DashboardView` 末尾の private struct)。

### #6. UUID は **小文字統一**。Swift `UUID().uuidString` は大文字で desktop と非互換

**症状**: iOS で作成したマンダラートを desktop で開くと、ルート中心セルクリックでドリルダウンが起きる (本来は「ホームへ戻る」)。breadcrumb 2 階層目に 1 階層目と同じ名前が表示される。再クリックでドリルアップ。desktop で作成したマンダラートでは正常。

**原因**: Swift の `UUID().uuidString` は **大文字** (`09469F25-EA72-486B-A3FB-72BD15F58D3E`) を返す。一方 desktop の `crypto.randomUUID()` は **小文字** (`09469f25-ea72-486b-a3fb-72bd15f58d3e`)。両プラットフォーム共に TEXT 型で大小を保存し、`===` で比較する。iOS push 由来データに対する desktop の判定 ([`desktop/src/components/editor/EditorLayout.tsx:1264`](../../desktop/src/components/editor/EditorLayout.tsx#L1264)) `cell.id === gridData.center_cell_id` が誤った経路に分岐する。

**対処**: iOS 側の UUID 生成は **必ず [`Mandalart/Utils/IDGenerator.swift`](../Mandalart/Utils/IDGenerator.swift) の `IDGenerator.uuid()` を経由する** (= `UUID().uuidString.lowercased()`)。`UUID().uuidString` を直接使わない。5 つの `@Model` の `id: String = ...` 既定値および `MandalartFactory.create` 内の明示 ID 生成すべてで `IDGenerator.uuid()` を使用済み。新規の Swift コードを書くときも同 helper を使うこと。

**既存の uppercase データ**: 既に cloud に push 済の uppercase ID レコードは手動で削除する (cloud + local 両方から)。push 後に lowercase 化する migration は実装しない (= ID が変わると参照整合性が崩れるため)。

### #5. umbrella `Supabase` SPM product を使う (個別 module を直 init しない)

**症状**: 試行錯誤で `Auth` / `PostgREST` / `Realtime` / `Storage` を個別に SPM 依存に入れて `AuthClient(url:headers:flowType:)` 等を直接 init したが、API シグネチャが頻繁に変わる:

```
AuthClient: Missing argument for parameter 'localStorage' in call
PostgrestClient: Argument 'schema' must precede argument 'headers'
RealtimeClientV2: Incorrect argument label in call (have 'url:apiKey:', expected 'url:options:')
SupabaseStorageClient: Missing argument for parameter 'configuration'
```

**対処**: umbrella `Supabase` product 1 本だけ依存に入れて `SupabaseClient(supabaseURL:supabaseKey:)` で 1 行 init。supabase-swift がメジャーバージョン跨いでも比較的安定している外向き API。

```yaml
# project.yml
dependencies:
  - package: Supabase
    product: Supabase   # ← umbrella
```

```swift
// SupabaseService.swift
self.client = SupabaseClient(
    supabaseURL: Secrets.supabaseURL,
    supabaseKey: Secrets.supabaseAnonKey
)
```

その後は `client.auth` / `client.from("table")` / `client.realtime` 等で各 module にアクセスできる。

### #8. drill アニメ中の画像セルまばたき (= desktop 落とし穴 #18 の iOS 版)

**症状**: drill / drill-up / 並列ナビ で grid 切替が起こると、`GridView3x3` が `.id("\(gridId)-\(position)-\(cellId)")` で view identity を変えるため CellView が **remount** される。新 mount は `_loadedImage = State(initialValue: ImageStorage.loadImage(...))` で同期的にディスクから読み込むが、 大量の cell を含むマンダラートでは disk I/O が積もって 1 frame ぶん画像表示が遅れ、ぴかっと白く見える。

**原因**: Phase 6 の orbit fade-in stagger で grid 切替頻度が上がる + `ImageStorage.loadImage` が毎 mount で disk read する。

**対処**: [`ImageStorage`](../Mandalart/Services/ImageStorage.swift) に in-memory `NSCache` 層を追加。`saveImage` 時に cache に乗せ、`loadImage` 時にまず cache lookup して hit なら disk を読まずに返す。これで 2 回目以降の remount は ~0ms で UIImage が手に入り、まばたき消失。

**desktop 側との対応**: desktop CLAUDE.md 落とし穴 #18 「画像セルまばたき」も同じ思想 (`getCachedCellImageUrl` 同期 lookup → `useState(() => initialUrl)`) — そちらと一貫した実装。

### #9. drill 切替時の stagger fade-in は CellView 単位で `onAppear` + `withAnimation` 駆動

**症状**: matchedGeometryEffect で「drill した親 peripheral cell が中央へ吸い寄せられる」desktop 風の orbit を SwiftUI で再現しようとすると、`GridView3x3` の `.id(...)` 強制 remount と衝突して geometry が連続しない (= マッチしないので即座切替に見える)。

**選んだ方針 (Phase 6a)**: matchedGeometryEffect は **使わない**。代わりに各 CellView に `@State animatedVisible` を持たせ、`onAppear` で `position` と `transitionKind` から [`AnimationStagger.delay`](../Mandalart/Utils/AnimationStagger.swift) を引いた delay 後に `withAnimation(.easeOut)` で `false → true` に補間する。これで「shutter 開く」スタイルの fade-in が実現でき、remount による text/image 状態リセットとも干渉しない。

**注意**: `staggerIndex` が nil を返す position (= drill-down の中心 position=4、X=C 連続セル) は `init` で `_animatedVisible = State(initialValue: true)` にしておくこと。さもないと中心が一瞬 0 → 1 に光る (= ちらつき)。

**精緻な orbit (matchedGeometry 連鎖)** は Phase 6c 以降の課題。今は遷移種別 (`drillDown` / `drillUp` / `parallel` / `initial`) ごとの sequence を [`AnimationStagger.swift`](../Mandalart/Utils/AnimationStagger.swift) に集約し、desktop の時計回り順 `[7,6,3,0,1,2,5,8]` (周辺) を踏襲。

## 参考: 0d375c9 commit の経緯

iOS 版 Phase 0-3 を実装する過程で実際に踏んだ落とし穴は、commit message ([`git log 0d375c9`](https://github.com/studionico/mandalart-app/commit/0d375c9)) にも要点を記録してある。本ファイルと矛盾する情報があれば本ファイルを正とする。
