# タイポグラフィ — マンダラート デスクトップアプリ

## 概要

**このアプリは独自フォントを一切バンドル / 読み込みしていない。** OS のシステムフォントをそのまま使う方針。Tauri の WebView (macOS では WKWebView) が OS のシステムフォントを拾うので、結果として OS ネイティブアプリと同じ見た目になる。

---

## 実際に効いているフォントスタック

[`desktop/src/index.css`](../src/index.css) は以下のみで、`font-family` の指定は無い:

```css
@import "tailwindcss";

@custom-variant dark (&:where(.dark, .dark *));

/* デフォルトフォントウェイトを 300 (Light) に */
html {
  font-weight: 300;
}
```

[`desktop/index.html`](../index.html) にも Google Fonts や `@font-face` の読み込みは無い。

したがって効いているのは **Tailwind v4 のデフォルトフォントスタック**:

```
font-sans:  ui-sans-serif, system-ui, sans-serif,
            "Apple Color Emoji", "Segoe UI Emoji", "Segoe UI Symbol", "Noto Color Emoji"
font-mono:  ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas,
            "Liberation Mono", "Courier New", monospace
```

### OS ごとの解決結果

| OS | 欧文 / 数字 | 日本語 | `font-mono` |
|---|---|---|---|
| **macOS** | SF Pro (San Francisco) | ヒラギノ角ゴシック (Hiragino Sans) | SF Mono / Menlo |
| **Windows** | Segoe UI Variable | Yu Gothic UI | Cascadia Mono / Consolas |
| **Linux** | 配布による (DejaVu Sans 等) | 配布による (Noto Sans CJK JP 等) | DejaVu Sans Mono 等 |

macOS で動作確認している場合、セル本文の日本語は **ヒラギノ角ゴ**、英数字は **SF Pro** で描画されている。

---

## デッドコード: `App.css`

[`desktop/src/App.css`](../src/App.css) には以下の宣言が残っている:

```css
:root {
  font-family: Inter, Avenir, Helvetica, Arial, sans-serif;
  font-size: 16px;
  line-height: 24px;
  font-weight: 400;
  ...
}
```

しかし `App.css` は [`main.tsx`](../src/main.tsx) からも [`App.tsx`](../src/App.tsx) からも import されていないので、**この宣言はどこにも効いていない**。Tauri の scaffold が生成したテンプレートの残滓で、将来的には削除してよい。

---

## 使用しているウェイト

デフォルトウェイトは `index.css` の `html { font-weight: 300 }` で **300 Light** に固定している (Tailwind デフォルトの 400 Regular より細い、全体的に繊細で静かな印象にする狙い)。明示的な Tailwind ウェイトクラスを指定した要素だけが太字化される。

| クラス | ウェイト | 使用箇所 |
|---|---|---|
| (デフォルト) | **300 Light** | セル本文 (中心セル含む)、メモ、大半の UI テキスト |
| `font-medium` | **500** | [`Button.tsx`](../src/components/ui/Button.tsx) primary バリアント、[`Toast.tsx`](../src/components/ui/Toast.tsx) のアクション、ダッシュボードカードのラベル類 |
| `font-semibold` | **600** | [`Modal.tsx`](../src/components/ui/Modal.tsx) / [`BottomSheet.tsx`](../src/components/ui/BottomSheet.tsx) のタイトル、Markdown プレビューの `##` |
| `font-bold` | **700** | [`DashboardPage.tsx`](../src/pages/DashboardPage.tsx) の `h1`、Markdown プレビューの `#` |

> **中心セルは強調しない方針**。以前は `font-semibold` で太字化していたが、周辺セルと並べたときに中心だけ悪目立ちするため撤去した。中心セルの強調は太さではなく **`border-[6px] border-black` の外枠** が担う。

`font-mono` は [`MemoTab.tsx`](../src/components/editor/MemoTab.tsx) の Markdown 編集 textarea と [`ImportDialog.tsx`](../src/components/editor/ImportDialog.tsx) のテキスト入力 textarea で使われている (編集中のみ等幅、プレビューは比例フォントに戻る)。

---

## 文字サイズ

### セル本文 (動的)

[`Cell.tsx`](../src/components/editor/Cell.tsx) のセル本文は `editorStore.fontScale` を乗じた inline style で描画する:

| 表示モード | ベースサイズ | 実効サイズ |
|---|---|---|
| 3×3 表示 | `28px` | `28 * 1.1^fontLevel` |
| 9×9 表示 (small) | `28 / 3 ≒ 9.33px` | `(28/3) * 1.1^fontLevel` |

> 9×9 表示ではセルが 3×3 表示の約 1/3 の幅しかないため、同じ文字数が同じ行数で読めるよう **フォントサイズも 1/3** に縮小している。`fontLevel` の拡縮は両モード共通で効くので、ユーザーの拡大縮小体験は揃う。

- `fontLevel` は整数 `-10 〜 +20` の範囲で、エディタヘッダの `A− / 現在の % / A＋` ボタンで 1 ステップずつ増減
- 最小 (`-10`) ≒ 39%、 `0` = 100%、最大 (`+20`) ≒ 673%
- `localStorage` キー `mandalart.fontLevel` に永続化 ([`editorStore.ts`](../src/store/editorStore.ts))

### 固定サイズ (主要なもの)

| 箇所 | サイズ | クラス / 値 |
|---|---|---|
| ダッシュボードカードのセルテキスト | 14px | `text-[14px]` + `line-clamp-6` |
| ヘッダのマンダラートタイトル (h1) | 18px | `text-lg font-bold` |
| モーダル / ボトムシートのタイトル | 18px | `text-lg font-semibold` |
| 汎用 UI ラベル | 14px | `text-sm` |
| 説明文・補助テキスト | 12px | `text-xs` |
| 小さいバッジ類 | 9〜11px | `text-[9px]` 〜 `text-[11px]` |

---

## フォントを変更したい場合

### システムフォントを別のものに差し替えたい

Tailwind v4 式のテーマオーバーライドが最もクリーン。[`desktop/src/index.css`](../src/index.css) を次のように編集する:

```css
@import "tailwindcss";

@theme {
  --font-sans: "Inter", ui-sans-serif, system-ui, sans-serif;
  --font-mono: "JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace;
}

@custom-variant dark (&:where(.dark, .dark *));
```

### Web フォントをバンドルしたい

1. [`desktop/index.html`](../index.html) の `<head>` に `<link>` を追加するか、ローカル `.woff2` を `src/assets/` に置いて `@font-face` で読み込む
2. 上記の `@theme { --font-sans: ... }` でスタック先頭に追加する

Tauri の WebView は file URL 経由で配信されるので、相対パスまたは `@import` 経由の local ファイルがそのまま使える。Google Fonts のようなリモート CDN はオフライン時に失敗するので、本気でやるならローカルに .woff2 を同梱する方が安全。

### `App.css` の残骸を消したい

現状どこからも import されていないので削除してよい。削除しても見た目は変わらない。

---

## 参考: なぜ独自フォントを読み込まないのか

1. **macOS ネイティブ感**: システムフォント (SF Pro + ヒラギノ) は macOS 全体と見た目が揃うので、追加で Inter 等を読み込むと逆に浮いてしまう
2. **起動速度**: Web フォントの読み込み・FOUT (Flash of Unstyled Text) を避けられる
3. **バンドルサイズ**: CJK フォントは数 MB〜十数 MB あるため、.dmg / .msi に同梱すると配布サイズが跳ねる
4. **ダークモード / HiDPI 対応**: システムフォントは OS 側で最適化されており、Retina での描画品質も OS に任せられる

将来ブランドフォントを採用したい場合だけ上記の手順で差し替える、という方針。
