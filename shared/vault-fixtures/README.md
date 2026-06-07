# shared/vault-fixtures

desktop (TypeScript / vitest) と iOS (Swift / XCTest) の **両方が同じ JSON を読んで**
vault ピュア層の挙動を検証する golden fixture。TS↔Swift の仕様乖離 (例: wiki-link の改行処理) を
自動検出し、テストケースの二重記述を減らすのが目的。

- desktop ローダ: [`desktop/src/lib/vault/__tests__/goldenFixtures.test.ts`](../../desktop/src/lib/vault/__tests__/goldenFixtures.test.ts)
- iOS ローダ: [`ios/MandalartTests/GoldenFixtureTests.swift`](../../ios/MandalartTests/GoldenFixtureTests.swift)

各ファイルは 1 ケース 1 JSON。`kind` で 3 種類:

## `kind: "bodyParse"` — `parseGridBody(body)` の検証
```jsonc
{
  "kind": "bodyParse",
  "name": "短い説明",
  "body": "## [x] 運動 #c/red-100 ^p2",   // 本文 (改行は \n)
  "expect": {
    "clean": true,                          // 任意: BodyParse.clean
    "memo": { "set": true, "value": "..." },// 任意: memo (set=false なら value 省略)
    "cells": {                              // 任意: position → 各フィールドの三値期待
      "2": {
        "text":  { "set": true, "value": "運動" },
        "done":  { "set": true, "value": true },
        "color": { "set": true, "value": "red-100" }
      }
    }
  }
}
```
text/color の value は文字列、done/hasImage の value は真偽。指定したフィールドだけを検証する
(未指定フィールドは無視)。

## `kind: "gridRender"` — `buildGridDocument(grid, cells, links)` の検証
```jsonc
{
  "kind": "gridRender",
  "name": "短い説明",
  "grid": { "id": "g1", "centerCellId": "c4", "parentCellId": null, "sortOrder": 0, "memo": null },
  "cells": [
    { "id": "c4", "position": 4, "text": "中心" },
    { "id": "c2", "position": 2, "text": "発揮\n窮地に", "color": null, "done": false, "imagePath": null }
  ],
  "links": {                                // 任意
    "childByCell": { "c2": "g-child" },      // セル id → 子グリッド id
    "parent": { "gridId": "g-root", "label": "健康\n2026" }
  },
  "contains":    ["[[g-child|発揮 窮地に]]"],// 出力本文に含まれるべき部分文字列
  "notContains": ["..."]                     // 任意: 含まれてはいけない部分文字列
}
```
タイムスタンプは検証に無関係なので各言語アダプタが固定値で埋める (fixture には書かない)。

## `kind: "cellGuard"` — セル空判定 / 中心セル保護の検証

「セルが空か」「周辺セルに内容があるか」「周辺へ paste 可能か」の判定が **両OSで同一契約**であることをロックする。
desktop は [`desktop/src/lib/utils/grid.ts`](../../desktop/src/lib/utils/grid.ts) の `isCellEmpty` / `hasPeripheralContent` /
`canPasteIntoPeripheral`、iOS は [`ios/Mandalart/Vault/VaultCellGuard.swift`](../../ios/Mandalart/Vault/VaultCellGuard.swift) の
`CellGuard` を検証する。

**正準定義 (= desktop)**: セルが空 = `text` を trim して空 **かつ** `imagePath` が無い。
**`color` / `done` は空判定に含めない**。中心セルは `position === 4` (`CENTER_POSITION`)。

```jsonc
{
  "kind": "cellGuard",
  "name": "短い説明",
  "cells": [                                 // gridRender と同じ cells スキーマを再利用
    { "id": "c4", "position": 4, "text": "中心" },
    { "id": "c0", "position": 0, "color": "red-100" }  // 色のみ → 空扱い
  ],
  "guard": { "pasteTarget": 0 },             // 任意: canPasteIntoPeripheral を検証する対象 position
  "expectGuard": {
    "emptyByPosition":      { "0": true, "4": false }, // 任意: isCellEmpty(cell) を position 別に
    "hasPeripheralContent": false,                     // 任意: hasPeripheralContent(cells)
    "canPasteIntoTarget":   false                      // 任意: canPasteIntoPeripheral(pasteTarget, cells)
  }
}
```
`cells` は **position をそのまま使う** (desktop merged 配列・iOS は表示スロット index を position に詰めた値と同義)。
指定した期待フィールドだけを検証する (未指定は無視)。
