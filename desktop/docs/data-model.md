# データモデル設計 — マンダラート デスクトップアプリ

## 概要

ローカル SQLite を一次ストレージとして使用する。
将来の Supabase 同期に備え、`synced_at` / `remote_id` カラムを各テーブルに保持する。

---

## テーブル構成

### mandalarts

マンダラート（ボード）を表す。

```sql
CREATE TABLE IF NOT EXISTS mandalarts (
  id          TEXT PRIMARY KEY,           -- UUID
  title       TEXT NOT NULL DEFAULT '',   -- タイトル（空=未設定）
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
  synced_at   TEXT,                       -- 最終クラウド同期日時
  remote_id   TEXT                        -- Supabase 側の ID
);
```

---

### grids

3×3 の1ユニット（グリッド）を表す。

```sql
CREATE TABLE IF NOT EXISTS grids (
  id             TEXT PRIMARY KEY,
  mandalart_id   TEXT NOT NULL REFERENCES mandalarts(id) ON DELETE CASCADE,
  parent_cell_id TEXT REFERENCES cells(id) ON DELETE CASCADE,
  -- NULL = ルートグリッド（並列含む）
  sort_order     INTEGER NOT NULL DEFAULT 0,  -- 並列順序（← → ナビゲーション順）
  memo           TEXT,                         -- Markdown メモ
  created_at     TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at     TEXT NOT NULL DEFAULT (datetime('now')),
  synced_at      TEXT,
  remote_id      TEXT
);

CREATE INDEX IF NOT EXISTS idx_grids_mandalart   ON grids(mandalart_id);
CREATE INDEX IF NOT EXISTS idx_grids_parent_cell ON grids(parent_cell_id, sort_order);
```

---

### cells

グリッド内の1マスを表す。

```sql
CREATE TABLE IF NOT EXISTS cells (
  id          TEXT PRIMARY KEY,
  grid_id     TEXT NOT NULL REFERENCES grids(id) ON DELETE CASCADE,
  position    INTEGER NOT NULL CHECK (position BETWEEN 0 AND 8),
  -- 0〜8（左上から右下、4 = 中央）
  text        TEXT NOT NULL DEFAULT '',
  image_path  TEXT,   -- ローカルファイルパスまたは DataURL
  color       TEXT,   -- プリセットカラーのキー（例: "red", "blue"）
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
  synced_at   TEXT,
  remote_id   TEXT,
  UNIQUE(grid_id, position)
);

CREATE INDEX IF NOT EXISTS idx_cells_grid ON cells(grid_id);
```

---

### stock_items

ストックエリアの保管アイテム。セル＋サブツリー全体の JSON スナップショット。

```sql
CREATE TABLE IF NOT EXISTS stock_items (
  id          TEXT PRIMARY KEY,
  snapshot    TEXT NOT NULL,   -- JSON（CellSnapshot 型）
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
```

---

## データ構造

### 階層の考え方

```
mandalart
  └── grids (parent_cell_id = NULL)  ← ルートグリッド
        ├── cells[0..8]
        │     └── grids (parent_cell_id = cell.id)  ← サブグリッド
        │           └── cells[0..8]
        │                 └── grids ...  ← 再帰的に続く
        └── grids (parent_cell_id = NULL, sort_order = 1)  ← 並列グリッド
```

- `parent_cell_id = NULL` のグリッドがルート階層（並列も含む）
- セルをクリックして掘り下げると、そのセルを `parent_cell_id` とする新しいグリッドを生成
- `sort_order` で同じ `parent_cell_id` を持つグリッドの並列順序を管理

### Position マッピング（0インデックス）

```
┌───┬───┬───┐
│ 0 │ 1 │ 2 │
├───┼───┼───┤
│ 3 │ 4 │ 5 │   4 = 中央（テーマセル）
├───┼───┼───┤
│ 6 │ 7 │ 8 │
└───┴───┴───┘
```

---

## TypeScript 型定義

```typescript
// src/types/index.ts

export type Mandalart = {
  id: string
  user_id: string       // デスクトップ版では空文字
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
  position: number      // 0〜8（4 = 中央）
  text: string
  image_path: string | null
  color: string | null
  created_at: string
  updated_at: string
}

export type StockItem = {
  id: string
  user_id: string       // デスクトップ版では空文字
  snapshot: CellSnapshot
  created_at: string
}

// ストックおよびエクスポートで使うスナップショット型
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

## SQLite 設定

### 接続

`@tauri-apps/plugin-sql` を使用。アプリ起動時にマイグレーションを自動適用する。

```rust
// src-tauri/src/lib.rs
tauri_plugin_sql::Builder::new()
    .add_migrations("sqlite:mandalart.db", vec![
        Migration {
            version: 1,
            description: "initial schema",
            sql: include_str!("../migrations/001_initial.sql"),
            kind: MigrationKind::Up,
        },
    ])
    .build()
```

### DB ファイルの場所

| OS | パス |
|----|------|
| macOS | `~/Library/Application Support/jp.mandalart.app/mandalart.db` |
| Windows | `%APPDATA%\jp.mandalart.app\mandalart.db` |

### 必要な Tauri パーミッション

```json
// src-tauri/capabilities/default.json
{
  "permissions": [
    "core:default",
    "opener:default",
    "sql:default",
    "sql:allow-execute",
    "global-shortcut:default"
  ]
}
```

---

## 将来の Supabase 同期設計

### 同期用カラム

各テーブルの `synced_at` / `remote_id` を使用:
- `remote_id`: Supabase 側の UUID
- `synced_at`: 最後にクラウドへ同期した日時

### 競合解決方針

- `updated_at` が新しい方を優先（Last Write Wins）
- 同期方向: ローカル → Supabase（push）、Supabase → ローカル（pull）
- 同期タイミング: アプリ起動時・保存時・手動

### 同期モジュール（未実装）

```
desktop/src/lib/sync/
  ├── push.ts     ローカル変更を Supabase へ送信
  ├── pull.ts     Supabase の変更をローカルに取得
  └── index.ts    syncAll() エントリーポイント
```
