# エクスポート / インポート検証用フィクスチャ

[`test-fixture.json`](./test-fixture.json) は各エクスポート形式の動作を手動で検証するための
包括的なマンダラートデータです。1 つの JSON に 7 つのシナリオを詰め込んでいるので、
インポート → 各形式でエクスポート → 再インポート、という往復テストが一気通貫で実施できます。

## 含まれるシナリオ

| # | シナリオ | 構造上の位置 | 検証対象 |
|---|---|---|---|
| 1 | ルート中心 + 8 周辺すべて入力 | 最上位 cells | 基本的な 9 cell 保持 |
| 2 | ルートグリッドの memo (複数行 + Markdown 記号) | `grid.memo` | memo が JSON で完全保持 / MD で `> blockquote` 出力 |
| 3 | ルート並列グリッド (memo + 独自 peripherals) | `children[0]` (parentPosition 省略) | 中心共有と並列の memo |
| 4 | 周辺 P0 → drilled サブグリッド (memo + 8 cells) | `children[1]` (parentPosition=0) | drilled subtree、memo 階層保持 |
| 5 | P0 サブグリッドの並列 | `children[1].children[1]` (parentPosition 省略) | 深い階層での並列 |
| 6 | P0 サブグリッド → 3 階層目 drill | `children[1].children[0]` (parentPosition=0) | 3 階層以上の drill |
| 7 | P1 の最小限サブグリッド (中心 + 2 cell) | `children[2]` (parentPosition=1) | overflow 少ない時の round-trip 制約確認 |

さらに:
- P0 のセルに `color: "red"` を設定 → JSON でのみ色が残り、MD / Indent では落ちる

## 使い方

### 準備

```
npm run tauri dev
```

ダッシュボードの「インポート」ボタンから `desktop/samples/test-fixture.json` を選択。
「メイン目標」という名前のマンダラートが作成されます。

### ラウンドトリップテスト

| ステップ | 操作 | 見るべきポイント |
|---|---|---|
| A | 作成された mandalart を開いて 3×3 / 9×9 で閲覧 | 7 シナリオすべてが期待通り配置されているか |
| B | エクスポートメニュー → **JSON** | `~/Downloads/mandalart-<タイムスタンプ>.json` が保存される。開くと元とほぼ同じ構造 |
| C | エクスポートメニュー → **Markdown** | `.md` ファイルに見出し階層 + `> blockquote` memo。色 / 並列単位の境界は落ちる |
| D | エクスポートメニュー → **インデントテキスト** | `.txt` ファイルに 2 スペースインデント。memo / 色 / 並列情報は含まれない |
| E | エクスポートメニュー → **PNG** | `.png` 画像 (現在 3×3 表示のスクリーンショット) |
| F | エクスポートメニュー → **PDF** | `.pdf` に画像として埋め込み |
| G | ダッシュボード → 再インポート (B の JSON) | 完全復元: memo / 色 / 並列 / 3 階層すべて |
| H | ダッシュボード → 再インポート (C の MD) | 見出し階層は復元、memo / 色 / 並列単位は落ちる |
| I | ダッシュボード → 再インポート (D の .txt) | 階層は復元、memo / 色 / 並列単位は落ちる |

## 形式ごとの保持対象まとめ

| 要素 | JSON | Markdown | Indent | PNG / PDF |
|---|:---:|:---:|:---:|:---:|
| 階層構造 | ✅ | ✅ | ✅ | ✅ (視覚のみ) |
| セル text | ✅ | ✅ | ✅ | ✅ (視覚のみ) |
| memo | ✅ | 🔶 出力はされるが再 import で落ちる | ❌ | ❌ |
| color | ✅ | ❌ | ❌ | ✅ (視覚のみ) |
| 並列グリッド (8 peripherals 超) | ✅ | ✅ 再 import で overflow 経由で再現 | ✅ 同上 | N/A |
| 並列グリッド (peripherals 合計 8 以下) | ✅ | ❌ 1 grid にマージされる | ❌ 同上 | N/A |
| 画像 (image_path) | ✅ 相対パスで保持 | ❌ | ❌ | ✅ 視覚のみ |

## 既知の round-trip 制約

- **MD / Indent では memo は落ちる** — parseMarkdown は見出し行以外を無視、parseIndentText は行 1 = ノード 1 前提
- **peripherals 合計 ≤ 8 のときに並列がマージされる** — MD / Indent のフォーマットが「並列グリッド」の概念を持たず、overflow (9 個目以降) だけを並列として再構築するため
- **色 / 画像パスはテキスト形式では失われる** — 完全保持には JSON を使う

完全なバックアップ / 他デバイスへの移行には **JSON** を使うのが確実。
MD / Indent は共有やレビュー用の text 出力として割り切る。
