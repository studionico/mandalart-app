# requirements.md (iOS)

iOS 版固有の UX / UI 方針。

⚠️ **機能要件本体 (セル操作 / D&D / ストック / クリップボード / 並列グリッド / ゴミ箱 / カラーパレット 等) は [`../../desktop/docs/requirements.md`](../../desktop/docs/requirements.md) を canonical として参照すること。** 本ファイルは iOS 固有の差分のみ書く。

## 向き

- **Landscape Left / Landscape Right のみ**
- Portrait は禁止 (`UISupportedInterfaceOrientations` で宣言、device 回転しても自動で Landscape ロック)
- 理由: 3×3 / 9×9 グリッドは正方形寄りで、Landscape の方が水平方向の余白を活かしてメモ / ストックタブを右ペインに配置しやすい

## 画面構成

### Editor (Phase 5 で本格実装予定)

Landscape 2 ペイン構成 (`HStack` ベース):

```
+------------------+----------------------+
|                  |  breadcrumb          |
|    3×3 グリッド  +----------------------+
|    (正方形)      |  メモ / ストック     |
|                  |   タブ               |
+------------------+----------------------+
```

- 左ペイン: `.aspectRatio(1, contentMode: .fit)` で正方形クランプ + 垂直中央寄せ
- 右ペイン: 上に breadcrumb (現在のドリル位置、iPad regular のみ。iPhone compact では root 戻る / showCheckbox / 文字サイズの 3 controls に置換 — 下記参照)、下に メモ / ストック の `TabView`
- 9×9 表示時も同じ正方形クランプで、3×3 を 9 個ネスト
- **9×9 view は iPad regular のみ実用**: iPhone Landscape (= horizontalSizeClass .compact) では grid サイズが ~380pt / セル ~14pt まで縮小するため非表示にする ([`pitfalls.md`](pitfalls.md) #11)。toggle ボタンも非表示、`viewMode` は `.grid3x3` 固定
- **breadcrumb 折りたたみ**: 4 階層以上で `[root] > [...] menu > [N-1] > [N]` 表示にして overflow 回避 ([`Breadcrumb.swift`](../Mandalart/Views/Components/Breadcrumb.swift))。**iPhone (= compact horizontal size class) では breadcrumb を表示せず、右ペイン (memo/stock) 上部に `[arrow.up.to.line]` (root 戻る、depth>1 のみ可視 / 36pt 枠は常時保持) → `[showCheckbox toggle]` → `[文字サイズ capsule]` の 3 controls を HStack(spacing:8) で左寄せ並置** (memoW タイト機種向けに `ScrollView(.horizontal)` でガード、中間階層へのジャンプは割愛)。iPad (regular) は従来通り breadcrumb 表示 + 各 controls は右上 floating
- **右上 floating control の並び順** (左 → 右、**iPad regular のみ**): showCheckbox 表示切替 (36pt circle) → 文字サイズ調整 (124pt capsule, A− / N% / A＋) → 9×9 toggle (56pt capsule)。iPhone (compact) では floating は全廃して右ペイン上部 HStack に集約 (= 上記 breadcrumb 行参照)。実装: [`EditorView.checkboxToggleControl`](../Mandalart/Views/EditorView.swift) / [`EditorView.fontSizeControl`](../Mandalart/Views/EditorView.swift)
- **セル左上 done チェックボックス** (`Mandalart.showCheckbox == true` 時のみ): 22pt 視覚 + 30pt hit area、非空 cell 全てに表示 (中心 / 周辺 / 子あり / 画像セル どれでも)。tap で `Cell.done` をトグル + サブツリーへ down 伝播 + 親方向へ up 伝播 ([`CellCheckboxService`](../Mandalart/Services/CellCheckboxService.swift))。9×9 inner / 編集中 / 空セルでは非表示。**ロック中は visible (= 閲覧情報) だが tap で no-op** ([`EditorView.handleToggleDone`](../Mandalart/Views/EditorView.swift) で `m.locked` ガード)。desktop [`Cell.tsx:336-412`](../../desktop/src/components/editor/Cell.tsx) と挙動一致
- **セル入れ替え / ストックペースト の選択モード UI (共通方針)**: 上部 banner は出さず、視覚 cue は **source 表示元** に集約する (= 縦スペース節約):
  - **セル入れ替え (tap-select)**: desktop の D&D swap を iOS で代替。CellView の長押し context menu に「入れ替え」 (周辺 + 非空 + 非ロック時のみ表示) → source 枠を accent color highlight → 周辺 cell tap で確定 (空 slot も target 可) / source 再 tap で cancel。中心セル絡みは context menu 非表示 + target 時 alert 拒否 (判定は display slot position で実施、child grid の merged center 対策)。実装: [`CellSwapService.swap`](../Mandalart/Services/CellSwapService.swift) が text / imagePath / color と grids の parentCellId / centerCellId を双方向 swap (`done` は除外、自グリッド除外で root 自己参照保持)
  - **ストックペースト**: StockTab の item の「ペースト」button → 選択した item のタイル枠が accent color highlight ([`StockTab.swift`](../Mandalart/Views/Components/StockTab.swift) の `isPasteSelected`) → grid 上の cell tap で paste / 同じ item 再 tap で cancel
  - **mutex**: 一方を起動するともう一方は自動的に解除 ([`EditorView.handleSwapStart`](../Mandalart/Views/EditorView.swift) / `onPasteRequest`)

### Dashboard (Phase 4)

- 左 sidebar: フォルダタブ (Landscape の余白を活かす、iPhone 横向きでも展開できる)
- 右メイン: カードグリッド (`LazyVGrid(columns: .adaptive(minimum: 140))`) + 検索バー (toolbar 右上の虫眼鏡アイコンタップで `.searchable` modifier をトグル表示。検索対象は `Mandalart.title` + 配下 `Cell.text` + `Grid.memo` の OR 部分一致で desktop の `searchMandalarts` と同等。Cancel タップで Apple が text を自動クリアするため `lastQuery` 別 state に直前値をバックアップして再オープン時に復元する)
- カードの長押しで context menu (ピン留め / ロック / 複製 / 削除 / フォルダ移動) — desktop の HoverActionButtons 相当
- **新規作成カード**: グリッド先頭に dashed-border + "+" のカードを置く (検索中は非表示)。tap で空タイトルの mandalart を作成して即 Editor を開く。toolbar 右上の "+" ボタンは廃止 (= desktop の `NewMandalartCard` と同等)

## マンダラート不変条件

- **中心セル空のときは周辺セルを編集できない**: 中心セル (position=4) が text 空 かつ imagePath nil の状態で、周辺セル (position ≠ 4) の新規入力は alert で拒否する
- **周辺セルに入力があるときは中心セルを空にできない**: 周辺セルのいずれかに text または imagePath がある状態で、中心セル text を空 (and imagePath nil) に変更しようとすると alert で拒否する
- 上記 2 つにより「中心空 AND 周辺入力済」状態はユーザー操作経路では発生しないことが保証される
- 実装: [`EditorView.beginEditing`](../Mandalart/Views/EditorView.swift) (周辺 tap のガード) + [`EditorView.commitEditing`](../Mandalart/Views/EditorView.swift) (中心 clear のガード) で `validationAlert` 経由 SwiftUI alert を出す
- desktop 版と完全同等 (`desktop/docs/requirements.md`、[`EditorLayout.tsx:1551-1557 / 1627-1632`](../../desktop/src/components/editor/EditorLayout.tsx))
- 既知の未ガード経路: ストックからの paste (Phase 11+ で対応予定)

## 空マンダラートの自動破棄 (hard delete)

- Dashboard の「新規作成」カード tap で生成され、ユーザーが Editor で何も入力せずに戻った場合 (= 中心セル text trim 空 かつ imagePath nil、root grid 単一) は **自動 hard delete** (ローカル物理削除 + cloud cascade DELETE)。ゴミ箱には入らない
- 判定は中心セルのみ。上記の不変条件 enforcement により「中心空 AND 周辺入力済」が発生しない前提
- 実装: [`EditorView.performBackWithCleanup`](../Mandalart/Views/EditorView.swift) → [`MandalartFactory.permanentDelete`](../Mandalart/Services/MandalartFactory.swift)
- desktop も同等 ([`EditorLayout.handleNavigateHome`](../../desktop/src/components/editor/EditorLayout.tsx) → `permanentDeleteMandalart`)
- ユーザーが意図的にゴミ箱へ送る経路 (Dashboard カード長押し → 「ゴミ箱へ移動」) は引き続き soft delete + 復元可能

## ジェスチャ / インタラクション

| desktop | iOS 対応 |
|---|---|
| マウスホバー | (ホバーなし) → 長押し or 常時表示 |
| HoverActionButtons | 長押しで context menu (`.contextMenu` modifier) |
| 右クリックメニュー | (なし) → 長押し menu |
| HTML5 D&D (`draggable={true}` / `onDragStart` / `onDrop`) | SwiftUI `.draggable` / `.dropDestination` (iOS 16+) or UIKit `UIDragInteraction` / `UIDropInteraction` |
| ドラッグ中 4 アクションアイコン | iOS 版でも同等の右ペイン 4 アイコンを実装予定 (Phase 5+) |
| ホイールでスクロール | スワイプ / 慣性スクロール (`ScrollView` 標準) |
| キーボードショートカット | iOS は Bluetooth キーボード接続時のみ。`onKeyPress` で最低限対応 (将来) |

## モノクロ UI

desktop と同じく **黒 / 白 / グレーのみ** (Q3=A 方針)。色での状態区別は **SF Symbols (Apple 公式 icon set)** で表現:

- ロック中: `lock.fill` (= desktop の SVG に相当)
- ピン留め: `pin.fill`
- 完了: `checkmark.circle.fill`
- 警告: `exclamationmark.triangle.fill`
- 同期中: `arrow.triangle.2.circlepath`

カラーピッカー (セルの色設定) は desktop と同じ 10 色プリセット ([`../../desktop/src/constants/colors.ts`](../../desktop/src/constants/colors.ts)) を Swift 側でも定義する (Phase 5 で実装)。

## ダーク / ライトモード

- `@Environment(\.colorScheme)` で自動対応
- 設定画面で手動 override 可能 (Phase 10 で実装予定)
- 黒 / 白の対比はライトモードで `Color.primary` (黒) on `Color.systemBackground` (白)、ダークモードで自動反転

## メニュー

iOS には OS メニューバーがないので、desktop の Window / Help メニューは:

- Window メニュー (ウィンドウサイズ): iOS では不要 (Simulator サイズは固定 / 実機は固定)
- Help メニュー (使い方を見る / About): **設定画面 (`SettingsView`) のセクション** で代替

## Welcome モーダル (Phase 9)

- 初回起動時に `fullScreenCover` で表示
- 6 個の slide を `TabView(.page)` で carousel
- 動画は `VideoPlayer` (AVKit) で `autoPlay loop` (desktop と同じ mp4 を `Resources/help/` に配置)
- ConceptSlide (1 枚目) は SwiftUI の keyframe animation で組む (desktop の CSS animation と同等)
- 「次回以降表示しない」チェックボックス (UserDefaults `welcomeSeenVersion` で管理)

## キーボード

- iPhone / iPad とも Bluetooth キーボード接続時のみキーボード操作対応
- セル編集中は標準のソフトウェアキーボードが出る
- ショートカット (Cmd+S 保存等) は SwiftUI の `.keyboardShortcut` で実装可能だが優先度低め

## アクセシビリティ (Phase 10)

- VoiceOver: 各 Cell に `.accessibilityLabel` を付ける
- Dynamic Type: SF font 使用なら自動対応
- カラーブラインド: モノクロ UI なので問題なし
- セル内テキストのコントラスト比 ≥ 4.5:1

## 文字サイズ

セル本文は `FontConstants.scale(for: fontLevel)` を乗じた `font(.system(size:))` で描画する。

| モード | ベースサイズ | 実効サイズ |
|---|---|---|
| 3×3 | `LayoutConstants.cellBaseFontSize` (14pt) | `14 * 1.1^fontLevel` |
| 9×9 inner | `LayoutConstants.cellNineByNineFontSize` (≒4.67pt) | `(14/3) * 1.1^fontLevel` |

- `fontLevel` は整数 `-10 〜 +20`、エディタ右上 floating capsule (`A− / 現在% / A＋`) で 1 段階ずつ増減
- 最小 (-10) ≒ 39%、`0` = 100%、最大 (+20) ≒ 673%
- **永続化スコープ: per-mandalart × per-device**。キー `mandalart.fontLevel.<mandalartId>` (UserDefaults)。マンダラートを開くたびに `MandalartFontPreference.load(for:)` で復元、変更は `.onChange` で即 persist
- 旧グローバル設定 (`mandalart.fontLevel`) は per-mandalart キー未設定時の fallback として全マンダラートのデフォルトに引き継がれる
- desktop も同じ scope (per-mandalart × per-device)。同じキー prefix `mandalart.fontLevel.<id>` を使用 (storage backend は別)
- 中心セルは weight/size とも周辺と同一 (desktop [`typography.md`](../../desktop/docs/typography.md) 67-77 と同方針)。中心強調は border 太さ (`cellCenterBorder = 1.5pt`) でのみ表現
