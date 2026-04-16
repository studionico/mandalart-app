# CLAUDE.md

このファイルは Claude Code (claude.ai/code) がこのリポジトリで作業する際のガイドです。

## プロジェクト概要

マンダラート（Mandalart）— 3×3 グリッドで思考を階層的に展開するデスクトップアプリ。各セルをクリックすると更に 3×3 グリッドに掘り下げられる「無限階層」式のツール。同じ階層に並列グリッドを作ることもでき、← → で切り替える。

**アクティブなコードベースは [`desktop/`](desktop/) 配下の Tauri デスクトップアプリ**。ルートの Next.js 部分 ([`_old_web/`](_old_web/)) は試作版の Web プロトタイプでメンテ停止。修正は特に指定がない限り `desktop/` に対して行う。

## コマンド (すべて `desktop/` から)

```bash
# Vite dev サーバーのみ (Tauri なしの UI 高速反復用)
npm run dev

# Tauri dev (SQLite / fs プラグインが必要なので、機能確認は基本こちら)
npm run tauri dev

# 型チェック
npx tsc --noEmit

# フロントエンドの本番ビルド
npm run build

# ネイティブアプリ (.dmg / .msi 等) のビルド
npm run tauri build
```

別途 lint スクリプトは無い。静的チェックは `tsc --noEmit` に任せている。

## アーキテクチャ

### 技術スタック

- **シェル**: Tauri v2 (Rust バックエンドは `src-tauri/`)
- **フロントエンド**: Vite + React 19 + TypeScript
- **ルーティング**: React Router v7 の HashRouter (Tauri が file URL を配信するため)
- **スタイル**: Tailwind CSS v4 (`@tailwindcss/vite`)。ダークモードは `@custom-variant dark` 経由のクラスベース
- **状態**: Zustand (`editorStore` / `undoStore` / `clipboardStore` / `authStore` / `themeStore`)
- **データベース**:
  - **ローカル**: SQLite via `tauri-plugin-sql` (primary storage、オフライン動作)
  - **クラウド**: Supabase (任意、サインインで有効化)
- **認証**: Supabase Auth (メール + Google / GitHub OAuth)、PKCE フロー + `tauri-plugin-deep-link` で `mandalart://` スキームをキャッチ
- **同期**: `lib/sync/` (push / pull / realtime)、last-write-wins (`updated_at` 比較)
- **Export**: html2canvas + jsPDF
- **Path alias**: `@/` → `desktop/src/`

### データモデル (ローカル SQLite)

スキーマは [`desktop/src-tauri/migrations/`](desktop/src-tauri/migrations/) にあり、起動時に `lib.rs` で自動適用される:

- `001_initial.sql`: `mandalarts` / `grids` / `cells` / `stock_items` の初期定義
- `002_soft_delete.sql`: 3 テーブルに `deleted_at TEXT` カラム + インデックス追加

階層構造:
```
mandalarts → grids → cells → grids (child, via parent_cell_id) → cells → …
```

- `grids.parent_cell_id = NULL` がルートグリッド (並列グリッドは `sort_order` で順序付け)
- `cells.position` は 0〜8 (4 が中央)、position 4 = テーマセル
- `stock_items.snapshot` は cell + サブツリー全体の JSON スナップショット
- **FK 制約は張っていない** (下の「DB のハマりポイント」参照)

### レイヤード構成

UI は SQLite を直接叩かない:

```
components/ → hooks/ → lib/api/ → lib/db/ → tauri-plugin-sql
```

- [`lib/db/index.ts`](desktop/src/lib/db/index.ts) が `tauri-plugin-sql` を `query` / `execute` / `generateId` / `now` のヘルパーで包む
- [`lib/api/*.ts`](desktop/src/lib/api/) がエンティティ単位の CRUD を提供
- [`lib/utils/*.ts`](desktop/src/lib/utils/) はピュアロジック (`grid.ts` / `dnd.ts` / `export.ts`)
- [`lib/sync/*.ts`](desktop/src/lib/sync/) はクラウド同期 (`push.ts` / `pull.ts` / `index.ts`)
- [`lib/realtime.ts`](desktop/src/lib/realtime.ts) は Supabase Realtime 購読

### 主要ディレクトリ (`desktop/src/` 配下)

| パス | 役割 |
|---|---|
| `lib/db/` | tauri-plugin-sql のラッパー。起動時に `PRAGMA journal_mode = WAL` + `PRAGMA busy_timeout = 5000` を設定 |
| `lib/api/` | エンティティごとの CRUD: `auth` / `mandalarts` / `grids` / `cells` / `stock` / `storage` / `transfer` |
| `lib/utils/` | `grid.ts` (セル判定) / `dnd.ts` (D&D ルール) / `export.ts` (PNG/PDF/JSON/CSV) |
| `lib/sync/` | `push.ts` / `pull.ts` / `index.ts` — ローカル ↔ クラウドの同期 |
| `lib/realtime.ts` | `postgres_changes` 購読 → ローカル DB 反映 |
| `lib/supabase/client.ts` | Supabase クライアント (env 欠損時はダミー URL でフォールバックし、`isSupabaseConfigured` で gate) |
| `lib/import-parser.ts` | インデントテキスト / Markdown 見出し → `GridSnapshot` パーサ |
| `store/` | Zustand: `editorStore` / `undoStore` / `clipboardStore` / `authStore` / `themeStore` |
| `hooks/` | `useGrid` / `useSubGrids` / `useDragAndDrop` / `useUndo` / `useSync` / `useAuthBootstrap` / `useGlobalShortcut` / `useTheme` / `useAppUpdate` |
| `pages/` | `DashboardPage.tsx` / `EditorPage.tsx` |
| `components/` | `ThemeToggle` / `UpdateDialog` / `AuthDialog` / `dashboard/TrashDialog` |
| `components/editor/` | `EditorLayout` / `GridView3x3` / `GridView9x9` / `Cell` / `CellEditModal` / `Breadcrumb` / `ParallelNav` / `SidePanel` / `MemoTab` / `StockTab` / `ImportDialog` |
| `constants/tabOrder.ts` | Tab 順 `[4, 7, 6, 3, 0, 1, 2, 5, 8]` (0-indexed) |
| `src-tauri/migrations/` | 起動時に自動適用される SQL マイグレーション |
| `src-tauri/capabilities/default.json` | Tauri v2 パーミッション |

### ルーティング

React Router v7 HashRouter ([`App.tsx`](desktop/src/App.tsx)):

```
/                 → /dashboard にリダイレクト
/dashboard        → DashboardPage
/mandalart/:id    → EditorPage → EditorLayout
```

認証ガードは無い。サインインしなくても全機能がローカル専用モードで使える。

---

## ビジネスルール

### セル操作 (クリック / ドラッグ / キーボード)

**クリック判定** (220ms のタイマーで single vs double を識別):

| セルの状態 | シングルクリック | ダブルクリック |
|---|---|---|
| 空 (text も image も無い) | **即インライン編集開始** (textarea にフォーカス) | 無視 (編集継続) |
| 入力ありの周辺セル | サブグリッドへドリル (220ms 遅延)。子グリッドが無ければ自動生成 | インライン編集 |
| 入力ありの中央セル (ルート) | **ダッシュボードへ戻る** | インライン編集 |
| 入力ありの中央セル (サブ) | 親グリッドへ戻る | インライン編集 |
| 中央セルが空の周辺セル | 操作不可 (disabled) | — |

**その他:**
- セル右上の `⋯` ボタン (hover 時表示) → `CellEditModal` で色 / 画像 / 長文編集
- 右クリック → コンテキストメニュー (カット / コピー / ペースト / ストック / インポート)
- D&D はマウスイベントベース (下記「Tauri のハマりポイント」参照)

### セルナンバリング (0-indexed、DB の `cells.position` と一致)

```
0 | 1 | 2
--+---+--
3 | 4 | 5    ← 4 = 中央
--+---+--
6 | 7 | 8
```

### Tab 移動順

`4 → 7 → 6 → 3 → 0 → 1 → 2 → 5 → 8 → 4` (ループ)

- Shift+Tab は逆順
- 中央セル (4) が空のとき Tab は留まる (周辺が disabled なので)
- IME 変換中 (`e.nativeEvent.isComposing`) の Tab は無視
- **インポート時の周辺セル配置順も同じ順**。`TAB_ORDER` から中央を除いた `[7, 6, 3, 0, 1, 2, 5, 8]`

### D&D ルール (同一グリッド / 9×9 跨ぎ 共通)

| ドラッグ元 | ドロップ先 | 結果 |
|---|---|---|
| 周辺 | 周辺 | サブツリーごと入れ替え (`swapCellSubtree`) |
| 中央 | 入力ありの周辺 | 内容のみ入れ替え (`swapCellContent`) |
| 中央 | 空の周辺 | サブツリーをコピー (`copyCellSubtree`) |
| 入力ありの周辺 | 中央 | 内容のみ入れ替え |
| 空の周辺 | 中央 | 何もしない |

9×9 表示では ルート + サブグリッドの全セルを平坦化して `useDragAndDrop` に渡すので、サブグリッドをまたいだ D&D も同じルールで解決される。

### ストック

- セル → ストック (`addToStock`): サブツリー全体をスナップショット化
  - 周辺セルの場合: そのセルの子グリッド群
  - 中央セルの場合: 所属グリッド自体 (8 周辺セル + 子孫)
- ストック → セル (`pasteFromStock`): **空セルのみ受け入れ** (入れ替えは行わない)。スナップショットの内容 + 子グリッドを再帰挿入。ストックアイテムは消費されない

### クリップボード (カット / コピー / ペースト)

- [`clipboardStore`](desktop/src/store/clipboardStore.ts) は `{ mode, sourceCellId }` のみ保持 (スナップショットは持たない)
- ⌘X / ⌘C / ⌘V は **hover しているセル** に対して動作 (`document.elementFromPoint` で特定)
- `INPUT` / `TEXTAREA` にフォーカスがあるときはブラウザ標準に譲る
- Cut + paste は `copyCellSubtree` 後に source を空化 + 子グリッドを論理削除

### 空データの非保存ルール

- 新規マンダラート: 初回入力までは UI 上の「下書き」扱い
- **グリッドは「中心セルが空」= 存在しないものとして扱う**。離脱時 (並列切替 / パンくず / ホーム / ドリルアップ) に `cleanupGridIfCenterEmpty` が走り soft-delete する
- cleanup は「このグリッドが最後の子グリッドだったら親セルも連動クリア」まで面倒を見る。これをやらないと「サブグリッドの中心を空にしたのに、戻ったら親セルで元の内容が復活してる」という UX になる
- `handleBreadcrumbNavigate` は `popBreadcrumbTo` **より前** に cleanup を完了させる。逆順だと `useGrid` の再フェッチが先に走って古い親セル値で `gridData` が確定してちらつく
- ルートグリッドが空になった → マンダラート全体を自動削除 (唯一のルートの場合)
- 空のままホームに戻る → 削除してダッシュボードへ (タイトルダイアログは**廃止済み**)

### 並列グリッド

- **UI**: 3×3 / 9×9 グリッドの左右に `<` / `>` / `+` のインライン SVG ボタン (以前の上部 `ParallelNav` と下部「+ 新しいグリッドを追加」は廃止済み)
  - `<` は `parallelIndex > 0` のときだけ表示
  - 右側は「次があれば `>`、末尾かつ中心セル入力ありなら `+`、末尾かつ中心空なら非表示」の三択
- **新規並列作成 (`+`)**: `handleAddParallel` が `createGrid` → 元グリッドの中心セル内容を新グリッドの中心セルに自動コピー → parallelGrids に追加 → orbit ではなく **slide アニメーション** で横方向に切替
- **並列切替 (`<` / `>`)**: `handleParallelNav` が次の grid を `getGrid` して slide アニメーションを再生。完了後に旧グリッドを `cleanupGridIfCenterEmpty` してから `parallelGrids` / `parallelIndex` を再計算
- **breadcrumb 末尾 gridId の追従**: `updateBreadcrumbItem` で並列切替や新規追加のたびに末尾エントリの gridId を現在地に合わせる。これがないと breadcrumb のラベル同期 useEffect が正しい grid を watch できない
- **breadcrumb 経由の戻り**: `handleBreadcrumbNavigate` は target 階層の兄弟 (`getChildGrids` / `getRootGrids`) を再取得して `parallelGrids` / `parallelIndex` をリセットする。これをやらないと下位の parallelGrids が残って「上位階層なのに存在しないはずの `<` `>` ボタンが出る」バグになる

### マンダラート管理

- **タイトル = ルート中心セルのキャッシュ**: `updateCell` が position=4 かつルートグリッドのセルを更新した際に `mandalarts.title` を同じテキストで自動更新。別途「ファイル名を付けて保存」するフローは無い
- **画像フォールバック**: `getMandalarts` / `searchMandalarts` は相関サブクエリでルート中心セルの `image_path` を一緒に取得する。テキストが空のときは **ダッシュボードカードとパンくずリスト末尾のラベル** を画像サムネイルに置き換えて表示
- **ダッシュボードカード**: 130×130 の正方形タイル、ルート中心セルのテキストを 14px / `line-clamp-6` で左寄せ・上詰め表示。外枠は黒 2px。hover で右上に複製・削除ボタン、下部に更新日。タイトル空で画像のみのときはカード全面に画像
- **検索**: タイトルとセル本文を横断する全文検索 (`searchMandalarts`)、200ms debounce
- **複製**: 全グリッド / セルを再帰コピー。タイトルにサフィックス (「〜 のコピー」等) は付けない
- **ゴミ箱**: `deleted_at` によるソフトデリート。ダッシュボードの「ゴミ箱」ボタンから `TrashDialog` を開いて復元 / 完全削除
  - **完全削除の 2 クリック確認**: Tauri v2 の WebView は `window.confirm` が動かないので、ブラウザ標準ダイアログではなく「1 回目のクリックでボタン表記を『本当に削除?』に切替、2 回目で実行、4 秒放置で自動リセット」という state ベース UI に実装 ([`TrashDialog.tsx`](desktop/src/components/dashboard/TrashDialog.tsx))
  - **完全削除は local + cloud 両方を消す**: `permanentDeleteMandalart` は local SQLite から `DELETE` した後、サインイン中であれば Supabase 側も `cells → grids → mandalarts` の順で `delete().eq('...')` で消す。これをやらないと「local で完全削除 → 次回 pull で cloud の `deleted_at` 行が再挿入 → ゴミ箱に復活」というバグになる。ネットワーク断 / RLS エラーで cloud delete が失敗した場合は warn ログのみで非致命 (local は既に消えているので UI 上はゴミ箱から消える)

### 文字サイズ

- `editorStore.fontLevel` (-10 〜 +20 の整数)、実効倍率は `1.1^level` の乗算式
- エディタのヘッダで `A− / 現在の % / A＋` ボタンで 1 段ずつ調整
- 設定は localStorage (`mandalart.fontLevel`) に永続化
- 3×3 のベース 28px、9×9 small のベース `28 / 3 ≒ 9.33px` (3×3 と同じテキストが同じ行数で読めるよう 1/3 に縮小)。`Cell` が `fontScale` プロップで適用

### フォントウェイト

- デフォルトは [`index.css`](desktop/src/index.css) で `html { font-weight: 300 }` (Light) に固定
- 明示的な Tailwind クラス (`font-medium` / `font-semibold` / `font-bold`) を指定した箇所だけ太字化
- 中心セルは周辺セルと同じ 300。強調しないデザイン方針
- 詳細は [`typography.md`](desktop/docs/typography.md)

### セルのビジュアル

- **3×3 表示**: 中心 = `border-[6px] border-black`、周辺 (子グリッドあり) = `border-2 border-black`、周辺 (子なし) = `border border-gray-300`
- **「子グリッドあり」の判定**: `childCount > 0` で決まる。ただし「子グリッドが存在する」ではなく「子グリッドの**周辺セルに入力がある**」= `fetchChildCountsFor` が SQL で `position != 4 AND (text != '' OR image_path IS NOT NULL)` で絞って `COUNT(DISTINCT grid_id)` を返す仕様。ドリル直後にセンターだけ自動コピーされたサブグリッドは「意味なし」扱いで border は 1px グレーのままになる
- **9×9 表示**: サブグリッドラッパーが `gap-px bg-gray-300` で「セル同士が共有する 1 本の境界線」を描画 (cells 側は border を持たない)。サブグリッドラッパー側の外枠は中央 = `border-[6px] black`、既存 = `border-2 black`、空 = `border-2 gray-300`
- **9×9 中心セル**: `border-2 border-black -m-px z-10` で gap-px を跨いで黒枠を描画
- **画像優先**: セルに画像と文字が両方入っている場合、確定表示では **画像のみ** を表示 (`absolute inset-0 object-cover`)。テキストはインライン編集 / 拡大エディタのときだけ見える
- **テキスト配置**: 左寄せ・上詰め。セル外縁からテキストまでの「見える余白」は 3×3 で 18px、9×9 で 6px に固定。border 幅が異なる (1〜6px) のに対応するため [`Cell.tsx`](desktop/src/components/editor/Cell.tsx) が `absolute` の inset をインラインスタイルで動的補正する (`textInsetPx = targetPadPx - borderPx`)
- **外周グリッドの背景**: `GridView3x3` は透明 (外側の灰色ラッパーを撤去済み)、`GridView9x9` の各サブグリッドは `bg-gray-300 dark:bg-gray-600` (gap-px を縫う用)
- **インラインエディタの拡大**: インライン編集中にテキストエリアをダブルクリックすると、`position: fixed` でサブグリッド全体 (3×3 コンテナ) を覆う拡大エディタが開く。下部に色選択・画像アップロードのツールバーが付き、`onMouseDown={e => e.preventDefault()}` で textarea の blur を防止。従来あった `⋯` 詳細編集モーダルは廃止済み

### ダークモード

- Tailwind v4 の `@custom-variant dark (&:where(.dark, .dark *))` でクラスベース
- `themeStore` が `preference: 'light' | 'dark' | 'system'` を保持 (localStorage)
- `useTheme` が `<html>.dark` の付け外しと `prefers-color-scheme` の監視を担当
- ヘッダの `ThemeToggle` (☀ ◐ ☾) で切り替え

### アニメーション

エディタで 3 種類の CSS-only アニメーションを再生する (React state flip + `transition` は WebKit でタイミングが不安定なので、基本は `@keyframes` + `animation-fill-mode: both` に統一。per-cell で translate 量が異なる `to-3x3` のみ例外的に double rAF + transition を使う):

1. **Slide** (並列グリッド切替): `fromCells` と `toCells` を横並びにした 200% 幅コンテナを `parallel-slide-forward/backward` で `translateX` させる。320ms
2. **Orbit** (ドリルダウン / ドリルアップ / 初回表示): 時計回り順にセル/ブロックが staggered fade-in し、「クリックされた要素だけ」が `orbit-from-{nw/n/ne/w/e/sw/s/se}` の 8 方向 keyframes で natural 位置へドリフトする。約 1000〜1080ms
   - drill-down: `[7, 6, 3, 0, 1, 2, 5, 8]` + 中心は移動要素 (クリック位置 → 中心)
   - drill-up:   `[7, 6, 3, 0, 1, 2, 5, 8, 4]` + 親 (中心 → 自然位置) が natural timing でドリフト
   - initial:    `[4, 7, 6, 3, 0, 1, 2, 5, 8]` (中心から周辺へ時計回り、移動なし)
   - 3×3 表示ではセル単位 (`orbit`)、9×9 表示ではサブグリッドブロック単位 (`orbit9`) で同じ演出を再生する
3. **View Switch** (3×3 ↔ 9×9 表示モード切替):
   - `to-9x9` (約 1195ms): 中央の 3×3 を `view-shrink-to-center` (scale 1 → 1/3) で縮小しつつ、周辺 8 ブロックを時計回り stagger fade-in。400ms 時点で source (縮小 3×3) → target (通常 9×9 render と同一構造の中央ブロック) にクロスフェードして swap の pop を消す
   - `to-3x3` (約 1080ms): 中央ブロックの 9 セルを `transform: translate(tx,ty) scale(1/3) → translate(0,0) scale(1)` で時計回り `[7,6,3,0,1,2,5,8,4]` に拡大展開、周辺 8 ブロックは fade-out。per-cell で tx/ty が違うので CSS 変数方式を避け、React state flip + double rAF + inline transform/transition を使用

詳細な仕組みとハマりポイントは [`animations.md`](desktop/docs/animations.md) 参照。主要な落とし穴:
- `@keyframes` 内で `transform: var(--x)` は WebKit で補間されない → 固定 keyframes 8 方向で対応
- drill-up で親が root の場合は `parent.cellId === null` で movingCell が null になる → `currentEntry.cellId` を使う必要あり
- orbit / orbit9 終了時は `childCounts` (と `subGrids`) を pre-populate してから `setOrbit(null)` にしないと border 幅が一瞬ズレてちらつく
- `ResizeObserver` の `gridSize` 更新は `Math.floor` + 4px 未満を無視して微振動を吸収する
- `to-9x9` は scaled 3×3 と実 9×9 中央ブロックで textInset / cell 幅 / gap に微差があるため、単純 swap だと「テキストが一段階内側に収縮」する pop が起きる → クロスフェードで解決
- `to-3x3` のセルは Cell の `wrapperStyle` prop 経由で transform を適用する。余分な `<div>` で囲むと Cell が grid item ではなくなり高さ 0 に潰れる

---

## Tauri / SQLite のハマりポイント

### Tauri WebKit の HTML5 DnD が動かない

ドロップイベントがサイレントに落ちる。**セル D&D は `mousedown` / `mousemove` / `mouseup` + `document.elementFromPoint` で自前実装** ([`useDragAndDrop.ts`](desktop/src/hooks/useDragAndDrop.ts))。`data-cell-id` / `data-stock-drop` 属性でドロップ先を判定する。HTML5 の `draggable` / `onDragStart` は使わないこと。

画像ファイルのネイティブドロップは `onDragDropEvent` (Tauri 側の API) + [`storage.ts`](desktop/src/lib/api/storage.ts) で処理し、AppData 配下の `images/` にコピーして `image_path` として保存する。

### SQLite の FK 制約を張らない設計

本来の DB スキーマには `grids.mandalart_id` / `grids.parent_cell_id` / `cells.grid_id` の FK が欲しい所だが、

1. `grids.parent_cell_id → cells` と `cells.grid_id → grids` の組み合わせが**循環カスケード**を作り、削除時に "too many levels of trigger recursion" になる
2. `tauri-plugin-sql` (sqlx) のコネクションプールは `PRAGMA foreign_keys` / トランザクションが接続ごとに独立するので、`BEGIN / COMMIT / defer_foreign_keys` をかけても効かないことがある

そのためローカルスキーマでは FK 制約を一切張らず、カスケード削除は API 層で明示的に行う (`deleteMandalart` が cells → grids → mandalarts の順に UPDATE、`pasteCell` cut モードが `deleteGrid` を再帰呼び出し、等々)。

### WAL モード必須

`getDb()` で `PRAGMA journal_mode = WAL` + `PRAGMA busy_timeout = 5000` を初回接続時に設定している。これが無いと、pull が書き込み中にダッシュボードの読み取りが走ると "database is locked" (SQLITE_BUSY) になる。

### ソフトデリートと同期

- 削除系 API (`deleteMandalart` / `deleteGrid`) は実際の `DELETE` ではなく `UPDATE deleted_at = ?, updated_at = ?` を行う
- 全 `SELECT` に `WHERE deleted_at IS NULL` フィルタが付いている
- `pushAll` / `pullAll` は `deleted_at` カラムも含めて upsert するので、**オフラインで削除してもオンライン復帰時に別デバイスへ伝播する**
- ゴミ箱 UI (`TrashDialog`) で `deleted_at IS NOT NULL` の行を一覧表示し、復元 (null に戻す) か物理削除ができる
- 物理削除 (`permanentDeleteMandalart`) は **local と cloud の両方を消す**。cloud を残すと次回 pull で復活する (上の「マンダラート管理 / 完全削除」参照)

### Supabase Realtime のハマりポイント

[`lib/realtime.ts`](desktop/src/lib/realtime.ts) で 3 テーブル (`mandalarts` / `grids` / `cells`) を個別に購読しているが、実運用で 2 つ落とし穴があった:

1. **`table` フィルターが discriminator として効かない場合がある**: `postgres_changes` を `{ table: 'mandalarts' }` で購読していても、`cells` への変更イベントが混線して `mandalarts` のハンドラに届くことがある。各ハンドラ冒頭で `if (payload.table !== 'mandalarts') return` のようにガードしないと、cells ペイロードを mandalarts 行として INSERT しようとして NOT NULL 制約違反になる
2. **DELETE は個別テーブルごとにしかイベントが来ない + cloud に未 push の子行はイベントが発行されない**: cloud 側は FK CASCADE で自動連鎖削除するが、realtime 経由で local に届くのは DELETE されたテーブルの行のみ。ローカルに「cloud にまだ push されていない子 grids / cells」があると、親の DELETE イベントだけでは孤立して残る。各 DELETE ハンドラで `DELETE FROM cells WHERE grid_id IN (...)` のように子孫まで明示的にカスケードする必要がある

これらを怠ると「push 時に RLS 拒否で同期エラー」「mandalarts.title NOT NULL 制約違反」といった症状が出る。

### Supabase 側のスキーマ修正が必要

- `grids.parent_cell_id` に ON DELETE CASCADE が残っていると同じ循環カスケード問題が起きる → `ALTER TABLE grids DROP CONSTRAINT grids_parent_cell_id_fkey` が必須
- ソフトデリート対応には `ALTER TABLE ... ADD COLUMN deleted_at timestamptz` を 3 テーブル分実行する必要がある
- 詳細は [`desktop/docs/cloud-sync-setup.md`](desktop/docs/cloud-sync-setup.md) 参照

### 環境変数 (Supabase)

- ローカル開発: `desktop/.env` (gitignore 済み) に `VITE_SUPABASE_URL` と `VITE_SUPABASE_ANON_KEY` を置く
- CI / リリースビルド: GitHub Secrets の同名 2 つを `.github/workflows/release.yml` が env に渡す
- env が欠損していると `supabase.createClient` が URL パースで throw してモジュール読み込み時にクラッシュ (= 白画面) するので、`lib/supabase/client.ts` がフォールバック URL で初期化し、`isSupabaseConfigured` フラグで auth / sync の bootstrap を gate する

---

## ドキュメント

アプリ仕様と運用ドキュメントは [`desktop/docs/`](desktop/docs/):

| ファイル | 内容 |
|---|---|
| [`requirements.md`](desktop/docs/requirements.md) | 機能要件・UX ルール・セル操作・D&D・検索・インポート/エクスポート |
| [`data-model.md`](desktop/docs/data-model.md) | ローカル SQLite スキーマ・マイグレーション履歴・同期対応の列 |
| [`api-spec.md`](desktop/docs/api-spec.md) | `lib/api/` / `lib/sync/` / `lib/realtime.ts` の関数シグネチャ |
| [`folder-structure.md`](desktop/docs/folder-structure.md) | ディレクトリツリーと設計上の分離方針 |
| [`typography.md`](desktop/docs/typography.md) | フォント (OS システムフォント使用)・ウェイト・文字サイズ・変更方法 |
| [`animations.md`](desktop/docs/animations.md) | 並列スライド・ドリル軌道 (orbit) アニメーションの仕様・実装・ハマりポイント |
| [`tasks.md`](desktop/docs/tasks.md) | フェーズ別のタスクチェックリスト (進捗の単一情報源) |
| [`cloud-sync-setup.md`](desktop/docs/cloud-sync-setup.md) | Supabase プロジェクトの手動セットアップとトラブルシューティング |
| [`updater-setup.md`](desktop/docs/updater-setup.md) | 自動アップデート用の署名鍵・GitHub Secrets・リリースフロー |
