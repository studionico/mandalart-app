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
- [x] `src/lib/api/transfer.ts`（exportToJSON / exportToCSV / importFromJSON / importIntoCell）
- [x] `src/lib/api/auth.ts`（スタブ — ローカルモードのみ）
- [x] `src/lib/realtime.ts`（スタブ）
- [x] `src/lib/offline.ts`（スタブ）

---

## フェーズ 4: ユーティリティ ✅

- [x] `src/lib/utils/grid.ts`（isCellEmpty / hasPeripheralContent / getCenterCell）
- [x] `src/lib/utils/dnd.ts`（D&D ルール判定）
- [x] `src/lib/utils/export.ts`（exportAsPNG / exportAsPDF / downloadJSON / downloadCSV）
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
- [ ] 複製機能（`duplicateMandalart`）
- [ ] タイトル検索・ソート

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

## フェーズ 16: ドラッグ＆ドロップ 🔄

- [x] D&D ルール判定ロジック（`lib/utils/dnd.ts`）
- [x] `useDragAndDrop.ts` 実装
- [x] 周辺 ↔ 周辺: サブツリーごと入れ替え
- [x] 中央 → 入力ある周辺: 内容のみ入れ替え
- [x] 中央 → 空の周辺: サブツリーコピー
- [ ] ドラッグ中のドロップ可能セルのハイライト表示
- [ ] 9×9 表示でのサブグリッドをまたいだ D&D

---

## フェーズ 17: カット＆ペースト 🔄

- [x] 右クリックコンテキストメニュー（カット / コピー / ストックに追加）
- [x] カット後のセルをグレーアウト表示（clipboardStore）
- [ ] ⌘X / ⌘C / ⌘V キーボードショートカット実装
- [ ] ペースト操作の完全実装（ドロップ先へのスナップショット適用）

---

## フェーズ 18: ストックエリア 🔄

- [x] `StockTab.tsx` 実装
- [x] `SidePanel.tsx` 実装（メモ / ストックのタブ切替）
- [x] セル → ストックへのコピー（コンテキストメニュー「ストックに追加」）
- [x] ストックアイテムの削除
- [ ] ストックアイテム → セルへのドロップ（D&D ルール適用）

---

## フェーズ 19: メモ欄 🔄

- [x] `MemoTab.tsx` 実装
- [x] Markdown エディタ（編集 / プレビュー切替）
- [ ] 自動保存（debounce）の確認・テスト

---

## フェーズ 20: Undo / Redo 🔄

- [x] `undoStore.ts` / `useUndo.ts` 実装
- [x] セル編集の Undo/Redo 登録
- [ ] ⌘Z / ⌘Y（Ctrl+Z / Ctrl+Y）キーボードショートカット実装
- [ ] D&D 操作の Undo 対応

---

## フェーズ 21: エクスポート ✅

- [x] PNG エクスポート（html2canvas）
- [x] PDF エクスポート（jsPDF）
- [x] JSON エクスポート
- [x] CSV エクスポート
- [x] エクスポートメニュー UI

---

## フェーズ 22: インポート 🔄

- [x] `importFromJSON` / `importIntoCell` 実装
- [x] `parseTextToSnapshot`（インデントテキスト / Markdown 解析）
- [ ] インポート UI フロー実装
  - [ ] ① 形式選択（ファイル / クリップボード）
  - [ ] ② プレビュー表示
  - [ ] ③ インポート先選択（新規 / 既存セル）
  - [ ] ④ 実行

---

## フェーズ 23: デスクトップ固有機能 ⬜

- [ ] グローバルショートカット: `Cmd/Ctrl+Shift+M` でウィンドウ表示/非表示
  - `tauri-plugin-global-shortcut` を使用
- [ ] 画像ファイル D&D: セルへのファイルドロップ → アプリデータディレクトリに保存
  - `tauri-plugin-fs` を使用
  - `src/lib/api/storage.ts` の暫定実装を本実装に置き換え
- [ ] 自動アップデート: GitHub Releases からチェック・適用
  - `tauri-plugin-updater` を有効化（現在コメントアウト中）
  - GitHub Actions でビルド・リリースワークフロー作成

---

## フェーズ 24: ダッシュボード補完 ⬜

- [ ] マンダラート複製機能
- [ ] タイトル検索
- [ ] 更新日ソート

---

## フェーズ 25: クラウド同期（オプション）⬜

- [ ] Supabase Auth 連携（メール / Google / GitHub）
- [ ] `src/lib/sync/push.ts`（ローカル → Supabase）
- [ ] `src/lib/sync/pull.ts`（Supabase → ローカル）
- [ ] 競合解決（updated_at 比較）
- [ ] 同期タイミング: 起動時・保存時・手動ボタン
- [ ] `src/lib/realtime.ts` の本実装（単一ユーザー複数デバイス同期）

---

## フェーズ 26: ビルド・配布 ⬜

- [ ] GitHub Actions ワークフロー作成
  - macOS: `.dmg` 生成
  - Windows: `.msi` / `.exe` 生成
- [ ] GitHub Releases への自動アップロード
- [ ] updater エンドポイントを GitHub Releases に設定
- [ ] コードサイニング設定（macOS / Windows）

---

## バグ・改善TODO

- [ ] `swapCellSubtree` の一時 UUID（`00000000-...`）が SQLite の外部キー制約に違反しないか確認
- [ ] 画像アップロードの本実装（Tauri fs プラグインによるローカル保存）
- [ ] `try/catch` エラーハンドリングを各 API 関数に追加
- [ ] `handleCreate` の try/catch を保持（エラー表示用）
