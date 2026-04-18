# API 仕様書 — マンダラート デスクトップアプリ

## 概要

`src/lib/` 配下のモジュールが提供する関数シグネチャの一覧。呼び出し関係:

```
components/ → hooks/ → lib/api/ → lib/db/ → tauri-plugin-sql
                      ↘ lib/sync/ → Supabase (REST + Realtime)
                      ↘ lib/supabase/client.ts
```

すべての CRUD はローカル SQLite が primary。サインインしている間は `lib/sync/` が差分を Supabase に push / pull する。

---

## lib/db/index.ts — データベース基盤

```typescript
// SQLite 接続を取得 (シングルトン)
// 初回接続時に PRAGMA journal_mode = WAL と busy_timeout = 5000 を設定する
getDb(): Promise<Database>

// SELECT クエリ (行の配列を返す)
query<T>(sql: string, params?: unknown[]): Promise<T[]>

// INSERT / UPDATE / DELETE
execute(sql: string, params?: unknown[]): Promise<void>

// UUID 生成 (crypto.randomUUID)
generateId(): string

// 現在時刻 (ISO 8601)
now(): string
```

---

## lib/api/mandalarts.ts

```typescript
// 削除されていない全マンダラートを更新日降順で取得
getMandalarts(): Promise<Mandalart[]>

// 指定 ID のマンダラートを取得 (削除済みは除外)
getMandalart(id: string): Promise<Mandalart | null>

// 新規マンダラートを作成
createMandalart(title?: string): Promise<Mandalart>

// タイトルを直接更新 (現状はほぼ未使用 — 通常は updateCell 経由の auto-sync に任せる)
updateMandalartTitle(id: string, title: string): Promise<void>

// マンダラートをソフトデリート (cells / grids / mandalarts の順に deleted_at をセット)
deleteMandalart(id: string): Promise<void>

// 全文検索: タイトルまたは配下のセル本文に一致するものを更新日降順で返す
// LIKE の % / _ / \ はエスケープされる
searchMandalarts(q: string): Promise<Mandalart[]>

// マンダラートを丸ごと複製 (全グリッド / セル / サブツリーを再帰複製)
// タイトルはソースのままコピーされる (「〜 のコピー」サフィックスは付けない)
duplicateMandalart(sourceId: string): Promise<Mandalart>

// ソフトデリートされたマンダラートを削除日降順で取得 (ゴミ箱)
getDeletedMandalarts(): Promise<Mandalart[]>

// ゴミ箱からの復元 (配下の grids / cells の deleted_at も NULL に戻す)
restoreMandalart(id: string): Promise<void>

// 完全削除 (物理削除)。ゴミ箱から元に戻せなくなる
// 1. ローカル: cells / grids / mandalarts を順に物理 DELETE
// 2. クラウド (サインイン時): 同じ順で Supabase から delete().eq() で消す
//    → これをやらないと次回 pullAll で cloud の deleted_at 付き行が再挿入されて
//      ゴミ箱に復活してしまう
//    ネットワーク断 / RLS エラーなどで cloud delete 失敗時は warn ログのみで非致命
permanentDeleteMandalart(id: string): Promise<void>
```

---

## lib/api/grids.ts

```typescript
// ルートグリッド (mandalarts.root_cell_id を center とするグリッド) を sort_order 昇順で取得
// 並列ルートグリッドをすべて含む
getRootGrids(mandalartId: string): Promise<Grid[]>

// 指定セルを center とする drill 先グリッドを sort_order 昇順で取得
// 自己参照 (cell の所属 grid と同じ grid) は除外するので、root 中心セルに対して呼んでも
// 自グリッド自身は返らない
getChildGrids(parentCellId: string): Promise<Grid[]>

// グリッドとそのセルを常に 9 要素で取得する
// - root grid: 自 grid_id 配下の 9 cells をそのまま返す
// - 子 grid: 自 grid_id 配下の 8 peripherals に center_cell_id が指す cell を merge して 9 要素にする
getGrid(id: string): Promise<Grid & { cells: Cell[] }>

// グリッドを新規作成する。
// - centerCellId = null: root 作成。新 center cell を生成して 9 cells を INSERT
// - centerCellId 指定: 子 / 並列グリッド作成。center は既存 cell を再利用し 8 peripherals のみ INSERT
createGrid(params: {
  mandalartId: string
  centerCellId: string | null
  sortOrder: number
}): Promise<Grid & { cells: Cell[] }>

// メモ (Markdown) を更新
updateGridMemo(id: string, memo: string): Promise<void>

// グリッドとその子孫を再帰的にソフトデリート
// 自 grid_id の cells のみを対象とするので、子グリッドの center cell
// (= 親 grid に属する peripheral) は削除されない
deleteGrid(id: string): Promise<void>

// 並列グリッドの表示順を更新
updateGridSortOrder(id: string, sortOrder: number): Promise<void>
```

---

## lib/api/cells.ts

```typescript
// セルの内容を部分更新 (指定フィールドのみ)
// ルートグリッドの中心セル (position=4) を更新した場合、
// mandalarts.title も同じテキストで自動同期される
updateCell(
  id: string,
  params: { text?: string; image_path?: string | null; color?: string | null }
): Promise<Cell>

// 2 つのセルの内容 (text / image_path / color) のみを入れ替える
// サブツリー (子グリッド) は移動しない
swapCellContent(cellIdA: string, cellIdB: string): Promise<void>

// 2 つのセルのサブツリーごと入れ替える
// 子グリッドの center_cell_id を付け替えるだけで実装 (循環 FK 問題を避けるため一時 ID は使わない)
// root 中心セルの自グリッド自己参照 (cell の所属 grid = grid 自身の center) は付け替え対象外
swapCellSubtree(cellIdA: string, cellIdB: string): Promise<void>

// クリップボードからのペースト (カット/コピー)
// copyCellSubtree で内容とサブツリーを複製し、cut モードなら source を論理削除
pasteCell(sourceCellId: string, targetCellId: string, mode: 'cut' | 'copy'): Promise<void>

// sourceCellId のサブツリーを targetCellId 配下に再帰的にコピー。
// 新モデル (X=C 統一): `SELECT ... FROM grids WHERE center_cell_id = ?` で source の
// サブツリーを列挙するので、source が root 中心セルなら所属 grid 自体も subtree に含まれ、
// 結果として "グリッド丸ごと複製" が自動的に実現される (旧モデルの特殊分岐は廃止)。
copyCellSubtree(sourceCellId: string, targetCellId: string): Promise<void>
```

---

## lib/api/stock.ts

```typescript
// ストックアイテムを作成日降順で取得
getStockItems(): Promise<StockItem[]>

// 指定セル (とそのサブツリー) のスナップショットをストックに追加
// 周辺セル: そのセルの子グリッド群
// 中央セル: 所属するグリッド自体 (8 周辺セル + その下のサブツリー)
addToStock(cellId: string): Promise<StockItem>

// ストックアイテムを削除
deleteStockItem(id: string): Promise<void>

// ストックアイテムの内容 + サブツリーをターゲットセルに貼り付け
// ターゲットが空セルのときのみ useDragAndDrop から呼ばれる
pasteFromStock(stockItemId: string, targetCellId: string): Promise<void>
```

---

## lib/api/storage.ts

```typescript
// ブラウザ File を $APPDATA/images/{cellId}-{ts}.{ext} にコピー
// CellEditModal のファイル選択経由で呼ばれる
uploadCellImage(
  userId: string,
  mandalartId: string,
  cellId: string,
  file: File
): Promise<string>   // 相対パス (AppData/images/...) を返す

// Tauri のネイティブ drag-drop で得られた絶対パスを AppData/images/ にコピー
copyImageFromPath(absolutePath: string, cellId: string): Promise<string>

// 相対パスを blob URL に変換 (cache 付き)
// Cell コンポーネントが <img src={blobUrl}> で表示するために使う
getCellImageUrl(path: string): Promise<string>

// ローカルファイルを削除 + blob URL をキャッシュから破棄
deleteCellImage(path: string): Promise<void>
```

---

## lib/api/transfer.ts

```typescript
// 指定グリッド以下の階層構造を GridSnapshot として取得 (JSON エクスポート用)
// 子グリッドには parentPosition が記録されるので round-trip 可能
// 並列グリッドの相互参照は visited Set で検出し無限再帰を回避する
exportToJSON(gridId: string): Promise<GridSnapshot>

// 指定グリッド以下を Markdown 見出し形式でエクスポート (round-trip 可能)
// Level 1..6 は `#` 見出し、7 以降は `- ` 箇条書きにフォールバック
// memo は各見出し直下の `> blockquote` (再 import 時には落ちる)
exportToMarkdown(gridId: string): Promise<string>

// 指定グリッド以下をインデントテキスト形式でエクスポート (2 スペースインデント)
// memo は tree 構造と両立しないため省略 (完全保持には JSON を使う)
exportToIndentText(gridId: string): Promise<string>

// テスト用のピュア関数: GridSnapshot → 文字列 (DB アクセスなし)
// export* と対で ExportNode tree を構築して文字列化する
snapshotToMarkdown(snapshot: GridSnapshot): string
snapshotToIndentText(snapshot: GridSnapshot): string

// GridSnapshot を新規マンダラートとしてインポート
// 中心セルのテキストがタイトルになる。parentPosition は `undefined` / `null` どちらでも並列扱い
importFromJSON(snapshot: GridSnapshot): Promise<Mandalart>

// GridSnapshot を既存セルの配下に挿入
// ターゲットセルの内容はスナップショットのルート中心セルで上書きされる
importIntoCell(cellId: string, snapshot: GridSnapshot): Promise<void>

// テキスト (インデント or Markdown 見出し) を GridSnapshot に変換
// 先頭の箇条書き記号 (・ • ◦ - * + 1. 1) など) は自動で剥がされる
// 9 個以上の子は先頭 8 個を peripherals、9 個目以降を 8 件チャンクの並列グリッドへ overflow
parseTextToSnapshot(text: string): GridSnapshot
```

各形式の round-trip 保持対象 (要素 vs 形式) は [`requirements.md`](./requirements.md#エクスポート機能) の
テーブル参照。検証用フィクスチャは [`desktop/samples/test-fixture.json`](../samples/test-fixture.json) +
[README](../samples/README.md) にある。

---

## lib/api/auth.ts — Supabase Auth 連携

```typescript
// 現在のセッションを取得
getSession(): Promise<Session | null>

// メール + パスワードでサインイン
signInWithEmail(email: string, password: string): Promise<{ data, error }>

// メール + パスワードで新規登録 (email 確認が必要な場合は Session なしで返る)
signUpWithEmail(email: string, password: string): Promise<{ data, error }>

// サインアウト
signOut(): Promise<{ error }>

// OAuth サインイン (Google / GitHub)
// supabase.auth.signInWithOAuth({ skipBrowserRedirect: true }) で URL を取得し
// tauri-plugin-opener でシステムブラウザを開く。コールバックは deep link で受け取る
signInWithOAuth(provider: 'google' | 'github'): Promise<{ error }>

// tauri-plugin-deep-link で受け取った URL から認可コードを取り出してセッションに変換
handleDeepLink(url: string): Promise<void>
```

---

## lib/supabase/client.ts

```typescript
// 環境変数 (VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY) が欠損している場合でも
// モジュール読み込み時にクラッシュしないよう、ダミー URL でフォールバック初期化する
export const supabase: SupabaseClient

// 両方の env var が設定されているかどうか
// useAuthBootstrap / useSync はこのフラグで gate して何も動かないように
export const isSupabaseConfigured: boolean
```

---

## lib/sync/push.ts

```typescript
// 未同期 (synced_at < updated_at もしくは synced_at IS NULL) のローカル行を
// Supabase に行単位で upsert する
// deleted_at もペイロードに含めるのでソフトデリートも伝播する
// 1 行失敗しても全体を止めず、失敗行を集約して最後にまとめて throw
pushAll(userId: string): Promise<{ mandalarts: number; grids: number; cells: number }>
```

## lib/sync/pull.ts

```typescript
// Supabase から mandalarts / grids / cells を全行 SELECT し、
// updated_at 比較で local に反映 (last-write-wins)
// 失敗行は console.error に詳細を出して throw
pullAll(): Promise<{ mandalarts: number; grids: number; cells: number }>
```

## lib/sync/index.ts

```typescript
// pullAll → pushAll の順で実行
// useSync から呼ばれる (起動時 / 手動同期ボタン / realtime 受信時)
syncAll(userId: string): Promise<SyncStats>

export type SyncStats = {
  pushed: { mandalarts: number; grids: number; cells: number }
  pulled: { mandalarts: number; grids: number; cells: number }
}
```

## lib/realtime.ts

```typescript
// Supabase Realtime (postgres_changes) を mandalarts / grids / cells の 3 テーブルで購読
// 受信したペイロードをローカル DB に upsert (deleted_at 含む)
// すべての apply 関数は try/catch で囲まれており、失敗しても他のテーブルへの伝播を止めない
//
// 実運用での注意:
//  1. postgres_changes の table フィルタは discriminator として効かない場合がある。
//     各ハンドラ冒頭で if (payload.table !== 'X') return のガードを必ず入れる
//  2. DELETE は cloud の FK CASCADE で連鎖するが、realtime では個別テーブルごとにしか
//     イベントが来ない。しかも cloud に未 push の子行にはイベントが発行されない。
//     各 DELETE ハンドラで「cells → grids → mandalarts」の順に明示カスケードしないと
//     ローカルに孤立した子行が残り、push で RLS 拒否の原因になる
subscribeRemoteChanges(onChange: () => void): () => void   // unsubscribe 関数を返す
```

---

## lib/utils/grid.ts

```typescript
// セルが空かどうか (text が空文字 かつ image_path が null)
isCellEmpty(cell: Pick<Cell, 'text' | 'image_path'>): boolean

// 周辺セル (position !== 4) に 1 つでも入力があるか
hasPeripheralContent(cells: Cell[]): boolean

// 中央セル (position === 4) を取得
getCenterCell(cells: Cell[]): Cell | undefined
```

## lib/utils/dnd.ts

```typescript
// ドラッグ元セルとドロップ先セルから D&D アクションを判定する
// 返り値は SWAP_SUBTREE / SWAP_CONTENT / COPY_SUBTREE / NOOP のいずれか
resolveDndAction(source: Cell, target: Cell): DndAction

export type DndAction =
  | { type: 'SWAP_SUBTREE'; cellIdA: string; cellIdB: string }
  | { type: 'SWAP_CONTENT'; cellIdA: string; cellIdB: string }
  | { type: 'COPY_SUBTREE'; sourceCellId: string; targetCellId: string }
  | { type: 'NOOP' }
```

## lib/utils/export.ts

```typescript
// グリッド DOM 要素を PNG としてダウンロード (html2canvas)
exportAsPNG(element: HTMLElement): Promise<void>

// グリッド DOM 要素を PDF としてダウンロード (jsPDF)
exportAsPDF(element: HTMLElement): Promise<void>

// JSON データをファイルとしてダウンロード
downloadJSON(data: unknown): void

// CSV 文字列をファイルとしてダウンロード
downloadCSV(csv: string): void
```

## constants/tabOrder.ts

```typescript
// Tab 移動順 (0-indexed、DB の cells.position と一致)
// 中心 4 から時計回り: 4 → 7 → 6 → 3 → 0 → 1 → 2 → 5 → 8 → 4
// インポート時の周辺セル配置順もこの順から中心を除いたもの
export const TAB_ORDER: number[] = [4, 7, 6, 3, 0, 1, 2, 5, 8]
export const TAB_ORDER_REVERSE: number[]

// position から次の Tab 先 position を返す
nextTabPosition(current: number, reverse?: boolean): number
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
fontLevel: number      // -10 〜 +20 の整数
fontScale: number      // 1.1^fontLevel (派生値、Cell に渡す)

type BreadcrumbItem = {
  gridId: string
  cellId: string | null      // 親グリッドで押下したセルの ID (root は null)
  label: string              // セルのテキスト
  cells: Cell[]              // ミニプレビュー用のセル一覧
  highlightPosition: number | null
}

// アクション
setMandalartId(id: string): void
setCurrentGrid(gridId: string): void
setViewMode(mode: '3x3' | '9x9'): void
pushBreadcrumb(item: BreadcrumbItem): void
popBreadcrumbTo(gridId: string): void
resetBreadcrumb(root: BreadcrumbItem): void

bumpFontLevel(delta: number): void   // +1 / -1 を押すたびに呼ばれる
resetFontLevel(): void                // 中央の「100%」ボタン
```

### undoStore

```typescript
type UndoOperation = {
  description: string
  undo: () => Promise<void>
  redo: () => Promise<void>
}

past: UndoOperation[]
future: UndoOperation[]

push(op: UndoOperation): void
undo(): Promise<void>
redo(): Promise<void>
clear(): void
```

### clipboardStore

```typescript
// スナップショットは持たず、DB 内のソースセル ID のみを記録する
// (paste 実行時に DB から source を読み直して copyCellSubtree + 必要なら論理削除)
mode: 'cut' | 'copy' | null
sourceCellId: string | null

set(mode: 'cut' | 'copy', cellId: string): void
clear(): void
```

### authStore

```typescript
session: Session | null
user: User | null
loading: boolean

setSession(session: Session | null): void
setLoading(loading: boolean): void
```

### themeStore

```typescript
// light / dark / system。localStorage に永続化
preference: 'light' | 'dark' | 'system'
setPreference(pref: 'light' | 'dark' | 'system'): void
```
