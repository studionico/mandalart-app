---
description: web/ ブラウザ版固有のコーディング規約 / リグレッションを grep ベースで検出する (書込みは行わずレポートのみ)
---

# /web-check-rules

`web/src/` のコーディング規約・Tauri 依存リグレッション・Supabase 書き込み規約違反を機械検出する。**漏れの検出と提案文の生成のみで、コードの書換は行わない**。修正はユーザー承認後に通常の Edit ツールで行う。

desktop 側の検査は [`/check-rules`](.claude/commands/check-rules.md) で別途行う。本コマンドは `web/src/` 配下専用。

## 引数 ($ARGUMENTS)

- 空: `web/src/` 配下全体を対象
- ファイルパス: そのファイルのみ
- glob (例: `web/src/lib/api/**/*.ts`): その範囲のみ
- `--diff`: uncommitted な diff の追加行のみ対象 (false positive を最小化したいとき)

## 手順

### 1. 検出ルール

各ルールを grep で走査し、ヒットした行を **file:line:matched-text** の形式で集める。
`web/node_modules/` / `web/dist/` は対象外。

#### 🔴 優先度高

##### Rule W1: `@tauri-apps/*` import のリグレッション

```bash
grep -rn "from '@tauri-apps" web/src/ \
  --include='*.ts' --include='*.tsx'
```

web 版では `@tauri-apps/*` は全廃済み。再混入するとビルドエラーまたはランタイムクラッシュになる。
**ヒットは全件エラー (例外なし)**。

提案: 該当 import を削除し、ブラウザ native API または Supabase SDK での代替実装を確認する。
([`web/src/hooks/useVisibilityResync.ts`](web/src/hooks/useVisibilityResync.ts)、[`web/src/lib/utils/export.ts`](web/src/lib/utils/export.ts) 等を参照)

##### Rule A: `localStorage` の直接使用 (`STORAGE_KEYS` 経由禁止)

```bash
grep -rn 'localStorage\.\(getItem\|setItem\|removeItem\)' web/src/ \
  --include='*.ts' --include='*.tsx'
```

例外: [`web/src/constants/storage.ts`](web/src/constants/storage.ts) 内の defining 箇所、および
`STORAGE_KEYS.<name>` を引数に取る `getItem(STORAGE_KEYS.<name>)` パターン。

提案: `import { STORAGE_KEYS } from '@/constants/storage'` → `localStorage.getItem(STORAGE_KEYS.<name>)`

##### Rule W2: 削除済みモジュールの残存参照

```bash
grep -rn "from '@/lib/db'\|from '@/lib/sync/lock'" web/src/ \
  --include='*.ts' --include='*.tsx'
```

`lib/db/` (SQLite) と `lib/sync/lock` は web 版では削除済み。残存すると typecheck エラーになる。
**ヒットは全件エラー (例外なし)**。

#### 🟡 優先度中

##### Rule W3: Supabase write に `synced_at` の欠落

```bash
grep -rn '\.insert(\|\.update(\|\.upsert(' web/src/lib/api/ \
  --include='*.ts' -l
```

ヒットした各ファイルを Read して、`.insert({` / `.update({` / `.upsert({` の payload に
`synced_at: now()` または `synced_at: ts` がセットされているか目視確認する。

**理由**: web 版は全書き込みが Supabase に直接反映されるため `synced_at` を書き込まないと、
desktop が pull 時に「未同期」と判断して再 push するレースが起きる。
`web/src/lib/utils/id.ts` の `now()` や、各関数内の `const ts = now()` 経由でセットしている箇所は OK。

例外: `deleted_at` のみを更新する soft-delete クエリ (論理削除は `deleted_at` + `updated_at` の更新のみ)。

##### Rule E: `position === <数値>` 裸比較

```bash
grep -rn '\.position\s*===\s*[0-9]' web/src/ \
  --include='*.ts' --include='*.tsx'
```

例外: `position >= 0 && position < 9` のような範囲チェック (単一の等値比較ではない場合)。

提案: [`web/src/constants/grid.ts`](web/src/constants/grid.ts) の `CENTER_POSITION` (= 4) または
`isCenterPosition(position)` で明示する。

##### Rule F: `setTimeout` の long magic number

```bash
grep -rn 'setTimeout([^,]*,\s*[0-9]\{3,\})' web/src/ \
  --include='*.ts' --include='*.tsx'
```

100ms 以上の数値直書きは [`web/src/constants/timing.ts`](web/src/constants/timing.ts) に対応定数があるべき。
再利用される値や、アニメーションと連動するタイミング値は定数化を提案する。

##### Rule G: CSS keyframes の `transform: var(...)` (WebKit 非互換)

```bash
grep -rn 'transform:\s*var(' web/src/index.css
```

Safari / iOS Safari が keyframes 内の CSS 変数を補間しない。8 方向固定 keyframes で対応するべき
(desktop 版 [`desktop/src/index.css`](desktop/src/index.css) の実装を参照)。

#### 🟢 補助的チェック

##### Rule I: 9 セル / 3×3 のループに裸の `9` / `3`

```bash
grep -rn 'length:\s*9\|length:\s*3\|< 9\|< 3' web/src/ \
  --include='*.ts' --include='*.tsx' \
  | grep -v 'GRID_CELL_COUNT\|GRID_SIDE'
```

[`web/src/constants/grid.ts`](web/src/constants/grid.ts) の `GRID_CELL_COUNT` (9) / `GRID_SIDE` (3) を使うべき。
1 ファイル 1 回限りで他と連動しない値は例外。false positive 多め。

##### Rule H: `_old_web/` への import (旧 Next.js 試作の参照)

```bash
grep -rn "from\s*['\"][^'\"]*_old_web" web/src/ \
  --include='*.ts' --include='*.tsx'
```

[`_old_web/`](_old_web/) はメンテ停止しているのでアクティブなコードからは参照しない。

### 2. 各ヒットを精査

grep 出力をそのまま信用せず、各 hit について:

1. ファイルを Read して周囲のコンテキストを確認
2. 例外 (defining 箇所 / `STORAGE_KEYS` 経由の localStorage / 削除クエリの `synced_at` 省略) に該当しないか確認
3. 提案する代替コードのドラフトを書く

### 3. レポートの構造

```markdown
## web ハードコーディング / 規約違反チェック結果

対象: <range> (<N> ファイル走査)

### 🔴 優先度高 (バグ / 事故直結)
- [`web/src/<file>.ts:42`](web/src/<file>.ts#L42) — Rule W1: `@tauri-apps/api/window` の import
  ```ts
  // 削除して visibilitychange / window.focus に置き換え
  ```

### 🟡 優先度中
- ...

### 🟢 補助 (例外の可能性あり、目視確認推奨)
- ...

### 漏れなし ✅
- @tauri-apps import: 検出なし
- localStorage 直接使用: 検出なし
- ...

### 集計
🔴 N 件 / 🟡 M 件 / 🟢 K 件
```

### 4. 制約

- **書込みは行わない**。Edit / Write は使わずレポートを返すだけ
- false positive は人間判断で除外する想定 (完璧な静的解析は目指さない)
- `web/src/` のみ対象。`web/node_modules/` / `web/dist/` は除外
- Rule W3 (`synced_at`) は grep でファイルを特定してから Read で目視確認する (grep だけでは payload 内容まで判定できない)

## desktop 版で除外しているルール (web では適用しない)

| desktop Rule | web では除外する理由 |
|---|---|
| Rule B: `window.confirm` | web ブラウザでは正常動作 |
| Rule C: `<a download>.click()` | web では **正しいアプローチ** (`export.ts` で採用) |
| Rule D: Tauri `dragDropEnabled` 設定 | Tauri 専用設定。ブラウザ不要 |

## 注意点

1. Rule W3 (`synced_at` 欠落) は grep でファイル一覧を出してから各ファイルを Read して確認する。soft-delete (deleted_at のみ更新) は `synced_at` 省略可
2. Rule F (`setTimeout`) は orbit / view-switch の既存リテラルが許容ケースとして残っている可能性あり → 🟡 のまま目視確認
3. Rule I は `Array.from({ length: 9 })` 等 grid 以外で 9 を使うコードも拾うので false positive 前提
4. レポートは 60 秒以内で出力できる粒度に保つ。1 ルールで大量 hit したら最初の 5 件 + 「他 N 件」で省略可
5. 関連コマンド: desktop 側は [`/check-rules`](.claude/commands/check-rules.md) / iOS 側は [`/ios-check-rules`](.claude/commands/ios-check-rules.md) / docs 同期は [`/sync-docs`](.claude/commands/sync-docs.md)
