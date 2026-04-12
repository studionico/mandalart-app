# フォルダ構成

Next.js 14+ App Router を使用した構成。
ビジネスロジックを UI から分離し、将来のネイティブアプリへの流用を容易にする。

---

## ディレクトリ構成

```
mandalart/
├── docs/                          # ドキュメント
│   ├── requirements.md
│   ├── data-model.md
│   ├── api-spec.md
│   └── folder-structure.md
│
├── public/                        # 静的ファイル
│   └── icons/
│
├── src/
│   ├── app/                       # Next.js App Router
│   │   ├── layout.tsx             # ルートレイアウト（フォント・プロバイダー）
│   │   ├── page.tsx               # ランディング / ログイン画面
│   │   │
│   │   ├── (auth)/                # 認証グループ（ヘッダーなし）
│   │   │   ├── login/
│   │   │   │   └── page.tsx
│   │   │   └── signup/
│   │   │       └── page.tsx
│   │   │
│   │   ├── (app)/                 # 認証済みグループ
│   │   │   ├── layout.tsx         # 認証チェック
│   │   │   ├── dashboard/
│   │   │   │   └── page.tsx       # マンダラート一覧
│   │   │   └── mandalart/
│   │   │       └── [id]/
│   │   │           └── page.tsx   # エディタ画面
│   │   │
│   │   └── api/                   # Route Handlers（最小限）
│   │       └── auth/
│   │           └── callback/
│   │               └── route.ts   # OAuth コールバック
│   │
│   ├── components/                # UI コンポーネント
│   │   ├── ui/                    # 汎用 UI（ボタン・モーダル・トーストなど）
│   │   │   ├── Button.tsx
│   │   │   ├── Modal.tsx
│   │   │   ├── BottomSheet.tsx
│   │   │   ├── Toast.tsx
│   │   │   └── ...
│   │   │
│   │   ├── auth/                  # 認証関連
│   │   │   ├── LoginForm.tsx
│   │   │   └── OAuthButtons.tsx
│   │   │
│   │   ├── dashboard/             # ダッシュボード関連
│   │   │   ├── MandalartCard.tsx  # カード（ミニプレビュー付き）
│   │   │   ├── MandalartGrid.tsx  # カード一覧
│   │   │   └── SearchBar.tsx
│   │   │
│   │   └── editor/                # エディタ関連
│   │       ├── EditorLayout.tsx   # エディタ全体レイアウト
│   │       ├── Breadcrumb.tsx     # パンくずリスト（ミニプレビュー付き）
│   │       ├── GridView3x3.tsx    # 3×3 表示
│   │       ├── GridView9x9.tsx    # 9×9 表示
│   │       ├── Cell.tsx           # 単一セル
│   │       ├── CellEditModal.tsx  # セル編集モーダル / ボトムシート
│   │       ├── ParallelNav.tsx    # 並列ナビゲーション（← →）
│   │       ├── SidePanel.tsx      # 右サイドパネル（メモ・ストック）
│   │       ├── MemoTab.tsx        # メモタブ（Markdown エディタ）
│   │       └── StockTab.tsx       # ストックタブ
│   │
│   ├── lib/                       # ビジネスロジック・ユーティリティ
│   │   ├── supabase/
│   │   │   ├── client.ts          # Supabase クライアント（ブラウザ用）
│   │   │   └── server.ts          # Supabase クライアント（サーバー用）
│   │   │
│   │   ├── api/                   # API 関数（api-spec.md に対応）
│   │   │   ├── auth.ts
│   │   │   ├── mandalarts.ts
│   │   │   ├── grids.ts
│   │   │   ├── cells.ts
│   │   │   ├── stock.ts
│   │   │   ├── storage.ts
│   │   │   └── transfer.ts        # インポート / エクスポート
│   │   │
│   │   ├── realtime.ts            # Realtime サブスクリプション
│   │   ├── offline.ts             # オフラインキャッシュ（IndexedDB）
│   │   │
│   │   └── utils/
│   │       ├── grid.ts            # グリッド操作のユーティリティ
│   │       ├── dnd.ts             # D&D ルール判定ロジック
│   │       ├── import-parser.ts   # テキスト / Markdown → GridSnapshot パーサー
│   │       └── export.ts          # PDF / PNG / CSV 出力ユーティリティ
│   │
│   ├── store/                     # 状態管理（Zustand）
│   │   ├── editorStore.ts         # エディタの現在状態（表示グリッド・モードなど）
│   │   ├── undoStore.ts           # Undo / Redo スタック
│   │   └── clipboardStore.ts      # カット / コピー状態
│   │
│   ├── hooks/                     # カスタム React フック
│   │   ├── useGrid.ts             # グリッドデータの取得・更新
│   │   ├── useRealtime.ts         # Realtime サブスクリプション管理
│   │   ├── useUndo.ts             # Undo / Redo 操作
│   │   ├── useDragAndDrop.ts      # D&D ハンドラー
│   │   └── useOffline.ts          # オフライン状態の検知・同期
│   │
│   ├── types/
│   │   └── index.ts               # 共通型定義（api-spec.md に対応）
│   │
│   └── constants/
│       ├── colors.ts              # プリセットカラー定義
│       └── tabOrder.ts            # Tab 移動順（5→8→7→4→1→2→3→6→9）
│
├── supabase/                      # Supabase ローカル開発設定
│   ├── migrations/                # DB マイグレーション SQL
│   │   ├── 001_create_mandalarts.sql
│   │   ├── 002_create_grids.sql
│   │   ├── 003_create_cells.sql
│   │   └── 004_create_stock_items.sql
│   └── seed.sql                   # 開発用シードデータ
│
├── .env.local                     # 環境変数（git 管理外）
├── next.config.ts
├── tailwind.config.ts
├── tsconfig.json
└── package.json
```

---

## 主要な設計方針

### 1. ビジネスロジックの分離

```
コンポーネント（components/）
    ↓ フックを通じて呼び出す
カスタムフック（hooks/）
    ↓ API 関数を呼び出す
API 層（lib/api/）
    ↓ Supabase SDK を使用
Supabase
```

コンポーネントが直接 Supabase を呼ばないことで、将来のネイティブアプリへの移植時に `lib/api/` と `types/` をそのまま流用できる。

### 2. SSR の最小化

エディタのコア機能はすべてクライアントコンポーネント（`'use client'`）として実装。
Server Components は認証チェックとメタデータ生成のみに使用。

### 3. ルートグループによる画面分離

- `(auth)/` : 未認証ユーザー向け（ログイン・サインアップ）
- `(app)/` : 認証済みユーザー向け（ダッシュボード・エディタ）

### 4. 状態管理の役割分担

| Store | 役割 |
|-------|------|
| `editorStore` | 現在表示中のグリッド ID・表示モード（3×3 / 9×9）・パンくず情報 |
| `undoStore` | 操作履歴スタック（Undo / Redo） |
| `clipboardStore` | カット / コピーしたセルの一時保持 |

サーバー状態（DB データ）は Zustand ではなくカスタムフック内で管理し、Realtime で更新を受け取る。

---

## 環境変数

```bash
# .env.local

NEXT_PUBLIC_SUPABASE_URL=https://xxxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=xxxx
```
