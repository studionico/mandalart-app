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
- [x] **定期 auto-push (15 秒間隔)**: サインイン中は `MandalartApp` の `.task` で 15 秒ごとに `pushPending` を実行。アプリを閉じずに編集後 15 秒以内に他デバイスへ反映
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
- [x] **カード並べ替え (タップ選択方式)**: 長押し context menu の「移動」でカードを移動ソースに指定 (accent 枠でハイライト) → 別カードをタップでその直前へ挿入 (move-and-shift) → ソース再タップ / 新規作成カードタップでキャンセル。確定後 `selectedFolderId` スコープで `sortOrder` を 0..N に振り直し、変更分のみ `updatedAt` を bump して save。desktop の [`reorderMandalarts`](../../desktop/src/lib/api/mandalarts.ts) / [`reorderArray`](../../desktop/src/utils/reorderArray.ts) 相当 (desktop は HTML5 D&D だが iOS は長押しメニュー衝突回避のため tap-select 方式に統一)。検索モード中 / 1 件以下では「移動」非表示。スキーマ変更なし (`sortOrder` は既に同期配線済)
- [x] **フォルダタブ** (Phase 4 phase 3): ダッシュボード上部に horizontal scroll の chip 風 folder tab (Inbox 先頭固定 + ユーザー folder)、選択 folder で main grid を filter (検索時は全 folder 横断)、folder 追加 / 名前変更 / 削除 (Inbox 不可)、長押し menu に「フォルダ移動」サブメニュー追加。folder マンダラート数 badge 表示。**folder 名入力は `.alert` だと iOS で日本語 IME が効かないため `.sheet` ベースの `FolderNameSheet` で実装** (落とし穴的な制約)
- [x] **`FolderRepository`** に CRUD 追加: `createFolder(name:)` / `renameFolder(_:to:)` / `deleteFolder(_:)` (Inbox 削除拒否、紐づく mandalart は Inbox に振り分けてから soft delete)
- [x] **ゴミ箱 UI** ([`TrashView`](../Mandalart/Views/TrashView.swift)): DashboardView の context menu の「削除」を `MandalartFactory.softDelete` 呼び出しに変更 (= cells / grids / mandalart の `deletedAt` を立てて cloud に push)、toolbar 右上に trash アイコンを追加し sheet で TrashView を出す。一覧は `@Query` で `deletedAt != nil` を `deletedAt` 降順 sort、各行に「復元」(`MandalartFactory.restore`) と「完全削除」(`MandalartFactory.permanentDelete`、SwiftUI `.alert` で 1 段階確認) を配置。リスト上部ヘッダーに「すべて削除 (N)」(全件一括完全削除、1 段階 `.alert` 確認、`permanentDelete` を逐次 await) を配置 (StockTab の「すべて削除」と同じ native pattern)。desktop の [`TrashDialog.tsx`](../../desktop/src/components/dashboard/TrashDialog.tsx) と等価。**ロック中マンダラートは context menu で「削除」非表示** + `softDelete` 冒頭にも `guard !mandalart.locked` の defensive ガードあり (= permanentDelete と同等の二重保護)

### 残作業

- [ ] カードグリッド `LazyVGrid(columns: .adaptive(minimum: 140))` の改善 (現状 minimum 140)
- [x] **ストックサイドパネル** (= Phase 7 のストックタブと統合実装): EditorView 右ペインに segmented picker (メモ / ストック) を追加。詳細は Phase 7 完了項目参照
- [ ] folder の並び替え (drag to reorder)

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

- [x] **ロック banner**: editor 上部全幅 banner、tap で alert 「ダッシュボードに戻ってロック解除」のヒント表示 ([`EditorView.lockBanner`](../Mandalart/Views/EditorView.swift))
- [x] **長押し context menu (色 + クリア)**: [`CellView.cellContextMenu`](../Mandalart/Views/Components/CellView.swift) で 10 色プリセット選択 + 内容クリア。ロック中 / cell 未生成時はメニュー無効化
- [x] **`PresetColors`**: desktop の 10 色プリセット ([`constants/colors.ts`](../../desktop/src/constants/colors.ts)) を Swift に移植 ([`Utils/PresetColors.swift`](../Mandalart/Utils/PresetColors.swift))。ライト / ダークモードで色調を desktop と統一
- [x] **画像 (ローカル保存)**: [`ImageStorage`](../Mandalart/Services/ImageStorage.swift) で PhotosPicker → JPEG 圧縮 (max 1200pt, q=0.7) → Application Support/images/ に保存。`Cell.imagePath` に相対パスを記録。CellView 背景に画像表示 + テキスト共存時は半透明黒 overlay でテキスト読みやすく。context menu に「画像を追加 / 変更 / 削除」追加。**画像本体は Supabase Storage `cell-images` に同期する** (下記参照)
- [x] **並列グリッド** (← / → / + で同じ親 cell から複数子グリッドを切替): [`GridRepository`](../Mandalart/Services/GridRepository.swift) に `getSiblingGrids` / `createParallelGrid` / `cleanupGridIfEmpty` を追加。EditorView 左ペインに chevron-left / chevron-right ボタン + 下部に「並列グリッド追加」capsule ボタン。並列追加は新 center cell を持つ独立 grid を作成 (`parentCellId` は現在 grid から継承)。並列ナビ時に旧 grid が完全に空 (cells が全て空 + 子グリッドなし) なら物理削除して累積を防止。breadcrumb 末尾の `gridId` を切替先に追従、`mandalart.lastGridId` も更新で cross-device 復元対応。**ロック中**は + ボタン非表示 / cleanup スキップ (= 書き込みなし、ナビは許可)
- [x] **チェックボックス UI + done 親子伝播**: マンダラート単位の `Mandalart.showCheckbox` (= per-mandalart 永続 + Supabase 同期) に応じて、各非空 cell の左上に 22pt チェックボックスを表示。tap で `Cell.done` をトグル + サブツリーへ down 伝播 + 親方向へ up 伝播 ([`CellCheckboxService.toggle`](../Mandalart/Services/CellCheckboxService.swift), desktop [`toggleCellDone`](../../desktop/src/lib/api/cells.ts) と等価)。EditorView 右上 toolbar の fontSizeControl 左隣に showCheckbox 表示切替 36pt circle (`ultraThinMaterial`) を配置 (compact / regular 両方で常時表示)。9×9 inner ビュー / 空セル / 編集中は非表示、ロック中は表示維持 + tap no-op で desktop と挙動一致
- [x] **セル入れ替え (周辺 ↔ 周辺、tap-select)**: desktop の D&D `swapCellSubtree` ([../../desktop/src/lib/api/cells.ts](../../desktop/src/lib/api/cells.ts)) を iOS で再現。CellView 長押し context menu に「入れ替え」項目を追加し、tap で swap mode を開始 → source cell 枠を accent color highlight (banner なし、視覚は cell highlight のみ) → grid 上で target cell を tap で確定 / source 再 tap で cancel。`CellSwapService.swap` ([../Mandalart/Services/CellSwapService.swift](../Mandalart/Services/CellSwapService.swift)) が cells の text / imagePath / color / done と grids の parentCellId / centerCellId を双方向で swap (`done` も内容に付随して swap、自グリッド除外。同一 grid swap で done 集合不変のため中心 done 再計算不要)。中心セル絡みは context menu 非表示 + target tap 時 alert で拒否 (desktop 落とし穴 #15 と整合)。中心判定は **display slot position** (= CellView の `position` prop) で行い `cell.position` は使わない (child grid の merged center 対策)。ロック中は context menu 自体非表示。ストックペーストと mutex (= 一方の起動で他方を解除)
- [x] **周辺セルのクリア (中心セル限定)**: desktop の中心セル右クリック「周辺セルのクリア」を移植。CellView 長押し context menu に「周辺セルのクリア」を追加 (中心セル + 周辺非空 + 非ロック時のみ表示)。[`GridRepository.clearGridPeripherals`](../Mandalart/Services/GridRepository.swift) が表示中グリッドの周辺 8 セル + 配下を `shredCellSubtree` で一括クリア (中心は保持)。確認は [`ClearPeripheralsConfirmModifier`](../Mandalart/Views/Components/ClearPeripheralsConfirmModifier.swift)、Undo 非対象。クリア対象は表示中 gridId (子グリッド中心は `cell.gridId` が親を指すため使わない) / 中心判定は display slot position
- [x] **画像 cross-device 同期**: Supabase Storage `cell-images` (非公開) 経由で他デバイスからも見えるようにした。desktop / iOS 両方が upload + download に対応。[`ImageStorage`](../Mandalart/Services/ImageStorage.swift) の `uploadToCloud` / `downloadFromCloud` / `backfillUpload`、キーは `<userId(小文字)>/<basename>`。`saveImage` 時に自動 upload、`CellView` の `.task` で local 不在時に download fallback、fullSync / 手動同期後に `SyncEngine.backfillImages` で回収。`cells.image_path` のスキーマは不変。設定手順は [`../../desktop/docs/cloud-sync-setup.md`](../../desktop/docs/cloud-sync-setup.md) の「必須: 画像同期用 Storage バケット」
- [ ] drill 中の child grid 削除 (cascade) は Phase 8 (delete 系) と統合予定

## Phase 6: drill + 9×9 + アニメーション (進行中)

### 完了 ✅

- [x] **drill / drill-up / 並列ナビ / 初回表示の orbit-style stagger fade-in**: [`AnimationStagger`](../Mandalart/Utils/AnimationStagger.swift) で順序テーブル (時計回り `[7,6,3,0,1,2,5,8]` 等) を集約、`CellView.onAppear` で `position` × `transitionKind` から計算した delay 後に `withAnimation(.easeOut)` で `animatedVisible: false → true` 補間。`TimingConstants.animStaggerMs` / `animFadeMs` を再利用。drill-down の中心 (X=C 連続セル) は `init` で visible=true にしてちらつき回避
- [x] **画像セルまばたき対策 (#18 の iOS 版)**: [`ImageStorage`](../Mandalart/Services/ImageStorage.swift) に in-memory `NSCache` 層を追加、`saveImage` 時に乗せ `loadImage` 時に同期 lookup。drill アニメで CellView が remount されてもディスク I/O なし
- [x] **`GridView9x9`** ([`Views/Components/GridView9x9.swift`](../Mandalart/Views/Components/GridView9x9.swift)): 3×3 を 9 個ネスト (= 81 セル)、view-only (= `readOnly: true` で `GridView3x3` を内側で使用)、子グリッド未作成 block は薄い grey placeholder
- [x] **`GridRepository.loadNineByNineLayout`**: root grid 起点で 9 ブロック分の `(Grid?, displayCells)` を返す
- [x] **3×3 ↔ 9×9 toggle**: EditorView 右上 floating capsule ボタン (`9×9` / `3×3` ラベル切替)、`withAnimation(.spring)` で scale + opacity の cross-fade
- [x] **`CellView.readOnly` props**: 9×9 内 inner 3×3 として描画するとき tap / longPress / contextMenu / focus 全 NOOP

### 残作業 (Phase 6c, 後続セッション)

- [ ] 精緻な orbit cross-fade (`matchedGeometryEffect` で親 peripheral → 子 center の連続動き)
- [ ] 3×3 ↔ 9×9 切替時の per-cell stagger expand / shrink (現状は全体 spring scale で一括)
- [ ] アニメ中 `allowsHitTesting(false)` でガード (現状はアニメ短いので未対応でも実害なし)

### Polish (UI 統一 + overflow 改善) ✅

- [x] **配色・ボーダー desktop 同期**: `LayoutConstants` で `cellCornerRadius=8`, `cellCenterBorder=3`, `cellPeripheralBorder=0.5`, `cellPeripheralWithChildBorder=1.5`, `cellNineByNineInnerBorder=1`, `cardCornerRadius=4` を定数化。CellView は cell の `hasChild` (= `GridRepository.hasChildMaskForGrid` が `findChildGrid` で計算) に応じて 0.5 / 1.5 を出し分け。font weight は iOS .system 維持で Dynamic Type 対応 ([`pitfalls.md`](pitfalls.md) #10)
- [x] **breadcrumb 折りたたみ**: 4 階層以上で `[root] > [...] menu > [N-1] > [N]` の 5 要素表示に折りたたみ、`[...]` Menu で省略中間階層 (index 1〜N-3) を一覧表示。各 label は `lineLimit(1)` + `truncationMode(.tail)` + `frame(maxWidth: 120)` で個別 truncate
- [x] **9×9 toggle idiom 判定**: `@Environment(\.horizontalSizeClass) == .regular` (= iPad regular) のみ 9×9 トグルボタンを表示。compact (iPhone / iPad Split View 1/3 等) では非表示 + `.onChange(of: hsc)` で 9×9 中なら 3×3 へ強制復帰 ([`pitfalls.md`](pitfalls.md) #11)

## Phase 7: メモ / ストック (進行中)

### 完了 ✅

- [x] **メモタブ** ([`MemoTab`](../Mandalart/Views/Components/MemoTab.swift)): EditorView 右ペインで「編集 / プレビュー」segmented picker、TextEditor で `grid.memo` を 直接 `Binding` で書き込み (= 別 `@State` を介さず `@Observable` の sync 反映を即座に拾う)、プレビューは行ごとに分割して見出し (`# / ## / ###`) とリスト (`- `) を手動 parse、各行内の inline 装飾 (`**bold**` / `*italic*` / `[link](url)`) は `AttributedString(markdown:)` に委譲
- [x] **対応 Markdown 仕様** (desktop `MemoTab.tsx` の `renderMarkdown` と揃える): `# / ## / ###` / `**bold**` / `*italic*` / `- リスト` / 改行 / `[link](url)`。**ただし `[link](url)` は desktop 側 renderMarkdown が未対応** なので iOS で書いても desktop では plain text になる (= 仕様の制約、両側 sync 自体は OK)

### 残作業

- [x] **ストックタブ** (Phase 4 残のストック sidebar と統合): EditorView 右ペインに segmented picker (メモ / ストック) を追加し、ストックタブで [`StockTab`](../Mandalart/Views/Components/StockTab.swift) を表示。`@Query<StockItem>` を `createdAt` 降順で取得し、3 列の正方形タイル grid に「ペースト」(下向き矢印) と「削除」(×) アイコンを付ける。「すべて削除」は `.alert` で 1 段階確認
- [x] **StockService** ([`StockService.swift`](../Mandalart/Services/StockService.swift)): `addToStock` / `moveCellToStock` (cut) / `getStockItems` / `deleteStockItem` / `pasteFromStock` を実装。`CellSnapshot` / `GridSnapshot` Codable 構造体は desktop ([`stock.ts`](../../desktop/src/lib/api/stock.ts)) と完全に揃え、X=C 統一モデルで peripherals のみ snapshot 化。中心セル → 中心セル ペースト時は grid 全体展開 (`expandGridSnapshotInto`)、それ以外は children を target cell 配下の新 grids として再帰挿入 (`insertGridSnapshot`)
- [x] **GridRepository.shredCellSubtree** ([`GridRepository.swift`](../Mandalart/Services/GridRepository.swift)): cut 用 helper。source cell の content クリア + `parentCellId == cellId` の grid を BFS で再帰収集して cells と grid を物理削除
- [x] **paste UX**: drag-drop は iPhone Landscape の hit-test 不安定さを避けて未実装。代わりに「ストックタブで item の『ペースト』ボタンタップ → 選択 item のタイル枠が accent color highlight ([`StockTab.swift`](../Mandalart/Views/Components/StockTab.swift) `isPasteSelected`) → grid のセルをタップ」 の選択モード方式。`stockPasteTargetItemId: String?` を EditorView に持ち、`GridView3x3` / `CellView` に `pasteMode` + `onPasteTargetTapped` を lift。同じ item を再 tap で mode 解除 (= banner なし、視覚 cue は source 表示元の StockTab タイル枠に集約。セル入れ替えと共通方針 [requirements.md](requirements.md))
- [x] **CellView context menu に「ストックに追加」「ストックに移動」を追加**: 内容クリアの上に配置。空セル時は disable
- [x] **paste ガード**: 中心セルが空のグリッドの周辺セルへペーストしようとした場合、`StockService.StockError.centerEmpty` を throw (現状は console log + silent skip、UI alert は将来追加)
- [ ] StockItem は **local-only** (Supabase 同期しない、[`data-model.md`](data-model.md) 参照) — 仕様確認のみ、SyncEngine の DTO 配列に StockItem を含めていないことを確認済 ✓
- [ ] `MarkdownUI` package or 自前で block-level Markdown (table / code block / list 等) を render (現状は inline のみ)
- [ ] **drag-drop UI** (= ストック → セル / セル → DragActionPanel): iPhone Landscape の hit-test 制約のため未実装、tap-select で代替済

## Phase 8: ロック / インポート / エクスポート (進行中)

### 完了 ✅

- [x] **ロック機能の現状確認**: editor / cell / dashboard 削除に既に locked guard あり ([`MandalartFactory.softDelete` / `permanentDelete`](../Mandalart/Services/MandalartFactory.swift) / [`CellView.cellContextMenu`](../Mandalart/Views/Components/CellView.swift) / [`DashboardView` 削除メニュー](../Mandalart/Views/DashboardView.swift))。pinned 切替 / folder 移動 / 複製は **desktop と整合して敢えて lock guard を入れていない** (= dashboard 上の整理操作で内部状態は変えない仕様)
- [x] **JSON / Markdown / IndentText の Export** ([`TransferService.swift`](../Mandalart/Services/TransferService.swift)):
  - `exportToJSON(gridId:in:)` で BFS で grid 階層を traverse し `GridSnapshot` 構築 (= desktop の [`transfer.ts`](../../desktop/src/lib/api/transfer.ts) と完全一致、cross-platform round-trip 可能)
  - `snapshotToMarkdown` / `snapshotToIndentText` の純関数で text 変換 (= 周辺セルは `peripheralPositionsByTab = [7, 6, 3, 0, 1, 2, 5, 8]` 順)
  - **Markdown はロスレス (md-lossless-v1)**: `snapshotToMarkdownFile` が YAML frontmatter に `GridSnapshot` 全体を compact JSON (block-scalar) で保持し、本文 `#` 見出しは人間可読ビュー。`buildFrontmatter` / `extractFrontmatterSnapshot` は desktop [`markdown-frontmatter.ts`](../../desktop/src/lib/markdown-frontmatter.ts) と等価。`CellInGrid.done` を追加し memo/color/image/done/位置/6 階層超を JSON 同等にロスレス往復 (done は cloud 同期外だが export/import には含む)。IndentText は簡易形式でロスあり
  - `MandalartExportDocument` (`FileDocument`) で `.fileExporter(...)` に接続。filename は `<sanitize(title or cell.text)>-yyyyMMdd-HHmmss.<ext>`
  - **Dashboard 経路**: カード長押し menu に「エクスポート」追加 → `confirmationDialog` で format 選択 → `.fileExporter` (= mandalart 全体を出力)
  - **Editor 経路**: cell 長押し context menu に「エクスポート」追加 (= **そのセル以下の subtree** を出力)。`exportCellAsSnapshot` で動作分岐: 中心セルなら自グリッド全体 / 周辺で drilled あれば drilled grid を出力 (cell が center として merge) / 周辺で drilled なしなら synthetic snapshot (cell content のみ)。Export はロック中も許可 (= 読み取り専用)
- [x] **JSON / Markdown / IndentText の Import** ([`TransferService.swift`](../Mandalart/Services/TransferService.swift)):
  - import 判定順は **frontmatter (md-lossless-v1) → JSON → テキスト**: `extractFrontmatterSnapshot(text) ?? parseTextToSnapshot(text)` で frontmatter があれば信頼してロスレス復元、無ければ従来パーサにフォールバック (Dashboard / Editor 両経路)
  - `parseTextToSnapshot(_:)` で先頭 `#` なら Markdown、それ以外は IndentText 自動判定 (= desktop の [`import-parser.ts`](../../desktop/src/lib/import-parser.ts) を Swift に移植、frontmatter なし旧ファイル用の fallback)
  - `parseMarkdown` / `parseIndentText` でツリー構築 (path-based stack で階層管理、`stripBulletMarker` で `・ • ◦` 等の bullet 記号除去)
  - `nodeToGrid` で `ParsedNode` → `GridSnapshot`、9 個目以降の子は 8 個ずつ並列グリッドに分割
  - `importFromJSON(snapshot:targetFolderId:in:)` で SwiftData @Model に新規 mandalart として insert (root grid → cells → drilled / parallel children を再帰挿入)
  - `importIntoCell(snapshot:cellId:in:)` で **既存セルに subtree を上書きインポート** (= desktop の `importIntoCell` 相当)。target cell の content を snapshot.cells[centerPosition] で上書き + drilled grid として cell の配下に挿入 (X=C primary drilled、`ownsCenter=false`)
  - **Dashboard 経路**: toolbar に「インポート」アイコン (square.and.arrow.down) → `.fileImporter` で .json / .md / .txt 選択 → 拡張子で JSON or text として parse → 新規マンダラート作成
  - **Editor 経路**: cell 長押し context menu に「ここにインポート」追加 (= ロック中は非表示) → `.fileImporter` → 既存セルに subtree を上書き
  - エラー (parse 失敗 / 空 / decode 失敗) は `TransferError` を localized message で alert 表示

### 残作業

- [ ] **ロック機能の追加 mutation guard**: 現状で十分な範囲をカバー済 (= editor 編集 / cell 編集 / 削除)。**desktop と同じ仕様** (pinned / folder 移動 / 複製は lock 中も許可 = dashboard 整理操作)。追加実装は不要だが、Phase 10 の仕上げで rechecks
- [ ] **PNG / PDF Export**: `ImageRenderer` (iOS 16+) で View → UIImage、`PDFKit` で PDF 化。3×3 / 9×9 表示の選択 + ロゴ/タイトル/日時の overlay 検討。別 phase で対応
- [ ] **Replace import** (= 既存マンダラートに上書き import): 現状は常に新規作成。EditorView から「現在のマンダラートに上書き」menu は別 issue

## Phase 9: Welcome モーダル (未着手)

- [ ] 初回起動判定 (UserDefaults で `welcomeSeenVersion` 比較)
- [ ] ConceptSlide (= desktop Phase 1-4 アニメ) を SwiftUI keyframes で再現
- [ ] FeatureSlide × 6: `VideoPlayer` (AVKit) で mp4 autoPlay loop
- [ ] mp4 は [`../Mandalart/Resources/help/`](../Mandalart/Resources/help/) に desktop と同じファイルを配置
- [ ] 「次回以降表示しない」チェックボックス

## Phase 10: UI 仕上げ + テスト (未着手)

- [x] ダーク / ライトモード手動 override (`ThemePreference` + `ThemeToggle`、3 値 `light` / `system` / `dark` / グローバル UserDefaults `app.theme` / `.preferredColorScheme` 適用 / Editor 右上 floating + iPhone compact 右ペイン上部 HStack + Dashboard toolbar primaryAction + SettingsView 「外観」Section の 4 箇所配置) — 2026-05-16
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

## Phase 12: vault フォルダモード (Markdown ファイルを正) — desktop 後追い

desktop で Phase 2 Productize まで完了済みの vault モードを iOS に移植する。サンドボックス制約で
ファイルアクセス層 (iCloud Drive + security-scoped bookmark + UIDocumentPicker、watch 不可 →
アプリ復帰時に全スキャン) が desktop と別物になるため、desktop と同じく安全段階ロールアウトで進める。

- [x] **Stage 0/1: ピュア層移植 + ユニットテスト** (2026-06-06) — desktop `src/lib/vault/` の純変換層を
  Swift に 1:1 移植。[`Mandalart/Vault/`](../Mandalart/Vault/): `VaultTypes` / `VaultFrontmatter`
  (block-scalar JSON codec) / `VaultFormat` (md-mandalart-v1 build/parse + docContentEquivalent +
  attachmentName + 本文 wiki-link/embed) / `VaultModel` (mandalartToVaultFiles / vaultFilesToRows) /
  `VaultReconcile` (hashContent=CryptoKit SHA-256 / diffById / diffFiles / shouldSkipEcho)。
  ピュア層は **@Model 非依存のプレーン struct 行型** (`VaultGrid`/`VaultCell`/`VaultMandalart`) を扱う。
  **本番未配線 (dead code)・既存コード無改変**。新規テストターゲット `MandalartTests` + 専用スキーム
  `VaultTests` で **35 tests green** (desktop `__tests__` のケースを移植、round-trip id 完全一致)。
  `xcodebuild test -scheme VaultTests` が Supabase 非ビルドで CLI 完走 (落とし穴 #1 回避)。
- [x] **Stage I/O (テスト可能な I/O 層)** (2026-06-06) — desktop `io.ts` / `imageVault.ts` / `config.ts` を
  iOS の FileManager / security-scoped bookmark に移植。[`Mandalart/Vault/`](../Mandalart/Vault/): `VaultIO`
  (scanVault / scanMandalartDir / ensureDir / write / remove / readBytes、URL ベース) / `VaultImageStore`
  (flushImagesToVault / restoreImagesFromVault、appSupportDir・vaultRoot を引数注入で ImageStorage=Supabase
  非依存) / `VaultConfig` (vaultMode / **bookmark Data** / vaultPath を UserDefaults 永続化、make/resolve/withAccess、
  shouldRebuildOnStartup)。**本番未配線・既存コード無改変**。temp ディレクトリ相手の XCTest 3 ファイルを追加し
  **50 tests green** (Stage 0/1 の 35 + I/O 15)、`VaultTests` スキームで Supabase 非ビルドのまま CLI 完走。
  ※`bookmarkData` は `.withSecurityScope` を使わない (macOS 専用)。watch は iOS 不可のため未移植。
- [x] **Stage I/O-b (picker + bookmark + export/dry-run ハーネス)** (2026-06-06) — 実フォルダに対し DB→vault
  書き出しと vault→rows dry-run を **DEBUG 限定 Settings ハーネス**から実行できるよう配線。新規: ピュア
  [`Vault/VaultTimestamp`](../Mandalart/Vault/VaultTimestamp.swift) (ISO8601 Date↔String、SyncEngine 同形式) /
  [`Vault/VaultSync`](../Mandalart/Vault/VaultSync.swift) (exportAllToVault / dryRunScan、structs のみで test 可) +
  SwiftData 依存の [`Services/VaultRowsBridge`](../Mandalart/Services/VaultRowsBridge.swift) (@Model→[MandalartRows]
  read-only、app 限定) + [`SettingsView`](../Mandalart/Views/SettingsView.swift) に `#if DEBUG`「Vault（実験的）」
  Section (`.fileImporter(.folder)` でフォルダ選択 → bookmark 永続化、export / dry-run ボタン、結果を Text 表示)。
  **本番トグル・DB 書込み無し / リリースビルドには出ない**。temp ディレクトリ相手の XCTest 追加で **57 tests green**
  (I/O の 50 + Timestamp 3 + Sync 4)、DEBUG/Release 両ビルド SUCCEEDED。手動検証: 設定→Vault→フォルダ選択→
  書き出し→Files アプリで `<dirName>/_mandalart.md`・`<gridId>.md`・`attachments/` を目視、dry-run で件数一致。
- [x] **Stage DB (vault→DB 実書込み)** (2026-06-06) — desktop `applyToDb.ts` / `reconcileVaultToDb` を
  SwiftData に移植。新規: [`Services/VaultDbApply`](../Mandalart/Services/VaultDbApply.swift)
  (`applyVaultRowsToDb` = id で upsert + `deletedAt=nil` 復活 + `syncedAt` 温存 + folder name ensure +
  vault に無い grid/cell 削除、`skipGridDeletionFor`/`deleteMissingMandalarts` ガード) /
  [`Services/VaultDbReconcile`](../Mandalart/Services/VaultDbReconcile.swift) (scanVault → vaultFilesToRows →
  apply + **破損検知** (grid .md 数 > grids 数 で削除スキップ) + 画像復元)。[`SettingsView`](../Mandalart/Views/SettingsView.swift)
  の `#if DEBUG` Section に確認ダイアログ付き**「vault から再構築」**ボタン (`deleteMissingMandalarts=false`)。
  **実 SwiftData 書込みを in-memory ModelContainer でユニットテスト**: `MandalartTests` に `Models/` +
  bridge/apply/reconcile + `IDGenerator` を直接追加 (Supabase 非リンク維持) し、applyToDb.test.ts の 5 ケース +
  reconcile round-trip/破損検知を移植 → **64 tests green** (57 + apply 5 + reconcile 2)、Debug/Release 両ビルド SUCCEEDED。
  **本番トグル・起動時 rebuild は後続 (反転 Stage)**。手動検証: 設定→Vault→書き出し→編集→「vault から再構築」で DB が vault に戻る。
- [x] **Stage 反転 + 同期 gate** (2026-06-06) — desktop P3/P4 の iOS 移植。vaultMode ON で ① 起動時に vault→DB
  再構築 ② クラウド同期 (fullSync + 手動同期) を停止。[`MandalartApp`](../Mandalart/App/MandalartApp.swift) に
  `bootstrapVaultRebuild` (shouldRebuildOnStartup なら `reconcileVaultToDb`、「初期化中…」ゲート、失敗は既存 DB で続行) +
  `fullSync` 冒頭 `if vaultMode { return }`。[`SettingsView`](../Mandalart/Views/SettingsView.swift) の `#if DEBUG` に
  **vaultMode トグル**(ON 時は baseline export で files=DB に揃え初回 rebuild を no-op 化、bookmark 未設定なら disabled) +
  本番「同期」Section を `@AppStorage("vault.mode")` で disabled + 注記。**トグル・フォルダ選択は DEBUG 限定**(release では
  `vault.mode` 常に false = 反転/gate は休眠)。新規ファイル・project.yml 変更なし、**64 tests のまま green**、Debug/Release
  両ビルド SUCCEEDED。落とし穴 #24 復帰条件に vaultMode を含める旨を [`sync.md`](sync.md) に明記。手動検証: vault ON→編集→
  再起動で保持・pull 上書きなし / 外部 .md 編集→再起動で反映。残: auto-flush (DB→vault 差分)。
- [x] **Stage auto-flush (DB→vault 差分 flush)** (2026-06-06) — desktop P2 auto-flush の iOS 移植。これで「外部編集→起動
  rebuild→DB」と「アプリ内編集→flush→vault」が揃い **双方向ループ完成・症状1 (アプリ内編集が再起動で消える) 解消**。
  [`VaultSync.flushDbToVault`](../Mandalart/Vault/VaultSync.swift) (DB rows→vault 差分書き出し: 既存 scan → `docContentEquivalent`
  で updated_at だけの差を churn 抑止 → `diffFiles` で write/delete + untitled リネーム + 画像 + 消えたマンダラート dir 削除/空 DB ガード、
  ピュア=test 可) + [`Services/VaultAutoFlush`](../Mandalart/Services/VaultAutoFlush.swift) (**`ModelContext.didSave` 購読**=iOS の
  onDbWrite 相当 + debounce 3s + in-flight 追走、vaultMode ON のときだけ flush、flush はファイルのみ書き DB 非改変=ループ無し)。
  [`MandalartApp`](../Mandalart/App/MandalartApp.swift) で bootstrap 後に `autoFlush.start` + scenePhase 背面遷移で `flushNow` (取りこぼし防止)。
  temp フォルダの flush テスト追加で **70 tests green** (64 + flush 6)、Debug/Release 両ビルド SUCCEEDED。
  → **Phase 12 (vault フォルダモード) 一巡完了**: Stage 0/1 (3621b57) → I/O (60df3d8) → I/O-b (8ea818f) → DB (a1f03db) → 反転 →
  auto-flush。vaultMode は引き続き DEBUG 限定 (release は休眠)。
- [x] **症状2 修正: 背面=書き出し / 復帰=取り込み** (2026-06-06) — 「アプリ起動中に外部で .md を編集→再起動で反映されない」は
  parse 破損ではなく **auto-flush が外部編集を上書き**していたのが原因 (iOS は watcher が無く外部編集を起動時 reconcile でしか取り込めず、
  取り込み前に flush=DB→vault が走ると外部編集をファイルごと潰す)。[`MandalartApp`](../Mandalart/App/MandalartApp.swift) の scenePhase を
  **background=`flushNow`(書き出し) / active 復帰=`importVaultOnForeground`(=reconcile 取り込み)** のペアにし、`wasBackgrounded` ガードで
  起動直後の .active を除外。これで背面中の外部編集が復帰時に DB へ取り込まれ、次の flush で潰れない。
  **重要**: flush(書き出し)は **`.background` だけ**で行う。復帰シーケンス `.background→.inactive→.active` の `.inactive` でも flush すると
  復帰途中で外部編集を潰し `.active` 取り込みが潰れた vault を読む (= 初回修正で踏んだバグ、手動検証で発覚 → `.inactive` は no-op に修正)。
  70 tests green・Debug/Release SUCCEEDED。
  残課題: vaultMode 本番昇格 / 大規模 vault の差分 rebuild 最適化 / フォルダ watcher (起動中ライブ取り込み、現状は背面往復で代替)。
- [x] **本文ラウンドトリップ Stage ①② (編集可能な本文 render + parser)** (2026-06-06) — 「外部編集が反映されない」真因は
  frontmatter の compact JSON を手編集して parse が壊れたこと (診断ログで確定)。本文(人間可読ビュー)を自然に編集→DB 反映できる形式へ
  再設計。ユーザー決定: position は `^pN` block-ref、フル忠実度 (text/color/done/image/memo)。① [`VaultFormat`](../Mandalart/Vault/VaultFormat.swift)
  の本文 render を正準形 `<#/##> [done] <text or [[childId|alias]]> #c/<color> ^pN` (+ 画像 embed) に拡張。② 新規
  [`VaultBody`](../Mandalart/Vault/VaultBody.swift) (`parseGridBody` / `mergeBody`、三値 `BodyField` でフィールド単位フォールバック=
  壊れてもサイレント全損しない、新 position=synthCellId・欠落 position 維持) + `parseGridDocument(applyBody:)`。**本番経路は applyBody=false
  のまま (挙動不変)、テストのみ true で round-trip 検証**。80 tests green (70 + VaultBody 10)、Debug/Release 両ビルド SUCCEEDED。
- [x] **本文ラウンドトリップ Stage ③ 本番配線** (2026-06-06) — `vaultFilesToRows` に `applyBody: Bool = false` 引数を足し
  [`VaultDbReconcile.reconcileVaultToDb`](../Mandalart/Services/VaultDbReconcile.swift) で `applyBody: true` 化 (起動 rebuild / 復帰 import /
  設定再構築の 3 経路が同関数に集約)。DB→vault 方向 (flush/dryRun の existing 読取) は既定 false で不変。本文編集で updated_at は bump せず
  (vault モード中は同期停止で問題なし、`docContentEquivalent` で round-trip 安定)。reconcile レベル end-to-end テスト 3 件 + files レベル 1 件追加で
  84 tests green、Debug build SUCCEEDED。
  残: **Stage ④ clobber 安全化** (per-file hash で外部変更ファイルを flush が上書きしない echo-skip) + vault OFF 遷移時の updated_at 整備。

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
