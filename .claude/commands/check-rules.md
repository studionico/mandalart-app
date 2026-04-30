---
description: ハードコーディング / Tauri 落とし穴 / 規約違反を grep ベースで検出する (書込みは行わずレポートのみ)
---

# /check-rules

[`CLAUDE.md`](CLAUDE.md) の「コーディング規約」と「知っておくべき落とし穴」に違反する記述を機械検出する。**漏れの検出と提案文の生成のみで、コードの書換は行わない**。修正はユーザー承認後に通常の Edit ツールで行う。

## 引数 ($ARGUMENTS)

- 空: `desktop/src/` 配下全体を対象
- ファイルパス: そのファイルのみ
- glob (例: `desktop/src/components/**/*.tsx`): その範囲のみ
- `--diff`: uncommitted な diff の追加行のみ対象 (false positive を最小化したいとき)

## 手順

### 1. 検出ルール

各ルールを grep で走査し、ヒットした行を **file:line:matched-text** の形式で集める。
`_old_web/` 配下は対象外。`node_modules` / `dist` / `target` も除外。

#### 🔴 優先度高

##### Rule A: `localStorage` の直接使用 (`STORAGE_KEYS` 経由禁止)

```bash
grep -rn 'localStorage\.\(getItem\|setItem\|removeItem\)' desktop/src/ \
  --include='*.ts' --include='*.tsx'
```

例外: [`desktop/src/constants/storage.ts`](desktop/src/constants/storage.ts) 内の defining 箇所、および
`STORAGE_KEYS.X` を引数に取る `getItem(STORAGE_KEYS.X)` パターン。

提案: `import { STORAGE_KEYS } from '@/constants/storage'` → `localStorage.getItem(STORAGE_KEYS.<name>)`

##### Rule B: Tauri 落とし穴 — `window.confirm` (落とし穴 #7)

```bash
grep -rn 'window\.confirm\|^[^/]*confirm(' desktop/src/ \
  --include='*.ts' --include='*.tsx'
```

Tauri v2 WebView では `window.confirm` が動作しない。state ベースの 2 クリック確認 UI で代替。
[`desktop/src/components/dashboard/TrashDialog.tsx`](desktop/src/components/dashboard/TrashDialog.tsx) を参照。

##### Rule C: Tauri 落とし穴 — `<a download>.click()` (落とし穴 #11)

```bash
grep -rn 'download[\"'"'"']\s*=\|\.click()' desktop/src/ \
  --include='*.ts' --include='*.tsx'
```

WebKit がサイレントに握り潰す。`@tauri-apps/plugin-fs` の `writeFile` + `BaseDirectory.Download` で代替。
[`desktop/src/lib/utils/export.ts`](desktop/src/lib/utils/export.ts) 参照。

##### Rule D: Tauri 落とし穴 — HTML5 D&D (落とし穴 #1)

```bash
# 「<lowercase-html-element ...onDrag*= 」のパターンに絞り込んで native HTML5 イベント属性のみ拾う。
# 大文字始まりの React component (例: <Cell onDragStart={...}>) は custom prop なので false positive。
grep -rEn '<[a-z][a-zA-Z0-9]*\s[^>]*\b(draggable|onDragStart|onDragOver|onDragEnd|onDrop)=' \
  desktop/src/ --include='*.tsx'
```

Tauri WebKit は HTML5 D&D が動かない。[`desktop/src/hooks/useDragAndDrop.ts`](desktop/src/hooks/useDragAndDrop.ts) の
mousedown ベース実装を使う。

**注**: 上記 grep は単一行内で `<element ... attr=` が完結している場合のみマッチ。改行を跨ぐ JSX 属性は拾えないので、🟡 補助チェックとして次のパターンも併走させる:

```bash
# component prop 経由の uses も全て列挙 (false positive 多めだが見逃し防止)
grep -rn 'onDragStart=\|onDragOver=\|onDragEnd=\|onDrop=\|draggable=' desktop/src/ --include='*.tsx'
```

このセカンダリ結果は **大文字始まりタグ** や **prop 定義 (例: `onDragStart?: () => void`)** であれば false positive、**小文字 HTML element** で `<div onDragStart=...>` の形なら本物の違反。

##### Rule E: `position === <数値>` の裸比較 (CLAUDE.md コーディング規約)

```bash
grep -rn '\.position\s*===\s*[0-9]' desktop/src/ \
  --include='*.ts' --include='*.tsx'
```

`CENTER_POSITION` (= 4) / `isCenterPosition()` を [`desktop/src/constants/grid.ts`](desktop/src/constants/grid.ts) から
import するべき。

#### 🟡 優先度中

##### Rule F: `setTimeout` の long magic number

```bash
grep -rn 'setTimeout([^,]*,\s*[0-9]\{3,\})' desktop/src/ \
  --include='*.ts' --include='*.tsx'
```

100ms 以上の数値直書きは [`desktop/src/constants/timing.ts`](desktop/src/constants/timing.ts) に対応定数があるべき。
タブの auto-reset (`CONFIRM_AUTO_RESET_MS` = 4000) のように再利用される値ならば定数化を提案。

##### Rule G: CSS keyframes の `transform: var(...)` (落とし穴 #8)

```bash
grep -rn 'transform:\s*var(' desktop/src/index.css desktop/src/**/*.css 2>/dev/null
```

WebKit が補間しないので 8 方向固定 keyframes で対応するべき。

##### Rule H: `_old_web/` への import (旧 Next.js 試作の参照)

```bash
grep -rn "from\s*['\"][^'\"]*_old_web" desktop/src/ \
  --include='*.ts' --include='*.tsx'
```

[`_old_web/`](_old_web/) はメンテ停止しているのでアクティブなコードからは参照しない。

#### 🟢 補助的チェック

##### Rule I: 9 セル / 3×3 のループに裸の `9` / `3`

```bash
grep -rn 'length:\s*9\|length:\s*3\|< 9\|< 3' desktop/src/ \
  --include='*.ts' --include='*.tsx' \
  | grep -v 'length: GRID_CELL_COUNT\|length: GRID_SIDE'
```

[`desktop/src/constants/grid.ts`](desktop/src/constants/grid.ts) の `GRID_CELL_COUNT` (9) /
`GRID_SIDE` (3) を使うべき。1 ファイル 1 回限りで他と連動しない値は例外なので false positive 多め。

### 2. 各ヒットを精査

grep 出力をそのまま信用せず、各 hit について:

1. ファイルを Read して周囲のコンテキストを確認
2. CLAUDE.md の「例外」(1 ファイル 1 回 / Tailwind プリセット / WebKit 非互換 keyframes) に該当しないか確認
3. 提案する代替コードのドラフトを書く

### 3. レポートの構造

```markdown
## ハードコーディング / 規約違反チェック結果

対象: <range> (<N> ファイル走査)

### 🔴 優先度高 (バグ / 事故直結)
- [`desktop/src/<file>.ts:42`](desktop/src/<file>.ts#L42) — Rule A: `localStorage.getItem('font_level')` (素文字列)
  ```ts
  // 修正案
  import { STORAGE_KEYS } from '@/constants/storage'
  localStorage.getItem(STORAGE_KEYS.fontLevel)
  ```

### 🟡 優先度中
- ...

### 🟢 補助 (例外の可能性あり、目視確認推奨)
- ...

### 漏れなし ✅
- localStorage 直接使用: 検出なし
- ...

### 集計
🔴 N 件 / 🟡 M 件 / 🟢 K 件
```

### 4. 制約

- **書込みは行わない**。Edit / Write は使わずレポートを返すだけ
- false positive は人間判断で除外する想定 (完璧な静的解析は目指さない)
- `desktop/src/` のみ対象。`_old_web/` / `node_modules/` / `dist/` / `target/` は除外
- CLAUDE.md の「例外」(1 ファイル 1 回限り / Tailwind プリセット / WebKit 非互換 keyframes) に該当する場合は 🟢 に降格して「例外の可能性あり」と注記
- 実装側で関数定義 (例: `STORAGE_KEYS` 自体の定義) は当然対象外

## 注意点

1. Rule B (`confirm(`) は user-defined 関数の `confirm()` も拾うので、目視確認が必須 (false positive 多め)
2. Rule F (setTimeout magic number) は 100ms 以上を閾値にしたが、orbit / view-switch のリテラル待ち合わせなど許容ケースもあり 🟡 に留める
3. Rule I は `Array.from({ length: 9 })` のような直書きを拾うが、grid 以外の用途で 9 を使うコードもあるので false positive 前提
4. レポートは 60 秒以内で出力できる粒度に保つ。1 ルールで大量 hit したら最初の 5 件 + 「他 N 件」で省略可
5. 関連する未来タスク: tasks.md 29.1 (カスタム ESLint rule) の前段として本コマンドが機能。ESLint plugin 化までの繋ぎ
