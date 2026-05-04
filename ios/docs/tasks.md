# tasks.md (iOS)

iOS 版 Phase 0-11 のチェックリスト。実装中のセッションが進捗確認に使う。

詳細な phase 設計 / 工数見積 / out-of-scope は plan file ([`/Users/maro02/.claude/plans/ios-twinkly-sonnet.md`](../../../.claude/plans/ios-twinkly-sonnet.md)) を参照 (記載対象外で gitignore)。

## Phase 0: 環境セットアップ ✅

- [x] Xcode 16+ (Tahoe で Xcode 26.4.1 確認済)
- [x] Apple ID で Free signing 有効化
- [x] iPhone 実機接続 (将来用、現在は Simulator のみ)
- [ ] Apple Developer Program 加入 ($99/年) — MVP 完成後

## Phase 1: プロジェクト初期化 ✅

- [x] xcodegen install (`brew install xcodegen`)
- [x] [`project.yml`](../project.yml) 作成、bundle identifier `jp.mandalart.app.ios`
- [x] Landscape 限定: `UISupportedInterfaceOrientations` を `LandscapeLeft + LandscapeRight` のみ
- [x] supabase-swift SPM 依存 (umbrella `Supabase` product)
- [x] `SUPPORTED_PLATFORMS = "iphoneos iphonesimulator"` / `SUPPORTS_MACCATALYST = NO` を target 明示
- [x] iPhone 17 Pro Simulator で空アプリ起動

## Phase 2: データモデル + ローカル CRUD ✅

- [x] 5 つの `@Model` 定義 (Mandalart / Grid / Cell / Folder / StockItem)
- [x] フィールド名を desktop SQLite schema と一致 (`Cell.text` / `Grid.sortOrder` / `Folder.isSystem`)
- [x] [`MandalartFactory`](../Mandalart/Services/MandalartFactory.swift) で `create` (root grid + center cell 同時 INSERT) / `permanentDelete` (cascade)
- [x] DashboardView の `+` ボタンで新規作成 / 長押しで削除 / カードタップで Editor 遷移
- [x] SwiftData が persist することを Simulator で確認
- [ ] 単体テスト (`XCTest` / Swift Testing) — 後回し可

## Phase 3: 認証 + 同期 (進行中)

### 完了 ✅

- [x] `SupabaseService` (umbrella `SupabaseClient` シングルトン)
- [x] `AuthStore` (Email サインイン / 新規登録 / サインアウト)
- [x] `SignInView` / `SettingsView` (今すぐ同期ボタン)
- [x] `SyncEngine.pullAll(into: ModelContext)` (folders / mandalarts / grids / cells を並列 fetch + last-write-wins upsert)
- [x] `SyncEngine.pushPending(from: ModelContext)` (synced_at < updated_at の dirty 行を upsert、folders/mandalarts に user_id 含める)
- [x] desktop で作ったマンダラートが iOS に pull されてくることを実機検証 (commit 0d375c9)
- [x] **自動同期 (scene phase ベース)**: [`MandalartApp`](../Mandalart/App/MandalartApp.swift) の `.task(id: auth.isSignedIn)` でサインイン直後フル同期、`.onChange(of: scenePhase)` でフォアグラウンド復帰 → pullAll、バックグラウンド遷移 → pushPending
- [x] **realtime 購読**: [`RealtimeService`](../Mandalart/Services/RealtimeService.swift) で 4 テーブル (folders / mandalarts / grids / cells) の `postgres_changes` を購読、任意 change で 1 秒 debounce の `pullAll` を発火。サインイン時 subscribe / サインアウト時 unsubscribe

- [x] **permanent delete の cloud 連動 + tombstone リトライ**: [`MandalartFactory.permanentDelete`](../Mandalart/Services/MandalartFactory.swift) を async 化、local 物理削除後に Supabase 側で cascade delete。失敗 / 未サインイン時は [`CloudDeleteTombstone`](../Mandalart/Services/CloudDeleteTombstone.swift) (UserDefaults 永続) に id を積み、次回 `SyncEngine.pullAll` 冒頭の `drainCloudDeleteTombstones` がリトライ。これで zombie 復活 (落とし穴 #6) を防止
- [x] **zombie cleanup**: [`SyncEngine.sanitizeZombies`](../Mandalart/Services/SyncEngine.swift) が `pullAll` / `pushPending` の冒頭で参照整合性をサニタイズ (親 mandalart が消えた grid / 親 grid が消えた cell を hard delete)。落とし穴 #12 (push thrash) 対策

### 残作業
- [ ] **OAuth サインイン (Google / GitHub)**: `Associated Domains` capability + `onOpenURL` で deep link 受け
- [ ] **エラー UI**: PGRST204 / 403 / network エラー時のユーザー通知 (現状は Settings 画面のテキストのみ)

## Phase 4: ダッシュボード画面 (進行中)

### 完了 ✅

- [x] **マンダラート作成時に `folder_id` を Inbox folder の id にセット**: [`FolderRepository.ensureInboxFolder`](../Mandalart/Services/FolderRepository.swift) で Inbox を find or create、`MandalartFactory.create` が引数省略時は自動でセット。重複 system folder の canonical 統合付き
- [x] **pullAll 後の orphan adoption**: [`FolderRepository.adoptOrphansToInbox`](../Mandalart/Services/FolderRepository.swift) を `SyncEngine.pullAll` 末尾で実行 (= 他端末 / 旧データ由来の `folderId == nil` マンダラートを Inbox に振り分け、desktop 側 `adoptOrphanMandalartsToInbox` 相当)
- [x] **検索 (`.searchable`)**: title のケースインセンシティブ部分一致 filter
- [x] **pinned top sort**: `@Query` の `SortDescriptor` で pinned DESC → sortOrder ASC → createdAt DESC
- [x] **長押し context menu**: ピン留め切替 / ロック切替 / 複製 / 削除 を実装。複製は [`MandalartFactory.duplicate`](../Mandalart/Services/MandalartFactory.swift) (lazy cell creation 維持で grids / cells を新 id で複製、pinned はリセット、locked / folderId は継承)
- [x] **カード上の indicator**: pinned / locked のとき右上に SF Symbol 表示

### 残作業

- [ ] フォルダ sidebar (Landscape 余白活用、追加 / 名前変更 / 削除 UI、+ folder 移動)
- [ ] カードグリッド `LazyVGrid(columns: .adaptive(minimum: 140))` の改善 (現状 minimum 140)
- [ ] ストックサイドパネル (右 sidebar)

## Phase 5: エディタ画面 (基本) (進行中)

### 完了 ✅

- [x] Landscape 2 ペイン構成 (`HStack`、左 = 3×3 グリッド `.aspectRatio(1, contentMode: .fit)` 正方形、右 = breadcrumb + メモ プレースホルダ)
- [x] `GridView3x3` / `CellView` / `Breadcrumb` Components
- [x] Tap で inline edit (空セル + 中心セル) / 周辺非空セルで drill-down
- [x] **drill-down**: 周辺セルタップで子グリッドを find or create (X=C 統一モデル)
- [x] **drill-up**: breadcrumb 前段クリックで戻る
- [x] **`mandalart.lastGridId`** を drill 時に更新 (= cross-device で復元) + 起動時 ancestry 復元
- [x] **child grid の center merge**: `GridRepository.displayCells(for:in:)` で親 peripheral cell を index 4 に注入
- [x] ロック中は Cell タップ全 disable

### Phase 5 残作業

- [ ] **並列グリッド** (← / → ボタン or swipe で同じ親 cell から複数子グリッドを切替)
- [ ] LongPress で context menu (色 / 画像 / 削除 / 並列追加)
- [ ] **ロック banner** (上部、`mandalart.locked` のとき常時表示 + タップでダッシュボード遷移ヒント)
- [ ] drill 中の child grid 削除 (cascade) は Phase 8 (delete 系) と統合予定

## Phase 6: drill + 9×9 + アニメーション (未着手)

- [ ] セルタップで `matchedGeometryEffect` を使った orbit-style drill アニメ
- [ ] `GridView9x9` Components (3×3 を 9 個ネスト)
- [ ] view-switch (3×3 ↔ 9×9) を 1 ボタンで切替 (= desktop と同じ UX)
- [ ] アニメ中 `pointer-events: none` 相当 (`allowsHitTesting(false)`)

## Phase 7: メモ / ストック (未着手)

- [ ] メモタブ (Markdown プレビュー、`MarkdownUI` package or 自前)
- [ ] ストックタブ (StockItem 一覧、drag でセルに paste)
- [ ] StockItem は **local-only** (Supabase 同期しない、[`data-model.md`](data-model.md) 参照)

## Phase 8: ロック / インポート / エクスポート (未着手)

- [ ] ロック機能: `mandalart.locked → 全 mutation guard (Cell タップで read-only)`
- [ ] エクスポート: JSON / Markdown / IndentText / PNG / PDF
  - PNG / PDF は `ImageRenderer` (iOS 16+) で View → image
  - Files app への保存は `UIDocumentPickerViewController` 経由
- [ ] インポート: Files app から `.mandalart.json` を選択 → parse → 新規マンダラート作成

## Phase 9: Welcome モーダル (未着手)

- [ ] 初回起動判定 (UserDefaults で `welcomeSeenVersion` 比較)
- [ ] ConceptSlide (= desktop Phase 1-4 アニメ) を SwiftUI keyframes で再現
- [ ] FeatureSlide × 6: `VideoPlayer` (AVKit) で mp4 autoPlay loop
- [ ] mp4 は [`../Mandalart/Resources/help/`](../Mandalart/Resources/help/) に desktop と同じファイルを配置
- [ ] 「次回以降表示しない」チェックボックス

## Phase 10: UI 仕上げ + テスト (未着手)

- [ ] ダーク / ライトモード対応 (`@Environment(\.colorScheme)`)
- [ ] iPhone 17 Pro / iPad (M4) Landscape で正常表示確認
- [ ] アクセシビリティ (VoiceOver / Dynamic Type)
- [ ] パフォーマンス計測 (Instruments)
- [ ] SwiftData VersionedSchema migration (技術検証で済ませている wipe 運用を撤廃)

## Phase 11: 配布準備 (オプション、未着手)

- [ ] App Icon / Launch Screen
- [ ] App Store スクリーンショット (6.7" / 6.1" / 12.9" iPad)
- [ ] App Store Connect 申請文 (= desktop の MoQ をベース)
- [ ] Apple Developer Program 加入
- [ ] TestFlight ベータ → 内部テスター招待
- [ ] App Store 申請

## 工数見積 (再掲)

iOS / Swift 経験者 1 人想定:

| Phase | 工数 |
|---|---|
| 1-3 (基盤 + 認証 + 同期) | 2〜3 週 (現在 Phase 3 進行中、commit 0d375c9 時点で実機検証済) |
| 4-5 (Dashboard + Editor 基本) | 2〜3 週 |
| 6 (drill + 9×9 + アニメ) | 2〜3 週 |
| 7-8 (メモ / ストック / lock / Import / Export) | 2 週 |
| 9 (Welcome) | 1 週 |
| 10 (仕上げ / テスト) | 1〜2 週 |
| **合計** | **約 10〜14 週 (2.5〜3.5 ヶ月)** |
