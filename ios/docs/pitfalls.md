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

### #10. 見た目の規則は desktop が canonical、iOS は pt にスケールして揃える

**症状になる前段階の問題**: iOS と desktop で同じプロダクトなのに border 太さ / cornerRadius / カラートークンが別々に決まっており、cross-device で開いたときの印象がバラついていた。

**方針**: **配色トークンと border / cornerRadius の規則は desktop ([`../../desktop/src/constants/colors.ts`](../../desktop/src/constants/colors.ts), [`../../desktop/src/components/editor/Cell.tsx`](../../desktop/src/components/editor/Cell.tsx)) を canonical** とし、iOS 側は同じ ratio で pt にスケール。

主な対応 (`LayoutConstants` で定数化、[`Constants.swift`](../Mandalart/Utils/Constants.swift)):

| 要素 | desktop | iOS pt |
|---|---|---|
| 中心セル border | 6px | `cellCenterBorder = 3` |
| 周辺セル border | 1px | `cellPeripheralBorder = 0.5` (hairline) |
| 周辺 + 子グリッドあり | 2px | `cellPeripheralWithChildBorder = 1.5` |
| 9×9 inner cell border | 2px | `cellNineByNineInnerBorder = 1` (= readOnly 時 hairline 回避) |
| cellCornerRadius | 8px | `cellCornerRadius = 8` (pt) |
| dashboard card cornerRadius | 4px | `cardCornerRadius = 4` (pt) |

**フォント weight は iOS .system 維持** (= Dynamic Type 対応のため強制 desktop 同期しない)。`.semibold` / `.regular` は iOS ネイティブ感を優先。

**子グリッドあり判定**: `findChildGrid` は per-cell に O(N) クエリなので、`GridRepository.hasChildMaskForGrid(displayCells:in:)` で 9 要素 Bool を一度に計算 → `GridView3x3` → `CellView` に props 経路で pass-through。9×9 view 内では readOnly mode になるので mask 計算スキップ。**判定は「子 Grid 行が存在するか」だけでなく「子 Grid の周辺セル (position != 4) に 1 つでも text/imagePath を持つ cell があるか」も併せて判定する** (= desktop の `EditorLayout.tsx` `fetchChildCountsFor` `EXISTS (… position != 4 AND (text != '' OR image_path IS NOT NULL))` と等価)。drill-down 直後で空のまま戻ったケースで太枠化しないため (= ユーザーが実際に入力するまで「サブグリッドあり」扱いしない)。

### #11a. 背景トーンは Apple semantic color ではなく Tailwind neutral 系列に揃える

**症状になる前段階の問題**: iOS の `Color(uiColor: .secondarySystemBackground)` (= ライト 242,242,247 / ダーク 28,28,30) は Apple HIG 標準のグレー寄りで、desktop の `bg-white dark:bg-neutral-900` (= 255,255,255 / 23,23,23) と RGB がズレる。同じマンダラートを iPhone と desktop で並べると、空セル / カード / root 背景の色味が違って見える。

**方針**: 背景色は **Tailwind neutral palette を直接コピー** した [`NeutralPalette`](../Mandalart/Utils/NeutralPalette.swift) を使う:

| iOS 用途 | NeutralPalette key | desktop 対応 | RGB (light/dark) |
|---|---|---|---|
| editor / dashboard root | `rootBackground` | `bg-neutral-50 dark:bg-neutral-950` | 250,250,250 / 10,10,10 |
| 空セル / memo / breadcrumb 領域 | `surfaceBackground` | `bg-white dark:bg-neutral-900` | 255,255,255 / 23,23,23 |
| dashboard card | `cardBackground` | `bg-white dark:bg-neutral-950` | 255,255,255 / 10,10,10 |
| 9×9 outer gap (将来) | `dividerSurface` | `bg-neutral-300 dark:bg-neutral-700` | 212,212,212 / 64,64,64 |

**注意**: Apple HIG の semantic color を使わない方針上、iOS の Increase Contrast / アクセシビリティ自動 contrast 補正は色味には適用されない (Dynamic Type / VoiceOver 等は引き続き有効)。プロダクト一貫性を優先した妥協。

**floating UI 素材** (= home button / 9×9 toggle / lock banner / parallel chevron): `.ultraThinMaterial` を維持。desktop の `bg-white/90 backdrop-blur` と概念的に等価で、iOS ネイティブ感を残す。

### #11. 9×9 view は iPad regular のみ実用、iPhone は非表示

**症状**: iPhone Pro Landscape (grid ~380pt) で 9×9 ビューを開くと 1 セルが約 14pt × 14pt まで縮小してテキスト読めない。toggle ボタンが UI を占有して使えない機能を提示し続ける。

**対処**: [`EditorView`](../Mandalart/Views/EditorView.swift) で `@Environment(\.horizontalSizeClass)` を読み、`hsc == .regular` (= iPad regular) のときのみ 9×9 toggle ボタンを表示。compact (iPhone / iPad Split View 1/3) では非表示 + `viewMode` が `.grid9x9` のまま縮小された場合は `.onChange(of: hsc)` で `.grid3x3` に強制復帰。

| 環境 | hsc | 9×9 ボタン |
|---|---|---|
| iPhone Landscape | .compact | 非表示 |
| iPad Landscape full | .regular | 表示 |
| iPad Split View 1/3 | .compact | 非表示 (open 中なら 3×3 強制復帰) |
| iPad Split View 1/2 | .regular | 表示 |

### #12. SwiftUI deeply-chained modifier が SourceKit (= Live Issues) を timeout させる

**症状**: Xcode の Live Issues / Clean Build Folder 後の解析で、1 つのファイル (例: [`DashboardView.swift`](../Mandalart/Views/DashboardView.swift)) に対して以下のような **複数の偽陽性エラー** が連鎖表示される:

```
Cannot find type 'MandalartExportDocument' in scope    (@State property 宣言行)
Cannot find 'TrashView' in scope                       (sheet content の参照)
Cannot find type 'ExportFormat' in scope               (関数シグネチャ)
Cannot find 'TransferService' in scope                 (helper 関数内)
Cannot find type 'GridSnapshot' in scope               (型 annotation)
Generic parameter 'D' could not be inferred            (.fileExporter の document:)
The compiler is unable to type-check this expression in reasonable time;
  try breaking up the expression into distinct sub-expressions
```

**重要**: `xcodebuild build` は **BUILD SUCCEEDED** で実コンパイルは正常。型は本当に存在しており、エラーは Live Issues (= SourceKit の IDE 用 type-checker) のみ。Build (Cmd+B) も成功する。

**原因**: SourceKit は swiftc 本体より厳しい timeout を持っており、SwiftUI の `sheet` / `confirmationDialog` / `fileExporter` / `fileImporter` / `alert` を **同じ View body に多数 chain** すると、特に `presenting:` のような generic 推論を含む modifier が複数あると諦めて type-check を打ち切る。打ち切りの cascade で **同ファイルの他の symbol resolution まで「Cannot find」が連鎖表示** される。

**切り分け手順**: まず本当のコンパイルエラーか SourceKit cascade かを確認:

```bash
cd /Users/maro02/20_アプリ開発/mandalart/ios
xcodebuild -project Mandalart.xcodeproj -scheme Mandalart \
    -destination 'generic/platform=iOS Simulator' \
    -derivedDataPath /tmp/mandalart-build build 2>&1 | grep -E "error:|BUILD"
```

- **BUILD SUCCEEDED** → 偽陽性 (= 下記対処)
- **BUILD FAILED + error: ...** → 本物の問題 (Live Issues に従って修正)

**対処**: 1 ファイルあたりの SourceKit 解析負荷を下げる。複数の手段を組み合わせる:

1. **ViewModifier 化 + 2-modifier ずつに分割**: 4 連鎖 modifier を 2 つの ViewModifier (= 各 2 modifier) に分け、`.modifier(_:)` で繋ぐ。1 つの ViewModifier に集約しても内部 chain 長は同じなので **物理的に分けることが必須**
2. **別ファイルへ切り出し**: ViewModifier 定義 + `TransferAlertState` のような関連型を別ファイルへ移動して 1 ファイルあたりの SwiftUI コードを減らす (= [`DashboardTransferSupport.swift`](../Mandalart/Views/DashboardTransferSupport.swift) が前例)
3. **`presenting:` ジェネリックを同じ body 内に複数入れない**: `confirmationDialog(presenting:)` と `alert(presenting:)` を 1 つの body に置くと推論コストが乗算される。別の ViewModifier に分散

**前例**: 2026-05-09 commit `4209210` で DashboardView.swift (632 行) が `Phase 8` 実装後に上記症状を起こし、Transfer 系 ViewModifier 79 行を [`DashboardTransferSupport.swift`](../Mandalart/Views/DashboardTransferSupport.swift) に切り出して解消。Build (= swiftc) 自体は最初から成功していた。

**予防**: 新しい sheet / alert / confirmationDialog / fileExporter / fileImporter を既存 View に追加するとき、すでに同じ body に **3 個以上の同種 modifier** がある場合は最初から ViewModifier 化 + 別ファイル切り出しを検討する。

### #13. child grid の merged center cell の `cell.position` は親 peripheral 値で display slot 4 と一致しない

**症状**: 中心セル判定を `cell.position == GridConstants.centerPosition` で書いた機能が、**root grid では動作するが child grid drill 後は機能しない**。例: 2026-05-15 のセル入れ替え機能で「中心セルとは入れ替えできません」alert が child grid だけ出ず swap が実行されてしまうバグ ([`EditorView.handleSwapTarget`](../Mandalart/Views/EditorView.swift))。

**原因**: desktop 共通の落とし穴 #10 (中心セル 3 パターン) の派生。新モデル (migration 006+) では child grid (= primary drilled) は自グリッドに position=4 の cell 行を持たず、`grids.center_cell_id` が **親 grid の peripheral cell** を指す。[`GridRepository.displayCells`](../Mandalart/Services/GridRepository.swift) はこの merged center cell を 9 要素配列の index 4 に注入するが、cell 行そのものは親 grid 由来のままなので **`cell.position` フィールドは親 peripheral position (例: 3)** で、display 上の slot 4 とは一致しない。

**対処**: CellView は 2 つの「位置」を区別する必要がある:

- **`cell.position`** (= Cell row の DB 値): その cell 行が **本来属していた grid** での position。merged center では親 peripheral 値で残る
- **`position` prop** (= CellView コンストラクタ引数): その cell が **今 render されている display slot** (0..8)。中心判定はこちらを使う

```swift
// ❌ child grid で誤動作
guard cell.position != GridConstants.centerPosition else { ... }

// ✅ display slot を使う
private var isCenter: Bool { position == GridConstants.centerPosition }  // CellView 内、既存
// callback で外側に渡すときは display slot も併せて渡す:
let onSwapTargetTapped: ((Cell, Int) -> Void)?
// 呼出側:
onSwapTargetTapped?(target, position)  // position は CellView の prop
// EditorView 側:
guard displayPosition != GridConstants.centerPosition else { ... }
```

**テスト指針**: 中心セル判定が絡む機能は **必ず child grid drill 状態でもテストする**。root grid だけだと `cell.position == 4 == display slot 4` で偶然一致するため bug が表面化しない。

**関連**: desktop 共通の落とし穴 #10 / iOS 落とし穴 #4 / memory `feedback_desktop_merged_cell_grid_id` (grid_id でも同種の問題)。

### #14. SwiftData は複合 unique を宣言できない → cells (grid_id, position) 重複は SyncEngine が担保

**症状**: iPhone で「今すぐ同期」すると `失敗: duplicate key value violates unique constraint "cells_grid_id_position_unique"` (Postgres `code 23505`)。

**原因**: cloud cells は `UNIQUE(grid_id, position)` を持つ。desktop は local SQLite にも同制約があるため重複を物理的に作れないが、**SwiftData の `@Attribute(.unique)` は単一 attribute のみで複合 unique を宣言できない**。このため:
- push が PK (id) ベース upsert だと、同 (grid_id, position) で別 id の cloud 行があるとき INSERT 扱いになり 23505。
- pull の `upsertCell` が id のみで突合していたため、cloud cell id=B が (G,4) にあり local に別 id=C が (G,4) にあると新規 INSERT して **local に (grid_id, position) 重複** を作る。重複が残ると batch upsert で同 (grid_id, position) が複数入り Postgres `21000` (ON CONFLICT DO UPDATE cannot affect row a second time) も誘発する。

**対処** (3 段構え、すべて [`SyncEngine.swift`](../Mandalart/Services/SyncEngine.swift)):
1. **push に `onConflict: "grid_id,position"`** (cells のみ、desktop [`push.ts`](../../desktop/src/lib/sync/push.ts) と対称) → 同位置・別 id の cloud 行を local 値で UPDATE (local 勝ち)。cells は leaf なので id が変わっても整合性 OK。
2. **`dedupCellsByPosition`** を `sanitizeZombies` 直後 (pull / push 両冒頭) で呼び、同 (gridId, position) を `updatedAt` 最新 1 行に集約 (既存 corrupt の healing + batch 21000 防止)。
3. **`upsertCell` の reconcile**: cloud cell INSERT 前に同 (gridId, position) の別 id local を削除 (pull は cloud 勝ち) → 新規重複の発生経路を塞ぐ。

実行順序: **sanitizeZombies → dedupCellsByPosition → (pull: upsertCell reconcile) → push (onConflict)**。詳細は [`sync.md`](sync.md) 「(grid_id, position) 重複の dedup / reconcile」節。

**関連**: desktop 落とし穴 #12 (zombie cleanup) / #2 (FK 制約)、desktop [`push.ts`](../../desktop/src/lib/sync/push.ts) の cells onConflict コメント。

## 参考: 0d375c9 commit の経緯

iOS 版 Phase 0-3 を実装する過程で実際に踏んだ落とし穴は、commit message ([`git log 0d375c9`](https://github.com/studionico/mandalart-app/commit/0d375c9)) にも要点を記録してある。本ファイルと矛盾する情報があれば本ファイルを正とする。
