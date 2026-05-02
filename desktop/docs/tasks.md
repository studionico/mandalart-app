# 開発タスク一覧 — マンダラート デスクトップアプリ

凡例: ✅ 完了 / 🔄 部分実装 / ⬜ 未実装

---

## フェーズ 1: プロジェクトセットアップ ✅

- [x] Tauri v2 + Vite + React プロジェクト作成（`create-tauri-app`）
- [x] Tailwind CSS セットアップ（`@tailwindcss/vite` プラグイン）
- [x] `@/` パスエイリアス設定（vite.config.ts + tsconfig.json）
- [x] Zustand・html2canvas・jsPDF インストール
- [x] `src/types/index.ts` 作成
- [x] `src/constants/colors.ts` 作成（プリセットカラー定義）
- [x] `src/constants/tabOrder.ts` 作成（Tab 移動順: 4→7→6→3→0→1→2→5→8）
- [x] React Router v6（HashRouter）セットアップ
- [x] ルーティング設定（/ → /dashboard → /mandalart/:id）

---

## フェーズ 2: SQLite セットアップ ✅

- [x] `tauri-plugin-sql`（sqlite feature）を Cargo.toml に追加
- [x] `src-tauri/migrations/001_initial.sql` 作成（全テーブル定義）
- [x] `lib.rs` でマイグレーション自動適用を設定
- [x] `capabilities/default.json` に `sql:default` / `sql:allow-execute` を追加
- [x] `src/lib/db/index.ts` 実装（query / execute / generateId / now）

---

## フェーズ 3: データアクセス層 ✅

- [x] `src/lib/api/mandalarts.ts`（getMandalarts / getMandalart / createMandalart / updateMandalartTitle / deleteMandalart / searchMandalarts）
- [x] `src/lib/api/grids.ts`（getRootGrids / getChildGrids / getGrid / createGrid / updateGridMemo / deleteGrid / updateGridSortOrder）
- [x] `src/lib/api/cells.ts`（updateCell / swapCellContent / swapCellSubtree / copyCellSubtree）
- [x] `src/lib/api/stock.ts`（getStockItems / addToStock / deleteStockItem / pasteFromStock）
- [x] `src/lib/api/storage.ts`（uploadCellImage / getCellImageUrl / deleteCellImage — 暫定実装）
- [x] `src/lib/api/transfer.ts`（exportToJSON / exportToMarkdown / exportToIndentText / importFromJSON / importIntoCell）
- [x] `src/lib/api/auth.ts`（スタブ — ローカルモードのみ）
- [x] `src/lib/realtime.ts`（スタブ）
- [x] `src/lib/offline.ts`（スタブ）

---

## フェーズ 4: ユーティリティ ✅

- [x] `src/lib/utils/grid.ts`（isCellEmpty / hasPeripheralContent / getCenterCell）
- [x] `src/lib/utils/dnd.ts`（D&D ルール判定）
- [x] `src/lib/utils/export.ts`（exportAsPNG / exportAsPDF / downloadJSON / downloadText）
- [x] `src/lib/import-parser.ts`（テキスト → GridSnapshot パーサー）

---

## フェーズ 5: Zustand ストア ✅

- [x] `src/store/editorStore.ts`（currentGridId / viewMode / breadcrumb）
- [x] `src/store/undoStore.ts`（操作履歴スタック）
- [x] `src/store/clipboardStore.ts`（カット/コピー状態）

---

## フェーズ 6: React フック ✅

- [x] `src/hooks/useGrid.ts`（グリッド + セルデータ取得・更新）
- [x] `src/hooks/useSubGrids.ts`（9×9 表示用サブグリッド一括取得）
- [x] `src/hooks/useDragAndDrop.ts`（D&D ハンドラー）
- [x] `src/hooks/useUndo.ts`（Undo/Redo 操作）
- [x] `src/hooks/useRealtime.ts`（スタブ）
- [x] `src/hooks/useOffline.ts`（スタブ）

---

## フェーズ 7: UI コンポーネント ✅

- [x] `src/components/ui/Button.tsx`
- [x] `src/components/ui/Modal.tsx`
- [x] `src/components/ui/BottomSheet.tsx`
- [x] `src/components/ui/Toast.tsx`

---

## フェーズ 8: ダッシュボード ✅

- [x] `DashboardPage.tsx` 実装（マンダラート一覧・作成・削除・リネーム）
- [x] ミニプレビューカード表示
- [x] 複製機能（`duplicateMandalart` — 全グリッド・セルを再帰的に複製）
- [x] タイトル検索（クライアント側フィルタ）
- [x] ソート（更新日順 / タイトル順）

---

## フェーズ 9: エディタ基盤 ✅

- [x] `EditorLayout.tsx` 実装（全体レイアウト・状態管理）
- [x] `EditorPage.tsx` 実装（useParams → EditorLayout）
- [x] `GridView3x3.tsx` 実装
- [x] `GridView9x9.tsx` 実装
- [x] グリッド表示サイズの最大化（ResizeObserver で正方形維持）
- [x] 表示モード切替トグル（3×3 / 9×9）
- [x] `Cell.tsx` 実装（テキスト・画像・色・子グリッドインジケーター）

---

## フェーズ 10: パンくずリスト ✅

- [x] `Breadcrumb.tsx` 実装
- [x] 階層パス表示（ミニプレビュー付き）
- [x] 「ホーム」ボタンで `handleNavigateHome` を呼び出す
- [x] パンくずアイテムクリックで `popBreadcrumbTo` で階層移動

---

## フェーズ 11: セル編集 ✅

- [x] `CellEditModal.tsx` 実装
- [x] テキスト入力エリア
- [x] 画像アップロード（暫定: DataURL）
- [x] プリセットカラー選択
- [x] Esc / 外側クリック → 保存して閉じる
- [x] キャンセルボタン → 破棄して閉じる
- [x] Tab キーによるセル間移動（IME 変換中は無視）
- [x] Shift+Tab で逆順移動

---

## フェーズ 12: 階層ナビゲーション ✅

- [x] 周辺セル（入力あり）シングルクリック → サブグリッドへ掘り下げ
- [x] 周辺セル（入力あり・子グリッドなし）シングルクリック → 新しいサブグリッドを作成して掘り下げ
- [x] 空の周辺セルシングルクリック → 編集モードへフォールバック
- [x] ルートグリッドの中央セル（入力あり）シングルクリック → ホームへ
- [x] ルートグリッドの中央セル（空）シングルクリック → 編集モード
- [x] サブグリッドの中央セルシングルクリック → 親グリッドへ戻る

---

## フェーズ 13: ホームへの遷移 ✅

- [x] タイトル未設定かつ内容あり → タイトル設定ダイアログを表示
- [x] タイトル設定済み → 直接ダッシュボードへ
- [x] 全セルが空 → マンダラートを削除してダッシュボードへ
- [x] ダイアログ「キャンセル」→ エディタに留まる

---

## フェーズ 14: バリデーション ✅

- [x] 中央セルが空のとき周辺セルを非活性化
- [x] 周辺セルに入力があれば中央セルをクリアできない（エラートースト表示）

---

## フェーズ 15: 並列ナビゲーション ✅

- [x] `ParallelNav.tsx` 実装（← → ボタン）
- [x] 並列グリッドが1つのみの場合は非表示
- [x] 「+ 新しいグリッドを追加」ボタン

---

## フェーズ 16: ドラッグ＆ドロップ ✅

- [x] D&D ルール判定ロジック（`lib/utils/dnd.ts`）
- [x] `useDragAndDrop.ts` 実装（mousedown/mousemove/mouseup + elementFromPoint）
- [x] 周辺 ↔ 周辺: サブツリーごと入れ替え
- [x] 中央 → 入力ある周辺: 内容のみ入れ替え
- [x] 中央 → 空の周辺: サブツリーコピー
- [x] ドラッグ中のドロップ可能セルのハイライト表示（`isDragOver` リング表示）
- [x] 9×9 表示でのサブグリッドをまたいだ D&D（dndCells で平坦化）

---

## フェーズ 17: カット＆ペースト ✅

- [x] 右クリックコンテキストメニュー（カット / コピー / ペースト / ストックに追加）
- [x] カット後のセルをグレーアウト表示（clipboardStore）
- [x] ⌘X / ⌘C / ⌘V キーボードショートカット実装（hover セル検出）
- [x] ペースト操作の完全実装（`pasteCell` — サブツリーコピー + cut モードで source クリア）

---

## フェーズ 18: ストックエリア ✅

- [x] `StockTab.tsx` 実装
- [x] `SidePanel.tsx` 実装（メモ / ストックのタブ切替）
- [x] セル → ストックへのコピー（コンテキストメニュー「ストックに追加」）
- [x] セル → ストックへの D&D（data-stock-drop ドロップゾーン）
- [x] ドラッグ開始時にストックタブへ自動切替
- [x] ストックアイテムの削除
- [x] ストックアイテム → セルへのドロップ（スナップショットの内容 + サブツリーを target に適用）
- [x] `addToStock` / `pasteFromStock` でサブツリーを再帰的に保存・復元

---

## フェーズ 19: メモ欄 ✅

- [x] `MemoTab.tsx` 実装
- [x] Markdown エディタ（編集 / プレビュー切替）
- [x] 自動保存（800ms debounce via `useEffect` + `setTimeout`）

---

## フェーズ 20: Undo / Redo ✅

- [x] `undoStore.ts` / `useUndo.ts` 実装
- [x] セル編集の Undo/Redo 登録
- [x] ⌘Z / ⌘Y（Ctrl+Z / Ctrl+Y）キーボードショートカット実装
- [x] D&D 操作の Undo 対応
  - SWAP_SUBTREE / SWAP_CONTENT は対称操作（undo = redo = 同じ呼び出し）
  - COPY_SUBTREE は target の事前状態 + 新規 grid ID を記録し、undo で復元

---

## フェーズ 21: エクスポート ✅

- [x] PNG エクスポート（html2canvas）
- [x] PDF エクスポート（jsPDF）
- [x] JSON エクスポート
- [x] Markdown エクスポート (インポートと対称、round-trip 可能)
- [x] インデントテキストエクスポート (インポートと対称、round-trip 可能)
- [x] エクスポートメニュー UI
- 旧 CSV エクスポートは廃止 (フラット構造でインポートと非対称だったため)

---

## フェーズ 22: インポート ✅

- [x] `importFromJSON` / `importIntoCell` 実装
- [x] `parseTextToSnapshot`（インデントテキスト / Markdown 解析）
- [x] インポート UI フロー実装（`ImportDialog.tsx`）
  - [x] ① 入力：ファイル選択 / クリップボード貼付 / テキスト直接入力
  - [x] ② 自動フォーマット判定（JSON / Markdown / インデントテキスト）
  - [x] ③ ツリープレビュー表示
  - [x] ④ インポート先：新規マンダラート（ダッシュボード）/ 既存セル配下（エディタ右クリック「ここにインポート」）

---

## フェーズ 23: デスクトップ固有機能 ✅

- [x] グローバルショートカット: `Cmd/Ctrl+Shift+M` でウィンドウ表示/非表示
  - `useGlobalShortcut` hook + `tauri-plugin-global-shortcut`
- [x] 画像ファイル D&D: セルへのファイルドロップ → `$APPDATA/images/` に保存
  - `tauri-plugin-fs` 導入、`storage.ts` を blob URL ベースの本実装に置き換え
  - `onDragDropEvent` + `elementFromPoint` で drop 先セルを特定
  - 階層掘り下げ時に親セルの画像 / 色も子グリッド中心セルへ自動コピー
- [x] 自動アップデート: GitHub Releases からチェック・適用（**エンドツーエンド動作確認済み**）
  - `tauri-plugin-updater` / `tauri-plugin-process` 有効化
  - `useAppUpdate` hook + `UpdateDialog` (起動時チェック・進捗表示・再起動)
  - `.github/workflows/release.yml` (tauri-action@v0.6.2, Apple Silicon / Intel / Linux / Windows マトリクス)
  - 署名鍵生成 → GitHub Secrets 登録 → タグ push → 自動ビルド → 自動アップデート完了
  - セットアップ手順とトラブルシューティングは [`docs/updater-setup.md`](./updater-setup.md) を参照

---

## フェーズ 24: ダッシュボード補完 ✅

- [x] マンダラート複製機能（`duplicateMandalart`）
- [x] タイトル検索
- [x] 更新日 / タイトル ソート切替

---

## フェーズ 25: クラウド同期 ✅

- [x] Supabase Auth 連携（メール + Google + GitHub OAuth）
  - PKCE フロー、`tauri-plugin-deep-link` で `mandalart://auth/callback` を受け取り `exchangeCodeForSession`
  - `useAuthBootstrap` hook で起動時セッション復元 + `onAuthStateChange` 購読
  - `AuthDialog` (signin / signup / OAuth ボタン)、`authStore` (Zustand)
- [x] `src/lib/sync/push.ts`（ローカル → Supabase upsert）
  - `synced_at IS NULL OR synced_at < updated_at` で dirty 判定
- [x] `src/lib/sync/pull.ts`（Supabase → ローカル upsert）
  - 行ごとに `updated_at` を比較し、クラウドが新しければローカルを上書き
- [x] 競合解決（updated_at last-write-wins）
- [x] 同期タイミング: サインイン時に初回フル同期、`useSync` の手動 sync ボタン、Realtime push 受信時
- [x] `src/lib/realtime.ts` の本実装（postgres_changes 全テーブル購読、ローカル DB に反映）
- [x] UI 統合: ダッシュボードヘッダーにサインイン / サインアウト / 同期ステータスインジケータ
- [x] ソフトデリート実装（`deleted_at` カラム + API 層フィルタ + sync 層 upsert）
  - ローカル migration 002 で列追加、クラウド側は `ALTER TABLE ADD COLUMN deleted_at timestamptz` を手動実行
  - オフライン削除 → 次回同期で cloud に伝播、別デバイス pull で自動的に不可視化
- 既知の制限: user_id バインディングは単一ユーザー前提
- セットアップ手順とトラブルシューティングは [`docs/cloud-sync-setup.md`](./cloud-sync-setup.md) 参照

---

## フェーズ 26: ビルド・配布 ✅

- [x] GitHub Actions ワークフロー作成 (`.github/workflows/release.yml`)
  - macOS: `.dmg` (Apple Silicon + Intel)
  - Windows: `.msi` / `.exe`
  - Linux: `.AppImage` / `.deb` / `.rpm`
- [x] GitHub Releases への自動アップロード (tauri-action)
- [x] updater エンドポイント (`latest.json`) を GitHub Releases に設定
- [ ] **コードサイニング（macOS / Windows）** — 有料証明書が必要、将来対応
  - macOS: Apple Developer Program ($99/年)
  - Windows: EV コードサイニング証明書 ($200-400/年)
  - 現状は未署名配布。macOS は `xattr -cr`、Windows は SmartScreen「詳細情報 → 実行」で起動可能

---

## バグ・改善TODO

- [x] `swapCellSubtree` の一時 UUID を廃止（child grid ID を事前取得する方式に変更）
- [x] 画像アップロードの本実装（`tauri-plugin-fs` + `$APPDATA/images/`、フェーズ23 で完了）
- [ ] `try/catch` エラーハンドリングを各 API 関数に追加
- [ ] `handleCreate` の try/catch を保持（エラー表示用）

---

## 全フェーズ完了

26 フェーズの MVP スコープはすべて実装・動作確認済み。未対応は有料証明書が必要なコードサイニングのみ。

---

## フェーズ 27: MVP 後の磨き込み ✅

MVP 完了後に、実際の使用感から出てきた要望を順次対応。

### 27.1 ゴミ箱 / 復元 UI ✅
- ソフトデリート基盤を活用
- `getDeletedMandalarts` / `restoreMandalart` / `permanentDeleteMandalart` を追加
- `TrashDialog` コンポーネント (削除日時付きリスト、復元ボタン、完全削除ボタン)
- ダッシュボードヘッダに「ゴミ箱」ボタン

### 27.2 全文検索 ✅
- `searchMandalarts` を拡張 — タイトルに加えてセル本文も検索対象に
- `LEFT JOIN grids + cells` で横断検索、LIKE の `%` / `_` / `\` をエスケープ
- ダッシュボードはクライアントフィルタ → サーバーサイド検索 (200ms debounce) に変更

### 27.3 ダークモード ✅
- Tailwind v4 の `@custom-variant dark` でクラスベース実装
- `themeStore` (Zustand、localStorage 永続化) と `useTheme` hook
- `ThemeToggle` コンポーネント (☀ ◐ ☾ セグメント) をダッシュボード + エディタヘッダに配置
- Modal / Button / DashboardPage / EditorLayout / Cell / GridView / SidePanel / Breadcrumb に `dark:` variant を追加

### 27.4 インライン編集 + フォントサイズ ✅
- セルを単一クリックで編集 (textarea 表示) できるように
- 詳細編集は右上の `⋯` ボタンから `CellEditModal` を起動
- フォントサイズ: `fontLevel` (-10 〜 +20) の乗算式 (`1.1^level`)、ヘッダの `A−` / `%` / `A＋` ボタンで調整
- インライン編集状態は `EditorLayout` の `inlineEditingCellId` で管理、Tab ナビも対応

### 27.5 クリック動作の再検討 ✅
- 最初は「シングル = 編集、ダブル = ドリル」→ 実使用で「シングル = ドリル」が欲しくなった
- 最終的に**空セルはシングル即編集、入力ありはシングル = ドリル + ダブル = 編集**の折衷案を採用
- 空セルは 220ms の遅延なしで即編集開始、入力ありは 220ms 待機でシングル/ダブル判定

### 27.6 インポート機能の仕様修正 ✅
- `GridSnapshot` 型に `parentPosition` を追加
- パーサー書き直し: ルートノードの children が root grid の周辺セルになり、孫はその周辺セルから subgrid として生える
- 9 個以上の子は並列グリッドとして展開
- `importIntoGrid` が `parentPosition` を見て attach 先を特定
- `exportToJSON` も `parentPosition` を記録するので round-trip 対応
- インポート時の配置順は `TAB_ORDER` (中心除く) に従う
- 箇条書き記号 (・ • ◦ - * + 1. 1) など) を自動で剥がす
- `importIntoCell` はターゲットセルの内容もスナップショットのルート中心セルに合わせて上書き

### 27.7 タイトル廃止・ダッシュボードリデザイン ✅
- 「ファイル名を付けて保存」フロー完全廃止 (タイトル設定ダイアログ削除)
- `mandalarts.title` はルート中心セルのキャッシュとして `updateCell` で自動同期される
- ダッシュボードのカードを 130×130 の正方形固定タイルに変更
- 中身はルート中心セルのテキストを 14px / `line-clamp-6` / 中央揃えで表示 (`safe center` で長文時は上揃えフォールバック)
- 3×3 ミニプレビュー削除、リネームボタン削除 (中心セル編集に統一)
- 複製時の「〜 のコピー」サフィックス廃止

### 27.8 0-indexed セルナンバリングに統一 ✅
- 要件定義のセル番号を 1-indexed → 0-indexed (DB の `cells.position` と一致)
- Tab 移動順も 0-indexed 表記: `4 → 7 → 6 → 3 → 0 → 1 → 2 → 5 → 8 → 4`
- インポート配置順も同じ順 (`[7, 6, 3, 0, 1, 2, 5, 8]`)

### 27.9 同期・UX 安定化 ✅
- `push.ts` を per-row upsert + 失敗集約 (1 行失敗でも全体が止まらない)
- `useSync` の realtime 受信を 300ms debounce (自己 push が realtime に戻ってきて reloadKey が連鎖する問題を回避)
- `DashboardPage` のリロードで loading フラグを切り替えず、既存データを保持 (フリッカ解消)
- `loadSeqRef` で race 対策 (古いレスポンスで新しい結果を上書きしない)
- FK 制約撤廃 (migration 001 を FK なし版に書き直し + ローカル DB を再作成)
- `PRAGMA journal_mode = WAL` + `busy_timeout` を `getDb` で設定

---

## フェーズ 28: 開発体制の整備 ✅

MVP 後の開発効率と退行防止を目的に、自動検査・テスト・ドキュメント参照性を整備。

### 28.1 ハードコーディング排除 + 定数化ルール ✅
- `constants/grid.ts` / `timing.ts` / `layout.ts` / `storage.ts` を新設
- 中心 position、orbit 登場順、アニメ timing、レイアウト px、localStorage キーを一元管理
- CSS 側は `--outer-grid-gap` で keyframes 内の 8px を統一
- CLAUDE.md に「コーディング規約 / ハードコーディング禁止」セクションを追加

### 28.2 自動検査 (lint / test / CI) ✅
- **ESLint v9 flat config** (`eslint.config.js`): `@eslint/js` + `typescript-eslint` + `eslint-plugin-react-hooks` (v7) + `eslint-plugin-react-refresh`
  - react-hooks v7 の新ルール (`set-state-in-effect` / `refs` / `set-state-in-render`) は warn に留めている
- **husky v9 + lint-staged**: `desktop/.husky/pre-commit` が commit 時に lint-staged + typecheck を実行
- **Vitest**: `vitest.config.ts` (node env)、ピュア関数の unit test 4 本 (dnd / grid / tabOrder / import-parser)
- **CI** (`.github/workflows/ci.yml`): push / PR で typecheck → lint → test → vite build

### 28.3 docs 参照性の強化 ✅
- CLAUDE.md 冒頭に「タスク逆引き index」(何を触る時にどの docs を読むか)
- CLAUDE.md に「タスクタイプ別チェックリスト」(アニメ / 新 API / 定数追加 / スキーマ変更 / 同期)
- CLAUDE.md に「ローカル検査 / CI」節 (各コマンドと発火タイミングの表)

### 28.4 ウインドウ状態の永続化 ✅
- `tauri-plugin-window-state` を導入、終了時のウインドウサイズ・位置・最大化状態を
  AppConfig (`~/Library/Application Support/jp.mandalart.app/window-state.json`) に保存し、
  起動時に復元

### 28.5 ダッシュボード入口の 3×3 統一 ✅
- `openMandalart(id)` ヘルパーで `setViewMode('3x3')` → `navigate`
- 新規作成 / カードクリック / インポート完了の 3 経路を統一

### 28.6 X=C 統一リファクタ (migration 004) ✅
- 背景: drill 元の周辺セル X と子グリッドの中心セル C が別々の cells 行だったため、
  seedCellWithDone / breadcrumb 中心同期 useEffect / 並列追加時の中心コピーなど、
  手動同期コードが散らばっていた。並列グリッドの中心を DB レベルで強制共有できず、
  done cascade のジグザグも複雑だった。
- **`grids.parent_cell_id` を `grids.center_cell_id TEXT NOT NULL` に置換**し、各グリッドが
  自身の中心セルを直接参照する構造に変更。子グリッドには自身の position=4 cell 行を持たず、
  親グリッドの drill 元 cell を再利用する。
- **`mandalarts.root_cell_id TEXT NOT NULL` を追加**し、並列ルートグリッド群で中心セルを共有。
- 既存データは破棄可能な状態 (未公開) だったため、migration 004 は全テーブル DROP & CREATE で実装。
  Supabase 側も `grids.parent_cell_id DROP` + `center_cell_id ADD` + `mandalarts.root_cell_id ADD` を
  手動 DDL で適用 ([`cloud-sync-setup.md`](./cloud-sync-setup.md))。
- API 層の一般化:
  - `createGrid({ centerCellId: null })` = root 作成 (9 cells)、`{ centerCellId: <id> }` = 子/並列 (8 cells)
  - `getGrid` は子グリッドの場合、親の center cell を `position=CENTER_POSITION` で merge して常に 9 要素返す
    (位置上書きしないと UI や handleCellDrill の center 判定が破綻する)
  - `markSubtreeDone` / `areDescendantsAllDone` / `getParentCellInTree` を「grids.center_cell_id を辿る」
    一般化ループに単純化 (旧モデルの「中心/周辺 二分岐」は廃止)
  - `seedCellWithDone` / `copyGridRecursive` の特殊分岐を削除
- UI 層: `handleAddParallel` の中心コピー削除、`handleCellDrill` の drill-up 判定を
  `cell.id === gridData.center_cell_id` に変更、9×9 モードで周辺サブブロック周辺クリックを
  2 段 drill-down に、9×9 モードを読み取り専用 (入力一切禁止) に変更。
- Cleanup: `cleanupGridIfCenterEmpty` → `cleanupGridIfEmpty` に改名し判定基準を再設計
  (self-centered root = 中心空、非 self-centered + 兄弟あり = 周辺全空、単独 = 削除しない)
- Commit: phase 1 (schema+types) / 2 (API) / 3 (sync) / 4 (UI) / 5 (tests+docs) に分割
- 関連 commits: 9a45d8e, 37198cc, 3b7d6a0, 035c91c, 50a2ffc, db6bdb6, 4a1da92, e908131,
  18fd19a, 40ba72c, 9d8451f, df1262e, c08bf31, afd17fe

### 28.7 lazy cell creation 設計 (migration 005) ✅
- 旧設計では `createGrid` が新規 grid 作成時に 8 / 9 cells を先行 INSERT (うちほとんど空) していた。
  storage を食う + 同期で cloud にも空行を撒く問題があり、「user が書込んだ瞬間に
  upsertCellAt で初めて INSERT する」lazy 設計へ移行
- migration 005 で既存 DB の空 cell 行を物理削除 (center_cell_id / root_cell_id 参照されている
  ものは保護)
- cloud 側は migration 機構が無いので `useCloudEmptyCellsCleanup` hook が「アプリ更新時に一度だけ」
  pagination 削除を実行する仕組み (`STORAGE_KEYS.cloudEmptyCleanupVersion` で gate)
- API 一新: `upsertCellAt(gridId, position, params)` が空 slot への書込窓口。`createMandalart` /
  `createGrid` / `duplicateMandalart` / `copyCellSubtree` が全て lazy 化

### 28.8 並列グリッド独立 center (migration 006) ✅
- 旧 X=C 統一モデルでは並列グリッドが `grids.center_cell_id` を共有し、1 つのテーマ編集で
  全並列に波及する仕様だった。「並列ごとに独立したテーマを持てるように」のユーザー要望に
  応えるため schema 変更
- `grids.parent_cell_id TEXT` を追加。drilled grid は drill 元 cell の id を、root grid は NULL を持つ
- **Primary 保持 + Parallel 独立** の方針: drill 1 個目 (primary) は X=C を維持、2 個目以降の並列は
  自身の center cell を独立 row として INSERT (空コンテンツ、コピーなし)
- `getRootGrids` / `getChildGrids` を parent_cell_id ベースに刷新
- import / export を新モデル対応 (parentPosition=undefined を独立 center cell として復元)
- Supabase 手動 ALTER 必須 (cloud-sync-setup.md 参照)
- 既存並列は移行せず legacy 共有モデルとして共存

### 28.9 セル D&D アクションアイコン UI + drop ポリシー (Phase A+B+C) ✅
- セル D&D を「ドラッグ開始 → 右パネルが 4 アクションアイコン (シュレッダー / 移動 / コピー /
  エクスポート) に切替」UX に再設計。中心セル絡みの cell-to-cell drop を全面禁止
- ストック → 入力ありセルへの drop は `ReplaceConfirmDialog` で確認後に上書き
- 新 API: `shredCellSubtree` / `moveCellToStock` / `pasteFromStockReplacing` /
  `permanentDeleteGrid`
- 新 component: `DragActionPanel` / `ShredConfirmDialog` / `ReplaceConfirmDialog` /
  `ExportFormatPicker`
- root primary 中心セルへの shred / move はマンダラート全体を `permanentDeleteMandalart` で削除
  (ゴミ箱に入らない)
- 並列中心セル shred / move は並列 grid 自体を `permanentDeleteGrid` で削除 + 左隣の並列に切替
- migration 006 取りこぼしの parent_cell_id INSERT 漏れ (stock.ts insertGridSnapshot /
  cells.ts copyCellSubtree) を修正、buildCellSnapshot/buildGridSnapshot を parent_cell_id
  ベースに

### 28.10 アニメーション乱れの修正 ✅
- orbit 3×3 / to-3x3 view-switch の空 slot を bare `<div />` で返していたため、入力ありセル
  だけ stagger fade-in し、空セルや外枠が orbit 終了 swap で初めて出現する乱れを修正
- 空 slot にも `GridView3x3` と同じ枠 + 背景 + `orbit-fade-in` を適用し、7-6-3-0-1-2-5-8 順
  で揃って表示
- アニメ render 経路 (slide / orbit 3×3 / to-3x3) で `onToggleDone` を渡していなかったため
  Cell の done チェックボックスがアニメ完了 swap で遅れて出現していた問題も同時に修正
  (showCheckbox 状態を render 経路に伝播)

### 28.11 チェックボックス UI のチェックボックス型化 + マンダラート単位記憶 (migration 007) ✅
- ツールバーのスライドピル型トグルを、セル本体の done チェックボックスと同じ角丸正方形 +
  ✓ デザインに変更
- マンダラート単位で表示状態を記憶 + クラウド同期するため、`mandalarts.show_checkbox INTEGER
  NOT NULL DEFAULT 0` を migration 007 で追加 (Supabase 手動 ALTER 必須)
- editorStore のグローバル state を撤去、EditorLayout で local state + DB load/persist に置換
- 新規 / 既存マンダラートは DEFAULT 0 (= OFF) で開始。旧 `mandalart.showCheckbox` localStorage
  は廃止 (orphan として残るが実害なし)
- push / pull / realtime の applyMandalartChange に show_checkbox を伝播 (contentSame echo
  検知も含む)
- `duplicateMandalart` はコピー元の show_checkbox を継承

### 28.12 クロスルート Converge Overlay morph (3 方向対応) ✅
- `ConvergeOverlay` (App 直下常駐) と `convergeStore` を新設、route 切替を跨いで生存する単一
  overlay で「セル ↔ ダッシュボードカード ↔ ストックエントリ」の寸法 morph を駆動
- transform scale ではなく `width / height / border-width / border-radius / inset / font-size`
  の並列 CSS transition で morph するため、終端で素 CSS 描画 target と subpixel 一致
  (visual snap の発生を原理的に消す案 A 方式)
- 3 方向: `home` (エディタ → ダッシュボード収束) / `open` (ダッシュボード → エディタ拡大、
  orbit 「のの字」を CONVERGE_DURATION_MS だけ遅延し中心セルは duration 1ms instant snap で
  引渡し) / `stock` (D&D copy/move 時に選択セル → 新規ストックエントリへ収束、メモタブ中なら
  自動でストックタブに切替)
- ダッシュボードカード再設計: 中心セル ~0.47 縮小相当 (border-[3px] / rounded(4px) /
  shadow-md / dark:bg-neutral-950 / 14px font / 6px inset)、`DASHBOARD_CARD_BORDER_PX` /
  `DASHBOARD_CARD_INSET_PX` を `layout.ts` に追加
- 各 target (DashboardCard / 中心セル / StockEntry) で `direction` と `targetId` を購読し、
  morph 中は `orbit-fade-in 1ms ease-out CONVERGE_DURATION_MS both` で opacity 0 → 終端 1ms
  snap で overlay clear と同フレームで可視化
- StockTab の text wrapper 構造を `absolute z-10 ... :not(.inset-0) > span` に統一し、
  ConvergeOverlay の polling が target inset/font を読めるよう interface 共通化
- SidePanel: stock 起源 drag (`dragSourceId.startsWith('stock:')`) では DragActionPanel を
  出さず、メモ/ストックタブを通常表示
- 旧 `runConvergeAnim('stock')` (グリッド全体縮小) は撤去、`runConvergeAnim('home')` (primary
  root 削除時の dashboard 遷移) のみ維持
- `CONVERGE_DEBUG_SLOW_FACTOR` を `timing.ts` に追加 (動作確認用倍率、リリース時 1)

### 28.13 画像セル remount まばたき抑止 ✅
- orbit アニメ完了で Cell が unmount → 通常 grid 描画で remount される際、`useState(null)` +
  async useEffect の組合せだとキャッシュ hit でも 1 frame だけ画像が消えていた
- `getCachedCellImageUrl(path)` (同期 cache lookup) を `storage.ts` に追加し、Cell.tsx の
  `useState` 初期値に渡すことで 1 frame 目から画像を出すよう修正

### 28.14 マンダラート再オープン時の sub-grid 階層復元 (migration 008) ✅
- ダッシュボードからマンダラートを再度開いたとき、前回 drill していた sub-grid の階層に
  自動復元されるようにした (再ドリルの手間を省く UX 改善)
- `mandalarts.last_grid_id TEXT` カラムを migration 008 で追加 (Supabase 手動 ALTER 必須)。
  nullable / DEFAULT なし、null は「未設定 → root にフォールバック」を意味する
- `lib/api/mandalarts.ts` に `updateMandalartLastGridId(id, gridId | null)` setter 新設
- `lib/api/grids.ts` に `getGridAncestry(gridId)` ancestry helper 新設 (parent_cell_id を遡って
  root → leaf 順の grid+cells 配列を返す。stale なら null で root フォールバック)
- editorStore に `setBreadcrumb(items)` action 追加 (resetBreadcrumb は root 単段のみなので不足)
- EditorLayout init で `last_grid_id` 読み → ancestry 構築 → breadcrumb 全段一括 set →
  orbit を target grid の cells で走らせる経路を追加。stale 検知時は DB を null にクリーンアップ
- EditorLayout に `currentGridId` 変化監視 useEffect を追加し、drill / drill-up / breadcrumb /
  parallel switch すべての遷移を 1 箇所でカバーして DB 永続化 (debounce なし、show_checkbox と同等)
- push.ts / pull.ts / realtime.ts に `last_grid_id` カラムを伝播 (TEXT なので変換不要)。
  duplicateMandalart は `last_grid_id` を継承せず NULL で開始 (新規コピーは root が自然)
- viewMode (3×3 / 9×9) は今回スコープ外 (Dashboard は常に 3×3 で開く)。需要が出たら同様に
  `mandalarts.last_view_mode` を追加できる

---

## フェーズ 29 以降: 将来取り組む改善 ⬜

今回の整備でスコープ外にした項目。導入コストが見合う時期に検討。

### 29.1 カスタム ESLint rule で規約を機械チェック ⬜
- `localStorage.{getItem,setItem}` の直接使用禁止 (→ `STORAGE_KEYS` 強制)
- `position === <数値>` の裸比較禁止 (→ `CENTER_POSITION` / `isCenterPosition()` 強制)
- `setTimeout(fn, <閾値超>)` の magic number 禁止
- 実装は `no-restricted-syntax` rule を拡張するか、軽量なカスタムプラグインを自作

### 29.2 React Testing Library による UI smoke test ⬜
- セル操作 (中央空 → 周辺 disabled / shift+tab / 編集保存) の smoke test
- jsdom 環境の vitest project を追加して node テストと共存

### 29.3 軽量 ADR (決定ログ) ⬜
- `desktop/docs/decisions/` に 1 ファイル 1 決定で記録:
  - 001: FK 制約を張らない理由 (循環カスケード問題)
  - 002: Realtime の table filter guard + DELETE カスケード
  - 003: View switch のクロスフェード (swap pop 回避)
  - 004: 完全削除は local + cloud 両方実行 (pull 復活回避)

### 29.4 用語集 (glossary.md) ⬜
- center cell / 中心セル / center block / サブグリッド / 並列グリッド 等の定義を固定
- AI セッションを跨いだ用語のブレを減らす

### 29.5 プロジェクト専用 slash command ⬜
- `.claude/commands/check-rules.md` — ハードコーディング検出 (grep ベース)
- `.claude/commands/sync-docs.md` — constants / api 変更に対応する docs 更新の確認
- `.claude/commands/add-constant.md` — 定数追加と CLAUDE.md 定数一覧の同期

### 29.6 release.yml への CI 前置 ⬜
- tag push で release する前に ci job 成功を require する (CI 失敗なら release しない)

### 29.7 CHANGELOG.md ⬜
- ユーザー向けリリースノート + 次回 Claude セッションの参照用コンテキスト
