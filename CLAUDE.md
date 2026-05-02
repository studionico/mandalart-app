# CLAUDE.md

このファイルは Claude Code (claude.ai/code) がこのリポジトリで作業する際のガイドです。
詳細なルール・仕様は [`desktop/docs/`](desktop/docs/) に分散しているので、ここはコマンド・構造・行動指針・docs ポインタに絞る。

## プロジェクト概要

マンダラート — 3×3 グリッドで思考を階層的に展開する Tauri v2 デスクトップアプリ (Vite + React 19 + TypeScript + SQLite)。アクティブなコードは [`desktop/`](desktop/) 配下。[`_old_web/`](_old_web/) は旧 Next.js 試作でメンテ停止。

## タスク逆引き index

作業を始める前に該当行を確認し、先に docs を読むこと。

| 触るもの | 先に読む docs |
|---|---|
| セルの見た目・操作 | [`requirements.md`](desktop/docs/requirements.md), [`typography.md`](desktop/docs/typography.md) |
| D&D / 4 アクションアイコン / 中心セル禁止 ルール | [`requirements.md`](desktop/docs/requirements.md) "セルのドラッグ＆ドロップ" 節 |
| アニメーション (slide / orbit / view-switch / morph) | [`animations.md`](desktop/docs/animations.md) |
| クロスルート morph (エディタ ↔ ダッシュボード ↔ ストック の収束/拡大) | [`animations.md`](desktop/docs/animations.md) "Converge Overlay" 節, [`ConvergeOverlay.tsx`](desktop/src/components/ConvergeOverlay.tsx), [`convergeStore.ts`](desktop/src/store/convergeStore.ts) |
| API (lib/api) | [`api-spec.md`](desktop/docs/api-spec.md), [`data-model.md`](desktop/docs/data-model.md) |
| DB スキーマ変更 | [`data-model.md`](desktop/docs/data-model.md), [`cloud-sync-setup.md`](desktop/docs/cloud-sync-setup.md) |
| 同期・realtime | 本ファイル「落とし穴」節, [`cloud-sync-setup.md`](desktop/docs/cloud-sync-setup.md) |
| セキュリティ / RLS 確認 | [`security.md`](desktop/docs/security.md) |
| リリース・更新 | [`updater-setup.md`](desktop/docs/updater-setup.md), [`.github/workflows/release.yml`](.github/workflows/release.yml) |
| フォルダ構成 | [`folder-structure.md`](desktop/docs/folder-structure.md) |

## コマンド / 検査 (すべて `desktop/` から)

| コマンド | 用途 | タイミング |
|---|---|---|
| `npm run dev` | Vite dev サーバー (UI 反復用) | 手動 |
| `npm run tauri dev` | Tauri dev (SQLite / fs 含む機能確認) | 手動 |
| `npm run typecheck` | `tsc --noEmit` | **pre-commit** + CI |
| `npm run lint` | ESLint (autofix: `lint:fix`) | **pre-commit** (staged のみ) + CI |
| `npm test` | Vitest (watch: `test:watch`) | CI |
| `npm run build` | Vite 本番ビルド | CI |
| `npm run tauri build` | ネイティブ .dmg / .msi ビルド | リリース時 |

- **pre-commit hook** ([`.husky/pre-commit`](desktop/.husky/pre-commit)): `lint-staged` → `typecheck` の順。失敗で commit 拒否
- **CI** ([`ci.yml`](.github/workflows/ci.yml)): 全 branch push + PR で typecheck / lint / test / build

### プロジェクト専用 slash command

各ツールの**組合せワークフロー** (コミット前 / PR 前 / リリース前 / 週次健康診断) は [`workflows.md`](desktop/docs/workflows.md) を参照。

| コマンド | 用途 |
|---|---|
| `/sync-docs [<range>]` ([`.claude/commands/sync-docs.md`](.claude/commands/sync-docs.md)) | コード変更が `desktop/docs/` / `CLAUDE.md` に反映されているか検査する。引数は `git diff` の範囲指定 (空 = uncommitted、`HEAD~N`、`main` 等)。書込みは行わずレポートのみ返し、ユーザーが承認した後で個別に docs を更新する流れ。**migration 追加時は Supabase 手動 ALTER 漏れの警告を必ず出す** (落とし穴 #17 防止) |
| `/check-rules [<scope>]` ([`.claude/commands/check-rules.md`](.claude/commands/check-rules.md)) | 「コーディング規約」+「落とし穴一覧」違反を grep ベースで検出する (ハードコーディング / `localStorage` 直接使用 / Tauri 落とし穴 / `position === 数値` の裸比較等)。引数は走査範囲 (空 = 全 src、ファイル/glob、`--diff` で uncommitted のみ)。書込みは行わずレポートのみ返し、🔴/🟡/🟢 で優先度分類して file:line リンク + 修正案ドラフトを提示。tasks.md 29.1 の ESLint plugin 化までの繋ぎ |

### プロジェクト専用 subagent

| エージェント | 自動起動条件 / 用途 |
|---|---|
| `migration-release-check` ([`.claude/agents/migration-release-check.md`](.claude/agents/migration-release-check.md)) | リリース前 / `desktop/src-tauri/migrations/*.sql` の新規追加検知時に proactively 起動。各 migration の schema 変更について **(1) lib.rs Migration 登録、(2) cloud-sync-setup.md の Supabase 手動 ALTER 手順、(3) push.ts / pull.ts / realtime.ts の sync 配線、(4) types/index.ts の型追加** が漏れなく揃っているか網羅監査 → 漏れには copy-paste 可能な ALTER SQL を提示。落とし穴 #17 (PGRST204 thrash) 予防専用 |

## コーディング規約

### ハードコーディング禁止

マジックナンバー・繰返し文字列はコードに裸で書かず、[`desktop/src/constants/`](desktop/src/constants/) の定数を経由する。

| カテゴリ | ファイル | 代表定数 |
|---|---|---|
| グリッド構造 | [`grid.ts`](desktop/src/constants/grid.ts) | `CENTER_POSITION`, `GRID_CELL_COUNT`, `ORBIT_ORDER_*` |
| タイミング (ms) | [`timing.ts`](desktop/src/constants/timing.ts) | `ANIM_STAGGER_MS`, `ANIM_FADE_MS`, `CLICK_DELAY_MS`, `CONVERGE_DURATION_MS`, `CONVERGE_DEBUG_SLOW_FACTOR` |
| レイアウト (px) | [`layout.ts`](desktop/src/constants/layout.ts) | `OUTER_GRID_GAP_PX`, `CELL_BASE_FONT_PX`, `DASHBOARD_CARD_SIZE_PX`, `DASHBOARD_CARD_BORDER_PX`, `DASHBOARD_CARD_INSET_PX` |
| localStorage キー | [`storage.ts`](desktop/src/constants/storage.ts) | `STORAGE_KEYS.fontLevel`, `STORAGE_KEYS.theme` |
| カラー | [`colors.ts`](desktop/src/constants/colors.ts) | プリセットカラー定義 |
| Tab 順 | [`tabOrder.ts`](desktop/src/constants/tabOrder.ts) | `TAB_ORDER`, `nextTabPosition()` |

CSS 側: Tailwind gap-2 と連動する値は CSS 変数 `--outer-grid-gap` ([`index.css`](desktop/src/index.css)) で一元化。JS 側の `OUTER_GRID_GAP_PX` と値を揃えること。

**例外**: 1 ファイル 1 回で他と連動しない値、Tailwind プリセットクラスそのもの、keyframes 内の transform 全体の CSS 変数化 (WebKit 非互換) は裸で OK。

## アーキテクチャ概要

```
components/ → hooks/ → lib/api/ → lib/db/ → tauri-plugin-sql (SQLite)
                      ↘ lib/sync/ → Supabase (REST + Realtime)
```

- **データモデル**: `mandalarts → grids → cells` の再帰階層。FK 制約なし (後述)。`deleted_at` でソフトデリート。**子グリッドの中心セル行の有無は 3 パターン**: ① root / 独立並列 (migration 006+) は自グリッド所属、② X=C primary drilled は親 peripheral と共有、③ レガシー共有並列 (migration 006 未満) は primary と center_cell_id 共有 (落とし穴 #10 参照)。並列の判定は `grids.parent_cell_id` (migration 006) で統一
- **lazy cell creation** (migration 005+): 空セル行は DB に作らない。`upsertCellAt(grid_id, position)` で書込時に初めて INSERT
- **同期**: `lib/sync/` で last-write-wins (updated_at 比較)、`lib/realtime.ts` で postgres_changes 購読。マンダラート単位の UI プリファレンス (`show_checkbox`、migration 007) も同期される
- **状態**: Zustand (`editorStore` / `undoStore` / `clipboardStore` / `authStore` / `themeStore` / `convergeStore`)。マンダラート単位の永続 UI 設定は DB カラム経由 (editorStore に置かない)。`convergeStore` は App 直下の `ConvergeOverlay` が購読し、エディタ ↔ ダッシュボード ↔ ストック 間のセル ↔ カード ↔ ストックエントリ morph アニメを駆動する
- **ルーティング**: HashRouter — `/dashboard`, `/mandalart/:id`。認証ガードなし (ローカル専用モードで全機能使える)
- 詳細は [`folder-structure.md`](desktop/docs/folder-structure.md)

## タスクタイプ別チェックリスト

### アニメ変更
- [`animations.md`](desktop/docs/animations.md) を読む → 新 keyframes は `index.css`、新 timing は `constants/timing.ts` → アニメ中 `pointer-events: none` → 終了時 state pre-populate (childCounts / subGrids)

### API 関数追加
- `lib/api/` に追加 → [`api-spec.md`](desktop/docs/api-spec.md) 更新 → 定数は `constants/` 参照 → ピュア関数は Vitest テスト追加

### 定数追加
- `constants/` 該当ファイルに追加 → コメントに理由 → CSS 連動なら `--outer-grid-gap` も確認

### スキーマ変更
- [`src-tauri/migrations/`](desktop/src-tauri/migrations/) に SQL → [`lib.rs`](desktop/src-tauri/src/lib.rs) 登録 → [`data-model.md`](desktop/docs/data-model.md) 更新 → Supabase 側は [`cloud-sync-setup.md`](desktop/docs/cloud-sync-setup.md) に追記

### 同期・realtime
- DELETE ハンドラは子孫まで明示カスケード → 各ハンドラ冒頭に `payload.table` ガード → push/pull は `deleted_at` 含めて upsert

## 知っておくべき落とし穴

以下は実際にハマった問題。該当領域を触る前に頭に入れておくこと。

1. **Tauri v2 の `dragDropEnabled` が default `true` だと target 側 HTML5 DnD イベントが届かない** — Tauri が OS 側の drag-drop を横取りして webview に target 側 (`dragenter` / `dragover` / `drop`) を伝搬しないため、HTML5 標準で書いた D&D が「source 側 (`dragstart` / `dragend` / native ghost) は動くが drop 検知ができない」状態に見える。**[`tauri.conf.json`](desktop/src-tauri/tauri.conf.json) の `windows[].dragDropEnabled: false` で解決**。本リポジトリは設定済みで `useDragAndDrop` / `useDashboardDnd` 共に HTML5 D&D ベース ([`dndPayload.ts`](desktop/src/lib/utils/dndPayload.ts) で `application/x-mandalart-drag` MIME に payload を詰める)。**ただし `dragDropEnabled: false` にすると Tauri native の `getCurrentWebview().onDragDropEvent` が使えなくなる**ので、デスクトップから webview への file drop は HTML5 `dataTransfer.files` 経由 (window-level listener、[`EditorLayout.tsx`](desktop/src/components/editor/EditorLayout.tsx) の画像ファイル受付参照) で実装すること。**`<img>` の native drag は [`index.css`](desktop/src/index.css) のグローバル `img { -webkit-user-drag: none; user-select: none; }` で一括抑止**して親要素の D&D を奪わせない方針 (個別に `draggable={false}` 不要)。**helper 利用ルール**: dataTransfer の読み書きは `setDragPayload` / `getDragPayload` 経由で `application/x-mandalart-drag` MIME に統一し、`text/plain` に直接 setData/getData しない (debug 用 fallback のみ helper が併設)。drag 中のホバー判定で source 種別を見たいときは Chrome の dragover 中 `dataTransfer.types` 制限を避けるため、自前の `sourceRef` (useRef で drag 開始時に保持) を読む。**drag image の WebKit quirk**: source 要素が `position: relative` + 内部 `<img class="absolute inset-0">` + 周辺 sibling が transform animation 中、という条件下で WebKit の default drag image が他要素 (隣接カード / DragActionPanel のテキスト等) を取り込んでしまう症状が確認されている。各 dragstart で `applyCleanDragImage(e, e.currentTarget)` を呼んで `setDragImage` を明示固定する (cloneNode で off-screen に置いた clone を 1 frame だけ使う方式、[`dndPayload.ts`](desktop/src/lib/utils/dndPayload.ts))
2. **FK 制約を張らない** — `grids ↔ cells` の循環 FK が CASCADE 再帰で壊れる + `tauri-plugin-sql` のプール問題。カスケードは API 層で明示実装。詳細は [`data-model.md`](desktop/docs/data-model.md)
3. **WAL モード必須** — `PRAGMA journal_mode = WAL` + `busy_timeout = 5000` がないと sync 中に "database is locked"
4. **Realtime の table フィルタが混線する** — `postgres_changes` の `{ table: 'X' }` が効かないことがある。各ハンドラで `if (payload.table !== 'X') return` を必ず入れる
5. **Realtime DELETE は子行を連鎖しない** — cloud FK CASCADE で消えた子行の DELETE イベントは来ない + 未 push の local 子行は孤立する。各 DELETE ハンドラで `DELETE FROM cells WHERE grid_id IN (...)` のように明示カスケード
6. **完全削除は local + cloud 両方消す** — `permanentDeleteMandalart` は local DELETE 後に Supabase も消す。cloud を残すと pull で復活する
7. **`window.confirm` が Tauri WebView で動かない** — [`useTwoClickConfirm`](desktop/src/hooks/useTwoClickConfirm.ts) hook で 2 クリック確認 UI を組む (boolean / keyed の 2 形式、`TrashDialog.tsx` / `StockTab.tsx` で使用)
8. **CSS keyframes の `transform: var(--x)` は WebKit で補間されない** — 固定 keyframes 8 方向で対応。詳細は [`animations.md`](desktop/docs/animations.md)
9. **環境変数が欠損するとクラッシュ** — `lib/supabase/client.ts` がダミー URL でフォールバックし `isSupabaseConfigured` で gate
10. **中心セル行の有無は grid 種別で 3 パターン** (migration 006 以降):
    - **root / 独立並列グリッド**: 自グリッド所属の position=4 cell 行を持つ。`cells WHERE grid_id = self.id` に center 含む
    - **X=C primary drilled**: position=4 cell 行を持たず、`center_cell_id` は親 peripheral を指す。`getGrid` が merge して 9 要素提供
    - **レガシー共有並列** (migration 006 以前の残存): primary と同じ `center_cell_id` を指し、cell 行は持たない
    グリッド列挙は `parent_cell_id` ベース (`getRootGrids` / `getChildGrids`) で統一されており新旧両モデルを透過的に扱う。`setGridDone` のような grid 単位の UPDATE は自グリッド所属の cells のみが対象になる点に注意
11. **`<a download>.click()` で Tauri のダウンロードは動かない** — ブラウザと違って WebKit はサイレントに握り潰す。ファイル保存は `@tauri-apps/plugin-fs` の `writeFile` + `BaseDirectory.Download` 等で書き、toast で保存先を通知する ([`src/lib/utils/export.ts`](desktop/src/lib/utils/export.ts))
12. **push 失敗の thrash が全 DB 操作を巻き込む** — `synced_at=NULL` のまま soft-delete された「cloud に存在しない行」や親 mandalart が local から消えた zombie grid/cell は、push のたびに RLS 403 で upsert 失敗 → busy_timeout ロック待ち連鎖で関係ない query が数百 ms 遅延する (実測 1 往復 225ms)。対策: ① 削除系 API は `synced_at IS NULL` ならハードデリートする (新規実装は [`syncAwareDelete`](desktop/src/lib/api/_softDelete.ts) helper を使う、[`mandalarts.ts:deleteMandalart`](desktop/src/lib/api/mandalarts.ts) / [`grids.ts:deleteGrid`](desktop/src/lib/api/grids.ts) で参照) ② [`push.ts`](desktop/src/lib/sync/push.ts) 先頭で参照整合性サニタイズ (`grids NOT IN mandalarts` / `cells NOT IN grids` を hard delete) ③ ただし zombie cleanup は**新規削除経路のバグを silent に隠す**ので、新しい DELETE 経路を追加したときは必ず子連鎖テストを書くこと (テスト基盤は [`setupTestDb.ts`](desktop/src/test/setupTestDb.ts))
13. **`copyCellSubtree` は mandalart 全体を in-memory ロードする** — [`cells.ts`](desktop/src/lib/api/cells.ts) の BFS + bulk INSERT 実装は「source cell が属する mandalart の全 grids / 全 cells」を 2 query で一括取得してから JS 側で subtree 抽出する。超巨大 mandalart (1 万 grid 超級) ではメモリスパイク / IPC 転送コスト (~0.6ms/row) に注意。少数の subtree コピーのためだけに 10000 行 fetch する設計なので、将来もし mandalart サイズ制限を緩めるなら再設計が必要
14. **D&D 後の UI 反映は `onCellsUpdated` 経由のみ** — [`useDragAndDrop.ts`](desktop/src/hooks/useDragAndDrop.ts) は D&D 成功時に `reloadAll` をスキップし、`refreshCell(target)` だけで UI を更新する (useEffect cascade の二重発火を避けるため)。D&D アクションが将来 target / source 以外の DB side-effect を持つようになる場合 (例: 親 grid の memo 書換など) は、`onCellsUpdated` のセル列挙を拡張するか reloadAll に戻す判断が必要
15. **D&D drop policy は cell-to-cell では 周辺→周辺 のみ** — Phase A 改修以降、中心セル絡みの cell-to-cell drop は `resolveDndAction` が NOOP を返す。中心セルからの操作は **D&D 中の右パネル 4 アクションアイコン** (シュレッダー / 移動 / コピー / エクスポート) に集約。新しい drop パターンを足すときはこの方針を維持し、中心セル直接 drop は再導入しないこと
16. **アニメ render 経路で空 slot / checkbox を忘れる罠** — orbit / view-switch / slide で `orbit.targetCells.find(...)` が undefined のとき bare `<div />` を返すと、空 slot が animation 完了 swap の瞬間に枠付きで pop する。空 slot にも `GridView3x3` と同じ枠 + `orbit-fade-in` を当てる必要がある。同様に `onToggleDone` を渡し忘れると Cell 内 `done` checkbox が遅れて出現する (アニメ render に必ず `onToggleDone={showCheckbox ? handleToggleDone : undefined}` を渡す)
17. **マンダラート単位の UI 設定は DB カラム + Supabase 手動 ALTER** — `mandalarts.show_checkbox` (migration 007) のように UI プリファレンスを DB に置く場合、Supabase 側で `ALTER TABLE mandalarts ADD COLUMN ... ;` を **新版配布前に手動実行** する必要がある。未実行のままだと push が `PGRST204: column not found` で失敗 → thrash 化する。手順は [`cloud-sync-setup.md`](desktop/docs/cloud-sync-setup.md) 参照。同様に migration 006 の `grids.parent_cell_id` も同パターン
18. **画像セル remount 時のまばたき** — orbit アニメ完了で Cell が unmount → 通常 grid 描画で remount される際、`useState(null)` 初期化 + `useEffect` の async load パターンだと**キャッシュ hit でも 1 frame だけ `imageUrl=null`** が挟まり画像が一瞬消える。対処: [`storage.ts:getCachedCellImageUrl`](desktop/src/lib/api/storage.ts) で同期 cache lookup → `useState(() => getCachedCellImageUrl(cell.image_path))` に渡して 1 frame目から画像を出す。新規 image_path (未キャッシュ) は null 返しで従来の async useEffect に委譲され挙動維持
19. **Converge overlay の morph 構造仮定** — [`ConvergeOverlay.tsx`](desktop/src/components/ConvergeOverlay.tsx) の polling は target DOM の子要素から `div.absolute.z-10:not(.inset-0) > span` を探して終端 inset/font を読む。Cell.tsx / DashboardPage MandalartCard / StockTab はすべてこの構造に揃えてあるので、新しい着地候補要素を追加するときも同じ DOM 構造で書くこと (異なる構造だと morph end のテキスト位置/サイズが補間されない)

## ドキュメント一覧

| ファイル | 内容 |
|---|---|
| [`requirements.md`](desktop/docs/requirements.md) | 機能要件・UX・セル操作・D&D・ストック・クリップボード・空データルール・並列グリッド・ゴミ箱・デザイン |
| [`data-model.md`](desktop/docs/data-model.md) | SQLite スキーマ・マイグレーション・FK 排除理由・WAL・同期カラム |
| [`api-spec.md`](desktop/docs/api-spec.md) | `lib/api/` / `lib/sync/` / `lib/realtime.ts` / Zustand の全シグネチャ |
| [`folder-structure.md`](desktop/docs/folder-structure.md) | ディレクトリツリー・設計分離方針・設定ファイル一覧 |
| [`typography.md`](desktop/docs/typography.md) | フォント・ウェイト・文字サイズ・セルビジュアル |
| [`animations.md`](desktop/docs/animations.md) | Slide / Orbit / View Switch の仕様・実装・ハマりポイント |
| [`tasks.md`](desktop/docs/tasks.md) | フェーズ別タスクチェックリスト (進捗の単一情報源) |
| [`cloud-sync-setup.md`](desktop/docs/cloud-sync-setup.md) | Supabase セットアップ・スキーマ修正・トラブルシューティング |
| [`updater-setup.md`](desktop/docs/updater-setup.md) | 自動アップデート署名鍵・GitHub Secrets・リリースフロー |
| [`workflows.md`](desktop/docs/workflows.md) | プロジェクト専用 slash command / subagent の組合せワークフロー (コミット前 / PR 前 / リリース前 / 週次健康診断) |
