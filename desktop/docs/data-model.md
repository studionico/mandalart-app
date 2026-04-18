# データモデル設計 — マンダラート デスクトップアプリ

## 概要

ローカル SQLite を一次ストレージとして使う。Supabase クラウド同期が有効な場合はそちらにも `updated_at` last-write-wins で双方向同期する。

各テーブルには同期用の `synced_at` / `remote_id` カラムと、ソフトデリート用の `deleted_at` カラムを持つ。

---

## テーブル構成

### mandalarts

マンダラート (ボード) を表す。

```sql
CREATE TABLE mandalarts (
  id            TEXT PRIMARY KEY,           -- UUID
  title         TEXT NOT NULL DEFAULT '',   -- ルート中心セル text のキャッシュ (updateCell 経由で自動同期)
  root_cell_id  TEXT NOT NULL,              -- 並列ルートグリッド群が共有する中心セル id
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now')),
  synced_at     TEXT,                       -- 最終クラウド同期日時
  remote_id     TEXT,                       -- Supabase 側の ID
  deleted_at    TEXT                        -- ソフトデリート (NULL = 未削除)
);
```

> **title は独立した値ではなく、ルートグリッドの中心セル (position = 4) のテキストをキャッシュしたもの。**`lib/api/cells.ts` の `updateCell` がルート中心セルの更新を検知して自動的に同期する。別途「ファイル名を付けて保存」するフローは無い。
>
> **`root_cell_id` は並列ルートグリッドの中心共有を実現するキー**。`getRootGrids(mandalartId)` は `WHERE mandalart_id = ? AND center_cell_id = root_cell_id` を使って並列ルートを列挙する。

---

### grids

3×3 の 1 ユニット (グリッド) を表す。

```sql
CREATE TABLE grids (
  id              TEXT PRIMARY KEY,
  mandalart_id    TEXT NOT NULL,             -- FK 制約は張らない (下記参照)
  center_cell_id  TEXT NOT NULL,             -- このグリッドの中心セル (position=4 相当) の cells.id
  sort_order      INTEGER NOT NULL DEFAULT 0, -- 並列順序 (← → ナビゲーション順)
  memo            TEXT,                      -- Markdown メモ
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now')),
  synced_at       TEXT,
  remote_id       TEXT,
  deleted_at      TEXT
);

CREATE INDEX idx_grids_mandalart    ON grids(mandalart_id);
CREATE INDEX idx_grids_center_cell  ON grids(center_cell_id, sort_order);
CREATE INDEX idx_grids_deleted_at   ON grids(deleted_at);
```

> **ローカルスキーマでは `grids.mandalart_id` / `grids.center_cell_id` に FK 制約を付けていない。** 理由は後述の「FK 制約を張らない理由」を参照。

**`center_cell_id` の意味**:
- **root グリッド** (`mandalart_id` 直下) → 自グリッド内 (`grid_id == grid.id`) の `position=4` の cell を指す
- **子グリッド** (drill で生まれたグリッド) → 親グリッドに属する drill 元 cell (旧 X) を指す。**子グリッドには `position=4` の cell 行は存在しない**
- **並列グリッド** (同一 `center_cell_id` を共有する複数 grid) → 中心セルが DB レベルで共有される (中心変更時に片方だけ変わるバグが起きない)

---

### cells

グリッド内の 1 マスを表す。

```sql
CREATE TABLE IF NOT EXISTS cells (
  id          TEXT PRIMARY KEY,
  grid_id     TEXT NOT NULL,                 -- FK 制約は張らない
  position    INTEGER NOT NULL CHECK (position BETWEEN 0 AND 8),
  text        TEXT NOT NULL DEFAULT '',
  image_path  TEXT,                          -- `$APPDATA/images/...` への相対パス
  color       TEXT,                          -- プリセットカラーのキー (例: "red", "blue")
  done        INTEGER NOT NULL DEFAULT 0,    -- チェックボックス (0 = 未、1 = 完了)
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
  synced_at   TEXT,
  remote_id   TEXT,
  deleted_at  TEXT,
  UNIQUE(grid_id, position)
);

CREATE INDEX IF NOT EXISTS idx_cells_grid       ON cells(grid_id);
CREATE INDEX IF NOT EXISTS idx_cells_deleted_at ON cells(deleted_at);
CREATE INDEX IF NOT EXISTS idx_cells_done       ON cells(done);
```

---

### stock_items

ストックエリアの保管アイテム。セルとサブツリー全体の JSON スナップショット。

```sql
CREATE TABLE IF NOT EXISTS stock_items (
  id          TEXT PRIMARY KEY,
  snapshot    TEXT NOT NULL,                 -- JSON (CellSnapshot 型)
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
```

---

## Position マッピング (0 インデックス)

```
┌───┬───┬───┐
│ 0 │ 1 │ 2 │
├───┼───┼───┤
│ 3 │ 4 │ 5 │    4 = 中央 (テーマセル)
├───┼───┼───┤
│ 6 │ 7 │ 8 │
└───┴───┴───┘
```

**Tab 移動順**: `4 → 7 → 6 → 3 → 0 → 1 → 2 → 5 → 8 → 4` (ループ)

インポート時の周辺セル配置順も同じ順 (`TAB_ORDER` から中央を除いたもの)。

---

## 階層構造

```
mandalart
  └── root grid R (9 cells: position 0-8)
        ├── R.center_cell_id → R.cells[4]                      ← ルートの中心は自分自身の cell
        └── cells[0..8] の内、周辺 cell (0-3, 5-8) のどれかを drill:
              └── child grid G (8 cells: position 0-3, 5-8)
                    ├── G.center_cell_id → R.cells[X] (drill 元)  ← 中心は親の周辺 cell
                    └── G の周辺 cell を drill → さらに子 grid ...

並列グリッド: G と G2 が R.cells[X] を中心共有
  └── G1.center_cell_id == G2.center_cell_id == R.cells[X].id  (sort_order で順序付け)
```

- **root グリッド** は自グリッド内の `position=4` cell (9 cells のうちの中央) を中心に持つ
- **子グリッド** は自グリッド内に `position=4` の cell を持たない (8 cells のみ)。代わりに `center_cell_id` で親グリッドの drill 元 cell を参照する
- **並列グリッド** は同じ `center_cell_id` を共有する複数の grid。`sort_order` で並列順を管理

---

## TypeScript 型定義

```typescript
// desktop/src/types/index.ts

export type Mandalart = {
  id: string
  user_id: string       // ローカル作成時は空文字 / cloud 側は Supabase auth.users.id
  title: string         // ルート中心セルのキャッシュ
  created_at: string
  updated_at: string
  deleted_at?: string | null
}

export type Grid = {
  id: string
  mandalart_id: string
  center_cell_id: string     // 中心セル (position=4 相当) の cells.id
  sort_order: number
  memo: string | null
  created_at: string
  updated_at: string
  deleted_at?: string | null
}

export type Cell = {
  id: string
  grid_id: string
  position: number      // 0〜8 (4 = 中央)
  text: string
  image_path: string | null
  color: string | null
  created_at: string
  updated_at: string
  deleted_at?: string | null
}

export type StockItem = {
  id: string
  user_id: string
  snapshot: CellSnapshot
  created_at: string
}

// スナップショット型 (ストック保存 / インポート / エクスポート 共通)

export type CellSnapshot = {
  cell: Pick<Cell, 'text' | 'image_path' | 'color'>
  children: GridSnapshot[]
}

export type GridSnapshot = {
  grid: Pick<Grid, 'sort_order' | 'memo'>
  cells: Pick<Cell, 'position' | 'text' | 'image_path' | 'color'>[]
  /**
   * このグリッドが親のどのセル (0..8) から生えているか。
   *  - undefined: ルートグリッド、または親と並列な兄弟グリッド
   *  - 0..8: 親グリッドの該当位置セルの配下
   */
  parentPosition?: number
  children: GridSnapshot[]
}
```

---

## マイグレーション履歴

### 001_initial.sql

初期スキーマ (`mandalarts` / `grids` / `cells` / `stock_items`)。**FK 制約は張っていない** (下記参照)。

### 002_soft_delete.sql

3 テーブルに `deleted_at TEXT` カラムとインデックスを追加:

```sql
ALTER TABLE mandalarts ADD COLUMN deleted_at TEXT;
ALTER TABLE grids      ADD COLUMN deleted_at TEXT;
ALTER TABLE cells      ADD COLUMN deleted_at TEXT;

CREATE INDEX IF NOT EXISTS idx_mandalarts_deleted_at ON mandalarts(deleted_at);
CREATE INDEX IF NOT EXISTS idx_grids_deleted_at      ON grids(deleted_at);
CREATE INDEX IF NOT EXISTS idx_cells_deleted_at      ON cells(deleted_at);
```

### 003_cell_done.sql

cells にチェックボックス用の `done INTEGER` カラム (0/1、boolean として扱う) を追加:

```sql
ALTER TABLE cells ADD COLUMN done INTEGER NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS idx_cells_done ON cells(done);
```

Supabase 側は `BOOLEAN NOT NULL DEFAULT FALSE` を手動で追加する必要がある ([`cloud-sync-setup.md`](./cloud-sync-setup.md) 参照)。階層カスケード (親 → 子全チェック / 子全 → 親自動チェック) は `lib/api/cells.ts` の `toggleCellDone` で実装。

### 004_unify_center.sql

X (drill 元の周辺セル) と C (旧サブグリッド中心セル) を単一の cell 行に統一。
`grids.parent_cell_id` を廃止し、代わりに `grids.center_cell_id TEXT NOT NULL` を導入する。

**全テーブル DROP & CREATE**。未公開アプリのため既存データは保持しない。
スキーマの詳細は本ドキュメントの「grids / cells」節を参照。

以降、`lib/api/grids.ts` の `createGrid` は次のように動作する:
- **root (`center_cell_id = null` 指定)**: 新規 center cell + grid + 8 peripherals を INSERT (計 9 cells)
- **child (`center_cell_id = <parent_peripheral.id>` 指定)**: grid + 8 peripherals のみ INSERT (center は親の cell を再利用)

Supabase 側も同じ schema 変更 (`parent_cell_id` DROP → `center_cell_id TEXT NOT NULL` ADD) が必要。詳細は [`cloud-sync-setup.md`](./cloud-sync-setup.md)。

---

## FK 制約を張らない理由

本来は `grids.mandalart_id → mandalarts.id`、`grids.center_cell_id → cells.id`、`cells.grid_id → grids.id` に FK を張りたいところだが、以下 2 点の理由で全て外している:

1. **循環 FK カスケード問題**: `grids.center_cell_id → cells` と `cells.grid_id → grids` の組み合わせは、マンダラート削除時に `mandalarts → grids → cells → grids → cells → ...` と循環カスケードが再帰し、SQLite の "too many levels of trigger recursion" (1000 レベル上限) に引っかかる
2. **接続プールと PRAGMA の不整合**: `tauri-plugin-sql` の sqlx プールは `PRAGMA foreign_keys` を接続ごとに独立管理し、`BEGIN / COMMIT / defer_foreign_keys` をかけても効かないことがある。結果として pull 中に接続が変わると FK 違反になる

そのため、カスケード削除 / ソフトデリートのカスケードはすべて API 層 (`lib/api/`) で明示的に実装している。

- `deleteMandalart` → cells / grids / mandalarts の順に UPDATE で `deleted_at` をセット
- `deleteGrid` → 子孫の cells / grids を再帰的にソフトデリート
- `pasteCell` cut モード → 子グリッドを `deleteGrid` で論理削除

---

## SQLite 設定

### 接続・PRAGMA

[`lib/db/index.ts`](../src/lib/db/index.ts) で初回接続時に以下を設定:

```typescript
db = await Database.load('sqlite:mandalart.db')
await db.execute('PRAGMA journal_mode = WAL')     // reader と writer の並行動作を許可
await db.execute('PRAGMA busy_timeout = 5000')    // ロック遭遇時に最大 5 秒待機
```

**WAL モードは必須**。これが無いと sync の書き込み中にダッシュボードの読み込みが走ると "database is locked" (SQLITE_BUSY) になる。

### マイグレーション自動適用

```rust
// src-tauri/src/lib.rs
tauri_plugin_sql::Builder::new()
    .add_migrations("sqlite:mandalart.db", vec![
        Migration { version: 1, description: "initial schema", sql: include_str!("../migrations/001_initial.sql"), kind: MigrationKind::Up },
        Migration { version: 2, description: "add deleted_at columns for soft delete", sql: include_str!("../migrations/002_soft_delete.sql"), kind: MigrationKind::Up },
        Migration { version: 3, description: "add done column to cells", sql: include_str!("../migrations/003_cell_done.sql"), kind: MigrationKind::Up },
        Migration { version: 4, description: "unify X and C: replace grids.parent_cell_id with grids.center_cell_id", sql: include_str!("../migrations/004_unify_center.sql"), kind: MigrationKind::Up },
    ])
    .build()
```

### DB ファイルの場所

| OS | パス |
|----|------|
| macOS | `~/Library/Application Support/jp.mandalart.app/mandalart.db` |
| Windows | `%APPDATA%\jp.mandalart.app\mandalart.db` |
| Linux | `~/.local/share/jp.mandalart.app/mandalart.db` |

### Tauri パーミッション (`src-tauri/capabilities/default.json`)

- `core:default` + `core:window:*`
- `opener:default`
- `sql:default` + `sql:allow-execute`
- `global-shortcut:default` + `allow-register/unregister/is-registered`
- `fs:default` + `allow-read-file/write-file/mkdir/remove/exists` + `fs:scope` (AppData / Desktop / Downloads / Pictures 等)
- `updater:default`, `process:default`, `process:allow-restart`
- `deep-link:default`

---

## Supabase 同期

### 同期用カラム

- `synced_at`: 最後に cloud へ push した時点の `updated_at` をコピー
- `remote_id`: 将来的にローカル ID と cloud ID がずれる場合の予備 (現状は同じ UUID を使う)

### 競合解決 (last-write-wins)

- `updated_at` が新しい方を優先
- ソフトデリートも `deleted_at` の最新値が勝つ

### 同期モジュール (実装済み)

```
desktop/src/lib/sync/
├── push.ts     ローカルの dirty 行 (synced_at < updated_at) を Supabase へ upsert
├── pull.ts     Supabase から全行を取得し、updated_at 比較で local に反映
└── index.ts    syncAll = pullAll → pushAll の順で実行
```

- `push.ts` は per-row upsert + failure aggregation (1 行の失敗が全体を止めない)
- `pull.ts` は pull → local update の順で、`deleted_at` も含めて伝播
- `realtime.ts` は `postgres_changes` を購読、`subscribeRemoteChanges` で全テーブル同時購読 + 300ms debounce

Supabase 側のスキーマセットアップ (FK 削除、`deleted_at` カラム追加、Realtime publication への追加) は [`cloud-sync-setup.md`](./cloud-sync-setup.md) 参照。
