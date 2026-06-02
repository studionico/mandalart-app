# architecture.md (iOS)

iOS 版のフォルダ構成・レイヤー・xcodegen workflow。

## フォルダ構成

```
ios/
├── project.yml              ← xcodegen の入力 (source of truth)
├── .gitignore               ← xcodeproj / Secrets.swift / DerivedData を除外
├── Mandalart.xcodeproj/     ← xcodegen で生成 (gitignore)
├── Mandalart/
│   ├── App/
│   │   ├── MandalartApp.swift    @main / ModelContainer 設定
│   │   └── ContentView.swift     ルーティング (Dashboard ↔ Editor)
│   ├── Models/             SwiftData @Model (5 ファイル)
│   │   ├── Mandalart.swift
│   │   ├── Grid.swift
│   │   ├── Cell.swift
│   │   ├── Folder.swift
│   │   └── StockItem.swift
│   ├── Views/
│   │   ├── DashboardView.swift   ホーム (LazyVGrid + 新規作成カード + 検索 + フォルダタブ + ゴミ箱 / インポート toolbar)
│   │   ├── EditorView.swift      編集画面 (Landscape 2 ペイン + drill state + 不変条件 enforcement + 空マンダラート自動 hard delete)
│   │   ├── TrashView.swift       ゴミ箱 (deletedAt != nil の一覧 + 復元 / 完全削除 / すべて削除、desktop の TrashDialog 等価)
│   │   ├── DashboardTransferSupport.swift Dashboard の Export/Import modifier 切り出し (SourceKit timeout 回避、pitfalls.md #12)
│   │   ├── SettingsView.swift    アカウント / 同期ボタン
│   │   ├── SignInView.swift      Email サインイン / 新規登録
│   │   └── Components/
│   │       ├── CellView.swift    1 セル (tap → drill or inline edit、長押しで色 / シュレッダー context menu、編集中以外は overlay で hit テスト)
│   │       ├── GridView3x3.swift 3×3 (`displayCells: [Cell?]` 9 要素受け取り、id で grid 切替時 remount)
│   │       ├── Breadcrumb.swift  右ペイン上部の階層 navigation (タップで drill-up)
│   │       ├── MemoTab.swift     右ペイン下部のメモタブ (編集 / プレビュー segmented picker、EditingSheet 閉鎖時に自動でプレビューへ復帰、grid.memo を 1 秒 debounce で auto-save)
│   │       ├── StockTab.swift    右ペイン下部のストックタブ (3 列タイル grid + ペースト / 削除 / 全削除)
│   │       ├── EditingSheet.swift `.fullScreenCover` 共通 sheet (セル / メモ編集を統一、Landscape kbd 覆い対策)
│   │       ├── ThemeToggle.swift ライト/システム/ダーク切替 (capsule = Editor 右上 / Dashboard toolbar、segmented = SettingsView Form)
│   │       ├── ShredderIcon.swift   desktop ShredderIcon SVG を SwiftUI Path で移植したベクター icon (24×24 viewBox、シュレッダー context menu の icon slot で使用)
│   │       ├── ShredConfirmModifier.swift シュレッダー確認 `.confirmationDialog` を切り出した ViewModifier (EditorView body chain type-check timeout 回避 / 落とし穴 #12 対策)
│   │       └── ClearPeripheralsConfirmModifier.swift 中心セル「周辺セルのクリア」確認 `.confirmationDialog` を切り出した ViewModifier (同 #12 対策)
│   ├── ViewModels/
│   │   └── AuthStore.swift       @Observable / @MainActor / supabase-swift Auth ラッパ
│   ├── Services/
│   │   ├── SupabaseService.swift 共有 SupabaseClient
│   │   ├── MandalartFactory.swift create / duplicate / softDelete / restore / permanentDelete (cascade) / deleteFromCloud (cloud cascade + tombstone)
│   │   ├── FolderRepository.swift ensureInboxFolder (重複 system folder 統合) / adoptOrphansToInbox
│   │   ├── ImageStorage.swift     セル画像 = Application Support/images/ にローカル保存 (JPEG 圧縮) + Supabase Storage `cell-images` 同期 (uploadToCloud / downloadFromCloud / backfillUpload、キー `<userId 小文字>/<basename>`)
│   │   ├── GridRepository.swift  drill / parallel helper (findOrCreateChildGrid / findChildGrid / displayCells / getGridAncestry / getSiblingGrids / createParallelGrid / cleanupGridIfEmpty / shredCellSubtree / clearGridPeripherals / permanentDeleteGrid)
│   │   ├── StockService.swift    Stock CRUD (addToStock / moveCellToStock = cut / pasteFromStock、CellSnapshot/GridSnapshot は desktop と互換)
│   │   ├── CellCheckboxService.swift done トグル + サブツリー down 伝播 + 親方向 up 伝播 (desktop toggleCellDone と等価、centerCellId ベース)。recomputeDoneUpward = シュレッダー後の中心 done 再計算 / propagateUndoneUpward = 新規入力 (空→非空) 時の親 done 解除
│   │   ├── CellSwapService.swift     周辺セル入れ替え (text/imagePath/color/done + grids の parentCellId/centerCellId を双方向 swap、自グリッド除外、done も内容に付随)
│   │   ├── TransferService.swift Export/Import (JSON / Markdown=md-lossless-v1 frontmatter / IndentText)。Markdown は memo/color/image/done/位置をロスレス往復
│   │   ├── CloudDeleteTombstone.swift permanent delete cloud cascade のリトライキュー (UserDefaults 永続)
│   │   ├── RealtimeService.swift Supabase realtime (postgres_changes) 購読 + debounced pullAll
│   │   ├── SyncEngine.swift      pullAll / pushPending / DTO / backfillImages (Storage 未アップロード画像の回収)
│   │   ├── Secrets.swift         Supabase URL / anon key (gitignore)
│   │   └── Secrets.swift.template
│   ├── Utils/
│   │   ├── Constants.swift       GridConstants / LayoutConstants / TimingConstants / FontConstants / MandalartFontPreference
│   │   ├── NeutralPalette.swift  Tailwind neutral 系列を直 RGB で持つ adaptive 背景色群 (systemBackground を意図的に回避)
│   │   ├── PresetColors.swift    desktop と完全一致の 10 色 (light/dark 両値)
│   │   └── ThemePreference.swift app.theme グローバル UserDefaults / 3 値 enum (light/system/dark) / colorScheme 算出
│   └── Resources/
│       ├── Assets.xcassets/      AppIcon (赤地 3×3 白枠 / 単一 1024 PNG / project.yml の ASSETCATALOG_COMPILER_APPICON_NAME=AppIcon で参照)
│       └── help/                 Welcome 動画 (Phase 9 で追加予定)
└── docs/                    本ドキュメント群
```

## レイヤー / 依存方向

```
┌──────────────────────────────────────────┐
│ Views (SwiftUI)                          │
│  - DashboardView / EditorView / Settings │
│  - @Query で SwiftData 取得              │
└────────────┬─────────────────────────────┘
             ↓
┌──────────────────────────────────────────┐
│ ViewModels (@Observable @MainActor)      │
│  - AuthStore                             │
└────────────┬─────────────────────────────┘
             ↓
┌──────────────────────────────────────────┐
│ Services                                 │
│  - SupabaseService (シングルトン)        │
│  - MandalartFactory (CRUD ヘルパ)        │
│  - SyncEngine (pull / push)              │
└─────┬──────────────────────────┬─────────┘
      ↓                          ↓
┌──────────────────┐   ┌──────────────────┐
│ SwiftData (local)│   │ supabase-swift   │
│ ModelContainer   │   │ Auth / PostgREST │
└──────────────────┘   └──────────────────┘
```

- **Views** は `@Query` で SwiftData を直接読み、`@Environment(\.modelContext)` で書く。CRUD のロジックは `MandalartFactory` 等のサービスに切り出す
- **ViewModels** は global state holder (`AuthStore`)。MVVM 厳格運用ではなく、SwiftData の `@Query` で済むものは ViewModel を作らない (= "thin" な MVVM)
- **Services** はサインアウト境界の最下層。Supabase API / SwiftData ModelContext を直接呼ぶ
- **Models** はピュアな `@Model` のみ (ロジックは持たない、Service 側に置く)

## xcodegen + project.yml

### なぜ xcodegen か

- `Mandalart.xcodeproj/project.pbxproj` は巨大な独自フォーマットで diff が読めない / マージで衝突しやすい
- xcodegen の YAML は人間が読める / git で diff できる / 再生成可能
- `xcodeproj` を gitignore してリポジトリの sourcetree をクリーンに保てる

### project.yml の中身

主要セクション:

| 階層 | 役割 |
|---|---|
| `options.bundleIdPrefix` | bundle id プレフィックス |
| `options.deploymentTarget.iOS` | iOS 17.0 (SwiftData 必須なため) |
| `settings.base` | 全ターゲット共通 (SWIFT_VERSION / IPHONEOS_DEPLOYMENT_TARGET) |
| `packages.Supabase` | SPM 依存 (`supabase-swift` 2.x) |
| `targets.Mandalart` | アプリ本体ターゲット |
| `targets.Mandalart.dependencies` | `product: Supabase` (umbrella product) |
| `targets.Mandalart.settings.base` | bundle id / orientation / `SUPPORTED_PLATFORMS` 等 |

### Landscape 限定

`INFOPLIST_KEY_UISupportedInterfaceOrientations_iPhone/iPad` を `LandscapeLeft + LandscapeRight` のみに設定済。Portrait は仕様外。

### SUPPORTED_PLATFORMS workaround

`SUPPORTED_PLATFORMS = "iphoneos iphonesimulator"` と `SUPPORTS_MACCATALYST = NO` を target に明示。`xcodebuild` CLI が SPM 依存追加で iOS Simulator destination を見失う症状の defensive な対処 ([`pitfalls.md`](pitfalls.md) #1)。

### 再生成のタイミング

- `project.yml` を編集したとき
- 新しい Swift ファイルを追加したとき (xcodegen は `Mandalart/` 配下を再帰スキャン)
- 削除したとき
- SPM 依存を追加 / 削除したとき

```sh
cd ios && xcodegen generate
```

実行後、Xcode で開いていれば「Project changed on disk」警告が出るので **Revert** を選んで disk 側を採用する。

## なぜ desktop/ と独立リポジトリ風に並列なのか

- desktop は Tauri (Rust + Web)、iOS は Native Swift で技術スタックが完全に異なるため、コード共有はしない
- 共通点は **Supabase スキーマ** だけ。スキーマ変更は desktop 側を canonical として両者を同期する
- ビルドツールチェーン (Vite + Cargo vs Xcode + xcodegen) も完全独立、CI も将来別系統で組む

詳細仕様の参照先:
- 機能要件: [`../../desktop/docs/requirements.md`](../../desktop/docs/requirements.md)
- データモデル schema: [`../../desktop/docs/data-model.md`](../../desktop/docs/data-model.md) / iOS 側対応表は [`data-model.md`](data-model.md)
- Supabase setup: [`../../desktop/docs/cloud-sync-setup.md`](../../desktop/docs/cloud-sync-setup.md)
