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

// 新規マンダラートを作成 (show_checkbox は DEFAULT 0 = OFF)
createMandalart(title?: string): Promise<Mandalart>

// タイトルを直接更新 (現状はほぼ未使用 — 通常は updateCell 経由の auto-sync に任せる)
updateMandalartTitle(id: string, title: string): Promise<void>

// セル左上 done チェックボックス UI 表示 ON/OFF を更新する (migration 007 以降)。
// DB 値はマンダラート単位で push/pull/realtime によりデバイス間同期される。
updateMandalartShowCheckbox(id: string, show: boolean): Promise<void>

// 前回開いていた sub-grid の id を更新する (migration 008 以降)。
// EditorLayout の `currentGridId` 変化監視 useEffect から都度呼ばれ、ダッシュボード再オープン時の
// drill 階層復元に使われる。null で「未設定 = root にフォールバック」へ戻せる (stale クリア用)。
updateMandalartLastGridId(id: string, lastGridId: string | null): Promise<void>

// ピン留めフラグを切替える (migration 009 以降)。pinned=1 で getMandalarts の ORDER BY で最上位固定。
updateMandalartPinned(id: string, pinned: boolean): Promise<void>

// 単体のマンダラートに sort_order を直接設定する (migration 009 以降)。一覧全体を一括振り直す
// 用途には reorderMandalarts を使う方が整合的。
updateMandalartSortOrder(id: string, sortOrder: number): Promise<void>

// ダッシュボードで card-to-card D&D した結果の順序を、先頭から 0,1,2... で sort_order に
// 振り直す (migration 009 以降)。orderedIds は現在ダッシュボードに見えている順 (= ピン留めを含む全カード)。
reorderMandalarts(orderedIds: string[]): Promise<void>

// マンダラートのフォルダ移動 (migration 010 以降)。タブ間 D&D で呼ばれる。
// 移動先 folder の末尾に並ぶよう sort_order は NULL リセット、updated_at fallback で末尾に並ぶ。
updateMandalartFolderId(id: string, folderId: string): Promise<void>

// stock item を起点に新しいマンダラートを作成する。
// 空 mandalart を `createMandalart()` で生成し、root_cell_id (空の root center cell) に
// `pasteFromStock` で stock snapshot を貼付け、root grid 全体を populate する。
// 用途: ダッシュボードの D&D で stock entry を空エリア / 既存カードに drop した際の新規作成
// (破壊的「stock → 既存カード置換」は実装しないため本 API は新規作成のみ提供)。
createMandalartFromStockItem(stockItemId: string): Promise<Mandalart>

// マンダラートと配下を削除する。
// - 未同期行 (synced_at IS NULL): hard delete (orphan 防止)
// - 同期済み行: soft delete (deleted_at) → push でクラウドに伝播
deleteMandalart(id: string): Promise<void>

// 全文検索: タイトルまたは配下のセル本文に一致するものを更新日降順で返す
// LIKE の % / _ / \ はエスケープされる
searchMandalarts(q: string): Promise<Mandalart[]>

// マンダラートを丸ごと複製 (全グリッド / セル / サブツリーを再帰複製)
// タイトル / show_checkbox はソースのまま継承される
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
// ルートグリッド (mandalart 直下、parent_cell_id IS NULL) を sort_order 昇順で取得
// migration 006 以降は parent_cell_id ベースの判定。並列ルート (legacy 共有 / 新独立) を統一的に拾う
getRootGrids(mandalartId: string): Promise<Grid[]>

// 指定セルを drill 元とする子グリッド群 (primary + 並列) を sort_order 昇順で取得
// migration 006 以降は parent_cell_id = ? で判定 (新独立並列も含めて統一的に列挙)
getChildGrids(parentCellId: string): Promise<Grid[]>

// グリッドとそのセルを常に 9 要素で取得する
// - root / 独立並列 grid: 自 grid_id 配下の 9 cells をそのまま返す
// - X=C primary drilled / レガシー共有並列: 自 grid_id 配下の 8 peripherals に
//   center_cell_id が指す cell を merge して 9 要素にする
getGrid(id: string): Promise<Grid & { cells: Cell[] }>

// 指定 gridId から root までの ancestry を返す (root が先頭、leaf=引数 gridId が末尾)。
// 用途: ダッシュボードからマンダラート再オープン時に `mandalarts.last_grid_id` を読んで
// breadcrumb を全段一括で復元するための材料を取る (migration 008 以降)。
// - parent_cell_id を辿り、その cell が属する grid_id を逆引きしながら遡る
// - 途中で grid / cell が見つからない (stale 参照) 場合は null を返す → 呼出側で root にフォールバック
// - 循環参照は理論上起きないが防衛的に Set で検出して null 返却
getGridAncestry(gridId: string): Promise<Array<Grid & { cells: Cell[] }> | null>

// グリッドを新規作成する (3 モード)。
// - parentCellId=null, centerCellId=null: root 初期作成 (createMandalart 経由)。
//   新 center cell を空で INSERT
// - parentCellId=Y, centerCellId=Y: primary drilled (X=C 維持)。新 cell INSERT なし
// - parentCellId=Y, centerCellId=null: 並列グリッド (独立 center)。新 center cell を空で INSERT
createGrid(params: {
  mandalartId: string
  parentCellId: string | null
  centerCellId: string | null
  sortOrder: number
}): Promise<Grid & { cells: Cell[] }>

// メモ (Markdown) を更新
updateGridMemo(id: string, memo: string): Promise<void>

// グリッドとその子孫を再帰的に削除する。
// - 未同期行 (synced_at IS NULL): hard delete
// - 同期済み行: soft delete (deleted_at)
// 自 grid 所属 cells (peripherals + 独立 center) を対象、X=C primary の center cell
// は親所属なので影響なし
deleteGrid(id: string): Promise<void>

// 並列グリッドの表示順を更新
updateGridSortOrder(id: string, sortOrder: number): Promise<void>

// グリッドとその配下を local + cloud で物理削除する。シュレッダー / orphan 整理 /
// 並列削除 など「復元意図なし」の経路で使用 (deleteGrid だと cloud に
// deleted_at 付きゴミが永続化するため)
permanentDeleteGrid(id: string): Promise<void>

// 「root から辿れるが内容なし」な空グリッド (orphan) を検出する。
// - 全 grids / cells / mandalarts を 3 query で一括取得 → in-memory で判定
// - 周辺セル全空 + drilled children も全 orphan な grid を畳み込みで列挙
findOrphanGrids(): Promise<{
  orphanGridIds: string[]
  orphanCellIds: string[]
  totalGrids: number
  totalCells: number
}>

// 上記 orphan を local + cloud で物理削除する。整理ボタンから呼ばれる
cleanupOrphanGrids(): Promise<{ gridsDeleted: number; cellsDeleted: number }>

// cloud (Supabase) 側に滞留する空 cell 行を物理削除する。
// 「アプリ更新時に一度だけ」走らせる useCloudEmptyCellsCleanup hook から呼ばれる
// (local は migration 005 で削除済 / 新規は lazy で作らない設計)
cleanupEmptyCellsInCloud(): Promise<{ deletedCount: number }>
```

---

## lib/api/cells.ts

```typescript
// (grid_id, position) スロットに対する upsert。lazy 設計で空 slot はまだ DB に
// cell 行が無い前提で、編集 / D&D / paste 等で「この slot に書き込みたいが行はまだ無い」
// 状態を扱うためのヘルパ。
upsertCellAt(
  gridId: string,
  position: number,
  params: { text?: string; image_path?: string | null; color?: string | null }
): Promise<Cell>

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

// 2 つのセルのサブツリーごと入れ替える (D&D Phase A 後は周辺→周辺 SWAP_SUBTREE のみで使用)
// 子グリッドの parent_cell_id / center_cell_id を付け替えて実現
swapCellSubtree(cellIdA: string, cellIdB: string): Promise<void>

// クリップボードからのペースト (カット/コピー)
// copyCellSubtree で内容とサブツリーを複製し、cut モードなら source を論理削除
pasteCell(sourceCellId: string, targetCellId: string, mode: 'cut' | 'copy'): Promise<void>

// sourceCellId のサブツリーを targetCellId 配下に再帰的にコピー (BFS + bulk INSERT)。
// mandalart 全体を 2 query で in-memory 取得 → JS で subtree 抽出して chunk INSERT。
// 新カラム parent_cell_id も整合性ある形で複製する
copyCellSubtree(sourceCellId: string, targetCellId: string): Promise<void>

// セルの内容を空クリア + 配下サブグリッド (parent_cell_id = cellId の grids) を再帰削除する。
// シュレッダー (確認後実行) / 移動 (snapshot 保存後実行) などから呼ばれる。
// deleteGrid 経由で local hard / soft 自動分岐 + cloud 同期も追従
shredCellSubtree(cellId: string): Promise<void>

// グリッド単位 done フラグ操作 (チェックボックス機能)。
// 自 grid 所属の populated cells のみを対象に done を一括設定する
setGridDone(gridId: string, done: boolean): Promise<void>

// セルの done を toggle する。子孫 propagate / 親 propagate (兄弟全 done なら親も done)
// を伴う複雑な伝搬を含む
toggleCellDone(cellId: string): Promise<void>
```

---

## lib/api/folders.ts (migration 010 以降)

ダッシュボードのフォルダタブ操作 API。すべてのマンダラートは必ず 1 つの folder に所属する。
Inbox は `is_system=1` の system folder として `ensureInboxFolder` の冪等呼び出しで自動生成される。

```typescript
// deleted_at IS NULL の folder を sort_order 順に返す
getFolders(): Promise<Folder[]>

// ユーザー定義フォルダを新規作成 (is_system=0)。sort_order は MAX+1 で自動採番
createFolder(name: string): Promise<Folder>

// フォルダ名を更新する。Inbox など system folder にも適用可 (i18n 用途)
updateFolderName(id: string, name: string): Promise<void>

// sort_order を直接設定する (タブの並び替え用)
updateFolderSortOrder(id: string, sortOrder: number): Promise<void>

// フォルダを削除する。
//  - is_system=1 (Inbox 等): 削除拒否 (Error throw)
//  - それ以外: 所属マンダラートの folder_id を Inbox に reset → folder 自身を syncAwareDelete
deleteFolder(id: string): Promise<void>

// Inbox folder が存在することを保証する冪等な bootstrap。
//  - 既に is_system=1 の folder があればその id を返す
//  - 無ければ新規作成 (sort_order=0、name='Inbox')
//  - その後、folder_id IS NULL の mandalarts を Inbox に振り分け
// アプリ起動時 + ダッシュボードマウント時に呼ぶ想定
ensureInboxFolder(): Promise<string>
```

---

## lib/api/stock.ts

```typescript
// ストックアイテムを作成日降順で取得
getStockItems(): Promise<StockItem[]>

// 指定セル (とそのサブツリー) のスナップショットをストックに追加
// - 周辺セル: parent_cell_id = cellId の全 grids を子として再帰スナップショット
// - 中央セル: center_cell_id = cellId のグリッド (root parallels 含む) を再帰スナップショット
// 戻り値の StockItem.id は ConvergeOverlay の direction='stock' 着地点
// (`[data-converge-stock="<id>"]`) を解決するために使われる。
addToStock(cellId: string): Promise<StockItem>

// ストックアイテムを削除
deleteStockItem(id: string): Promise<void>

// 「移動」アクション: addToStock + shredCellSubtree。
// snapshot をストック保存してから元セル + 配下を完全削除する (= カット to ストック)。
// 戻り値の StockItem.id は同じく ConvergeOverlay 着地点解決用。
moveCellToStock(cellId: string): Promise<StockItem>

// ストックアイテムの内容 + サブツリーをターゲットセルに貼り付け
// 通常のターゲットが空セルの経路で useDragAndDrop から呼ばれる
pasteFromStock(stockItemId: string, targetCellId: string): Promise<void>

// 入力ありセルへのストックペースト (置換版)。
// 既存 cell content + 配下 (parent_cell_id = targetCellId) を破棄してから pasteFromStock。
// ReplaceConfirmDialog 経由で確認後に呼ばれる
pasteFromStockReplacing(stockItemId: string, targetCellId: string): Promise<void>
```

---

## lib/api/storage.ts

```typescript
// ブラウザ File を $APPDATA/images/{cellId}-{ts}.{ext} にコピー
// CellEditModal のファイル選択 / デスクトップから webview への HTML5 file drop
// (EditorLayout の window-level dataTransfer.files listener) 共通の入口
uploadCellImage(
  userId: string,
  mandalartId: string,
  cellId: string,
  file: File
): Promise<string>   // 相対パス (AppData/images/...) を返す

// 相対パスを blob URL に変換 (cache 付き)
// Cell コンポーネントが <img src={blobUrl}> で表示するために使う
getCellImageUrl(path: string): Promise<string>

// 同期版: メモリキャッシュを直接覗く。未キャッシュは null を返す。
// Cell.tsx の useState 初期値 (`useState(() => getCachedCellImageUrl(cell.image_path))`) で使い、
// orbit アニメ後の remount 時にキャッシュ済み画像を 1 frame目から描画してまばたきを防ぐ。
getCachedCellImageUrl(path: string | null | undefined): string | null

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
// targetFolderId 指定時はそのフォルダに所属。未指定 (undefined) なら Inbox にフォールバック。
// home 収束アニメ後のフォルダタブが import 元のフォルダと一致するよう、通常は呼び出し側 (ImportDialog)
// で「インポート押下時の選択中フォルダ id」を渡す。
importFromJSON(snapshot: GridSnapshot, targetFolderId?: string): Promise<Mandalart>

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
// ドラッグ元セルとドロップ先セルから D&D アクションを判定する (Phase A drop policy 厳格化後)。
// - 周辺 → 周辺: SWAP_SUBTREE
// - 中心セル絡み (どちらかが center) は全て NOOP (= 4 アクションアイコン経由のみ許可)
resolveDndAction(source: Cell, target: Cell): DndAction

export type DndAction =
  | { type: 'SWAP_SUBTREE'; cellIdA: string; cellIdB: string }
  | { type: 'NOOP' }
```

## lib/utils/export.ts

Tauri WebKit は `<a download>` の click() が動かないので、`tauri-plugin-fs` の `writeFile` で
`$DOWNLOAD` (OS のダウンロードフォルダ) に直接書き、戻り値のファイル名を toast で通知する。

```typescript
// DOM 要素を PNG として Downloads に保存 (html-to-image。html2canvas は Tailwind CSS v4 の
// oklch() をパースできないため使わない)
exportAsPNG(element: HTMLElement, baseName?: string): Promise<string>  // filename を返す

// DOM 要素を PDF として Downloads に保存 (PNG 経由 → jsPDF)
exportAsPDF(element: HTMLElement, baseName?: string): Promise<string>

// JSON を pretty-print して Downloads に保存
downloadJSON(data: unknown, baseName?: string): Promise<string>

// プレーンテキスト (Markdown / IndentText) を Downloads に保存。拡張子は呼出側が指定 ('md', 'txt')
downloadText(content: string, extension: string, baseName?: string): Promise<string>
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
  imagePath?: string | null  // 画像セルのサムネ (text 空時のフォールバック)
  cells: Cell[]              // ミニプレビュー用のセル一覧
  highlightPosition: number | null
}

// アクション
setMandalartId(id: string): void
setCurrentGrid(gridId: string | null): void
setViewMode(mode: '3x3' | '9x9'): void
pushBreadcrumb(item: BreadcrumbItem): void
popBreadcrumbTo(gridId: string): void
resetBreadcrumb(root: BreadcrumbItem): void
// breadcrumb 全段を一括 set + currentGridId を末尾 item に揃える。
// 用途: マンダラート再オープン時に `mandalarts.last_grid_id` から ancestry を構築して復元する (migration 008 以降)。
setBreadcrumb(items: BreadcrumbItem[]): void
// gridId に一致するエントリの一部フィールドを更新 (label / imagePath / gridId 自身など)
updateBreadcrumbItem(gridId: string, updates: Partial<BreadcrumbItem>): void

bumpFontLevel(delta: number): void   // +1 / -1 を押すたびに呼ばれる
resetFontLevel(): void                // 中央の「100%」ボタン
```

**注**: 旧 `showCheckbox` / `setShowCheckbox` は migration 007 でマンダラート単位の DB カラム
(`mandalarts.show_checkbox`) に移行したため editorStore からは撤去された。EditorLayout 側で
local state + DB load/persist で扱う ([`updateMandalartShowCheckbox`](#libapimandalartsts) 参照)。

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

### convergeStore

App 直下にマウントされた `ConvergeOverlay` がエディタ ↔ ダッシュボード ↔ ストック の morph アニメ
(寸法/枠/角丸/inset/font の並列 CSS transition) を駆動するための一時 state。route 切替を跨いで
保持され、`clear()` で消える。詳細は [`animations.md`](./animations.md) "5. Converge Overlay" 節参照。

```typescript
type ConvergeDirection = 'home' | 'open' | 'stock'

type SourceRect = { left: number; top: number; width: number; height: number }

type CenterCell = {
  text: string
  imagePath: string | null
  color: string | null
  fontPx: number          // source の text フォントサイズ (px)
  topInsetPx: number      // text wrapper top inset (border-box 内側起算)
  sideInsetPx: number     // text wrapper right/bottom/left inset (〃)
  borderPx: number        // source の border-width (px)
  radiusPx: number        // source の border-radius (px)
}

direction: ConvergeDirection | null  // 'home' | 'open' | 'stock' | null
targetId: string | null              // 着地点識別子 (mandalartId or stockItemId)
sourceRect: SourceRect | null        // 起点要素の viewport 矩形
centerCell: CenterCell | null        // 起点要素の表示内容 + 計測値

// trigger 側 (handleNavigateHome / DashboardPage MandalartCard / handleDndAction) が呼ぶ
setConverge(
  direction: ConvergeDirection,
  id: string,
  rect: SourceRect,
  centerCell: CenterCell,
): void

// ConvergeOverlay が morph 完了 (transitionend or safetyTimer) で呼ぶ
clear(): void
```

**direction の意味**:
- `home`: エディタ中心セル → ダッシュボードカード収束 (ホームボタン押下時)
- `open`: ダッシュボードカード → エディタ中心セル拡大 (カードクリック時)
- `stock`: エディタ内セル → 新規ストックエントリ収束 (D&D で copy/move drop 時)

`targetId` は polymorphic id (前 2 つは `mandalart.id`、`stock` は `stock_item.id`)。`centerCell` は起点側 DOM の実測値で overlay の**初期**スタイルとして使い、終端値は polling した target DOM の `getComputedStyle` から読む。
