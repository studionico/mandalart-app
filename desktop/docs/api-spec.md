# API 仕様書 — マンダラート デスクトップアプリ

## 概要

`src/lib/api/` 配下のモジュールが提供する関数の仕様。
すべて SQLite（`@tauri-apps/plugin-sql`）を介してローカルデータにアクセスする。
呼び出し元: React コンポーネント → hooks → lib/api/（この順で依存）

---

## lib/db/index.ts — データベース基盤

```typescript
// SQLite 接続を取得（シングルトン）
getDb(): Promise<Database>

// SELECT クエリ（行の配列を返す）
query<T>(sql: string, params?: unknown[]): Promise<T[]>

// INSERT / UPDATE / DELETE
execute(sql: string, params?: unknown[]): Promise<void>

// UUID 生成
generateId(): string   // crypto.randomUUID()

// 現在時刻（ISO 8601 文字列）
now(): string
```

---

## lib/api/mandalarts.ts

```typescript
// 全マンダラートを更新日降順で取得
getMandalarts(): Promise<Mandalart[]>

// 指定 ID のマンダラートを取得（存在しない場合は null）
getMandalart(id: string): Promise<Mandalart | null>

// 新規マンダラートを作成（タイトルは後から設定）
createMandalart(title?: string): Promise<Mandalart>

// タイトルを更新
updateMandalartTitle(id: string, title: string): Promise<void>

// マンダラートを削除（関連する grids / cells は CASCADE 削除）
deleteMandalart(id: string): Promise<void>

// タイトル部分一致検索
searchMandalarts(q: string): Promise<Mandalart[]>
```

---

## lib/api/grids.ts

```typescript
// ルートグリッドを sort_order 昇順で取得（並列グリッドを含む）
getRootGrids(mandalartId: string): Promise<Grid[]>

// 指定セルを親とするサブグリッドを sort_order 昇順で取得
getChildGrids(parentCellId: string): Promise<Grid[]>

// グリッドとその全セルを取得
getGrid(id: string): Promise<Grid & { cells: Cell[] }>

// グリッドを新規作成し、9つのセルを同時に生成して返す
createGrid(params: {
  mandalartId: string
  parentCellId: string | null
  sortOrder: number
}): Promise<Grid & { cells: Cell[] }>

// グリッドのメモを更新
updateGridMemo(id: string, memo: string): Promise<void>

// グリッドを削除（関連 cells は CASCADE 削除）
deleteGrid(id: string): Promise<void>

// 並列グリッドの表示順を更新
updateGridSortOrder(id: string, sortOrder: number): Promise<void>
```

---

## lib/api/cells.ts

```typescript
// セルの内容を部分更新（指定フィールドのみ更新）
updateCell(
  id: string,
  params: { text?: string; image_path?: string | null; color?: string | null }
): Promise<Cell>

// 2つのセルの内容（text / image_path / color）のみを入れ替える
// サブツリー（子グリッド）は移動しない
swapCellContent(cellIdA: string, cellIdB: string): Promise<void>

// 2つのセルのサブツリーごと入れ替える
// 一時的な UUID を経由して parent_cell_id を付け替える
swapCellSubtree(cellIdA: string, cellIdB: string): Promise<void>

// sourceCellId のサブツリーを targetCellId 配下に再帰的にコピーする
// 元のセルは変化しない
copyCellSubtree(sourceCellId: string, targetCellId: string): Promise<void>
```

---

## lib/api/stock.ts

```typescript
// ストックアイテムを作成日降順で取得
getStockItems(): Promise<StockItem[]>

// 指定セル（とそのサブツリー）のスナップショットをストックに追加
addToStock(cellId: string): Promise<StockItem>

// ストックアイテムを削除
deleteStockItem(id: string): Promise<void>

// ストックアイテムの内容をターゲットセルに貼り付け（内容のみ）
pasteFromStock(stockItemId: string, targetCellId: string): Promise<void>
```

---

## lib/api/storage.ts

```typescript
// セルに画像をアップロード（現在は DataURL を返す暫定実装）
// 将来: Tauri fs プラグインでアプリデータディレクトリに保存
uploadCellImage(
  userId: string,
  mandalartId: string,
  cellId: string,
  file: File
): Promise<string>   // 保存パスを返す

// 画像パスから表示用 URL を取得
getCellImageUrl(path: string): Promise<string>

// 画像を削除（将来実装）
deleteCellImage(path: string): Promise<void>
```

---

## lib/api/transfer.ts

```typescript
// 指定グリッド以下の階層構造を GridSnapshot として取得（JSON エクスポート用）
exportToJSON(gridId: string): Promise<GridSnapshot>

// 指定グリッド以下をフラットな CSV 形式で取得
exportToCSV(gridId: string): Promise<string>
// 列: position, text, color, depth

// JSON スナップショットを新規マンダラートとしてインポート
importFromJSON(snapshot: GridSnapshot): Promise<Mandalart>

// 指定セルの子グリッドとして JSON スナップショットをインポート
importIntoCell(cellId: string, snapshot: GridSnapshot): Promise<void>

// テキスト（インデント形式 or Markdown）を GridSnapshot に変換
parseTextToSnapshot(text: string): GridSnapshot
```

---

## lib/api/auth.ts（スタブ）

デスクトップ版ではローカルモードのみ。将来の Supabase 同期時に実装予定。

```typescript
signOut(): Promise<void>
getSession(): Promise<null>
signIn(email: string, password: string): Promise<{ error: Error }>
signUp(email: string, password: string): Promise<{ error: Error }>
signInWithGoogle(): Promise<{ error: Error }>
signInWithGitHub(): Promise<{ error: Error }>
```

---

## lib/realtime.ts（スタブ）

デスクトップ版は単一デバイスのため Realtime 不要。

```typescript
subscribeToCells(
  mandalartId: string,
  onInsert: (c: Cell) => void,
  onUpdate: (c: Cell) => void,
): () => void   // unsubscribe 関数を返す

subscribeToGrids(
  mandalartId: string,
  onInsert: (g: Grid) => void,
  onUpdate: (g: Grid) => void,
): () => void

unsubscribe(sub: () => void): void
```

---

## lib/offline.ts（スタブ）

SQLite がプライマリのためオフライン対応不要。

```typescript
cacheGrid(grid: Grid & { cells: unknown[] }): Promise<void>
getCachedGrid(id: string): Promise<null>
queueUpdate(op: unknown): Promise<void>
syncPendingUpdates(): Promise<void>
```

---

## lib/utils/grid.ts

```typescript
// セルが空かどうか（text が空文字 かつ image_path が null）
isCellEmpty(cell: Pick<Cell, 'text' | 'image_path'>): boolean

// 周辺セル（position !== 4）に1つでも入力があるか
hasPeripheralContent(cells: Cell[]): boolean

// 中央セル（position === 4）を取得
getCenterCell(cells: Cell[]): Cell | undefined
```

---

## lib/utils/dnd.ts

D&D ルール判定ロジック。

```typescript
type DndRule = 'swapSubtree' | 'swapContent' | 'copySubtree' | 'noop'

// ドラッグ元とドロップ先の組み合わせからルールを決定
determineDndRule(
  source: Cell,
  target: Cell,
  sourceHasChildren: boolean,
  targetHasChildren: boolean,
): DndRule
```

---

## lib/utils/export.ts

```typescript
// グリッド DOM 要素を PNG としてダウンロード
exportAsPNG(element: HTMLElement): Promise<void>

// グリッド DOM 要素を PDF としてダウンロード
exportAsPDF(element: HTMLElement): Promise<void>

// JSON データをファイルとしてダウンロード
downloadJSON(data: unknown): void

// CSV 文字列をファイルとしてダウンロード
downloadCSV(csv: string): void
```

---

## Zustand ストア

### editorStore

```typescript
// 状態
mandalartId: string | null
currentGridId: string | null
viewMode: '3x3' | '9x9'
breadcrumb: BreadcrumbItem[]

// BreadcrumbItem
type BreadcrumbItem = {
  gridId: string
  cellId: string | null       // 親グリッドで押下したセルの ID（root は null）
  label: string               // セルのテキスト
  cells: Cell[]               // ミニプレビュー用のセル一覧
  highlightPosition: number | null
}

// アクション
setMandalartId(id: string): void
setCurrentGrid(gridId: string): void
setViewMode(mode: '3x3' | '9x9'): void
pushBreadcrumb(item: BreadcrumbItem): void
popBreadcrumbTo(gridId: string): void     // 指定 gridId までパンくずをポップ
resetBreadcrumb(root: BreadcrumbItem): void
```

### undoStore

```typescript
type UndoEntry = {
  description: string
  undo: () => Promise<void>
  redo: () => Promise<void>
}

push(entry: UndoEntry): void
undo(): Promise<void>
redo(): Promise<void>
```

### clipboardStore

```typescript
mode: 'cut' | 'copy' | null
sourceCellId: string | null
snapshot: CellSnapshot | null

set(mode: 'cut' | 'copy', cellId: string, snapshot: CellSnapshot): void
clear(): void
```
