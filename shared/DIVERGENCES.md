# 乖離レジストリ (desktop ↔ iOS)

desktop (Tauri/TS) と iOS (Swift) は二重実装で、乖離を systematic にゼロ化できない。
本ファイルは **既知の乖離を 1 箇所に集約**し、「ここに無い差異 = 偶発」と即判定できるようにするための索引。

## 読み方 / 保守ルール

- 各行は **索引**。詳細は一次ソース (CLAUDE.md / docs / コード / auto-memory) に委ね、ここには重複記述しない。
- **乖離を新たに見つけた / 解消した / 意図的に分けると決めたら、この表を更新する**。
  逆に「この表に無い desktop↔iOS の挙動差」を見つけたら、まず**偶発の乖離 (バグ)** を疑うこと。
- 区分: **A 停止中/復帰待ち** ・ **B 意図的非対称 (unify 禁止)** ・ **C 解消済 (再検出しない)** ・ **D 要確認**。
- 値・実装状況を表に書くときは **必ず一次ソースで再確認**する (過去に Explore が画像圧縮を 1920/0.8 と誤報告した実績あり)。
- スコープ外: tasks.md / Phase 進捗と重複する「iOS が Phase 的に未実装の port」(cell swap / folder UI 等) は**載せない** (= tasks.md が一次情報源)。

関連: root [`CLAUDE.md`](../CLAUDE.md) / desktop [`CLAUDE.md`](../desktop/CLAUDE.md) 落とし穴 / [`shared/vault-fixtures/`](vault-fixtures/) (契約ロック)。

---

## 区分 A: 停止中 / 復帰待ち

Supabase Realtime Messages 過剰使用警告 (2026-05-04) による緊急停止と、その復帰に必要な未対応項目。
一次ソース = root [`CLAUDE.md`](../CLAUDE.md) 冒頭 + desktop [`CLAUDE.md`](../desktop/CLAUDE.md) 落とし穴 #24 + plan `~/.claude/plans/ios-swift-glistening-thacker.md`。

| # | 項目 | desktop | iOS | status |
|---|---|---|---|---|
| A1 | Realtime 自動同期経路 | 全 subscribe/pull 経路をコメントアウト | RealtimeService / 15s polling / scenePhase pull-push を停止 | ⏸ 両OS停止中。サインイン1回 + 手動「今すぐ同期」のみ |
| A2 | echo-skip (cloud realtime) | 未完成 (vault 経路 `vaultWriteLedger` は実装済) | 未完成 (vault 経路 `VaultWriteLedger` は実装済) | ❌ 復帰チェックリスト #3 |
| A3 | subscribe 経路統合 | `useSync` と `useRealtime` が別々に購読保持 (二重) | (単一経路) | ❌ desktop で #4 未統合 |
| A4 | iOS 15s polling → dirty flag + 60s debounce | (該当なし) | polling 廃止済 / mutation 駆動 dirty flag への置換は未実装 | ❌ 復帰チェックリスト #5 |

> 復帰には最低でも A3 (subscribe 統合) と A4 (dirty flag) の追加実装が必要。

---

## 区分 B: 意図的非対称 (unify 禁止)

両OSで**わざと**揃えていない差異。「揃っていない＝バグ」ではないので、安易に unify しないこと。

| 項目 | desktop | iOS | 理由 / 一次ソース |
|---|---|---|---|
| アニメ timing | stagger 85 / fade 400 / converge 400 ms | 50 / 200 / 600 ms | device の体感差。codegen 単一ソース化は colors のみ (timing は orbit/tab 配列と同居 enum で対象外)。[`timing.ts:35-57`](../desktop/src/constants/timing.ts) / [`Constants.swift:56-58`](../ios/Mandalart/Utils/Constants.swift) |
| 画像圧縮 | 長辺 1600px / JPEG q0.8 | 長辺 1200pt / JPEG q0.7 | [`imageSync.ts:39`](../desktop/src/lib/api/imageSync.ts#L39) / [`ImageStorage.swift:22`](../ios/Mandalart/Services/ImageStorage.swift#L22)。**ただし値差の根拠は未明文化 → 区分 D-1 にも再掲** |
| theme 設定 (キー / スコープ) | localStorage `mandalart.theme` (per-device) | UserDefaults `app.theme` (per-device) | rawValue (`light`/`system`/`dark`) は一致。**キー文字列差は意図的** (iOS は端末専有 namespace を分離)・cross-device 非同期も意図的。[`themeStore.ts`](../desktop/src/store/themeStore.ts) / [`ThemePreference.swift:6`](../ios/Mandalart/Utils/ThemePreference.swift#L6) |
| font scale 同期スコープ | per-mandalart × per-device | per-mandalart × per-device | 設計は対称だが localStorage/UserDefaults とも cross-device 非対応 (意図的) |
| breadcrumb UI | テキスト階層 | 3×3 ミニマップ + iPhone compact は右ペイン上部に集約 | native UX 最適化。[`ios/docs/requirements.md`](../ios/docs/requirements.md) |
| セル操作 paradigm | D&D (マウス) | tap-select (banner 無し / source 枠 highlight) | touch 最適化。結果 (swap/paste の DB 効果) は等価。[`ios/docs/requirements.md`](../ios/docs/requirements.md) |
| merged 中心セルの position 表現 | merged 9 配列で中心を position=4 に正規化 | `displayCells` は表示スロット index 配列 (中心の `cell.position`≠4)、`SlotCell` で吸収 | X=C drilled の中心セル 3 パターン。desktop 落とし穴 #10 / iOS [`pitfalls.md #13`](../ios/docs/pitfalls.md) |

---

## 区分 C: 解消済 (再検出しない)

過去に乖離していたが統一済み。「また違う」と再 flag しないための記録。

| 項目 | 解消法 | 日付 |
|---|---|---|
| セル空判定 / 中心セル保護 (色・done・trim) | desktop 準拠に統一 + [`cellGuard`](vault-fixtures/) fixture で両OS lock | 2026-06-08 |
| vault 本文 parse parity (複数行 heading / clean 削除) | ブロック parse 移植 + golden fixture lock | 2026-06-07 |
| UUID 大文字小文字 | 両OS lowercase 統一 (iOS `IDGenerator.uuid()`) | desktop 落とし穴 #23 / iOS pitfalls #6 |
| カラープリセット | [`shared/constants/colors.json`](constants/colors.json) 単一ソース codegen | — |
| zombie cleanup / PGRST204 thrash 対策 | 両OS実装 (desktop `push.ts` 冒頭サニタイズ / iOS `SyncEngine.sanitizeZombies`) | desktop 落とし穴 #12/#17 |

---

## 区分 D: 要確認 (値の根拠 / 実装状況が不確実)

乖離か意図的かが**まだ確定していない**もの。調査して B か C に振り分けるべき宿題。

| # | 項目 | 不明点 | 一次ソース |
|---|---|---|---|
| D1 | 画像圧縮値の根拠 | なぜ iOS が低 (1200/0.7) かが未明文化。意図的差なら B に理由付きで残す | [`imageSync.ts`](../desktop/src/lib/api/imageSync.ts) / [`ImageStorage.swift`](../ios/Mandalart/Services/ImageStorage.swift) |
| D2 | 画像同期 end-to-end | 相互 download 含む実機検証が未実施。api-spec.md 未反映 | auto-memory `project_image_cloud_sync` |
| D3 | vault ライブ watcher (旧 C) | desktop は FSEvents 常時取込 / iOS は前面 watcher 無し→背面復帰時 reconcile のみ | auto-memory `reference_ios_vault_parse_divergence` |
| D4 | vault-exit の updatedAt bump (旧 E) | iOS [`VaultExitSync.swift`](../ios/Mandalart/Services/VaultExitSync.swift) のみ・desktop に相当処理なし | 同上 |
| D5 | vault 中の cloud-off transport (旧 D) | 両OS とも vault ON 時は cloud 同期 OFF = 端末間転送は外部フォルダ同期に全依存 (フォルダ未共有・片方だけ vault ON は永久乖離) | root/desktop CLAUDE.md vault 節 |
