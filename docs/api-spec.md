# API 仕様書

Supabase クライアント SDK（`@supabase/supabase-js`）を使用したクライアントサイド API の関数定義。
すべての関数は `lib/api/` に配置し、UI コンポーネントから直接 Supabase を呼ばない。

---

## 型定義

```typescript
// types/index.ts

export type Mandalart = {
  id: string
  user_id: string
  title: string
  created_at: string
  updated_at: string
}

export type Grid = {
  id: string
  mandalart_id: string
  parent_cell_id: string | null
  sort_order: number
  memo: string | null
  created_at: string
  updated_at: string
}

export type Cell = {
  id: string
  grid_id: string
  position: number  // 0〜8（4 = 中心）
  text: string
  image_path: string | null
  color: string | null
  created_at: string
  updated_at: string
}

export type StockItem = {
  id: string
  user_id: string
  snapshot: CellSnapshot
  created_at: string
}

export type CellSnapshot = {
  cell: Pick<Cell, 'text' | 'image_path' | 'color'>
  children: GridSnapshot[]
}

export type GridSnapshot = {
  grid: Pick<Grid, 'sort_order' | 'memo'>
  cells: Pick<Cell, 'position' | 'text' | 'image_path' | 'color'>[]
  children: GridSnapshot[]
}
```

---

## 認証 API

```typescript
// lib/api/auth.ts

// メール + パスワードでサインアップ
export async function signUp(email: string, password: string) {
  return supabase.auth.signUp({ email, password })
}

// メール + パスワードでサインイン
export async function signIn(email: string, password: string) {
  return supabase.auth.signInWithPassword({ email, password })
}

// Google OAuth でサインイン
export async function signInWithGoogle() {
  return supabase.auth.signInWithOAuth({ provider: 'google' })
}

// GitHub OAuth でサインイン
export async function signInWithGitHub() {
  return supabase.auth.signInWithOAuth({ provider: 'github' })
}

// サインアウト
export async function signOut() {
  return supabase.auth.signOut()
}

// 現在のセッションを取得
export async function getSession() {
  return supabase.auth.getSession()
}
```

---

## マンダラート API

```typescript
// lib/api/mandalarts.ts

// 一覧取得（更新日降順）
export async function getMandalarts(): Promise<Mandalart[]>

// 1件取得
export async function getMandalart(id: string): Promise<Mandalart>

// 新規作成（タイトルは後から設定）
export async function createMandalart(title?: string): Promise<Mandalart>

// タイトル更新
export async function updateMandalartTitle(id: string, title: string): Promise<Mandalart>

// 削除（CASCADE で grids・cells も削除）
export async function deleteMandalart(id: string): Promise<void>

// 複製（grids・cells を含む全階層を再帰的にコピー）
export async function duplicateMandalart(id: string): Promise<Mandalart>

// 全文検索（タイトル + セルのテキスト）
export async function searchMandalarts(query: string): Promise<Mandalart[]>
```

---

## グリッド API

```typescript
// lib/api/grids.ts

// マンダラートのルートグリッド一覧を取得（parent_cell_id = NULL）
export async function getRootGrids(mandalartId: string): Promise<Grid[]>

// 特定セルの子グリッド一覧を取得（並列順に並べる）
export async function getChildGrids(parentCellId: string): Promise<Grid[]>

// グリッドを1件取得（cells を含む）
export async function getGrid(id: string): Promise<Grid & { cells: Cell[] }>

// 新規グリッドを作成（9 cells を同時に生成）
export async function createGrid(params: {
  mandalartId: string
  parentCellId: string | null
  sortOrder: number
}): Promise<Grid & { cells: Cell[] }>

// メモを更新
export async function updateGridMemo(id: string, memo: string): Promise<Grid>

// 削除（CASCADE で cells・子グリッドも削除）
export async function deleteGrid(id: string): Promise<void>

// 並列順序を更新（← → 移動時）
export async function updateGridSortOrder(id: string, sortOrder: number): Promise<Grid>
```

---

## セル API

```typescript
// lib/api/cells.ts

// セルを更新（テキスト・画像・色）
export async function updateCell(id: string, params: {
  text?: string
  image_path?: string | null
  color?: string | null
}): Promise<Cell>

// 同一グリッド内でセルを入れ替え（内容のみ）
export async function swapCellContent(cellIdA: string, cellIdB: string): Promise<void>

// サブツリーごと入れ替え（parent_cell_id の付け替え）
export async function swapCellSubtree(cellIdA: string, cellIdB: string): Promise<void>

// サブツリーをコピー（中心セル → 空の周辺セルへのコピー）
export async function copyCellSubtree(sourceCellId: string, targetCellId: string): Promise<void>
```

---

## ストックエリア API

```typescript
// lib/api/stock.ts

// ストックアイテム一覧を取得（作成日降順）
export async function getStockItems(): Promise<StockItem[]>

// セルをストックに追加（snapshot を生成して保存）
export async function addToStock(cellId: string): Promise<StockItem>

// ストックアイテムを削除
export async function deleteStockItem(id: string): Promise<void>

// ストックアイテムをセルにペースト
export async function pasteFromStock(stockItemId: string, targetCellId: string): Promise<void>
```

---

## 画像ストレージ API

```typescript
// lib/api/storage.ts

// 画像をアップロードし、パスを返す
export async function uploadCellImage(params: {
  file: File
  userId: string
  mandalartId: string
  cellId: string
}): Promise<string>  // 返り値は Storage のパス

// 画像の公開 URL を取得（signed URL）
export async function getCellImageUrl(path: string): Promise<string>

// 画像を削除
export async function deleteCellImage(path: string): Promise<void>
```

---

## Realtime サブスクリプション

```typescript
// lib/realtime.ts

// マンダラートの cells 変更をサブスクライブ
export function subscribeToCells(
  mandalartId: string,
  onUpdate: (cell: Cell) => void,
  onInsert: (cell: Cell) => void,
  onDelete: (cellId: string) => void,
): RealtimeChannel

// グリッドの変更をサブスクライブ（並列グリッドの追加・削除など）
export function subscribeToGrids(
  mandalartId: string,
  onChange: (grid: Grid) => void,
): RealtimeChannel

// サブスクリプションを解除
export function unsubscribe(channel: RealtimeChannel): void
```

---

## インポート / エクスポート API

```typescript
// lib/api/transfer.ts

// JSON エクスポート（現在グリッド以下の全階層）
export async function exportToJSON(gridId: string): Promise<GridSnapshot>

// CSV エクスポート（フラットなセルリスト）
export async function exportToCSV(gridId: string): Promise<string>

// JSON インポート（新規マンダラートとして作成）
export async function importFromJSON(snapshot: GridSnapshot): Promise<Mandalart>

// テキスト（インデント or Markdown）をパースして GridSnapshot に変換
export function parseTextToSnapshot(text: string): GridSnapshot

// GridSnapshot を既存セルの子グリッドとして差し込む
export async function importIntoCell(cellId: string, snapshot: GridSnapshot): Promise<void>
```

---

## オフラインキャッシュ

```typescript
// lib/offline.ts

// IndexedDB にグリッドデータをキャッシュ
export async function cacheGrid(gridId: string, data: Grid & { cells: Cell[] }): Promise<void>

// キャッシュからグリッドデータを取得
export async function getCachedGrid(gridId: string): Promise<(Grid & { cells: Cell[] }) | null>

// ペンディングな更新をキューに追加
export async function queueUpdate(operation: OfflineOperation): Promise<void>

// ネットワーク復帰時にキューを Supabase へ同期
export async function syncPendingUpdates(): Promise<void>

type OfflineOperation = {
  type: 'updateCell' | 'updateGridMemo' | 'createGrid' | 'deleteGrid'
  payload: Record<string, unknown>
  timestamp: number
}
```
