# マンダラート アプリ 30 秒 SNS CM — Midjourney 絵コンテ生成プロンプト集

> **目的**: Discord または Web UI 上の **Midjourney** で、本アプリ 30 秒 SNS CM の絵コンテキービジュアル 13 枚を作るための、コピペ即実行可能なプロンプト集。シナリオ / 絵コンテ詳細指示書は [Claude との対話履歴](../README.md) を参照 (本ファイルは生成作業に特化)。
>
> **対応バージョン**: Midjourney v6.1 / v7 (本書執筆時点の主流)
> **対応プラットフォーム**: Discord (`/imagine` コマンド) / Web UI (`midjourney.com/imagine`)

---

## 目次

1. [概要 / このファイルの使い方](#1-概要--このファイルの使い方)
2. [共通スタイル仕様](#2-共通スタイル仕様)
3. [推奨ワークフロー (3 フェーズ)](#3-推奨ワークフロー-3-フェーズ)
4. [seed 戦略](#4-seed-戦略)
5. [13 カット プロンプト一覧](#5-13-カット-プロンプト一覧)
6. [失敗時のリトライパラメータ](#6-失敗時のリトライパラメータ)
7. [商標 / 法務まわり](#7-商標--法務まわり)
8. [ファイル命名 / 取り込み規則](#8-ファイル命名--取り込み規則)
9. [コスト / プラン目安](#9-コスト--プラン目安)
10. [トラブルシューティング (FAQ)](#10-トラブルシューティング-faq)

---

## 1. 概要 / このファイルの使い方

### このファイルで生成するもの
30 秒 SNS CM 全 13 カット (シーン) の **絵コンテ用キービジュアル 13 枚**。各カットの構図・トーン・主要要素を 1 枚絵で確定させ、後段の動画制作 (After Effects / Premiere) に入る前のラフ確認に使う。

### 使用ツール (どちらか)
| ツール | URL / アクセス | 特徴 |
|---|---|---|
| Discord (`/imagine`) | midjourney.com の Discord 招待 → サーバ参加後 `/imagine prompt:` | バッチ生成 / Variation / Upscale が直感的、コミュニティで参考に |
| Web UI | https://midjourney.com/imagine | ブラウザ完結、Job 管理が見やすい、複数同時生成しやすい |

### 基本フロー
```
1. このファイルの §3 「推奨ワークフロー」に従って Phase 1 から進める
2. §5 の各カット ```text``` ブロックをそのままコピーして /imagine に貼る
3. 4 枚の Variation が出る → 気に入った 1 枚を Upscale (U1〜U4 ボタン)
4. PNG をダウンロード → §8 の命名規則で保存
5. 13 枚揃ったら絵コンテと照合 → §10 の FAQ で微修正
```

### ⚠ 日本語テキストの扱い (重要)
Midjourney は **日本語を「読める文字」として描けない** (記号風 glyph になる)。  
本ファイルのプロンプトはすべて、日本語テキストの位置・サイズ・色・余白を **「形のプレースホルダー」** として描かせる方針。

→ **完成版 13 枚の上に、Photoshop / After Effects で実日本語テキストを別レイヤー合成する** ことを必ず前提とする。

---

## 2. 共通スタイル仕様

### 共通 suffix (全カットの末尾に付ける)
```
--ar 9:16 --v 6.1 --s 200 --style raw --seed 1024
```

### 共通 `--no` リスト (全カットで除外する要素)
```
--no busy background, neon, cyberpunk, anime, kawaii, glitter, gradient rainbow, stock-photo people, watermark, low contrast, vintage filter, real person, athlete, celebrity, sports imagery, baseball, jersey
```

> 後半の `real person, athlete, celebrity, sports imagery, baseball, jersey` は **大谷選手の肖像が誤って混入するのを防ぐ** ための保険 (§7 参照)。

### パラメータ早見表

| パラメータ | 意味 | 本案の値 | 効果 |
|---|---|---|---|
| `--ar 9:16` | アスペクト比 | 縦型 1080×1920 | Reels / TikTok / Shorts / X 縦動画 |
| `--v 6.1` | モデルバージョン | v6.1 | タイポグラフィ / 写実描写が安定 |
| `--s 200` | スタイライズ強度 (0〜1000) | 200 | 中庸 (アート寄りすぎず、写実すぎない) |
| `--style raw` | プリセット | raw | 過剰美化を抑え絵コンテ向きに |
| `--seed 1024` | 乱数シード | **要置換** (§4 参照) | 13 カットでルック統一 |
| `--c 0〜100` | カオス度 | デフォルト 0 | 構図ブレを防ぐため基本 0、creative なら 25 程度 |
| `--no` | 除外リスト | 上記 | 不要要素を弾く |

---

## 3. 推奨ワークフロー (3 フェーズ)

13 カットを **闇雲に上から生成しない**。ルック統一のため以下の順で進める。

### Phase 1 — 基準カットで seed を確定 (約 15 分)
**最も "アプリらしさ" が出る Cut 12 (アプリアイコン + アプリ名) で先に seed を決める**。

1. §5 Cut 12 のプロンプト末尾の `--seed 1024` を **削除して** /imagine に貼る → 4 案出る
2. 一番気に入った 1 枚を Upscale (U1〜U4 ボタン)
3. Upscale された画像メッセージに **✉ (envelope) emoji リアクション** を付ける  
   → Midjourney bot が DM で **Job ID / Seed** を送ってくる (例: `Seed: 4128762091`)
4. その seed を本ファイルの `--seed 1024` の `1024` 部分と置換 (sed 一括推奨):
   ```bash
   # 例: macOS sed
   sed -i '' 's/--seed 1024/--seed 4128762091/g' midjourney-storyboard-prompts.md
   ```

### Phase 2 — 主要 "映え" 3 カット (約 30 分)
ルックの肝。ここでズレるとリトライが必要。

| 優先 | カット | 役割 |
|---|---|---|
| ★1 | **Cut 08** (3×3 orbit 展開) | アプリ機能の核、SNS 映え最大 |
| ★2 | **Cut 10** (9×9 俯瞰) | 保存トリガー、81 マスのインパクト |
| ★3 | **Cut 01** (フック・黒地+成功したい) | 0-2s 離脱抑止の鍵 |

3 枚揃った時点で絵コンテと照合。**ズレていたら Phase 3 に進まずに seed / chaos を見直す**。

### Phase 3 — 残り 10 カット (約 60 分)
Phase 2 で確定した seed で残りを一気に投入。違和感があれば §6 のリトライ戦術。

---

## 4. seed 戦略

### Discord で seed を取得する手順
1. /imagine で生成 → 4 案 → Upscale (U1〜U4)
2. Upscale 結果の画像メッセージにマウスホバー
3. 「**+ リアクション追加**」 → 検索バーに `envelope` と入力 → ✉ 絵文字を選択
4. 数秒後、Midjourney bot から **DM (Direct Message)** で Job 情報が届く
   ```
   Job ID: xxxxxxxx-xxxx-...
   Seed: 4128762091
   ```
5. その数値を本ファイルの全プロンプトに sed 置換

### Web UI で seed を確認する手順
1. midjourney.com/imagine で生成
2. 画像クリック → 右上 `…` → `Copy → Seed` でコピー
3. 同じく sed 一括置換

### seed を統一する効果
- **ルックの一貫性**: 13 枚で同じ "光の当たり方 / 質感" が出やすい
- **再現性**: 後で 1 カットだけ作り直しても元のルックに戻せる
- **Variation の起点**: `--seed N` を保ったまま `--c 25` で 4 案出すと、ルックは保ったまま構図 Variation が試せる

### 注意点
- seed 統一しても **完全に同じ絵が出るわけではない** (プロンプトが違うので構図は変わる)、トーンが揃うだけ
- 生成失敗が続くとき、その seed が「偶然そのプロンプトと相性が悪い」可能性がある → seed を別の良かった候補に切替

---

## 5. 13 カット プロンプト一覧

> 各カットは Discord に貼る用に、**1 つの ```text``` ブロックで完結** している。プロンプト末尾の `--seed 1024` を Phase 1 で決めた値に sed 置換してから使うこと。

---

### Cut 01 — 0.0–0.6s [フック #1] 黒地に "成功したい"

- 役割: 0-2s 離脱抑止 (Phase 2 ★3)
- 推奨 chaos: 0
- 想定構図: 中央 1 行のセリフ体テキスト + 圧倒的余白

```text
/imagine prompt: Pure black background, single line of large elegant Japanese serif typography floating at vertical center, immense negative space above and below, dramatic emptiness, subtle film grain, monochrome, museum poster aesthetic, cinematic still, sharp focus on text only, no other elements --ar 9:16 --v 6.1 --s 200 --style raw --seed 1024 --no busy background, neon, cyberpunk, anime, kawaii, glitter, gradient rainbow, stock-photo people, watermark, low contrast, vintage filter, real person, athlete, celebrity, sports imagery, baseball, jersey
```

リトライ案: 余白が足りない → `negative space dominating 70% of frame` を追加 / 文字が小さすぎる → `extremely large typography filling 30% width` を追加

---

### Cut 02 — 0.6–1.4s [フック #2] 赤の衝突

- 役割: 違和感 / 視覚衝突
- 推奨 chaos: 0
- 想定構図: 白テキスト + 赤の傾いたサブテキストが衝突

```text
/imagine prompt: Pure black background, large elegant white Japanese serif typography centered, with a smaller bold red question mark text rotated -8 degrees crashing diagonally into the right edge of the white text, sharp collision moment, premium poster design, two-color palette black white red, dramatic visual tension, sharp focus --ar 9:16 --v 6.1 --s 200 --style raw --seed 1024 --no busy background, neon, cyberpunk, anime, kawaii, glitter, gradient rainbow, stock-photo people, watermark, low contrast, vintage filter, real person, athlete, celebrity, sports imagery, baseball, jersey
```

リトライ案: 赤が控えめすぎ → `vivid crimson red #E63946 high saturation` 追加 / 衝突感が出ない → `aggressive overlap, red text invading white text space`

---

### Cut 03 — 1.4–2.0s [フック #3] 文字崩壊

- 役割: 痛み / 危機感のピーク
- 推奨 chaos: 10 (崩壊の不規則性で chaos 少し許容)

```text
/imagine prompt: Black background, white Japanese serif typography in the process of dissolving into pixel fragments and ink drips, liquid distortion effect, broken letters falling apart, second smaller line of clean serif text appearing below at the lower third, double-exposure feel, decay vs appearance, monochrome, sharp focus on dissolution --ar 9:16 --v 6.1 --s 200 --style raw --c 10 --seed 1024 --no busy background, neon, cyberpunk, anime, kawaii, glitter, gradient rainbow, stock-photo people, watermark, low contrast, vintage filter, real person, athlete, celebrity, sports imagery, baseball, jersey
```

リトライ案: 崩壊が激しすぎ → `subtle dissolution, gentle fade decay` / きれいすぎ → `chaotic ink splatter, glitchy break-up`

---

### Cut 04 — 2.0–4.0s [共感 #1] 願望ラッシュ

- 役割: ターゲット自分事化
- 推奨 chaos: 0
- 想定構図: 縦に並ぶ 3-4 行の願望テキスト

```text
/imagine prompt: Black background, three lines of large elegant Japanese serif typography stacked vertically with generous spacing, each line a different desire phrase, smallest line at bottom in bold sans-serif, monochrome white text, clean editorial poster, vertical reading rhythm, no decorations, just text on void --ar 9:16 --v 6.1 --s 200 --style raw --seed 1024 --no busy background, neon, cyberpunk, anime, kawaii, glitter, gradient rainbow, stock-photo people, watermark, low contrast, vintage filter, decorative elements, illustration, real person, athlete, celebrity, sports imagery, baseball, jersey
```

リトライ案: 行間が詰まる → `with at least 200 pixels of vertical spacing between each line`

---

### Cut 05 — 4.0–7.0s [共感 #2] カレンダー早送り

- 役割: 時間の経過と停滞の対比
- 推奨 chaos: 0
- 想定構図: 中央にカレンダー UI モック + 隅に静止テキスト

```text
/imagine prompt: Black background, large white minimal paper calendar mockup centered, showing month grid with subtle motion blur as if pages flipping rapidly, clean editorial design, in the lower left corner a small dim grey Japanese text label sits absolutely still as a counterpoint, double contrast between motion and stillness, monochrome, premium magazine layout aesthetic --ar 9:16 --v 6.1 --s 200 --style raw --seed 1024 --no busy background, neon, cyberpunk, anime, kawaii, glitter, gradient rainbow, stock-photo people, watermark, low contrast, vintage filter, colorful, calendar with photos, decorations, real person, athlete, celebrity, sports imagery, baseball, jersey
```

リトライ案: モーションブラーが弱い → `strong directional motion blur on calendar pages`

---

### Cut 06 — 7.0–10.0s [共感 #3] 問いかけ

- 役割: 解決への橋渡し / 静寂
- 推奨 chaos: 0
- 想定構図: 黒地 + 中央 3 行のテキスト

```text
/imagine prompt: Pure black background, three centered lines of elegant Japanese serif typography stacked, the third line slightly larger and bolder, dramatic contemplative space, museum exhibit text feel, breathing room, single faint vignette, monochrome, intimate quiet mood, philosophical poster aesthetic --ar 9:16 --v 6.1 --s 200 --style raw --seed 1024 --no busy background, neon, cyberpunk, anime, kawaii, glitter, gradient rainbow, stock-photo people, watermark, low contrast, vintage filter, decorations, illustration, real person, athlete, celebrity, sports imagery, baseball, jersey
```

リトライ案: 暗すぎ → `slight central glow drawing eye toward text`

---

### Cut 07 — 10.0–12.0s [解決 #1] アプリ登場

- 役割: 主役登場、UI への切替
- 推奨 chaos: 0
- 想定構図: ダーク mode mobile app mockup

```text
/imagine prompt: Dark mode mobile app mockup centered on near-black background, premium software aesthetic, single rounded-corner 3x3 grid of empty dark cells visible inside the device frame, the center cell highlighted with a heavy black-and-white border showing a Japanese phrase being typed character by character, soft drop shadow under the device, minimal UI, no notification chrome, hyper-clean tech product photography --ar 9:16 --v 6.1 --s 200 --style raw --seed 1024 --no busy background, neon, cyberpunk, anime, kawaii, glitter, gradient rainbow, stock-photo people, watermark, low contrast, vintage filter, glossy reflections, busy UI, notifications, multiple apps, real person, athlete, celebrity, sports imagery, baseball, jersey
```

リトライ案: 端末枠が出ない → `inside iPhone-style rounded device bezel` / 中央セルが浮き出ない → `center cell with glowing rim light`

---

### Cut 08 — 12.0–15.0s [解決 #2] 3×3 orbit 展開 ★1 主要

- 役割: アプリ核体験、保存トリガー (Phase 2 ★1)
- 推奨 chaos: 0
- 想定構図: 9 マス全埋まり + ハロー光

```text
/imagine prompt: Dark mode app interface centered, full 3x3 grid of nine rounded-square cells visible, the center cell with thick black-and-white border containing a Japanese phrase, the eight peripheral cells each containing a different short Japanese label, all cells equal size and evenly spaced with 8px gaps, soft halo glow around the grid, minimal UI, premium software product shot, dark mode aesthetic --ar 9:16 --v 6.1 --s 200 --style raw --seed 1024 --no busy background, neon, cyberpunk, anime, kawaii, glitter, gradient rainbow, stock-photo people, watermark, low contrast, vintage filter, multiple grids, decorations, real person, athlete, celebrity, sports imagery, baseball, jersey
```

リトライ案: グリッドが歪む → `perfectly geometric, mathematically precise grid alignment` / セルが小さい → `cells filling 80% of frame width`

---

### Cut 09 — 15.0–19.0s [解決 #3] drill

- 役割: 階層深化の視覚化
- 推奨 chaos: 5
- 想定構図: タップ → 拡大 → 新 9 マス

```text
/imagine prompt: Dark mode app interface, the previous 3x3 grid is in motion: one peripheral cell zooms toward the camera and transforms into a new center, while eight new sub-cells fan out around it in a deeper second 3x3 grid, hierarchical zoom motion captured as a still, depth and recursion implied through scale, premium dark UI, halo glow --ar 9:16 --v 6.1 --s 200 --style raw --c 5 --seed 1024 --no busy background, neon, cyberpunk, anime, kawaii, glitter, gradient rainbow, stock-photo people, watermark, low contrast, vintage filter, chaotic, multiple overlapping grids, decorations, real person, athlete, celebrity, sports imagery, baseball, jersey
```

リトライ案: 階層感が薄い → `dramatic depth-of-field, foreground grid sharp, background grid soft-blurred`

---

### Cut 10 — 19.0–22.0s [解決 #4] 9×9 俯瞰 ★2 主要

- 役割: 81 マスのインパクト、保存トリガー (Phase 2 ★2)
- 推奨 chaos: 0
- 想定構図: 全 81 マスの俯瞰

```text
/imagine prompt: Dark mode app interface displaying a complete 9x9 grid (eighty-one small dark rounded-square cells) arranged in a 3x3 macro pattern of 3x3 micro-grids, each cell containing tiny faint Japanese text labels, dramatic top-down product photography composition, the grid resembles a constellation map of intentions, halo of soft light, monochrome dark UI, premium minimal software aesthetic, sharp focus on the entire grid lattice --ar 9:16 --v 6.1 --s 200 --style raw --seed 1024 --no busy background, neon, cyberpunk, anime, kawaii, glitter, gradient rainbow, stock-photo people, watermark, low contrast, vintage filter, chaotic, gaming UI, decorations, real person, athlete, celebrity, sports imagery, baseball, jersey
```

リトライ案: 9×9 が 3×3 の micro pattern に分かれない → `clear visual gap between every 3x3 sub-block, three macro divisions visible`

---

### Cut 11 — 22.0–25.0s [解決 #5] 大谷フック (テキスト引用のみ)

- 役割: 権威付け、シェアトリガー
- 推奨 chaos: 0
- 想定構図: 9×9 を背景に薄くフェード + 前景テロップ
- ⚠ **大谷の肖像 / 似顔絵 / 野球関連は絶対に出さない** (プロンプトの `--no` で除外済)

```text
/imagine prompt: The 9x9 grid from before now sits faded and blurred in the background at fifty percent opacity, while in the foreground crisp Japanese serif typography appears in two layers, a primary larger phrase mid-frame and a smaller dim grey secondary phrase below, layered editorial composition, blurred-foreground-text-on-clear-background reverse, monochrome with subtle amber accent, premium poster design, contemplative --ar 9:16 --v 6.1 --s 200 --style raw --seed 1024 --no busy background, neon, cyberpunk, anime, kawaii, glitter, gradient rainbow, stock-photo people, watermark, low contrast, vintage filter, busy, gradient, photo of person, sports imagery, baseball, jersey, real person, athlete, celebrity
```

リトライ案: 背景がクリアすぎ → `background heavily blurred with bokeh effect`

---

### Cut 12 — 25.0–28.0s [CTA #1] アプリアイコン ★3 主要 (Phase 1 で先行)

- 役割: ブランド露出、Phase 1 基準カット
- 推奨 chaos: 0
- 想定構図: アプリアイコン + アプリ名

```text
/imagine prompt: Pure black background, single rounded-square premium app icon centered in the upper third with subtle drop shadow, the icon design features a minimal monogram or 9-dot mandala-grid mark, below it large elegant Japanese serif typography spelling the app name with letter-spacing, generous negative space, museum poster composition, hi-tech minimal brand reveal --ar 9:16 --v 6.1 --s 200 --style raw --seed 1024 --no busy background, neon, cyberpunk, anime, kawaii, glitter, gradient rainbow, stock-photo people, watermark, low contrast, vintage filter, busy logo, gradient logo, App Store badge yet, real person, athlete, celebrity, sports imagery, baseball, jersey
```

リトライ案: アイコンが装飾的すぎ → `extremely minimal flat design, no illustration inside icon, just abstract grid mark`

---

### Cut 13 — 28.0–30.0s [CTA #2] DL 喚起 + 矢印

- 役割: コンバージョン
- 推奨 chaos: 0
- 想定構図: アイコン + アプリ名 + 三行テキスト + amber 矢印

```text
/imagine prompt: Pure black background, premium rounded-square app icon in upper area, elegant Japanese serif app name below it, then two lines of bold sans-serif Japanese pricing-and-platform copy mid-frame in white, and at the bottom a single bold amber-yellow Japanese call-to-action with a downward arrow symbol, complete commercial closing frame layout, multi-tier typographic hierarchy, generous negative space, premium brand commercial poster --ar 9:16 --v 6.1 --s 200 --style raw --seed 1024 --no busy background, neon, cyberpunk, anime, kawaii, glitter, gradient rainbow, stock-photo people, watermark, low contrast, vintage filter, App Store badge, multiple buttons, decorations, real person, athlete, celebrity, sports imagery, baseball, jersey
```

リトライ案: 矢印が見当たらない → `prominent glowing amber-yellow downward arrow at bottom center`

---

## 6. 失敗時のリトライパラメータ

| 症状 | 対処 | プロンプトへの追加 |
|---|---|---|
| 構図が毎回違う | カオス度を下げる | `--c 0` (デフォルトだが明示も可) |
| スタイルが派手すぎる | スタイライズを下げる | `--s 100` 〜 `--s 50` |
| アニメ調・キャラっぽくなる | raw 強化 + 否定追加 | `--style raw` 維持 + `--no anime, illustration, character` 追加 |
| 文字が読める日本語っぽくなる | **問題なし** (どのみち後合成するので無視 OK)、気になるなら | `--no readable text, real letters` |
| 縦横比が 9:16 じゃない | パラメータ位置確認 | `--ar 9:16` がスペース区切りで正しく入っているか |
| 全体が暗すぎ / 明るすぎ | 露出指定 | `well-exposed, balanced lighting` または `slightly underexposed for drama` |
| 同じプロンプトで毎回違う seed が出る | seed 固定 | `--seed <数値>` を必ず付ける |
| 生成 4 枚すべて気に入らない | Variation Strong | Discord で `Vary (Strong)` ボタン、Web で `Vary (Strong)` |
| 1 枚だけ惜しい | Variation Subtle / Vary Region | `Vary (Subtle)` で微調整、領域指定なら `Vary Region` |

---

## 7. 商標 / 法務まわり

### 大谷選手まわり
- **画像 / 似顔絵 / 連想されるアスリートを絶対に出さない**: 全プロンプトの `--no` に `real person, athlete, celebrity, sports imagery, baseball, jersey` を含めて二重保険
- 動画本編では「テキスト引用のみ」という大原則を堅持。本ファイルで生成する画像にも一切人物を出さない方針
- 万一生成結果に人物が混入したら、そのカットは **必ず作り直す** (Vary Region で人物部分を消すのは確実性に欠ける)

### App Store / Microsoft Store ロゴ
- §5 Cut 13 の `--no App Store badge` で除外
- 公式バッジは **後で Photoshop で正規アセットを乗せる** (公式ガイドライン準拠)
- Midjourney 出力に偽の App Store ロゴが描かれることがあるが、その場合は無視 (本番では使わない領域)

### Midjourney の利用規約
- **商用利用 (本動画は SNS 広告)**: Midjourney **有料プラン (Basic 以上)** が必須。無料 Trial では商用不可
- 生成画像の権利は基本ユーザーに帰属 (Pro Plan 以上は他者から見られない Stealth Mode あり)
- 生成画像をそのまま使うのではなく、後合成 (テキスト乗せ / アプリ実機録画とのコンポジット) を経由するため、Midjourney 単体での "完成品" にしない方が法的にも安全

---

## 8. ファイル命名 / 取り込み規則

### ローカル保存先 (推奨)
```
mandalart/
└── marketing/
    ├── midjourney-storyboard-prompts.md     ← 本ファイル
    └── storyboard/                          ← 新規作成 (このフォルダは .gitignore 推奨、容量大)
        ├── cut01_seed4128762091_v1.png
        ├── cut01_seed4128762091_upscaled.png  ← 採用版
        ├── cut02_seed4128762091_v1.png
        ├── cut02_seed4128762091_upscaled.png
        ├── ...
        └── cut13_seed4128762091_upscaled.png
```

### 命名規則
```
cut{NN}_seed{SEED}_{state}.png
```
- `NN`: カット番号 (01〜13、ゼロパディング)
- `SEED`: §4 で確定した共通 seed
- `state`: `v1` 〜 `v4` (Variation の生成番号) / `upscaled` / `final` (後合成済み)

### .gitignore 推奨
画像 PNG は git LFS でも管理可能だが、絵コンテ段階では .gitignore で除外して各自手元保管を推奨:
```gitignore
# marketing/ 内の生成画像 (Midjourney) は git で管理しない
marketing/storyboard/*.png
marketing/storyboard/*.jpg
```

### 13 枚揃ったあとの取り込み先
| ツール | 用途 |
|---|---|
| **Figma** | 1 ページに 13 フレーム並べて絵コンテ清書 |
| **Keynote / PowerPoint** | プレゼン資料・出資者デッキ |
| **Frame.io / Vimeo** | 制作チームへのレビュー |
| **After Effects** | 動画制作の placeholder background として読み込み |

---

## 9. コスト / プラン目安

| プラン | 月額 | Fast Hours | 想定本案で十分か |
|---|---|---|---|
| Basic | $10 | 3.3h (約 200 ジョブ) | ✅ **本案には十分** (13 カット × Variation 4-6 = 約 50-80 ジョブ) |
| Standard | $30 | 15h | ◎ 余裕、複数案検討する場合に |
| Pro | $60 | 30h + Stealth Mode | △ Stealth が必要な場合のみ (公開前秘匿) |
| Mega | $120 | 60h | × オーバースペック |

> **Fast Hours = 通常モード**、超過後は Relax Mode (待ち時間あり、無料) で続行可能 (Standard 以上)。

### 本案の所要時間 / コスト見積
- Phase 1 (基準 seed 確定): 4 案 × 1〜2 試行 = 約 8 ジョブ
- Phase 2 (主要 3 カット): 各 4 案 × 1〜2 試行 + Upscale = 約 15〜20 ジョブ
- Phase 3 (残り 10 カット): 各 4 案 × 1 試行 + Upscale = 約 50 ジョブ
- **合計**: 約 75〜80 ジョブ → Basic Plan ($10) 1 ヶ月分の約 40% 消費

---

## 10. トラブルシューティング (FAQ)

### Q1. `Banned prompt` / `Blocked words` エラーが出る
**原因**: Midjourney のセーフティフィルタが特定単語に反応 (例: `crashing` が暴力的と判定されるケース)。  
**対処**:
- `crashing into` → `intersecting with` / `colliding with gently`
- `dissolving` → `transitioning into` / `softly fragmenting`
- 『戦い』を連想させる語を避け、抽象的な動作 `merging`, `blending`, `transforming` に置換

### Q2. 何度試しても日本語っぽい文字が崩れる
**仕様**: Midjourney は日本語フォントを正確に出せない。**最初から後合成前提** (§1)。  
プロンプトの `Japanese serif typography` 指定で「読めない記号風日本語」が出るが、それでも構図確認には十分。

### Q3. 生成が遅い / 順番待ち
**原因**: Fast Hours 残量切れ → Relax Mode 自動切替で待ち時間発生 (10〜30 分)。  
**対処**:
- Standard Plan へアップグレード → Fast Hours 増量
- または Relax Mode で待つ (本案は 1〜2 日で完了する規模なので Relax でも十分)

### Q4. キャラ / 人物が意図せず出る
**原因**: プロンプトに `Japanese`, `traditional`, `kimono` 等が含まれると人物連想されることがある。  
**対処**: `--no` リストに既に `real person, athlete, celebrity` を入れているが、足りなければ `--no portrait, face, body, character` 追加。

### Q5. 縦横比が 9:16 にならず正方形 / 横長になる
**原因**: `--ar 9:16` の前後にスペースが正しくない / バージョン指定が間違い。  
**対処**:
- ✅ `--ar 9:16 --v 6.1` (各パラメータ前にスペース)
- ❌ `--ar 9:16,--v 6.1` / `--ar9:16` (区切り間違い)

### Q6. 13 枚のルックがバラバラ
**原因**: seed が固定されていない / Phase 1 を飛ばした。  
**対処**: §3 Phase 1 に戻って seed を確定 → 全カットを sed 置換 → 再生成。

### Q7. アプリの 9×9 グリッドが歪んで描かれる
**原因**: Midjourney は完全な geometric grid を描くのが苦手 (微妙にセル幅がブレる)。  
**対処**:
- プロンプトに `mathematically precise grid, perfectly aligned cells, equal-width gaps` 追加
- それでも歪む場合、**実機録画素材で代替** することも検討 (絵コンテ用途なら Midjourney で十分、本番動画は実機録画前提)

### Q8. アプリアイコンの中身が毎回違う
**仕様**: 本案では「Midjourney でアイコンを正確に再現させる」のではなく、**抽象的な monogram / mandala mark で雰囲気のみ確定** → 本番では実アイコン PNG (1024×1024) を後合成。  
プロンプトの `minimal monogram or 9-dot mandala-grid mark` 部分はあくまで "形のヒント"。

### Q9. Discord で /imagine が見つからない
**対処**:
- Midjourney Bot が同じサーバにいるか確認 (公式 Discord 招待リンクから参加: https://discord.gg/midjourney)
- 自分専用サーバで使う場合は Bot を招待 (公式手順あり)
- DM 経由でも `/imagine` 可能 (Bot に直接 DM)

### Q10. 結果を後で見返したい
- Web UI: midjourney.com にログイン → 過去 Job が全て履歴で見られる
- Discord: 自分の生成は DM で受け取る設定にしておくと検索しやすい (`Settings → Direct Messaging`)

---

## 付録: 1 行コピー用「全 13 カット プロンプト」CSV エクスポート

スプレッドシート / バッチ処理用に 1 行 1 カットでまとめた版 (タブ区切り):

```tsv
Cut	Seconds	Role	Prompt
01	0.0-0.6	hook-1	Pure black background, single line of large elegant Japanese serif typography floating at vertical center, immense negative space above and below, dramatic emptiness, subtle film grain, monochrome, museum poster aesthetic, cinematic still, sharp focus on text only, no other elements --ar 9:16 --v 6.1 --s 200 --style raw --seed 1024
02	0.6-1.4	hook-2	Pure black background, large elegant white Japanese serif typography centered, with a smaller bold red question mark text rotated -8 degrees crashing diagonally into the right edge of the white text, sharp collision moment, premium poster design, two-color palette black white red, dramatic visual tension, sharp focus --ar 9:16 --v 6.1 --s 200 --style raw --seed 1024
03	1.4-2.0	hook-3	Black background, white Japanese serif typography in the process of dissolving into pixel fragments and ink drips, liquid distortion effect, broken letters falling apart, second smaller line of clean serif text appearing below at the lower third, double-exposure feel, decay vs appearance, monochrome, sharp focus on dissolution --ar 9:16 --v 6.1 --s 200 --style raw --c 10 --seed 1024
04	2.0-4.0	empathy-1	Black background, three lines of large elegant Japanese serif typography stacked vertically with generous spacing, each line a different desire phrase, smallest line at bottom in bold sans-serif, monochrome white text, clean editorial poster, vertical reading rhythm, no decorations, just text on void --ar 9:16 --v 6.1 --s 200 --style raw --seed 1024
05	4.0-7.0	empathy-2	Black background, large white minimal paper calendar mockup centered, showing month grid with subtle motion blur as if pages flipping rapidly, clean editorial design, in the lower left corner a small dim grey Japanese text label sits absolutely still as a counterpoint, double contrast between motion and stillness, monochrome, premium magazine layout aesthetic --ar 9:16 --v 6.1 --s 200 --style raw --seed 1024
06	7.0-10.0	empathy-3	Pure black background, three centered lines of elegant Japanese serif typography stacked, the third line slightly larger and bolder, dramatic contemplative space, museum exhibit text feel, breathing room, single faint vignette, monochrome, intimate quiet mood, philosophical poster aesthetic --ar 9:16 --v 6.1 --s 200 --style raw --seed 1024
07	10.0-12.0	solution-1	Dark mode mobile app mockup centered on near-black background, premium software aesthetic, single rounded-corner 3x3 grid of empty dark cells visible inside the device frame, the center cell highlighted with a heavy black-and-white border showing a Japanese phrase being typed character by character, soft drop shadow under the device, minimal UI, no notification chrome, hyper-clean tech product photography --ar 9:16 --v 6.1 --s 200 --style raw --seed 1024
08	12.0-15.0	solution-2	Dark mode app interface centered, full 3x3 grid of nine rounded-square cells visible, the center cell with thick black-and-white border containing a Japanese phrase, the eight peripheral cells each containing a different short Japanese label, all cells equal size and evenly spaced with 8px gaps, soft halo glow around the grid, minimal UI, premium software product shot, dark mode aesthetic --ar 9:16 --v 6.1 --s 200 --style raw --seed 1024
09	15.0-19.0	solution-3	Dark mode app interface, the previous 3x3 grid is in motion: one peripheral cell zooms toward the camera and transforms into a new center, while eight new sub-cells fan out around it in a deeper second 3x3 grid, hierarchical zoom motion captured as a still, depth and recursion implied through scale, premium dark UI, halo glow --ar 9:16 --v 6.1 --s 200 --style raw --c 5 --seed 1024
10	19.0-22.0	solution-4	Dark mode app interface displaying a complete 9x9 grid (eighty-one small dark rounded-square cells) arranged in a 3x3 macro pattern of 3x3 micro-grids, each cell containing tiny faint Japanese text labels, dramatic top-down product photography composition, the grid resembles a constellation map of intentions, halo of soft light, monochrome dark UI, premium minimal software aesthetic, sharp focus on the entire grid lattice --ar 9:16 --v 6.1 --s 200 --style raw --seed 1024
11	22.0-25.0	solution-5	The 9x9 grid from before now sits faded and blurred in the background at fifty percent opacity, while in the foreground crisp Japanese serif typography appears in two layers, a primary larger phrase mid-frame and a smaller dim grey secondary phrase below, layered editorial composition, blurred-foreground-text-on-clear-background reverse, monochrome with subtle amber accent, premium poster design, contemplative --ar 9:16 --v 6.1 --s 200 --style raw --seed 1024
12	25.0-28.0	cta-1	Pure black background, single rounded-square premium app icon centered in the upper third with subtle drop shadow, the icon design features a minimal monogram or 9-dot mandala-grid mark, below it large elegant Japanese serif typography spelling the app name with letter-spacing, generous negative space, museum poster composition, hi-tech minimal brand reveal --ar 9:16 --v 6.1 --s 200 --style raw --seed 1024
13	28.0-30.0	cta-2	Pure black background, premium rounded-square app icon in upper area, elegant Japanese serif app name below it, then two lines of bold sans-serif Japanese pricing-and-platform copy mid-frame in white, and at the bottom a single bold amber-yellow Japanese call-to-action with a downward arrow symbol, complete commercial closing frame layout, multi-tier typographic hierarchy, generous negative space, premium brand commercial poster --ar 9:16 --v 6.1 --s 200 --style raw --seed 1024
```

> CSV/TSV としてスプレッドシートに貼ると 13 行 4 列のテーブルになる。バッチ処理 / 進捗管理 / レビューチェックシートに使える。
