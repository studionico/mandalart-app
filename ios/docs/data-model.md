# data-model.md (iOS)

iOS 版の SwiftData `@Model` 定義と desktop SQLite / Supabase Postgres スキーマとの対応表。

⚠️ **詳細な schema 仕様 (FK 排除理由 / migration 履歴 / lazy cell creation 等) は [`../../desktop/docs/data-model.md`](../../desktop/docs/data-model.md) を canonical として参照すること。** ここでは iOS 側の `@Model` 定義と field 名の対応のみ書く。

## 5 つの @Model 一覧

| @Model | iOS 側ファイル | Postgres / SQLite テーブル |
|---|---|---|
| `Mandalart` | [`../Mandalart/Models/Mandalart.swift`](../Mandalart/Models/Mandalart.swift) | `mandalarts` |
| `Grid` | [`../Mandalart/Models/Grid.swift`](../Mandalart/Models/Grid.swift) | `grids` |
| `Cell` | [`../Mandalart/Models/Cell.swift`](../Mandalart/Models/Cell.swift) | `cells` |
| `Folder` | [`../Mandalart/Models/Folder.swift`](../Mandalart/Models/Folder.swift) | `folders` |
| `StockItem` | [`../Mandalart/Models/StockItem.swift`](../Mandalart/Models/StockItem.swift) | `stock_items` (local-only、同期なし) |

## camelCase ↔ snake_case 対応表

SwiftData の `@Model` field は camelCase、Postgres / desktop SQLite は snake_case。`SyncEngine` の DTO ([`../Mandalart/Services/SyncEngine.swift`](../Mandalart/Services/SyncEngine.swift) 内の `Cloud*` 構造体) は **snake_case のまま** で受け、SwiftData に詰め替える際に変換する。

### Mandalart

| iOS (`@Model`) | Postgres / SQLite | 型 | 備考 |
|---|---|---|---|
| `id` | `id` | `String` (UUID) / `TEXT` | unique |
| `title` | `title` | `String` / `TEXT` | |
| `rootCellId` | `root_cell_id` | `String` / `TEXT` | |
| `imagePath` | `image_path` | `String?` / `TEXT` | (現状 desktop には mandalart.image_path は無い、将来用) |
| `showCheckbox` | `show_checkbox` | `Bool` / `INTEGER` | migration 007 |
| `lastGridId` | `last_grid_id` | `String?` / `TEXT` | migration 008 |
| `sortOrder` | `sort_order` | `Int?` / `INTEGER` | migration 009 |
| `pinned` | `pinned` | `Bool` / `INTEGER` | migration 009 |
| `folderId` | `folder_id` | `String?` / `TEXT` | migration 010 |
| `locked` | `locked` | `Bool` / `INTEGER` | migration 011 |
| `createdAt` / `updatedAt` / `deletedAt` / `syncedAt` | `created_at` / `updated_at` / `deleted_at` / `synced_at` | `Date` / `TEXT` (ISO8601) | 同期メタ |

### Grid

| iOS | Postgres / SQLite | 型 | 備考 |
|---|---|---|---|
| `id` | `id` | `String` | unique |
| `mandalartId` | `mandalart_id` | `String` | FK 制約は張らない (desktop と同様、循環 FK 回避のため) |
| `centerCellId` | `center_cell_id` | `String` | migration 004 で導入 |
| `parentCellId` | `parent_cell_id` | `String?` | migration 006 (並列グリッド独立化) |
| `sortOrder` | `sort_order` | `Int` | NOT NULL DEFAULT 0 |
| `memo` | `memo` | `String?` | |
| `createdAt` / `updatedAt` / `deletedAt` / `syncedAt` | (同上) | `Date` | |

### Cell

| iOS | Postgres / SQLite | 型 | 備考 |
|---|---|---|---|
| `id` | `id` | `String` | unique |
| `gridId` | `grid_id` | `String` | |
| `position` | `position` | `Int` | 0-8 (中央=4) |
| `text` | `text` | `String` | ⚠️ desktop は `text`、`content` ではない |
| `imagePath` | `image_path` | `String?` | |
| `color` | `color` | `String?` | hex / preset name |
| `done` | `done` | `Bool` / `INTEGER` | migration 003 |
| `createdAt` / `updatedAt` / `deletedAt` / `syncedAt` | (同上) | `Date` | |

⚠️ desktop schema には Cell に `subgridId` 列は存在しない。drill 階層は `Grid.parentCellId` で表現する。

### Folder

| iOS | Postgres / SQLite | 型 | 備考 |
|---|---|---|---|
| `id` | `id` | `String` | unique |
| `name` | `name` | `String` | |
| `sortOrder` | `sort_order` | `Int` | |
| `isSystem` | `is_system` | `Bool` / `INTEGER` | Inbox folder 判定 (削除拒否 / migration 010) |
| `createdAt` / `updatedAt` / `deletedAt` / `syncedAt` | (同上) | `Date` | |

### StockItem (local-only)

| iOS | SQLite | 型 | 備考 |
|---|---|---|---|
| `id` | `id` | `String` | unique |
| `snapshot` | `snapshot` | `String` | JSON 文字列 (Cell snapshot を JSON エンコード) |
| `createdAt` | `created_at` | `Date` | |

⚠️ **StockItem は同期しない**。desktop / iOS 各端末でローカル保管のみ (ストックは個人作業の一時置場という UX 上の判断)。Supabase 側にもテーブルなし。

## 実例: ID 生成 / 同期メタ

- `id`: **必ず [`IDGenerator.uuid()`](../Mandalart/Utils/IDGenerator.swift) 経由** で生成 (= `UUID().uuidString.lowercased()`)。Swift 標準の `UUID().uuidString` は大文字で desktop の `crypto.randomUUID()` (小文字) と非互換になり、`===` 比較が失敗する経路がある ([`pitfalls.md`](pitfalls.md) #6 参照)
- `createdAt` / `updatedAt`: SwiftData 側は `Date()`。Postgres 側は `now()`
- `syncedAt`: `pullAll` で `updatedAt` と同じ値に揃える / `pushPending` で push 成功時に `updatedAt` を代入
- `deletedAt`: soft delete。permanent delete は別 API (`MandalartFactory.permanentDelete`)

## 新しい列を足すフロー

1. **desktop 側 migration を canonical として作る** ([`../../desktop/src-tauri/migrations/`](../../desktop/src-tauri/migrations/)、`migration-release-check` agent を起動)
2. Supabase 側で手動 ALTER ([`../../desktop/docs/cloud-sync-setup.md`](../../desktop/docs/cloud-sync-setup.md) の手順) — **未実行だと PGRST204 thrash**
3. iOS 側の `@Model` に field 追加 ([`../Mandalart/Models/`](../Mandalart/Models/))
4. `SyncEngine` の `Cloud*` DTO に追加、`pullAll` の `select(...)` 列、`pushPending` の payload にも追加 ([`../Mandalart/Services/SyncEngine.swift`](../Mandalart/Services/SyncEngine.swift))
5. 本ファイルの対応表を更新
6. iOS Simulator のアプリを削除して新スキーマでクリーン起動 (SwiftData の VersionedSchema を入れていないため、現状は wipe が必要)

## SwiftData 内部の persistent store

SwiftData は内部で SQLite を使う。store path は通常:

```
~/Library/Developer/CoreSimulator/Devices/<device-id>/data/Containers/Data/Application/<app-id>/Library/Application Support/default.store
```

直接 sqlite3 で開いて検証することは可能だが、通常は不要。SwiftData の `@Query` / `FetchDescriptor` 経由で読む。
