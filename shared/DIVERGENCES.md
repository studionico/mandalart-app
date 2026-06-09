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
- **CI による検知 (レバー C)**: iOS 関連変更時に [`ios-ci.yml`](../.github/workflows/ios-ci.yml) が iOS `LogicTests` (純粋契約 `CellGuard` を Supabase 非リンクで検証) を起動する。desktop の共有純粋契約 (`grid.ts`) が片側だけ変わると [`ci.yml`](../.github/workflows/ci.yml) の `cross-platform-parity` job が `::warning::` でリマインドする (非ブロッキング)。

関連: root [`CLAUDE.md`](../CLAUDE.md) / desktop [`CLAUDE.md`](../desktop/CLAUDE.md) 落とし穴。

---

## 区分 A: 停止中 / 復帰待ち

Supabase Realtime Messages 過剰使用警告 (2026-05-04) による緊急停止と、その復帰。**2026-06-08 にコード側の復帰実装を完了**し、現在は Supabase 設定適用 + Dashboard 監視を挟む段階ロールアウト中。
一次ソース = root [`CLAUDE.md`](../CLAUDE.md) 冒頭 + desktop [`CLAUDE.md`](../desktop/CLAUDE.md) 落とし穴 #24 + plan `~/.claude/plans/subscribe-realtime-tidy-meerkat.md`。

| # | 項目 | desktop | iOS | status |
|---|---|---|---|---|
| A1 | Realtime 自動同期経路 | `useRealtimeSync` で購読復帰 / `useVisibilityResync` pullAll 復帰 | `RealtimeService.subscribe` 復帰 / 15s polling 廃止 / scenePhase `.background` flush | 🔄 コード復帰済。段階ロールアウト (Dashboard 監視) 運用中 |
| A2 | echo-skip (cloud realtime) | `realtime.ts` の content 比較で実装済 | 「任意 change → 1s debounce pullAll」で冪等吸収 (pull は broadcast 非生成) | ✅ 実装済 (トリガ無効化が前提) |
| A3 | subscribe 経路統合 | App レベル `useRealtimeSync` 1 本に統合。`useSync`/`useRealtime` は `app:sync-pulled` reload 経路のみ | (単一経路) | ✅ 統合済 |
| A4 | iOS 15s polling → dirty flag + 60s debounce | (該当なし) | `SyncDirtyTracker` (didSave 観測 + 60s sliding debounce) に置換 | ✅ 実装済 |

> コード復帰は完了。残りは運用: ① Supabase の `BEFORE UPDATE` トリガ無効化 (手動 SQL) ② 段階 0→4 を Dashboard 監視を挟んでロールアウト。詳細は plan `~/.claude/plans/subscribe-realtime-tidy-meerkat.md`。

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
| セル空判定 / 中心セル保護 (色・done・trim) | desktop 準拠に統一。両OS の純粋ユニットテスト (desktop [`grid.test.ts`](../desktop/src/lib/utils/__tests__/grid.test.ts) / iOS `CellGuardTests`) で lock | 2026-06-08 |
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

> 旧 D3-D5 (vault ライブ watcher / vault-exit updatedAt bump / vault 中 cloud-off transport) は Obsidian 風 Markdown vault 廃止 (2026-06-08) に伴い消滅。その後継だった一方向 JSON ミラーも同日撤去され (クラウド同期 + 手動 export に一本化)、ローカルファイル保存の乖離項目は両 OS とも存在しない。
