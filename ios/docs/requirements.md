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
- 右ペイン: 上に breadcrumb (現在のドリル位置)、下に メモ / ストック の `TabView`
- 9×9 表示時も同じ正方形クランプで、3×3 を 9 個ネスト
- **9×9 view は iPad regular のみ実用**: iPhone Landscape (= horizontalSizeClass .compact) では grid サイズが ~380pt / セル ~14pt まで縮小するため非表示にする ([`pitfalls.md`](pitfalls.md) #11)。toggle ボタンも非表示、`viewMode` は `.grid3x3` 固定
- **breadcrumb 折りたたみ**: 4 階層以上で `[root] > [...] menu > [N-1] > [N]` 表示にして overflow 回避 ([`Breadcrumb.swift`](../Mandalart/Views/Components/Breadcrumb.swift))

### Dashboard (Phase 4)

- 左 sidebar: フォルダタブ (Landscape の余白を活かす、iPhone 横向きでも展開できる)
- 右メイン: カードグリッド (`LazyVGrid(columns: .adaptive(minimum: 140))`) + `searchable`
- カードの長押しで context menu (ピン留め / ロック / 複製 / 削除 / フォルダ移動) — desktop の HoverActionButtons 相当

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
