# 開発タスク一覧

## フェーズ 1: プロジェクトセットアップ

- [ ] Next.js 14+ プロジェクト作成（`create-next-app`、App Router 有効）
- [ ] Tailwind CSS セットアップ
- [ ] `@supabase/supabase-js`・`@supabase/ssr` インストール
- [ ] Zustand・その他依存パッケージのインストール（html2canvas・jsPDF・Markdown エディタ等）
- [ ] `.env.local` に環境変数設定（`NEXT_PUBLIC_SUPABASE_URL`・`NEXT_PUBLIC_SUPABASE_ANON_KEY`）
- [ ] `src/lib/supabase/client.ts`・`server.ts` 作成（ブラウザ用・サーバー用クライアント）
- [ ] `src/types/index.ts` 作成（`Mandalart`・`Grid`・`Cell`・`StockItem`・`CellSnapshot`・`GridSnapshot` 型）
- [ ] `src/constants/colors.ts` 作成（プリセットカラー定義）
- [ ] `src/constants/tabOrder.ts` 作成（Tab 移動順: 5→8→7→4→1→2→3→6→9）

---

## フェーズ 2: データベース・ストレージ

- [ ] Supabase マイグレーション: `001_create_mandalarts.sql`（テーブル + RLS）
- [ ] Supabase マイグレーション: `002_create_grids.sql`（テーブル + RLS + インデックス + REPLICA IDENTITY FULL）
- [ ] Supabase マイグレーション: `003_create_cells.sql`（テーブル + RLS + REPLICA IDENTITY FULL）
- [ ] Supabase マイグレーション: `004_create_stock_items.sql`（テーブル + RLS）
- [ ] `updated_at` 自動更新トリガー関数の追加（3テーブル分）
- [ ] Supabase Storage バケット `cell-images` 作成（非公開）
- [ ] Storage RLS ポリシー設定（アップロード・読み取り・削除）
- [ ] `supabase/seed.sql` 作成（開発用シードデータ）

---

## フェーズ 3: 認証

- [ ] `src/lib/api/auth.ts` 実装（`signUp`・`signIn`・`signInWithGoogle`・`signInWithGitHub`・`signOut`・`getSession`）
- [ ] `src/app/api/auth/callback/route.ts` 実装（OAuth コールバックハンドラー）
- [ ] `src/app/(auth)/login/page.tsx` 実装（メール/パスワード + Google/GitHub ボタン）
- [ ] `src/app/(auth)/signup/page.tsx` 実装
- [ ] `src/components/auth/LoginForm.tsx` 実装
- [ ] `src/components/auth/OAuthButtons.tsx` 実装
- [ ] `src/app/(app)/layout.tsx` 実装（認証チェック・未ログインリダイレクト）

---

## フェーズ 4: ダッシュボード

- [ ] `src/lib/api/mandalarts.ts` 実装（`getMandalarts`・`getMandalart`・`createMandalart`・`updateMandalartTitle`・`deleteMandalart`・`duplicateMandalart`・`searchMandalarts`）
- [ ] `src/app/(app)/dashboard/page.tsx` 実装（マンダラート一覧、新規作成ボタン）
- [ ] `src/components/dashboard/MandalartCard.tsx` 実装（タイトル・更新日・ルートグリッドのミニプレビュー）
- [ ] `src/components/dashboard/MandalartGrid.tsx` 実装（カード一覧レイアウト）
- [ ] `src/components/dashboard/SearchBar.tsx` 実装（タイトル検索・全文検索）
- [ ] ダッシュボードからの操作: 複製・削除・リネーム（コンテキストメニューまたはカード内ボタン）

---

## フェーズ 5: エディタ基盤

- [ ] `src/store/editorStore.ts` 実装（現在グリッド ID・表示モード・パンくず情報）
- [ ] `src/store/undoStore.ts` 実装（操作履歴スタック）
- [ ] `src/store/clipboardStore.ts` 実装（カット/コピー状態）
- [ ] `src/lib/api/grids.ts` 実装（`getRootGrids`・`getChildGrids`・`getGrid`・`createGrid`・`updateGridMemo`・`deleteGrid`・`updateGridSortOrder`）
- [ ] `src/lib/api/cells.ts` 実装（`updateCell`・`swapCellContent`・`swapCellSubtree`・`copyCellSubtree`）
- [ ] `src/lib/utils/grid.ts` 実装（グリッド操作ユーティリティ）
- [ ] `src/hooks/useGrid.ts` 実装（グリッドデータ取得・更新）
- [ ] `src/app/(app)/mandalart/[id]/page.tsx` 実装（エディタ画面エントリーポイント）
- [ ] `src/components/editor/EditorLayout.tsx` 実装（全体レイアウト・ヘッダー・サイドパネル・グリッドエリア）
- [ ] `src/components/editor/Cell.tsx` 実装（テキスト・画像・色表示、各クリックイベント）
- [ ] `src/components/editor/GridView3x3.tsx` 実装（3×3 表示・セルレンダリング）
- [ ] `src/components/editor/GridView9x9.tsx` 実装（9×9 表示・サブグリッド境界線）
- [ ] 表示モード切り替えトグルボタン実装（`[3×3] [9×9]`）
- [ ] `src/components/editor/ParallelNav.tsx` 実装（← → ナビゲーション、並列グリッドがあるときのみ表示）
- [ ] 並列グリッド追加ボタン実装（「+ 新しいグリッドを追加」）

---

## フェーズ 6: パンくずリスト

- [ ] `src/components/editor/Breadcrumb.tsx` 実装
  - [ ] 現在の階層パス表示（テキスト + 画像アイコン）
  - [ ] 各アイテムにグリッドミニプレビュー表示（現在パス上のセルをハイライト）
  - [ ] 「ホーム」クリックでダッシュボードへ移動

---

## フェーズ 7: セル編集

- [ ] `src/components/editor/CellEditModal.tsx` 実装
  - [ ] レスポンシブ: スマホ（〜768px）はボトムシート、それ以上はモーダル
  - [ ] テキスト入力エリア
  - [ ] 画像アップロード（`src/lib/api/storage.ts` 実装: `uploadCellImage`・`getCellImageUrl`・`deleteCellImage`）
  - [ ] プリセットカラー選択（`colors.ts` のカラー一覧を表示）
  - [ ] 「確定」で保存・「キャンセル/Escape」で破棄
- [ ] Tab キーによるセル間移動実装（デスクトップのみ: 5→8→7→4→1→2→3→6→9 のループ）
  - [ ] 中心セルが空の場合は Tab を押してもセル 5 に留まる
  - [ ] `Shift+Tab` で逆順移動

---

## フェーズ 8: 階層ナビゲーション

- [ ] シングルクリックでサブグリッドへ掘り下げ（`editorStore` の現在グリッド更新）
- [ ] サブグリッドを持たない空セルをシングルクリック → 編集モードにフォールバック
- [ ] 空の周辺セル（中心が空で非活性）はすべてのクリック操作を無効化
- [ ] ルートグリッドの中心セル（空）→ 編集モード
- [ ] ルートグリッドの中心セル（入力あり）→ ダッシュボードへ移動
- [ ] タイトル設定ダイアログ: ホームへ離脱する際にタイトル未設定なら表示（初期値=中心セルテキスト）

---

## フェーズ 9: バリデーション

- [ ] 中心セルが空のとき周辺セルを非活性化（入力不可表示）
- [ ] 周辺セルに入力がある場合、中心セルをクリアしようとするとエラートースト表示

---

## フェーズ 10: 空データの非保存ルール

- [ ] 新規マンダラート作成時は「下書き状態」として扱い、最初の入力が確定した時点で DB に保存
- [ ] 既存グリッドの全セルが空になったとき、そのグリッドを自動削除（Undo トーストを表示）
- [ ] ルートグリッドが空になったとき、マンダラート全体を自動削除
- [ ] 並列グリッドが空になったとき、その並列グリッドのみ削除

---

## フェーズ 11: ドラッグ＆ドロップ

- [ ] `src/lib/utils/dnd.ts` 実装（D&D ルール判定ロジック）
- [ ] `src/hooks/useDragAndDrop.ts` 実装
- [ ] 同一グリッド内 D&D: 5つのルール実装
  - [ ] 周辺セル ↔ 周辺セル: サブツリーごと入れ替え（`swapCellSubtree`）
  - [ ] 中心セル → 入力ある周辺セル: 内容のみ入れ替え（`swapCellContent`）
  - [ ] 中心セル → 空の周辺セル: 階層全体をコピー（`copyCellSubtree`）
  - [ ] 入力ある周辺セル → 中心セル: 内容のみ入れ替え（対称）
  - [ ] 空の周辺セル → 中心セル: 何もしない
- [ ] 9×9 表示でのサブグリッドをまたいだ D&D（デスクトップのみ）
- [ ] ドラッグ中のドロップ可能セルをハイライト表示

---

## フェーズ 12: 階層間データ移動

- [ ] カット＆ペースト: 右クリック（長押し）コンテキストメニュー実装
- [ ] キーボードショートカット: `⌘X` / `⌘C` / `⌘V`（`Ctrl` も対応）
- [ ] カット後の元セルをグレーアウト表示
- [ ] `src/lib/api/stock.ts` 実装（`getStockItems`・`addToStock`・`deleteStockItem`・`pasteFromStock`）
- [ ] `src/components/editor/StockTab.tsx` 実装（ストックアイテム一覧・ミニプレビュー・削除）
- [ ] セル → ストックへのドラッグ（常にコピー）
- [ ] ストックアイテム → セルへのドロップ（同一グリッド D&D と同ルール適用）

---

## フェーズ 13: Undo / Redo

- [ ] `src/hooks/useUndo.ts` 実装（`undoStore` と連携）
- [ ] `⌘Z` / `⌘Y`（Mac）・`Ctrl+Z` / `Ctrl+Y`（Windows）キーボードハンドラー実装
- [ ] 対象操作を Undo スタックへ記録（テキスト編集・色変更・D&D・削除・セル移動）

---

## フェーズ 14: メモ欄

- [ ] `src/components/editor/MemoTab.tsx` 実装
  - [ ] Markdown エディタ（編集モード / プレビューモード切り替え）
  - [ ] 現在グリッドのメモを表示・編集
  - [ ] `updateGridMemo` を使用した自動保存（debounce）

---

## フェーズ 15: サイドパネル

- [ ] `src/components/editor/SidePanel.tsx` 実装（メモ / ストックのタブ切り替え）

---

## フェーズ 16: リアルタイム同期

- [ ] `src/lib/realtime.ts` 実装（`subscribeToCells`・`subscribeToGrids`・`unsubscribe`）
- [ ] `src/hooks/useRealtime.ts` 実装（サブスクリプション管理・クリーンアップ）
- [ ] エディタ画面でのリアルタイム更新反映（複数デバイス間同期）

---

## フェーズ 17: オフライン対応

- [ ] `src/lib/offline.ts` 実装（`cacheGrid`・`getCachedGrid`・`queueUpdate`・`syncPendingUpdates`）
- [ ] `src/hooks/useOffline.ts` 実装（オフライン状態検知・復帰時自動同期）
- [ ] 画面上部にオフラインインジケーター表示

---

## フェーズ 18: エクスポート

- [ ] `src/lib/utils/export.ts` 実装（PDF/PNG 出力ユーティリティ）
- [ ] `src/lib/api/transfer.ts` に `exportToJSON`・`exportToCSV` 実装
- [ ] PNG エクスポート（html2canvas）
- [ ] PDF エクスポート（jsPDF）
- [ ] エクスポートボタン UI（エディタ画面内に配置）

---

## フェーズ 19: インポート

- [ ] `src/lib/utils/import-parser.ts` 実装（インデントテキスト・Markdown 見出し → `GridSnapshot` パース）
- [ ] `src/lib/api/transfer.ts` に `importFromJSON`・`parseTextToSnapshot`・`importIntoCell` 実装
- [ ] インポート UI フロー実装
  - [ ] ① 形式選択（ファイル選択 / クリップボード）
  - [ ] ② プレビュー表示（インポート後の構造確認）
  - [ ] ③ インポート先選択（新規マンダラート / 既存セルに差し込み）
  - [ ] ④ 実行

---

## フェーズ 20: グリッド管理

- [ ] 右クリック（長押し）コンテキストメニュー実装（削除・リネーム・複製）
- [ ] 並列グリッド・サブグリッド共通で動作確認

---

## フェーズ 21: 汎用 UI コンポーネント

- [ ] `src/components/ui/Button.tsx`
- [ ] `src/components/ui/Modal.tsx`
- [ ] `src/components/ui/BottomSheet.tsx`
- [ ] `src/components/ui/Toast.tsx`（エラー・Undo 通知）

---

## フェーズ 22: デプロイ

- [ ] Vercel プロジェクト作成・リポジトリ連携
- [ ] Vercel 環境変数設定（`NEXT_PUBLIC_SUPABASE_URL`・`NEXT_PUBLIC_SUPABASE_ANON_KEY`）
- [ ] Supabase 本番プロジェクト作成・マイグレーション適用
- [ ] Supabase Auth の OAuth リダイレクト URL を本番 URL に更新
- [ ] 本番環境での動作確認（認証・グリッド操作・リアルタイム同期）
