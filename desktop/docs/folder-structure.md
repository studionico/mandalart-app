# フォルダ構成 — マンダラート デスクトップアプリ

## トップレベル

```
mandalart/
├── desktop/                  # Tauri デスクトップアプリ (本体)
│   ├── src-tauri/            # Rust バックエンド
│   ├── src/                  # Vite + React フロントエンド
│   ├── docs/                 # ドキュメント (本ファイル群)
│   ├── dist/                 # Vite ビルド出力 (git 管理外)
│   ├── .env                  # VITE_SUPABASE_URL / ANON_KEY (gitignore 済み)
│   ├── .env.example          # .env のテンプレート
│   ├── index.html
│   ├── vite.config.ts
│   ├── tsconfig.json
│   └── package.json
├── _old_web/                 # 旧 Next.js 試作版 (メンテ停止、参照用)
├── .github/workflows/
│   └── release.yml           # リリースワークフロー (tauri-action, マルチ OS)
├── CLAUDE.md                 # Claude Code 向けガイド (本 repo 全体)
└── README.md                 # Desktop 版への案内
```

---

## desktop/src-tauri/ (Rust バックエンド)

```
src-tauri/
├── src/
│   ├── lib.rs                # Tauri アプリ初期化・プラグイン登録
│   └── main.rs               # エントリーポイント (lib::run() を呼ぶだけ)
├── migrations/
│   ├── 001_initial.sql       # SQLite 初期スキーマ (FK 制約なし)
│   ├── 002_soft_delete.sql   # deleted_at カラム + インデックス追加
│   ├── 003_cell_done.sql     # cells.done カラム (チェックボックス機能)
│   └── 004_unify_center.sql  # X と C の統一: parent_cell_id → center_cell_id, mandalarts.root_cell_id 追加 (全テーブル DROP & CREATE)
├── capabilities/
│   └── default.json          # フロントエンドへの権限付与設定
├── icons/                    # アプリアイコン
├── gen/                      # Tauri が自動生成するスキーマ (git 管理外)
├── target/                   # Rust ビルド出力 (git 管理外)
├── Cargo.toml                # Rust 依存関係
├── Cargo.lock
└── tauri.conf.json           # Tauri アプリ設定 (ウィンドウ・バンドル・プラグイン)
```

### 主要な Rust 依存 (Cargo.toml)

| クレート | 用途 |
|---|---|
| `tauri` | デスクトップアプリ基盤 |
| `tauri-plugin-sql` (`sqlite` feature) | SQLite アクセス |
| `tauri-plugin-global-shortcut` | グローバルショートカット (`Cmd+Shift+M`) |
| `tauri-plugin-opener` | URL / ファイルを OS で開く |
| `tauri-plugin-fs` | ファイルシステム操作 (画像のローカル保存) |
| `tauri-plugin-updater` | 自動アップデート (GitHub Releases) |
| `tauri-plugin-process` | アップデート後の再起動 |
| `tauri-plugin-deep-link` | `mandalart://` URI スキームで OAuth コールバックを受け取る |

---

## desktop/samples/ (手動検証用)

```
samples/
├── test-fixture.json       # 7 シナリオ (ルート並列 / drilled / memo / color 等) を詰めた GridSnapshot
└── README.md               # 使い方 + 各形式の round-trip 保持対象テーブル
```

各エクスポート形式 (JSON / Markdown / インデントテキスト / PNG / PDF) の動作を手動で検証するためのフィクスチャ。
「インポート → 各形式でエクスポート → 再インポート」の round-trip を 1 ファイルで一気通貫できる。

---

## desktop/src/ (React フロントエンド)

```
src/
├── main.tsx                  # React エントリーポイント
├── App.tsx                   # HashRouter + Routes + グローバル hooks (useTheme / useAuthBootstrap / useGlobalShortcut / useAppUpdate)
├── App.css / index.css       # グローバルスタイル (index.css で Tailwind + @custom-variant dark 定義)
├── vite-env.d.ts
│
├── pages/                    # ページコンポーネント (React Router のルート単位)
│   ├── DashboardPage.tsx     # マンダラート一覧 (130×130 タイル表示)・作成・複製・削除・検索・ゴミ箱
│   └── EditorPage.tsx        # エディタ画面 (useParams で mandalartId を取得)
│
├── components/
│   ├── AuthDialog.tsx        # メール/OAuth サインインダイアログ
│   ├── UpdateDialog.tsx      # 自動アップデート確認・進捗・再起動ダイアログ
│   ├── ThemeToggle.tsx       # ☀ ◐ ☾ のテーマ切替セグメント
│   ├── ConvergeOverlay.tsx   # App 直下常駐の単一 overlay。エディタ ↔ ダッシュボード ↔ ストック 間の morph アニメ駆動 (寸法/枠/角丸/inset/font 並列 transition)
│   │
│   ├── dashboard/
│   │   └── TrashDialog.tsx   # ゴミ箱ダイアログ (復元・完全削除)
│   │
│   ├── editor/               # エディタ関連
│   │   ├── EditorLayout.tsx      # エディタ全体レイアウト・状態管理のハブ
│   │   ├── GridView3x3.tsx       # 3×3 グリッド表示
│   │   ├── GridView9x9.tsx       # 9×9 グリッド表示 (2 階層同時)
│   │   ├── Cell.tsx              # セル 1 マスの表示・インライン編集・クリック・D&D
│   │   ├── CellEditModal.tsx     # 詳細編集モーダル (色・画像・長文)
│   │   ├── Breadcrumb.tsx        # パンくずリスト (階層ナビゲーション)
│   │   ├── ParallelNav.tsx       # 並列グリッド ← → ナビゲーション
│   │   ├── SidePanel.tsx         # 右サイドパネル (メモ・ストック タブ + ドラッグ中の DragActionPanel オーバーレイ)
│   │   ├── DragActionPanel.tsx   # D&D 中の右パネル 4 アクションアイコン (シュレッダー / 移動 / コピー / エクスポート)
│   │   ├── MemoTab.tsx           # メモタブ (Markdown エディタ)
│   │   ├── StockTab.tsx          # ストックタブ (保管セル一覧 + ConvergeOverlay polling target)
│   │   └── ImportDialog.tsx      # インポートダイアログ (新規 / 既存セル配下)
│   │
│   └── ui/                   # 汎用 UI コンポーネント
│       ├── Button.tsx        # primary / secondary / ghost / danger バリアント (dark 対応)
│       ├── Modal.tsx         # オーバーレイモーダル (size prop、max-h-[90vh])
│       ├── BottomSheet.tsx   # モバイル用ボトムシート
│       └── Toast.tsx         # トースト通知 (info / success / error + Undo)
│
├── hooks/                    # React カスタムフック
│   ├── useGrid.ts            # グリッド + セルデータの取得・更新
│   ├── useSubGrids.ts        # 9×9 表示用のサブグリッド一括取得
│   ├── useDragAndDrop.ts     # D&D 実装 (cell source / stock source 両対応、mousedown ベース)
│   ├── useUndo.ts            # Undo/Redo キーボードハンドラ + push
│   ├── useRealtime.ts        # subscribeRemoteChanges の thin wrapper
│   ├── useOffline.ts         # オフライン状態検知 (現状スタブ、lib/offline.ts と対)
│   ├── useSync.ts            # クラウド同期 (起動時全同期 + realtime + manual 同期 + 300ms debounce)
│   ├── useAuthBootstrap.ts   # 起動時のセッション復元 + deep link ハンドラ登録
│   ├── useTheme.ts           # themeStore → <html>.dark クラスの適用 + prefers-color-scheme 追従
│   ├── useGlobalShortcut.ts  # Cmd+Shift+M でウィンドウ表示/非表示
│   └── useAppUpdate.ts       # tauri-plugin-updater の check / download / install
│
├── store/                    # Zustand グローバルストア
│   ├── editorStore.ts        # currentGridId / viewMode / breadcrumb / fontLevel
│   ├── undoStore.ts          # 操作履歴スタック
│   ├── clipboardStore.ts     # mode / sourceCellId (スナップショットは持たない)
│   ├── authStore.ts          # session / user / loading
│   ├── themeStore.ts         # light / dark / system
│   └── convergeStore.ts      # クロスルート morph 用 overlay state (direction='home'|'open'|'stock' / targetId / sourceRect / centerCell)
│
├── lib/
│   ├── db/
│   │   └── index.ts          # SQLite 基盤 (getDb / query / execute / generateId / now)
│   ├── api/                  # エンティティ別 API レイヤー
│   │   ├── mandalarts.ts     # CRUD + ソフトデリート + ゴミ箱 + 全文検索 + 複製
│   │   ├── grids.ts          # CRUD + 9 セル一括生成 + 再帰論理削除
│   │   ├── cells.ts          # 更新 (ルート中心セル自動 title 同期) / swap / copy / paste
│   │   ├── stock.ts          # ストック CRUD + スナップショット構築
│   │   ├── storage.ts        # 画像ファイルを $APPDATA/images/ に保存 + blob URL 変換
│   │   ├── transfer.ts       # exportToJSON / exportToMarkdown / exportToIndentText / importFromJSON / importIntoCell / parseTextToSnapshot
│   │   └── auth.ts           # Supabase Auth 連携 (メール + OAuth + deep link)
│   ├── sync/                 # クラウド同期
│   │   ├── push.ts           # per-row upsert + 失敗集約
│   │   ├── pull.ts           # Supabase → local に last-write-wins で反映
│   │   └── index.ts          # syncAll = pullAll → pushAll
│   ├── supabase/
│   │   └── client.ts         # Supabase クライアント (env 欠損時フォールバック)
│   ├── utils/
│   │   ├── grid.ts           # isCellEmpty / hasPeripheralContent / getCenterCell
│   │   ├── dnd.ts            # resolveDndAction (D&D ルール判定)
│   │   └── export.ts         # エクスポート各形式を `$DOWNLOAD` (OS ダウンロードフォルダ) に直接 writeFile で保存 (Tauri WebKit で `<a download>` が動かないため)
│   ├── import-parser.ts      # インデントテキスト / Markdown → GridSnapshot (箇条書き記号除去あり)
│   ├── realtime.ts           # Supabase Realtime (postgres_changes) 購読
│   └── offline.ts            # オフラインスタブ (将来の pending updates 用)
│
├── constants/
│   ├── grid.ts               # CENTER_POSITION / GRID_CELL_COUNT / ORBIT_ORDER_*
│   ├── timing.ts             # ANIM_*, CLICK_DELAY_MS, CONVERGE_DURATION_MS, CONVERGE_DEBUG_SLOW_FACTOR 等
│   ├── layout.ts             # OUTER_GRID_GAP_PX / CELL_BASE_FONT_PX / DASHBOARD_CARD_* 等の寸法定数
│   ├── storage.ts            # STORAGE_KEYS (localStorage キー一元化)
│   ├── colors.ts             # プリセットカラー定義
│   └── tabOrder.ts           # Tab 移動順 [4, 7, 6, 3, 0, 1, 2, 5, 8]
│
└── types/
    └── index.ts              # Mandalart / Grid / Cell / StockItem / CellSnapshot / GridSnapshot 型定義
```

---

## ルーティング (React Router v7 / HashRouter)

| パス | コンポーネント | 概要 |
|---|---|---|
| `/` | リダイレクト | `/dashboard` へ転送 |
| `/dashboard` | DashboardPage | マンダラート一覧 |
| `/mandalart/:id` | EditorPage → EditorLayout | エディタ画面 |

HashRouter を使うのは、Tauri が `file://` プロトコルでフロントをロードするため。認証ガードは無く、サインインしなくても全機能がローカル専用モードで使える。

---

## 設定ファイル

| ファイル | 内容 |
|---|---|
| `vite.config.ts` | `@tailwindcss/vite` プラグイン、`@/` エイリアス、dev ポート 1420 |
| `tsconfig.json` | `"paths": { "@/*": ["./src/*"] }` でパスエイリアス解決 |
| `tauri.conf.json` | ウィンドウ設定・バンドル設定・updater pubkey・deep-link scheme など |
| `src-tauri/capabilities/default.json` | フロントエンドの権限定義 (SQL / fs / global-shortcut / updater / process / deep-link 等) |
| `src-tauri/Cargo.toml` | Rust 依存関係 |
| `.github/workflows/release.yml` | `v*` タグ push でマルチ OS ビルド + 署名 + GitHub Release 作成 |

---

## 設計上の分離方針

- **UI → hooks → lib/api → lib/db の単方向依存**。UI コンポーネントが SQL を直接書いたり Supabase SDK を直接呼んだりしない
- **lib/api は「ローカル DB の操作」に集中**。クラウド同期はプレゼンテーション層 (`hooks/useSync`) が `lib/sync` を呼ぶ形にしている
- **ソフトデリート**は API 層で管理。全 `SELECT` に `WHERE deleted_at IS NULL` が付き、削除系は UPDATE のみで物理削除はしない (`permanentDeleteMandalart` のみ例外)
- **環境変数は Vite の `VITE_` プレフィックス**経由でのみフロントにバンドルされる。秘匿情報は置かず、anon key + URL のみ
