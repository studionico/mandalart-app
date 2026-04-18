# アニメーション仕様 — マンダラート デスクトップアプリ

エディタで使われる主要なアニメーションの目的・実装・既知のハマりポイントをまとめたドキュメント。実装は主に [`EditorLayout.tsx`](../src/components/editor/EditorLayout.tsx) + [`index.css`](../src/index.css) の 2 ファイルで完結している。

---

## 全体方針

- **CSS-only で完結させる**。React state の flip + `transition` 方式は WebKit で発火タイミングが不安定になりがちなので、`@keyframes` + `animation-fill-mode: both` に統一している
- 演出の骨子は 3 種類:
  1. **Slide**: 並列グリッド切替時の横スライド
  2. **Orbit**: ドリルダウン・ドリルアップ・初回表示時の「クリックセルの移動 + 時計回り段階表示」
  3. **View Switch**: 3×3 ↔ 9×9 表示モード切替時の縮小 / 展開
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
| `initial` | ダッシュボードからマンダラートを開いた直後 | なし (全セル fade-in のみ) | `[4, 7, 6, 3, 0, 1, 2, 5, 8]` (中心から開始) |

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

### インライン編集 → 拡大エディタ

[`Cell.tsx`](../src/components/editor/Cell.tsx) のダブルクリック拡大エディタは `position: fixed` で 3×3 グリッド全体を覆う。アニメーションは付けていない (瞬時に出る)。

### テキストエリアの focus 復帰

拡大エディタのツールバー (色選択 / 画像アップロード) のボタンには `onMouseDown={(e) => e.preventDefault()}` を付けて textarea の blur を防いでいる。これがないと色を選ぶたびに blur → commit が走って編集モードが終了してしまう。

---

## D&D アニメーション

### ドラッグ開始 (マウス追従ゴースト)

`useDragAndDrop` がドラッグを検出 (mousemove で DRAG_THRESHOLD 到達) したときから、
ソースセル (or ストックアイテム) の内容を `position: fixed` で描画する "ゴースト" を
[`EditorLayout.tsx`](../src/components/editor/EditorLayout.tsx) 末尾でレンダリングする。

- ゴーストはカーソル位置に追従 (`dragPosition` state が mousemove ごとに更新される)
- `drag-wobble` CSS keyframes で ±3 度の rotate を `DRAG_WOBBLE_PERIOD_MS` (700ms) 周期で往復
- `pointerEvents: none` で elementFromPoint の判定に干渉しない
- ソースセル本体は `visibility: hidden` でレイアウトを維持しつつ視覚的に消える

### ターゲット swap 予告 (cell→cell のみ)

ドラッグ中に別セルにホバーすると、そのセルが自分のいる位置から **ソースセルの元位置へ**
transform でスライドする (swap の視覚予告)。

- `useDragAndDrop` の `sourceCellRect` (ドラッグ開始時の source の `getBoundingClientRect`)
  を Cell に渡す
- Cell は ` useLayoutEffect` で自身の layout rect を **drag 開始時に 1 回キャッシュ**
  (`getBoundingClientRect` は transform 反映済みの座標を返すため、ホバー中の再レンダで
  読み取ると「もう source 位置にある」と誤認して translate(0) に縮退するバグが起きる。
  cache で layout rect を固定することで回避)
- `transform: translate(sourceRect - ownRect)` + `transition: transform 220ms ease-out`
- ホバー解除時は `transform: translate(0, 0)` に戻す → 同じ transition で元位置へスライド

### 適用範囲

- 3×3 モードのみ (9×9 は読み取り専用なので D&D 無効)
- セル → セル: ゴースト + swap 予告
- ストック → セル: ゴースト + target ハイライト (target 移動なし、ドロップ先が空セル前提のため)

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
| `DRAG_WOBBLE_PERIOD_MS` | 700ms | D&D ドラッグゴーストの揺れ周期 |
| `DRAG_TARGET_SHIFT_MS` | 220ms | D&D swap 予告アニメの target 移動 duration |

すべて [`EditorLayout.tsx`](../src/components/editor/EditorLayout.tsx) の冒頭にまとまっている。スピード調整したい場合はここを変更する。

### グリッドサイズ予約

`SIDE_BUTTON_RESERVE = 128px`。左右の並列ナビボタン (`w-12 × 2 = 96px`) + `gap-4 × 2 = 32px` の合計。gridAreaRef の幅からこの分を差し引いて `gridSize` を計算する。
