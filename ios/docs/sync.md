# sync.md (iOS)

iOS 版の Supabase 同期戦略。desktop 版と同等の last-write-wins / soft-delete 設計を踏襲する。

⚠️ **Supabase project / RLS / publication / 手動 ALTER 手順は [`../../desktop/docs/cloud-sync-setup.md`](../../desktop/docs/cloud-sync-setup.md) を canonical として参照。** 本ファイルは iOS 側の SyncEngine 実装詳細のみ書く。

## 概要

```
iOS                                     Supabase
┌──────────────┐                       ┌────────────┐
│ SwiftData    │                       │ Postgres   │
│ ModelContext │ <--- pullAll() ------ │  + RLS     │
│              │ ---- pushPending() -> │  + Realtime│
└──────────────┘                       └────────────┘
```

- 実装: [`../Mandalart/Services/SyncEngine.swift`](../Mandalart/Services/SyncEngine.swift)
- 認証: [`../Mandalart/ViewModels/AuthStore.swift`](../Mandalart/ViewModels/AuthStore.swift) (supabase-swift `Auth` モジュール)
- supabase 共有 instance: [`../Mandalart/Services/SupabaseService.swift`](../Mandalart/Services/SupabaseService.swift) (umbrella `SupabaseClient`)
- 同期トリガ UI: [`../Mandalart/Views/SettingsView.swift`](../Mandalart/Views/SettingsView.swift) の「今すぐ同期」ボタン (Phase 0-3 時点は手動のみ、自動同期は Phase 3 残作業)

> **注**: 旧 Obsidian 風 Markdown vault も、その後継の一方向ローカル JSON ミラーも撤去された (2026-06-08)。
> ローカルファイル保存は廃止し、クラウド同期 + 手動 export ([`TransferService`](../Mandalart/Services/TransferService.swift)) に
> 一本化した。同期経路にローカルミラー由来の gate は存在しない。

## pullAll (cloud → local)

### 流れ

1. 4 テーブルを並列 fetch (`folders` / `mandalarts` / `grids` / `cells`)
2. 各行について local の `id` で既存検索:
   - 存在しない → INSERT (新規 SwiftData オブジェクト作成)
   - 存在する + cloud `updated_at` > local `updatedAt` → UPDATE (フィールドを cloud で上書き)
   - 存在する + cloud `updated_at` ≦ local → スキップ
3. INSERT / UPDATE 時は `syncedAt = updatedAt` をセット (= cloud と一致した印)
4. `context.save()` で SwiftData の永続化

### desktop 版との同等性

desktop の [`pull.ts`](../../desktop/src/lib/sync/pull.ts) と同じロジック。`folders` を最初に upsert するのは `mandalarts.folder_id` の参照先を先に揃えるため。

### StockItem は除外

`stock_items` は local-only なので pull しない。

## 画像同期 (Supabase Storage `cell-images`)

`cells.image_path` (= ローカル相対パス `images/<cellId>-<ts>.jpg`) は通常の cell 同期で push/pull されるが、画像**本体**は別途 Storage バケット `cell-images` (非公開) に同期する。実装は [`ImageStorage`](../Mandalart/Services/ImageStorage.swift)。

- **キー**: `<userId>/<basename(image_path)>`。`userId` は **`session.user.id.uuidString.lowercased()`** (Postgres `auth.uid()::text` は小文字、`UUID.uuidString` は大文字 → 揃えないと RLS 403 / desktop とキー不一致、落とし穴 #23)。
- **upload**: `saveImage` 時に JPEG (1200pt/q0.7) を `uploadToCloud` で best-effort アップロード (`upsert: true`)。
- **download fallback**: [`CellView`](../Mandalart/Views/Components/CellView.swift) の `.task(id: imagePath)` で、ローカルに実ファイルが無ければ `downloadFromCloud` で取得 → ローカルにキャッシュして表示。
- **backfill**: fullSync ([`MandalartApp`](../Mandalart/App/MandalartApp.swift)) / 手動「今すぐ同期」([`SettingsView`](../Mandalart/Views/SettingsView.swift)) の後に `SyncEngine.backfillImages` → `ImageStorage.backfillUpload` が、`<userId>/` の既存キー一覧と差分のローカル画像だけアップロード (オフライン追加分の回収)。
- **削除**: v1 では Storage 側を消さない (`image_path` 共有あり、orphan 整理は将来)。
- Storage は **Realtime Messages quota とは無関係** (緊急停止中の同期問題を悪化させない)。
- バケット + RLS policy の作成手順は [`../../desktop/docs/cloud-sync-setup.md`](../../desktop/docs/cloud-sync-setup.md) の「必須: 画像同期用 Storage バケット」(desktop と共有、canonical)。

## pushPending (local → cloud)

### 流れ

1. 各テーブルから dirty 行を抽出: `syncedAt == nil OR syncedAt < updatedAt`
2. dirty 行を Codable payload に変換し `client.from(table).upsert([...]).execute()`
3. 成功したら local の `syncedAt = updatedAt` をセット

**cells のみ `onConflict: "grid_id,position"` を指定する** (desktop [`push.ts`](../../desktop/src/lib/sync/push.ts) と対称)。複数デバイス / 歴史的な sync ズレで同じ `(grid_id, position)` に local / cloud で別 id の cell が並ぶと、PK (id) ベース upsert では INSERT 扱いになり cloud の `UNIQUE(grid_id, position)` に弾かれる (`code 23505`)。onConflict を一意制約側に指定すると「既存行を local 内容で UPDATE」= local 勝ちになる。cells は leaf で他テーブルから id 参照されない (`grids.center_cell_id` は grid 単位 1 行) ので cloud 側 id が変わっても整合性に影響なし。grids / folders / mandalarts は PK のまま。

### user_id 必須カラム

`folders` と `mandalarts` の payload には **`user_id`** を含める必要がある (Supabase の RLS policy が `auth.uid() = user_id` をチェック)。

```swift
// SyncEngine.swift より
"user_id": .string(userId),
```

`grids` と `cells` は `user_id` 列なし — 親 `mandalart_id` 経由で所有権を継承する RLS policy が組まれているため。

### 認証必須

```swift
guard let session = try? await client.auth.session else {
    throw SyncError.notSignedIn
}
let userId = session.user.id.uuidString
```

未サインインだと `SyncError.notSignedIn` を throw する。

## 競合解決 (last-write-wins)

両方向同期だが、競合時は **`updated_at` (cloud) > `updatedAt` (local) なら cloud 採用** で上書き。逆 (local が新しい) なら次回 push で cloud に反映される。

両端の編集が同じ `updatedAt` ms 解像度で衝突するケースは、現状では cloud が勝つ (= push 後の next pull で local が上書きされる)。実用上は ms オーダーの同時編集はほぼ起きないので問題視していない。

## Date 形式

- Postgres `TIMESTAMPTZ` は ISO8601 with fractional seconds (例: `2026-04-15T10:30:00.123456+00:00`)
- SyncEngine は `ISO8601DateFormatter(formatOptions: [.withInternetDateTime, .withFractionalSeconds])` で parse
- フォールバックで標準 `.iso8601` でも parse 試行 (古い行 / fractional なし)

## 落とし穴 (desktop 版と共通)

iOS 側でも同等の対策が必要:

- **#12 zombie cleanup** (push 失敗 thrash): `synced_at IS NULL` のまま soft-delete された行や親 mandalart が消えた zombie grid/cell は、push のたびに RLS 403 で失敗 → ロック待ち連鎖。**iOS 側は現状未実装** (Phase 3 残作業)。実装時は desktop の [`push.ts`](../../desktop/src/lib/sync/push.ts) の `syncAwareDelete` / `skipOrphanDirtyDelete` 戦略を参考にする
- **#17 PGRST204 thrash** (column not found): スキーマ変更時に Supabase 手動 ALTER を実行しないと発生。両プラットフォーム共通
- **Realtime DELETE は子行を連鎖しない** (#5): postgres_changes で親 mandalart の DELETE イベントが来ても、子 grid/cell の DELETE は来ない。realtime ハンドラ実装時 (Phase 3 残) は明示カスケード必須

詳細は [`../../desktop/CLAUDE.md`](../../desktop/CLAUDE.md) の落とし穴節 #2 / #5 / #10 / #12 / #17 を参照。

## realtime 購読 + 自動同期 (実装済)

### scene phase ベース自動同期 ([`MandalartApp`](../Mandalart/App/MandalartApp.swift))

- サインイン直後 (`.task(id: auth.isSignedIn)`): 初回フル同期 (pull → push)
- フォアグラウンド復帰 (`scenePhase == .active`): pullAll
- バックグラウンド遷移 (`scenePhase == .background`): pushPending
- realtime 取りこぼしの保険 (= desktop 側 visibility resync 相当)

### realtime 購読 ([`RealtimeService`](../Mandalart/Services/RealtimeService.swift))

- サインイン時に `client.realtime.channel("mandalart-app").onPostgresChange(AnyAction.self, schema: "public", table: T)` を 4 テーブル (folders / mandalarts / grids / cells) で購読
- **任意の change で 1 秒 debounce の `pullAll` を発火** する単純化方式 (incremental upsert ではない)。理由: 子行の cascade DELETE が realtime では届かない (落とし穴 #5)、incremental update で取りこぼしを再現するのは複雑、`last-write-wins` で冪等な pullAll なら自分自身の echo も無害
- サインアウト時に `unsubscribe` で channel 切断

## permanent delete の cloud 連動 (実装済)

[`MandalartFactory.permanentDelete`](../Mandalart/Services/MandalartFactory.swift) は **local 物理削除後に Supabase 側でも cascade delete** する:

1. ローカル削除 (cells → grids → mandalart)
2. サインイン中なら cloud 側 `cells WHERE grid_id IN (...)` → grids → mandalarts の順で cascade delete
3. cloud 削除失敗 / 未サインイン時は **`CloudDeleteTombstone` に id を積む** ([`Services/CloudDeleteTombstone.swift`](../Mandalart/Services/CloudDeleteTombstone.swift)、UserDefaults 永続)
4. 次回 [`SyncEngine.pullAll`](../Mandalart/Services/SyncEngine.swift) 冒頭で `drainCloudDeleteTombstones` が tombstone を drain (= cascade cloud delete をリトライ) し、成功した id は除去

これがないとオフライン削除 → 再サインインで **「マンダラートが zombie 復活して再削除が必要」** になる (落とし穴 #6 の典型パターン)。tombstone は永続化されるので、アプリを kill/再起動しても削除予定 id は失われない。

## zombie cleanup (実装済)

[`SyncEngine.sanitizeZombies`](../Mandalart/Services/SyncEngine.swift) は **`pullAll` / `pushPending` の冒頭で参照整合性をサニタイズ** する (落とし穴 #12 対策):

1. 親 `mandalart_id` が local SwiftData に存在しない `Grid` 行 → hard delete
2. 残った grid id 集合に対して、孤立した `Cell` (= 親 `grid_id` が無い行) → hard delete

**背景**: 過去のバグ (削除時の子残り / 部分 sync で分裂 / クラッシュ中断) で生まれた zombie 行が `synced_at == nil` のまま push されると RLS 403 / FK 23503 で失敗 → push のたびに同じ失敗が連鎖して全体パフォーマンスが劣化する (= push thrash、desktop 側で実測 1 往復 225ms 遅延)。

サニタイズは pull / push の毎回冒頭で走るが、zombie が無ければ no-op (= ほぼ無料)。**新しい DELETE 経路を追加するときは、サニタイズに頼らず子連鎖を明示削除すること** (= サニタイズはバグの silent な隠蔽になり得るため、desktop 落とし穴 #12 の警告と同じ)。

## (grid_id, position) 重複の dedup / reconcile (実装済)

cloud cells は `UNIQUE(grid_id, position)` を持つ。desktop は local SQLite にも同制約があるため重複が物理的に作れないが、**SwiftData は複合 unique を宣言できない**ため iOS はコードで担保する。3 段構え:

1. **push の onConflict** ([`pushPending`](../Mandalart/Services/SyncEngine.swift)): cells のみ `onConflict: "grid_id,position"`。同 (grid_id, position) で別 id の cloud 行があれば local 値で UPDATE (上記 pushPending 節参照)。
2. **push 前 dedup** ([`SyncEngine.dedupCellsByPosition`](../Mandalart/Services/SyncEngine.swift)): `sanitizeZombies` の直後 (pull / push 両方の冒頭) で、同 `(gridId, position)` を持つ複数 Cell を `updatedAt` 最新 1 行に集約し他を hard delete。これがないと batch upsert の配列内に同 (grid_id, position) が複数入り Postgres `21000` (ON CONFLICT DO UPDATE cannot affect row a second time) を誘発する。既に corrupt した local DB の healing も兼ねる。
3. **pull の reconcile** ([`SyncEngine.upsertCell`](../Mandalart/Services/SyncEngine.swift)): cloud cell を INSERT する前に、同 `(gridId, position)` を持つ別 id の local を削除 (= pull は cloud 勝ちで cloud の id 体系に寄せる)。これで pull が新たな重複を作る経路を塞ぐ。`updatedAt` 比較はここでは挟まない (挟むと同 position に 2 行残り得るため)。

実行順序: **sanitizeZombies → dedupCellsByPosition → (pull: upsertCell 内 reconcile) → push (onConflict)**。

## 未実装 (Phase 3 残作業)

- **OAuth サインイン (Google / GitHub)**: 現状 Email のみ。OAuth は `Associated Domains` capability + `onOpenURL` で deep link を受ける必要がある
