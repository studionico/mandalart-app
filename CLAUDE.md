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
| アニメーション | [`animations.md`](desktop/docs/animations.md) |
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

## コーディング規約

### ハードコーディング禁止

マジックナンバー・繰返し文字列はコードに裸で書かず、[`desktop/src/constants/`](desktop/src/constants/) の定数を経由する。

| カテゴリ | ファイル | 代表定数 |
|---|---|---|
| グリッド構造 | [`grid.ts`](desktop/src/constants/grid.ts) | `CENTER_POSITION`, `GRID_CELL_COUNT`, `ORBIT_ORDER_*` |
| タイミング (ms) | [`timing.ts`](desktop/src/constants/timing.ts) | `ANIM_STAGGER_MS`, `ANIM_FADE_MS`, `CLICK_DELAY_MS` |
| レイアウト (px) | [`layout.ts`](desktop/src/constants/layout.ts) | `OUTER_GRID_GAP_PX`, `CELL_BASE_FONT_PX`, `DASHBOARD_CARD_SIZE_PX` |
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

- **データモデル**: `mandalarts → grids → cells` の再帰階層。FK 制約なし (後述)。`deleted_at` でソフトデリート
- **同期**: `lib/sync/` で last-write-wins (updated_at 比較)、`lib/realtime.ts` で postgres_changes 購読
- **状態**: Zustand (`editorStore` / `undoStore` / `clipboardStore` / `authStore` / `themeStore`)
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

1. **Tauri WebKit の HTML5 DnD が動かない** — `mousedown`/`mousemove`/`mouseup` + `document.elementFromPoint` で自前実装 ([`useDragAndDrop.ts`](desktop/src/hooks/useDragAndDrop.ts))。`draggable` / `onDragStart` は使わない
2. **FK 制約を張らない** — `grids ↔ cells` の循環 FK が CASCADE 再帰で壊れる + `tauri-plugin-sql` のプール問題。カスケードは API 層で明示実装。詳細は [`data-model.md`](desktop/docs/data-model.md)
3. **WAL モード必須** — `PRAGMA journal_mode = WAL` + `busy_timeout = 5000` がないと sync 中に "database is locked"
4. **Realtime の table フィルタが混線する** — `postgres_changes` の `{ table: 'X' }` が効かないことがある。各ハンドラで `if (payload.table !== 'X') return` を必ず入れる
5. **Realtime DELETE は子行を連鎖しない** — cloud FK CASCADE で消えた子行の DELETE イベントは来ない + 未 push の local 子行は孤立する。各 DELETE ハンドラで `DELETE FROM cells WHERE grid_id IN (...)` のように明示カスケード
6. **完全削除は local + cloud 両方消す** — `permanentDeleteMandalart` は local DELETE 後に Supabase も消す。cloud を残すと pull で復活する
7. **`window.confirm` が Tauri WebView で動かない** — state ベースの 2 クリック確認 UI で代替 ([`TrashDialog.tsx`](desktop/src/components/dashboard/TrashDialog.tsx))
8. **CSS keyframes の `transform: var(--x)` は WebKit で補間されない** — 固定 keyframes 8 方向で対応。詳細は [`animations.md`](desktop/docs/animations.md)
9. **環境変数が欠損するとクラッシュ** — `lib/supabase/client.ts` がダミー URL でフォールバックし `isSupabaseConfigured` で gate
10. **子グリッドには position=4 の cell 行が無い** — drill 先グリッドの中心は親グリッドの drill 元 cell (`grids.center_cell_id`) で直接参照。`cells WHERE grid_id = child.id` は 8 行しか返らない。描画では `getGrid` が親 cell を merge して 9 要素提供する。`setGridDone` のような grid 単位の UPDATE は 8 行のみ対象になる点に注意

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
