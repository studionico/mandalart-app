---
description: iOS 版固有のコーディング規約 / 落とし穴違反を grep ベースで検出する (書込みは行わずレポートのみ)
---

# /ios-check-rules

[`ios/CLAUDE.md`](ios/CLAUDE.md) と [`ios/docs/pitfalls.md`](ios/docs/pitfalls.md) のコーディング規約・落とし穴に違反する記述を機械検出する。**漏れの検出と提案文の生成のみで、コードの書換は行わない**。修正はユーザー承認後に通常の Edit ツールで行う。

desktop 側の検査は [`/check-rules`](.claude/commands/check-rules.md) で別途行う。本コマンドは `ios/` 配下専用。

## 引数 ($ARGUMENTS)

- 空: `ios/Mandalart/` 配下全体を対象
- ファイルパス: そのファイルのみ
- glob (例: `ios/Mandalart/Views/**/*.swift`): その範囲のみ
- `--diff`: uncommitted な diff の追加行のみ対象 (false positive を最小化したいとき)

## 手順

### 1. 検出ルール

各ルールを grep で走査し、ヒットした行を **file:line:matched-text** の形式で集める。
`ios/Mandalart.xcodeproj/` (xcodegen 生成) と `ios/build/` は対象外 (`.gitignore` 配下なので通常 grep 結果に含まれない)。

#### 🔴 優先度高

##### Rule A: `UUID().uuidString` の直接使用 (`IDGenerator.uuid()` 経由禁止)

```bash
grep -rn 'UUID()\.uuidString' ios/Mandalart/ \
  --include='*.swift'
```

例外: [`ios/Mandalart/Utils/IDGenerator.swift`](ios/Mandalart/Utils/IDGenerator.swift) 内の defining 箇所のみ。

**理由**: Swift の `UUID().uuidString` は **大文字** (`09469F25-...`) を返すが、desktop は **小文字** (`09469f25-...`)。両プラットフォーム共に TEXT 型で大小区別する case-sensitive `===` 比較 (例: [`EditorLayout.tsx:1264`](desktop/src/components/editor/EditorLayout.tsx#L1264)) が誤判定する経路があり、ドリル誤動作などを引き起こす (落とし穴 #6)。

提案: `IDGenerator.uuid()` (= `UUID().uuidString.lowercased()`) 経由に統一。

##### Rule B: `position == <数値>` 裸比較

```bash
grep -rn '\.position\s*==\s*[0-9]' ios/Mandalart/ \
  --include='*.swift'
```

例外: テストコード / 範囲チェック (`position >= 0 && position < 9` 等の境界比較) は `position == 0..3` 単一比較ではないので拾わない。

提案: `GridConstants.centerPosition` (= 4) または `position == GridConstants.centerPosition` で明示。range の場合は `(0..<GridConstants.gridCellCount).contains(position)` を使う。

##### Rule C: `print()` を使った debug ログ放置の検出 (将来の logger 移行用、今は 🟡 でも可)

```bash
grep -rn 'print(' ios/Mandalart/ \
  --include='*.swift'
```

現状は print() を許容しているが、将来 `os.Logger` などの構造化 logger に移行するときの調査用。**🟢 補助** に降格しておくとよい。

#### 🟡 優先度中

##### Rule D: `count: 9` / `0..<9` / `length: 9` 裸書き (= `GRID_CELL_COUNT` 経由禁止)

```bash
grep -rn 'count:\s*9\b\|0\.\.<9\b\|count:\s*3\b\|0\.\.<3\b' ios/Mandalart/ \
  --include='*.swift' \
  | grep -v 'GridConstants.gridCellCount\|GridConstants.gridSide'
```

提案: [`ios/Mandalart/Utils/Constants.swift`](ios/Mandalart/Utils/Constants.swift) の `GridConstants.gridCellCount` (= 9) / `GridConstants.gridSide` (= 3、現状未定義なら追加) を使う。

##### Rule E: nested `.sheet` で `@Environment(AuthStore)` を引いている View (落とし穴 #2)

`.sheet` の中で `@Environment(AuthStore.self)` を `@Bindable` 抜きで参照すると、ネスト sheet で環境が伝搬しない場合がある。検出は文法的には不可なので、**目視確認** に留める:

```bash
grep -rn '\.sheet(' ios/Mandalart/Views/ \
  --include='*.swift' -A3
```

各 sheet content で `@Environment(AuthStore.self)` を使う場合、親側で `.sheet { ... .environment(auth) }` のように明示 inject されているかを目視。

##### Rule F: `Cell.text` / `Grid.sortOrder` / `Folder.isSystem` 以外のフィールド名で `Cloud*` DTO を作っているか (落とし穴 #4)

DTO は **必ず snake_case** で desktop schema に揃える必要がある:

```bash
grep -rn 'struct Cloud[A-Z]' ios/Mandalart/Services/SyncEngine.swift
```

各 `Cloud*` 構造体内のフィールドが snake_case (例: `root_cell_id`) になっているか目視確認。camelCase (`rootCellId`) は誤り。

#### 🟢 補助的チェック

##### Rule G: `try!` の使用 (= 強制 unwrap、クラッシュリスク)

```bash
grep -rn 'try!' ios/Mandalart/ \
  --include='*.swift'
```

Swift の `try!` は失敗時にクラッシュする。`try?` で nil 化 or `do { try ... } catch { ... }` に書き換えを検討。テスト / Preview / `fatalError` 確定のセマンティクスでのみ許容。

##### Rule H: `ModelContext` を引数で渡さず `@Environment(\.modelContext)` を直接 Service / Repository から呼んでいないか

Service / Repository (= ロジック層) は **テスタビリティ確保のため `ModelContext` を引数で受け取る** べき。Views は `@Environment(\.modelContext)` で取得して service に渡す:

```bash
grep -rn '@Environment(\\.modelContext)' ios/Mandalart/Services/ ios/Mandalart/Repositories/ 2>/dev/null
```

ヒットがあれば 🟡 に昇格して目視確認 (= ある程度は許容しても良い、現状の SwiftData 慣習)。

### 2. 各ヒットを精査

grep 出力をそのまま信用せず、各 hit について:

1. ファイルを Read して周囲のコンテキストを確認
2. 例外 (defining 箇所 / テストコード / 1 ファイル 1 回限り等) に該当しないか確認
3. 提案する代替コードのドラフトを書く

### 3. レポートの構造

```markdown
## iOS ハードコーディング / 規約違反チェック結果

対象: <range> (<N> ファイル走査)

### 🔴 優先度高 (バグ / 事故直結)
- [`ios/Mandalart/<file>.swift:42`](ios/Mandalart/<file>.swift#L42) — Rule A: `UUID().uuidString` (大文字) の直接使用
  ```swift
  // 修正案
  let id = IDGenerator.uuid()  // = UUID().uuidString.lowercased()
  ```

### 🟡 優先度中
- ...

### 🟢 補助 (例外の可能性あり、目視確認推奨)
- ...

### 漏れなし ✅
- UUID 直接使用: 検出なし
- ...

### 集計
🔴 N 件 / 🟡 M 件 / 🟢 K 件
```

### 4. 制約

- **書込みは行わない**。Edit / Write は使わずレポートを返すだけ
- false positive は人間判断で除外する想定 (完璧な静的解析は目指さない)
- `ios/Mandalart/` 配下のみ対象。`ios/Mandalart.xcodeproj/` / `ios/build/` / `ios/.swiftpm/` は対象外
- `IDGenerator.swift` 自身の `UUID().uuidString.lowercased()` は **defining 箇所として除外**
- 実装側で関数定義 (例: `GridConstants` 自体の定義) は当然対象外

## 注意点

1. Rule C (`print()`) は debug 用途で広く使われている。現状は **🟢 補助** に留め、`os.Logger` 移行が決まったら 🟡 に昇格
2. Rule E (nested `.sheet` 環境伝搬) は文法では検出不可なので、`.sheet` 全件を grep で出して目視確認のリストにする
3. Rule F (Cloud* DTO snake_case) は SyncEngine.swift 内の構造体定義が中心、現状 4 つ (`CloudFolder` / `CloudMandalart` / `CloudGrid` / `CloudCell`)
4. レポートは 60 秒以内で出力できる粒度に保つ
5. 関連: desktop 側の検査は [`/check-rules`](.claude/commands/check-rules.md)、両プラットフォーム共通の docs 同期検査は [`/sync-docs`](.claude/commands/sync-docs.md)
