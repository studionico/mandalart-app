# フォルダ構成 — マンダラート デスクトップアプリ

## トップレベル

```
mandalart/
├── desktop/                  # Tauri デスクトップアプリ（本体）
│   ├── src-tauri/            # Rust バックエンド
│   ├── src/                  # Vite + React フロントエンド
│   ├── docs/                 # ドキュメント（本ファイル群）
│   ├── dist/                 # Vite ビルド出力（git 管理外）
│   ├── index.html
│   ├── vite.config.ts
│   ├── tsconfig.json
│   └── package.json
└── src/                      # 旧 Next.js Web 版（参照のみ・メンテ停止）
```

---

## desktop/src-tauri/（Rust バックエンド）

```
src-tauri/
├── src/
│   ├── lib.rs                # Tauri アプリ初期化・プラグイン登録
│   └── main.rs               # エントリーポイント（lib::run() を呼ぶだけ）
├── migrations/
│   └── 001_initial.sql       # SQLite スキーマ（マンダラート・グリッド・セル・ストック）
├── capabilities/
│   └── default.json          # フロントエンドへの権限付与設定
├── icons/                    # アプリアイコン各種
├── gen/                      # Tauri が自動生成するスキーマ定義（git 管理外推奨）
├── target/                   # Rust ビルド出力（git 管理外）
├── Cargo.toml                # Rust 依存関係
└── tauri.conf.json           # Tauri アプリ設定（ウィンドウ・バンドル・プラグイン）
```

### 主要な Rust 依存関係（Cargo.toml）

| クレート | 用途 |
|---------|------|
| `tauri` | デスクトップアプリ基盤 |
| `tauri-plugin-sql` (sqlite feature) | SQLite アクセス |
| `tauri-plugin-global-shortcut` | グローバルショートカット |
| `tauri-plugin-opener` | URL・ファイルを OS で開く |
| `tauri-plugin-updater` | 自動アップデート（GitHub Releases 設定後に有効化）|

---

## desktop/src/（React フロントエンド）

```
src/
├── main.tsx                  # React エントリーポイント（ReactDOM.createRoot）
├── App.tsx                   # HashRouter + Routes 定義
├── App.css / index.css       # グローバルスタイル
├── vite-env.d.ts
│
├── pages/                    # ページコンポーネント（React Router のルート単位）
│   ├── DashboardPage.tsx     # マンダラート一覧・作成・削除・リネーム
│   └── EditorPage.tsx        # エディタ画面（useParams で mandalartId を取得）
│
├── components/
│   ├── editor/               # エディタ関連コンポーネント
│   │   ├── EditorLayout.tsx  # エディタ全体レイアウト・状態管理のハブ
│   │   ├── GridView3x3.tsx   # 3×3 グリッド表示
│   │   ├── GridView9x9.tsx   # 9×9 グリッド表示（2階層同時表示）
│   │   ├── Cell.tsx          # セル1マスの表示・クリック・D&D
│   │   ├── CellEditModal.tsx # セル編集モーダル（テキスト・画像・色）
│   │   ├── Breadcrumb.tsx    # パンくずリスト（階層ナビゲーション）
│   │   ├── ParallelNav.tsx   # 並列グリッド ← → ナビゲーション
│   │   ├── SidePanel.tsx     # 右サイドパネル（メモ・ストックのタブ）
│   │   ├── MemoTab.tsx       # メモタブ（Markdown エディタ）
│   │   └── StockTab.tsx      # ストックタブ（保管セル一覧）
│   ├── dashboard/            # ダッシュボード関連（現在 DashboardPage 内に統合）
│   │   ├── MandalartCard.tsx
│   │   ├── MandalartGrid.tsx
│   │   └── SearchBar.tsx
│   ├── auth/                 # 認証関連（将来の Supabase 同期時に使用）
│   │   ├── LoginForm.tsx
│   │   ├── OAuthButtons.tsx
│   │   └── SignOutButton.tsx
│   └── ui/                   # 汎用 UI コンポーネント
│       ├── Button.tsx        # プライマリ・セカンダリ・ゴーストの3バリアント
│       ├── Modal.tsx         # オーバーレイモーダル（Esc・外側クリックで閉じる）
│       ├── BottomSheet.tsx   # モバイル用ボトムシート
│       └── Toast.tsx         # トースト通知（info / success / error + Undo アクション）
│
├── hooks/                    # React カスタムフック
│   ├── useGrid.ts            # グリッド + セルデータの取得・更新
│   ├── useSubGrids.ts        # 9×9 表示用のサブグリッド一括取得
│   ├── useDragAndDrop.ts     # D&D ハンドラー（ルール判定 → API 呼び出し）
│   ├── useUndo.ts            # Undo/Redo スタック操作
│   ├── useRealtime.ts        # Realtime サブスクリプション管理（デスクトップ版はスタブ）
│   └── useOffline.ts         # オフライン状態検知（デスクトップ版はスタブ）
│
├── store/                    # Zustand グローバルストア
│   ├── editorStore.ts        # 現在グリッド ID・表示モード・パンくず情報
│   ├── undoStore.ts          # 操作履歴スタック（undo / redo エントリー）
│   └── clipboardStore.ts     # カット/コピー状態（モード・ソースセル・スナップショット）
│
├── lib/
│   ├── db/
│   │   └── index.ts          # SQLite アクセス基盤（getDb / query / execute）
│   ├── api/                  # エンティティ別 API（シグネチャは Web 版と同一）
│   │   ├── mandalarts.ts     # マンダラート CRUD
│   │   ├── grids.ts          # グリッド CRUD + セル一括生成
│   │   ├── cells.ts          # セル更新・swap・コピー
│   │   ├── stock.ts          # ストックアイテム CRUD
│   │   ├── storage.ts        # 画像アップロード（暫定: DataURL）
│   │   ├── transfer.ts       # エクスポート / インポート
│   │   └── auth.ts           # 認証スタブ（将来の Supabase 同期用）
│   ├── utils/
│   │   ├── grid.ts           # isCellEmpty / hasPeripheralContent / getCenterCell
│   │   ├── dnd.ts            # D&D ルール判定ロジック
│   │   ├── export.ts         # PNG / PDF / JSON / CSV ダウンロード
│   │   └── import-parser.ts  # テキスト → GridSnapshot パーサー
│   ├── offline.ts            # オフラインスタブ
│   └── realtime.ts           # Realtime スタブ
│
├── constants/
│   ├── colors.ts             # プリセットカラー定義（key / label / bg / text クラス）
│   └── tabOrder.ts           # Tab 移動順（position 配列）
│
└── types/
    └── index.ts              # Mandalart / Grid / Cell / StockItem 型定義
```

---

## ルーティング（React Router v6 / HashRouter）

| パス | コンポーネント | 概要 |
|------|--------------|------|
| `/` | リダイレクト | `/dashboard` へ転送 |
| `/dashboard` | DashboardPage | マンダラート一覧 |
| `/mandalart/:id` | EditorPage → EditorLayout | エディタ画面 |

HashRouter を使用するため、Tauri のファイルプロトコルと互換性がある。

---

## 設定ファイル

| ファイル | 内容 |
|---------|------|
| `vite.config.ts` | `@tailwindcss/vite` プラグイン、`@/` エイリアス設定 |
| `tsconfig.json` | `"paths": { "@/*": ["./src/*"] }` でパスエイリアス解決 |
| `tauri.conf.json` | ウィンドウサイズ・バンドル設定・プラグイン設定 |
| `src-tauri/capabilities/default.json` | フロントエンドの権限定義 |
| `src-tauri/Cargo.toml` | Rust 依存関係 |

---

## 将来追加予定

```
src/lib/sync/
  ├── push.ts       ローカル変更を Supabase へ送信
  ├── pull.ts       Supabase の変更をローカルに取得
  └── index.ts      syncAll() エントリーポイント
```
