# アニメーション仕様 — マンダラート デスクトップアプリ

エディタで使われる主要なアニメーションの目的・実装・既知のハマりポイントをまとめたドキュメント。実装は主に [`EditorLayout.tsx`](../src/components/editor/EditorLayout.tsx) + [`index.css`](../src/index.css) の 2 ファイルで完結している。

---

## 全体方針

- **CSS-only で完結させる**。React state の flip + `transition` 方式は WebKit で発火タイミングが不安定になりがちなので、`@keyframes` + `animation-fill-mode: both` に統一している
- 演出の骨子は 4 種類:
  1. **Slide**: 並列グリッド切替時の横スライド
  2. **Orbit**: ドリルダウン・ドリルアップ・初回表示時の「クリックセルの移動 + 時計回り段階表示」
  3. **View Switch**: 3×3 ↔ 9×9 表示モード切替時の縮小 / 展開
  4. **Converge Overlay (morph)**: ルートを跨ぐ「セル ↔ ダッシュボードカード ↔ ストックエントリ」の寸法 morph アニメ ([`ConvergeOverlay.tsx`](../src/components/ConvergeOverlay.tsx) + [`convergeStore.ts`](../src/store/convergeStore.ts))
- アニメーション中は `pointer-events: none` で操作を止め、編集系イベント (`onDrill` / `onDragStart` / `onCellSave` 等) を一時的に no-op にして事故を防ぐ

---

## 1. 並列グリッドスライド

### 目的
並列グリッド (`<` / `>` / `+` ボタン) で切替えた際に「隣のグリッドへ滑っていく」視覚効果を出す。ただ currentGrid が入れ替わるだけだと、同じ位置に別グリッドが pop するだけで「新しいグリッドが増えた / 切り替わった」ことが伝わりにくいため。

### state

```ts
type SlideState = {
  fromCells: Cell[]
  toCells: Cell[]
  direction: 'forward' | 'backward'
}
```

- `forward`: 「+ 」や「>」で右隣へ → 現在のグリッドが左へ押し出され、新グリッドが右から入る
- `backward`: 「<」で左隣へ → 逆方向

### 仕組み

1. **2 枚のグリッドを横並びに配置した flex コンテナ** (`width: gridSize * 2`) を描画する
2. そのコンテナを CSS `animation` で `translateX` する:
   - `parallel-slide-forward`: `translateX(0) → translateX(-50%)`
   - `parallel-slide-backward`: `translateX(-50%) → translateX(0)`
3. アニメーション終了後 (`SLIDE_DURATION_MS = 320`) に `setSlide(null)` でクリアし、通常描画に戻す
4. アニメ中のグリッドは `GridView3x3` / `GridView9x9` に `onCellSave` などの編集 props を渡さない (view-only)

### 注意点

- `parallelGrids` / `parallelIndex` の state は **animation の前** に切り替える (setCurrentGrid 含む)。アニメは純粋に視覚エフェクト
- `handleParallelNav` / `handleAddParallel` で `breadcrumb` 末尾の `gridId` を追従させる (パンくずリスト末尾ラベルの同期用)
- `handleAddParallel` は新グリッドを元グリッドと同じ `center_cell_id` で作成する (X=C 統一モデル)。中心セルは DB レベルで親 X と共有されるので別途コピー不要。アニメ用の `toCells` は `getGrid` で merged された 9 要素の `newGrid.cells` をそのまま使える

---

## 2. セル軌道アニメーション (Orbit)

### 目的

3×3 表示で階層を移動するとき、「クリックされたセルがどこへ移動するか」を視覚的に示す。全セルが一瞬で描き変わると、ユーザーが「どのセルに入ったか / どのセルから戻ってきたか」を見失うため。

### 3 つの発火ケース

| direction | 発火タイミング | 動くセル | 周辺セルの登場順 |
|---|---|---|---|
| `drill-down` | 3×3 で入力ある周辺セルをクリック | サブグリッドの中心セル (pos 4) — クリック位置から中心へ移動 | `[7, 6, 3, 0, 1, 2, 5, 8]` (中心は移動セル) |
| `drill-up` | 3×3 でサブグリッドの中心セル (pos 4) をクリック | 親グリッド内の「ドリル元セル」 — 中心 (pos 4) から自然位置へ移動 | `[7, 6, 3, 0, 1, 2, 5, 8, 4]` (中心が最後) |
| `initial` | マンダラートを開いた直後 (ダッシュボードからのカードクリック含む) | なし (全セル fade-in のみ) | `[4, 7, 6, 3, 0, 1, 2, 5, 8]` (中心から開始) |

`initial` direction は `OrbitState.initialDelayMs` を持ち、ダッシュボード → エディタ拡大 (`convergeStore.direction === 'open'` 経由) で開いた場合のみ `CONVERGE_DURATION_MS` をセット。convergence overlay の morph 完了まで全セル opacity 0 で隠し、中心セルだけは duration=1ms の instant snap で overlay 終端と同フレームで可視化、周辺セルはその後「のの字」順で staggered fade-in。詳細は **5. Converge Overlay** 節参照。

### 9×9 ブロック orbit (orbit9)

9×9 表示でも同じ演出を「サブグリッド (3×3 ブロック)」単位で再生する。`orbit9` state は `orbit` と同じ構造を持ち、`movingToPosition` / `movingFromPosition` がブロック単位の座標に変わっているだけ。セル orbit の `targetCells` に相当するものとして `targetRootCells` (中央ブロックに入る 9 セル) と `targetSubGrids` (周辺 8 ブロックに入れるサブグリッドデータ) を事前フェッチして持たせる。

発火ケースは 3×3 と同じ 3 種類。いずれも中央ブロックは 9 セルすべてを再描画し、周辺ブロックは「子サブグリッドがあればその 9 セル、なければ親セル単独を中心に配置」という分岐で 9×9 構造を再現する。auto-clear useEffect は `childCounts` に加えて `subGrids` も pre-populate してから `setOrbit9(null)` にする (= `useSubGrids` の async fetch 遅延で一瞬空っぽに見えるのを防ぐ)。

### state

```ts
type OrbitState = {
  targetCells: Cell[]
  targetGridId: string
  childCountsByCellId: Map<string, number>
  movingCellId: string | null
  movingFromPosition: number
  direction: 'drill-down' | 'drill-up' | 'initial'
}
```

- `targetCells`: 遷移後のグリッドの 9 セル (orbit 中の描画ソース)
- `targetGridId`: gridData がこの id に追いついたら auto-clear する (orbit → 通常描画の切替を同期)
- `childCountsByCellId`: orbit 中の border 判定用。通常の `childCounts` state は別 useEffect が async 再計算するので、orbit 終了時に値ズレで一瞬 border 幅が変わる「ちらつき」が発生するため、orbit 開始時に事前フェッチして持たせ、クリア時に `childCounts` state にも流し込む
- `movingCellId`: 動くセルの id。`null` の場合 (initial) は全セル fade-in 扱い
- `movingFromPosition`: 動くセルが視覚的に出現する位置 (target grid 内の座標系)

### 実装のしくみ

**CSS keyframes** ([`index.css`](../src/index.css)):

```css
@keyframes orbit-fade-in {
  from { opacity: 0; }
  to   { opacity: 1; }
}

/* 8 方向の移動用 keyframes (WebKit で CSS 変数を transform に使うと補間が効かない
   ケースがあったため、変数ではなく固定値の keyframes を 8 個用意している) */
@keyframes orbit-from-nw { from { transform: translate(calc(-100% - 8px), calc(-100% - 8px)); } to { transform: translate(0, 0); } }
@keyframes orbit-from-n  { from { transform: translate(0, calc(-100% - 8px)); } to { transform: translate(0, 0); } }
/* ... orbit-from-ne / orbit-from-w / orbit-from-e / orbit-from-sw / orbit-from-s / orbit-from-se も同様 */
```

**JS 側** ([`EditorLayout.tsx`](../src/components/editor/EditorLayout.tsx)):

```ts
function orbitMoveAnimationName(fromPos: number, toPos: number): string | null {
  // dCol / dRow から orbit-from-{nw/n/ne/w/e/sw/s/se} を選択
}
```

セルの `wrapperStyle` に `animation: orbit-from-XX ${duration}ms ease-out ${delay}ms both` を付ける。`animation-fill-mode: both` を使うので、delay 中は from フレーム (= 開始位置 / opacity 0) で固定され、時間が来ると再生される。

### タイミング

- `ORBIT_STAGGER_*_MS = 85` (各セルの登場間隔)
- `ORBIT_FADE_*_MS = 400` (各セルの fade / move duration)
- 合計時間
  - drill-down: `7 * 85 + 400 = 995ms` (周辺 8 セル stagger + 移動セル)
  - drill-up:   `8 * 85 + 400 = 1080ms` (9 セル stagger を踏むぶん若干長い)
  - initial:    `8 * 85 + 400 = 1080ms` (同じく 9 セル)

### 移動セルの drift 時間 (drill-up のみ)

drill-up では移動セル (親セル) の `movingDuration = max(fade, staggerIdx * stagger + fade)`。natural timing で「そのセルが stagger に現れる時刻」まで長くドリフトするので、中心から周辺への移動がはっきり視認できる。

drill-down は `delay 0, duration = fade` で即座に中心へ吸い寄せられる。

### 発火 / クリアの制御

- **drill-down / drill-up**: `handleCellDrill` 内で `setOrbit(...)` → `setTimeout` で合計時間待機 → `setCurrentGrid(...)` などで state 遷移。auto-clear useEffect が `gridData.id === orbit.targetGridId` を検知してクリア
- **initial**: `init()` 内で `resetBreadcrumb` が先に走って currentGridId を即セットするため、auto-clear を発動させると animation 開始前に消えてしまう。そのため `direction === 'initial'` の場合は auto-clear 対象から除外し、`setTimeout` で明示的にクリアする

### ハマりポイント

**1. CSS 変数を keyframes の `transform` に使う方式は不安定**

最初の実装は `--orbit-from` を CSS 変数で渡して `@keyframes` 内で `transform: var(--orbit-from)` としていた。これが WebKit (Tauri) でうまく補間されず、「from → to が共に `translate(0, 0)` と解釈される」= 移動アニメが動かない現象が発生した。**固定 keyframes 方式** (8 方向) に切り替えて解決。

**2. React state flip + `transition` 方式も不安定**

次に試した `orbitPhase: 'initial' → 'final'` で flip する方式も、React の batch commit と browser paint のタイミングがズレて「initial 状態がペイントされずに直接 final にジャンプ」するケースがあった。`@keyframes` + `animation-fill-mode: both` に完全移行して解決。

**3. drill-up to root で `movingCell` が null になる**

`parent.cellId` (= 親の breadcrumb エントリの cellId) を使って movingCell を探していたが、parent が root の場合は `cellId = null` なので常に null になる。その結果 `if (movingCell)` 配下のアニメーションが丸ごとスキップされて「一瞬で切替」となっていた。

正しくは `currentEntry.cellId` (= 現在 grid を生んだ親 grid 内のセル) を使う。breadcrumb 末尾エントリの cellId は root 以外では必ず非 null。

**4. orbit 終了時の border 幅ちらつき**

orbit がクリアされた瞬間に通常描画に切り替わる際、`childCounts` state が gridData 依存の別 useEffect で async 再計算されるため、一瞬だけ「新 gridData + 古い childCounts」の組み合わせになる。セルの border 幅は childCount に依存するので、幅が 1〜2px ずれて「ちらつく」。

対策: orbit クリアの useEffect で同時に `setChildCounts(orbit.childCountsByCellId)` を実行して pre-populate する。

**5. orbit 終了時のグリッドサイズ微振動**

ResizeObserver が breadcrumb 高さ変動 (scrollbar の出し入れ等) を拾って `gridSize` を 1〜3px ずらすと、グリッド全体が伸縮して見える。

対策:
- Breadcrumb の `<nav>` に `[&::-webkit-scrollbar]:hidden` を付けて scrollbar を消す
- ResizeObserver で `Math.floor` + 「前回値との差が 4px 未満ならスキップ」で微小変化を吸収

**6. drill-down / drill-up の順序に注意**

orbit は「state 遷移より前」に `setOrbit` → 待機 → state 遷移、の順。逆にすると `useGrid` が先にフェッチを走らせて `gridData` が target に変わり、auto-clear が animation 開始前に発動してしまう。

**7. lazy 設計の空 slot を入れた場合のタイミング統一**

`orbit.targetCells` にはコンテンツのある cell 行しか含まれない (lazy cell creation)。空 slot を `<div />` で返すだけだと、入力ありセルだけ stagger fade-in し、空セルは orbit 終了後の通常 render swap でようやく枠付きで現れる ("外枠が最後に出る" 体験)。

**対策**: orbit / to-3x3 view-switch 描画の `if (!cell)` 分岐で、`GridView3x3` の空 placeholder と同じ枠 + 背景を持つ styled `<div>` を返し、wrapperStyle で **同じ `orbit-fade-in` (or transform transition)** + `staggerIdx * stagger` の delay を当てる。これで populated / empty 問わず 7-6-3-0-1-2-5-8 順に一斉表示される。

**8. Cell 内 `done` チェックボックスの描画タイミング**

[`Cell.tsx`](../src/components/editor/Cell.tsx) の `showCheckbox` 判定は `!!onToggleDone && ...` を含むので、アニメ render 経路 (slide / orbit 3×3 / to-3x3) で `onToggleDone` を渡し忘れると、checkbox が orbit 終了後の swap で初めて出現してしまう (= セル本体は fade-in しているのに checkbox が遅れて pop)。

**対策**: 各アニメ render 経路で `onToggleDone={showCheckbox ? handleToggleDone : undefined}` を渡す。`pointer-events: none` で click は飛ばないが、render 上は同時に表示される。

---

## 3. 表示モード切替 (View Switch)

### 目的

3×3 表示と 9×9 表示をトグルボタンで切替える際に、視覚的な連続性を保って「どちらが何なのか」を直感的に伝える。瞬時に切り替えると 9 セルがいきなり 81 セルに増えたように見えて、親子関係 (中央ブロック = 現在の 3×3) が分かりにくい。

### 2 方向

| direction | 演出 |
|---|---|
| `to-9x9` | 現在の 3×3 が中央原点で `scale(1)→scale(1/3)` に縮小 (= 9×9 の中央ブロック位置に収束) しつつ、周辺 8 ブロックが時計回り `[7,6,3,0,1,2,5,8]` で stagger fade-in |
| `to-3x3` | 中央ブロックの 9 セルが個別に `scale(1/3) + translate(9×9 位置)` → `scale(1)` で 3×3 natural 位置へ展開、`[7,6,3,0,1,2,5,8,4]` で stagger (中心最後)。周辺 8 ブロックは fade-out |

### state

```ts
type ViewSwitchState = {
  direction: 'to-9x9' | 'to-3x3'
  rootCells: Cell[]
  subGrids: Map<string, SubGridData>
  childCountsByCellId: Map<string, number>
}
```

加えて `viewSwitchPhase: 'start' | 'end'` を別に持ち、`viewSwitch` がセットされた 2 フレーム後に `'end'` に切替える。この phase flip が `to-3x3` の per-cell `transform transition` を発火させる。

### 実装のしくみ

- **`to-9x9`** — 3 層構成 (下 → 上):
  1. 周辺 8 ブロック (`orbit-fade-in`、delay 200ms + stagger 85ms)
  2. 縮小する 3×3 (source): `view-shrink-to-center` で scale 1 → 1/3 + 後半 200–400ms で `view-fade-out` の 2 アニメーションを合成
  3. **target の 9×9 中央ブロック (通常 9×9 render と完全同一の構造 = `bg-gray-300` wrapper + `size='small'` セル + `border-[6px]`)** を最前面に置き、200–400ms で `orbit-fade-in`
  source → target のクロスフェードをすることで、transition layer 終了時の swap でテキストや枠が pop する問題を回避している (scaled 3×3 と実 9×9 center block はセル幅 ~66 vs ~62、gap 2.67 vs 1、textInset 5.3–5.7 vs 6 と微差があり直接 swap すると「一段階内側に収縮」する)。
- **`to-3x3`** — 中央の 9 セルは最終 (3×3 natural) 位置に CSS Grid で配置し、`transform: translate(tx, ty) scale(1/3)` で一時的に 9×9 位置に押し込む。`viewSwitchPhase === 'end'` で `transform: translate(0,0) scale(1)` に切替 → `transition: transform 400ms ease-out ${delay}ms` で展開。double `requestAnimationFrame` で phase flip の間に確実に paint を挟み、WebKit の commit/paint 競合を回避する。周辺ブロックは `view-fade-out` keyframes で fade-out。
  transform は Cell の `wrapperStyle` prop 経由でセル本体 (= grid item) に直接適用する。余分な `<div>` で囲むと Cell が grid item としてサイズを得られず空になってしまうので注意。

### タイミング

- `VIEW_SWITCH_FADE_MS = 400` / `VIEW_SWITCH_STAGGER_MS = 85` — 既存 Orbit と揃える
- `to-9x9`: 周辺の初回 delay = `VIEW_SWITCH_TO_9_DELAY_MS = 200ms`。total = 200 + 7*85 + 400 = 1195ms
- `to-3x3`: total = 8*85 + 400 = 1080ms (drill-up と同じ)

### ハマりポイント

**1. per-cell で translate 量が異なるので CSS 変数方式が使えない**

`to-3x3` では 9 セルそれぞれに異なる `(tx, ty)` が必要。keyframes で `transform: var(--tx)` は WebKit で補間が効かないため、inline `transform` + `transition` + React state flip に寄せた。state flip 方式を安全に動かすため double rAF を入れている。

**2. viewMode を切替えるタイミング**

`setViewMode(next)` をアニメーション開始時に呼ぶ。transition layer が `viewSwitch` を見て優先描画するので「まだ 3×3 layout なのに 9×9 が見える」という不整合は起きない。アニメ終了時に `setViewSwitch(null)` で通常描画に戻る。

**3. subGrids / childCounts の事前投入**

`to-9x9` 後の通常描画に使う `subGrids` と `childCounts` を、アニメーション開始時点で `setSubGrids / setChildCounts` で投入しておく。これをしないと useSubGrids の async fetch が遅れて「アニメ終了 → 一瞬空っぽ → 遅れて正しい描画」とちらつく。

**4. `to-9x9` で中央ブロックを 2 層にする理由**

初期実装は「縮小 3×3 のみ」を描画 → 終了時に通常 9×9 render に切替、という構成だった。しかしこの 2 つはセル幅・gap・textInset・外枠に微差があり、swap の瞬間に「中央ブロックのテキストが一段階内側に収縮する」視覚的な pop が起きた。対策として target レイヤー (通常 9×9 render と同じ構造) を最前面に置いてクロスフェードし、400ms 時点でピクセル一致状態にしてから transition layer を終了させる。

**5. `to-3x3` で Cell を余分な div で囲まない**

Cell の root div は CSS Grid item として stretch される前提。余分な `<div style={{transform}}>` ラッパーで囲むと、Cell のルートが grid item ではなくなって `height: auto`(=コンテンツ依存) で実質 0 高さに潰れる。transform / transition は必ず Cell の `wrapperStyle` prop 経由でルート div に直接適用する。

---

## 4. 補助的な動き

### Cell hover `shadow-md`

Tailwind の `hover:shadow-md` + `transition-shadow`。orbit / slide との相互作用は特になし。

## 5. Converge Overlay (Morph)

### 目的

エディタ ↔ ダッシュボード ↔ ストック の遷移時に、「ユーザーが直前に見ていた要素」から「遷移先の同じ logical object」へ滑らかに **寸法/枠/角丸/inset/font-size を並列 morph** する。スクリーン間の visual continuity を確保し、UI が同じ要素を示していることを認知させる。

`transform: scale()` を使わず CSS 個別プロパティ transition で morph する設計が肝で、終端の overlay は素 CSS で描画される target と同一のレンダリングパイプラインに乗るため subpixel 描画差が原理的に発生せず、終端の "止まる瞬間" の visual snap が消える。

### 3 方向

| direction | 起点 | 着地点 | polling selector | 駆動側 |
|---|---|---|---|---|
| `home` | エディタ中心セル (3×3 / 9×9 どちらでも) | `[data-converge-card="<mandalartId>"]` (ダッシュボードカード) | `[data-converge-card="<id>"]` | [`EditorLayout.handleNavigateHome`](../src/components/editor/EditorLayout.tsx) — ホームボタン |
| `open` | ダッシュボードカード | エディタ root grid 中心セル | `[data-mandalart-id="<id>"] [data-position="4"]` | [`DashboardPage.MandalartCard.handleClick`](../src/pages/DashboardPage.tsx) |
| `stock` | エディタ内の copy/move された source セル | 新規ストックエントリ | `[data-converge-stock="<stockItemId>"]` | [`EditorLayout.handleDndAction`](../src/components/editor/EditorLayout.tsx) (copy / move / self-centered move 経路) |

### state ([`convergeStore.ts`](../src/store/convergeStore.ts))

```ts
type ConvergeState = {
  direction: 'home' | 'open' | 'stock' | null
  targetId: string | null
  sourceRect: { left, top, width, height } | null
  centerCell: {
    text, imagePath, color,
    fontPx, topInsetPx, sideInsetPx,  // source DOM 実測値
    borderPx, radiusPx,               // 〃
  } | null
}
```

`targetId` は polymorphic id (mandalartId / mandalartId / stockItemId)。`centerCell` は source 側 DOM の実測値で、overlay の **初期** 値として使う (終端値は polling 対象 DOM から `getComputedStyle` で読む)。両端ともに DOM 実測なのでテーマ/フォント拡縮に自動追従。

### 駆動シーケンス

1. **trigger 側** が source DOM の rect / 内部 text wrapper / span / `getComputedStyle` の border-width / border-radius を計測 → `setConverge(direction, id, rect, centerCell)` → (route 切替が伴う場合は) `navigate(...)`
2. **`ConvergeOverlay`** (App 直下常駐、`<Routes>` の隣にマウント) が state 変化を検知 → `position: fixed` で sourceRect の位置/寸法/枠/角丸/inset/font-size を**初期値**として描画
3. setTimeout(16ms) で 1 frame 待ってから `targetSelector` を polling (50ms × 30 回 = 最大 1.5s)
4. target DOM が見つかったら、自身の overlay と内部 text wrapper / span に `transition: left/top/width/height/border-width/border-radius/inset/font-size` を並列適用し、target 値に書き換え
5. `transitionend` (propertyName === 'width' で絞る) または `safetyTimer` (`dur + 200ms`) で `finalize` → `clear()` で state を消す

### target 側のハンドオフ仕様

morph 完了の瞬間に「overlay 消滅」と「target 要素可視化」が同フレームで起きないと target の中身が overlay 到着前に裸で見えてしまう。これを防ぐため、各 target 要素は `direction` と `targetId` を購読して、自分がターゲットの間は `animation: orbit-fade-in 1ms ease-out ${CONVERGE_DURATION_MS}ms both` を当てる。`animation-fill-mode: both` の効果で:

- t=0..400ms: opacity 0 (from frame で固定) → morph 中に target の中身は見えない
- t=400ms (= CONVERGE_DURATION_MS): 1ms snap で opacity 0 → 1 → overlay clear と同フレームで可視化

実装箇所:
- [`DashboardPage.MandalartCard`](../src/pages/DashboardPage.tsx) (direction='home' のターゲット)
- [`EditorLayout` orbit 描画の中心セル](../src/components/editor/EditorLayout.tsx) (direction='open' のターゲット、`OrbitState.initialDelayMs` 経由)
- [`StockTab`](../src/components/editor/StockTab.tsx) (direction='stock' のターゲット)

### target 構造の前提

ConvergeOverlay の polling は、target 要素の子から `div.absolute.z-10:not(.inset-0) > span` を探して終端の inset / font-size を読む。Cell.tsx / DashboardPage MandalartCard / StockTab はすべてこの構造に統一されており、新しい着地候補要素を追加するときも同じ DOM 構造で書く必要がある (構造が違うとテキスト系プロパティの morph 終端が読み取れず、span のサイズ/位置が補間されない)。

### 新規 landing-target を追加する際のチェックリスト

新しい converge direction (例: 外部エディタ連携 / 別画面への morph 等) や既存 direction の新規 target 要素を足すときは、以下を**全て**満たす必要がある:

1. **polling selector を direction 別に切替えるか拡張する** — [`ConvergeOverlay.tsx`](../src/components/ConvergeOverlay.tsx) の polling は direction で `[data-converge-card]` / `[data-mandalart-id] [data-position="4"]` / `[data-converge-stock]` を切替えているので、新 direction では新たな selector を追加する
2. **landing 要素の DOM 構造**を `div.absolute.z-10:not(.inset-0) > span` (テキスト) または `<img class="absolute inset-0 w-full h-full object-cover">` (画像) に統一する。共通 [`CardLikeText.tsx`](../src/components/CardLikeText.tsx) を使えば自動でこの構造になる
3. **landing 要素に `data-converge-*` 属性 + `direction` / `targetId` 購読の useEffect** を入れる (target が自分のときだけ animation を当てる)
4. **終端 fade-in は 1ms snap pattern**: `animation: orbit-fade-in 1ms ease-out CONVERGE_DURATION_MS both` を当てる。`animation-fill-mode: both` の効果で morph 中は opacity 0 で隠れ、終端で 1ms snap → overlay clear と同フレームで可視化される (= 中身が overlay 到着前に裸で見えない)
5. **既存 3 箇所** ([`Cell.tsx` 中心セル](../src/components/editor/Cell.tsx) / [`DashboardPage` MandalartCard](../src/pages/DashboardPage.tsx) / [`StockTab` StockEntry](../src/components/editor/StockTab.tsx)) と完全に同 pattern であることを目視確認する

これらを 1 つでも外すと、morph 中に target の中身が裸で先見えする / 終端で text が pop する / そもそも polling timeout で animation が走らない、いずれかが起きる (落とし穴 #19 参照)。

### stock 経路の特殊事情

direction='stock' は route 切替を伴わない。トリガー側 (`handleDndAction`) は cell DOM 計測 → `addToStock` / `moveCellToStock` で `StockItem` を取得 → setStockReloadKey + setConverge → 続けて `permanentDeleteGrid` 等の post-cleanup を実行する。新規ストックエントリは StockTab の async fetch 後に DOM に出現するので、polling は数 100ms かけて待つ。メモタブがアクティブだった場合は **SidePanel が `convergeStore.direction === 'stock'` を購読する useEffect で自動的にストックタブへ切替える** (`SidePanel.tsx`)。これにより memo タブ中に drop しても StockTab がマウントされて polling target が解決する。

### 注意点

1. **transition: all を使わない**。`left / top / width / height / border-width / border-radius / inset / font-size` を明示列挙。後から追加されたプロパティが意図せず補間されるのを避ける
2. **`border-width` / `border-radius` を className でなく inline style 初期値で持つ**。Tailwind の `border-[6px]` はコンパイル時に固定 CSS 値となり JS から書き換えても class との競合や 1 frame 古い表示が出る可能性。最初から inline でやる
3. **`transitionend` は重複発火**。並列 6 プロパティのため複数回発火する。`event.propertyName === 'width'` で絞って 1 回だけ finalize
4. **画像のみセル**は内部 text wrapper が無いので polling は text 系プロパティを skip。overlay の `<img class="absolute inset-0 w-full h-full object-cover">` が overlay の width/height に追従する
5. **overlay 開始 1 frame 待ち**: `setTimeout(tryAnimate, 16)` で初期 inline 値を browser に反映させてから transition + 終端値を設定 (これがないと始点→終点の補間が起きない場合がある)
6. **target 側の hide 期間**: `CONVERGE_DURATION_MS` × `CONVERGE_DEBUG_SLOW_FACTOR` 連動。デバッグ時にスローにすれば target の hide 時間も等比でスローになる

---

### インライン編集 → 拡大エディタ

[`Cell.tsx`](../src/components/editor/Cell.tsx) のダブルクリック拡大エディタは `position: fixed` で 3×3 グリッド全体を覆う。アニメーションは付けていない (瞬時に出る)。

### テキストエリアの focus 復帰

拡大エディタのツールバー (色選択 / 画像アップロード) のボタンには `onMouseDown={(e) => e.preventDefault()}` を付けて textarea の blur を防いでいる。これがないと色を選ぶたびに blur → commit が走って編集モードが終了してしまう。

---

## 6. Help モーダル — コンセプトスライド (フルスクリーン演出)

[`ConceptSlide.tsx`](../src/components/help/ConceptSlide.tsx) は Welcome モーダル 1 番目のスライドで、マンダラート手法のコンセプトを **真紅 (rgb(221, 58, 63)) 背景 + セル枠 + 白フチ円 + 中心からの放射状直線**のフルスクリーンアニメで 4 phase 構成 (~12 秒) で表現する。Phase 4 完了と同時に親 ([`HelpDialog`](../src/components/help/HelpDialog.tsx)) が currentIndex を 1 へ自動進行 → ConceptSlide が unmount → フルスクリーン解除。

### Phase 構成

| Phase | 時間 | 演出 | キャプション |
|---|---|---|---|
| 1 | 0〜3s | 中央 1 マス (セル枠 + 白フチ円、円はセルいっぱい) が `orbit-fade-in` で出現 | なし |
| 2 | 3〜6s | 周辺 8 マスが `ORBIT_ORDER_PERIPHERAL` 順 (`[7,6,3,0,1,2,5,8]`) stagger で fade-in。**同時に中心セル → 周辺セルへの直線 (SVG `<line>`)** もそれぞれ fade-in | なし |
| 3a | 6〜7.5s | 3×3 grid 全体 (cells + Phase 2 lines) が `concept-3x3-shrink-to-center` で `scale(1) → scale(1/3)` に縮小。視覚的に「中央のマンダラートが 9×9 layout の中央ブロック位置へ集約」 | なし |
| 3b | 7.5〜10s | 周囲 8 ブロック (各 3×3 = 9 cells with circles) が `ORBIT_ORDER_PERIPHERAL` 順 (時計回り) で stagger fade-in。**同時に container 中心 → 各周辺ブロック中心への直線** もペアで fade-in | なし |
| 4 | 10〜12s | 全体 (outer container) を `concept-grid-shrink-fadeout` (scale 1 → 0.6 + opacity 1 → 0)、catchphrase を `concept-catchphrase-fadein` で fade-in | 「思考を、階層で広げる ─ Mandalart」(暫定) |

### 描画スタイル

- **セル枠の階層** (実マンダラート慣習: 中央 6px > サブグリッド有 2px > プレーン 1px に倣う):
  - `main` (Phase 1-2 中央 = grand center): `border-[12px]` → shrink 後 4px (絶対中心、最太)
  - `sub`  (Phase 1-2 周辺 = サブテーマ): `border-[6px]` → shrink 後 2px
  - `sub`  (Phase 3 周辺ブロックの中心、scale なし): `border-2` (2px)
  - `regular` (Phase 3 周辺ブロックの leaf 8 セル、scale なし): `border` (1px) + `border-white/50` で薄め
  - shrink 後の階層: 4px > 2px > 1px ← 実マンダラートの 6px > 2px > 1px と相似
- **円**: `border-2 border-white rounded-full` の白フチ (塗りなし)、セルいっぱいの大きさ。`backgroundColor: rgb(221, 58, 63)` (= 全体背景色) で円の内部を塗り、後ろを通る放射状直線が円の内側に貫通しないようにする
- **直線**: SVG `<line>` で `stroke="white"`、`strokeWidth="0.4"` (Phase 2) / `0.3` (Phase 3)、`vectorEffect="non-scaling-stroke"` で scale 変化中も線幅を維持
- 円の bg が背景色なので、直線は cells の隙間 (gap-3 = 12px) と各円の間にだけ視認される。重なっている部分は円の bg で隠れる

### 新規 / 変更 keyframes (index.css)

```css
/* Phase 3a: 3×3 全体を中央 1/3 領域へ縮小 (内部の cells / lines / 子 SVG が同時 scale) */
@keyframes concept-3x3-shrink-to-center {
  from { transform: scale(1); }
  to   { transform: scale(0.3333); }
}

/* Phase 4: outer container を scale + fade out (内側の縮小 3×3 はさらに小さくなり、周辺 block は 1 → 0.6) */
@keyframes concept-grid-shrink-fadeout {
  from { opacity: 1; transform: scale(1); }
  to   { opacity: 0; transform: scale(0.6); }
}

/* Phase 4: catchphrase fade-in (前半 1s は opacity 0 維持、後半 1s で 1 へ) */
@keyframes concept-catchphrase-fadein {
  0%   { opacity: 0; }
  50%  { opacity: 0; }
  100% { opacity: 1; }
}
```

各 cell / block / line の fade-in は既存 `orbit-fade-in` を再利用。旧 `concept-3x3-fadeout` / `concept-9x9-fadein` (cross-fade approach 用) は v4 で不要になったため削除済。

### Phase 3 の "shrink-then-expand" approach

旧 v3 (cross-fade) では 3×3 が opacity フェードアウトして 9×9 が cross-fade で出現していたが、新 v4 では:

1. **Phase 3a (1.5s)**: 3×3 grid 全体を `transform: scale(1) → scale(1/3)` で中央へ縮小。内部 cells + Phase 2 lines (SVG) が同 transform に乗って一緒に縮む。視覚的に「中央のマンダラートが 9×9 layout の中央ブロック位置へまとまる」
2. **Phase 3b (2.5s)**: 縮小完了後、周囲 8 ブロックが `ORBIT_ORDER_PERIPHERAL` 順 (時計回り) で stagger fade-in (250ms 間隔)。中央ブロックは縮小済みの 3×3 が常駐するので 9×9 grid 側では block 4 を skip
3. ブロック展開と同時に **中央 → 周辺ブロック中心への放射状直線** もペアで fade-in

中央ブロックの内部 (Phase 2 lines) と外側 (Phase 3 lines) で「中央から放射状に広がる」パターンを再帰的に描き、マンダラート手法の階層構造を視覚化する。

block 内の 9 cells は個別 stagger なしで同時表示 (block 単位の fade-in)。厳密な「セルが分裂する」ような split アニメーションは実装コストが大きいため将来タスク。

### HelpDialog 側との連携

- ConceptSlide は `fixed inset-0 z-50 bg-[rgb(221,58,63)]` のフルスクリーン overlay として render される。Modal 自身は z-40 なので背後に隠れる。Modal の title bar (× ボタン) / nav / footer は Concept active 中は invisible / 非 render
- ホバー pause は無効化 (Concept は時間ベースの guided animation なので止めない)
- 自動進行は autoAdvance フラグに**関わらず**必ず働く (= メニュー経由でも 12 秒で次のスライドへ抜ける)。Carousel の自動進行が OFF でも Concept の特例として時間で flow する
- 再訪時 (slide 2 → 1 へ戻る等): ConceptSlide が条件 render なので unmount → mount で CSS animation がリセットされ、最初から再生される
- ESC は Modal が listen しているので生きており、Concept 中でも閉じられる
- キーボード ← → も生きているので、Concept をスキップしたい場合は → でスライド 2 へジャンプ可能 (full-screen overlay 中でも document-level listener なので発火する)

---

## 定数と調整

### アニメーション速度

| 定数 | 値 | 用途 |
|---|---|---|
| `SLIDE_DURATION_MS` | 320ms | 並列スライド |
| `ORBIT_STAGGER_DOWN_MS` | 85ms | drill-down 各セルの登場間隔 |
| `ORBIT_FADE_DOWN_MS` | 400ms | drill-down fade / move duration |
| `ORBIT_STAGGER_UP_MS` | 85ms | drill-up 各セルの登場間隔 |
| `ORBIT_FADE_UP_MS` | 400ms | drill-up fade / move duration |
| `ORBIT_STAGGER_INIT_MS` | 85ms | 初回表示 stagger |
| `ORBIT_FADE_INIT_MS` | 400ms | 初回表示 fade |
| `VIEW_SWITCH_FADE_MS` | 400ms | view switch 各要素の fade / transform duration |
| `VIEW_SWITCH_STAGGER_MS` | 85ms | view switch の stagger |
| `VIEW_SWITCH_TO_9_DELAY_MS` | 200ms | to-9x9 で周辺ブロック fade-in が始まるまでの遅延 |
| `CONVERGE_DURATION_MS` | 400ms × factor | Converge overlay morph (寸法/枠/角丸/inset/font 並列 transition) duration |
| `CONVERGE_DEBUG_SLOW_FACTOR` | 1 (リリース時) | 収束アニメ全体の速度倍率。デバッグ時のみ > 1 にして slow 再生で動作確認する |

すべて [`EditorLayout.tsx`](../src/components/editor/EditorLayout.tsx) の冒頭または [`constants/timing.ts`](../src/constants/timing.ts) にまとまっている。スピード調整したい場合はここを変更する。

### グリッドサイズ予約

`SIDE_BUTTON_RESERVE = 128px`。左右の並列ナビボタン (`w-12 × 2 = 96px`) + `gap-4 × 2 = 32px` の合計。gridAreaRef の幅からこの分を差し引いて `gridSize` を計算する。
