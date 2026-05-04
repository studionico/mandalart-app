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
│   │   ├── DashboardView.swift   ホーム (LazyVGrid + 新規作成 + サインインボタン)
│   │   ├── EditorView.swift      編集画面 (Landscape 2 ペイン + drill state)
│   │   ├── SettingsView.swift    アカウント / 同期ボタン
│   │   ├── SignInView.swift      Email サインイン / 新規登録
│   │   └── Components/
│   │       ├── CellView.swift    1 セル (tap → drill or inline edit、長押しで色 / クリア context menu、編集中以外は overlay で hit テスト)
│   │       ├── GridView3x3.swift 3×3 (`displayCells: [Cell?]` 9 要素受け取り、id で grid 切替時 remount)
│   │       ├── Breadcrumb.swift  右ペイン上部の階層 navigation (タップで drill-up)
│   │       └── MemoTab.swift     右ペイン下部のメモタブ (編集 / プレビュー切替、grid.memo を 1 秒 debounce で auto-save)
│   ├── ViewModels/
│   │   └── AuthStore.swift       @Observable / @MainActor / supabase-swift Auth ラッパ
│   ├── Services/
│   │   ├── SupabaseService.swift 共有 SupabaseClient
│   │   ├── MandalartFactory.swift create / permanentDelete (cascade) / cloud cascade + tombstone
│   │   ├── FolderRepository.swift ensureInboxFolder (重複 system folder 統合) / adoptOrphansToInbox
│   │   ├── ImageStorage.swift     セル画像のローカル保存 (Application Support/images/、JPEG 圧縮、cross-device 非同期)
│   │   ├── GridRepository.swift  drill / parallel helper (findOrCreateChildGrid / findChildGrid / displayCells / getGridAncestry / getSiblingGrids / createParallelGrid / cleanupGridIfEmpty)
│   │   ├── CloudDeleteTombstone.swift permanent delete cloud cascade のリトライキュー (UserDefaults 永続)
│   │   ├── RealtimeService.swift Supabase realtime (postgres_changes) 購読 + debounced pullAll
│   │   ├── SyncEngine.swift      pullAll / pushPending / DTO
│   │   ├── Secrets.swift         Supabase URL / anon key (gitignore)
│   │   └── Secrets.swift.template
│   ├── Utils/
│   │   └── Constants.swift       GridConstants / LayoutConstants / TimingConstants
│   └── Resources/
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
