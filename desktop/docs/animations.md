# アニメーション仕様 — マンダラート デスクトップアプリ

エディタで使われる主要なアニメーションの目的・実装・既知のハマりポイントをまとめたドキュメント。実装は主に [`EditorLayout.tsx`](../src/components/editor/EditorLayout.tsx) + [`index.css`](../src/index.css) の 2 ファイルで完結している。

---

## 全体方針

- **CSS-only で完結させる**。React state の flip + `transition` 方式は WebKit で発火タイミングが不安定になりがちなので、`@keyframes` + `animation-fill-mode: both` に統一している
- 演出の骨子は 2 種類:
  1. **Slide**: 並列グリッド切替時の横スライド
  2. **Orbit**: ドリルダウン・ドリルアップ・初回表示時の「クリックセルの移動 + 時計回り段階表示」
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
- `handleAddParallel` は新グリッドの中心セルに現グリッドの中心セル内容を自動コピーする。アニメーション用の `toCells` にも反映させる必要がある (`newGrid.cells` は古い値のため)

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

## 3. 補助的な動き

### Cell hover `shadow-md`

Tailwind の `hover:shadow-md` + `transition-shadow`。orbit / slide との相互作用は特になし。

### インライン編集 → 拡大エディタ

[`Cell.tsx`](../src/components/editor/Cell.tsx) のダブルクリック拡大エディタは `position: fixed` で 3×3 グリッド全体を覆う。アニメーションは付けていない (瞬時に出る)。

### テキストエリアの focus 復帰

拡大エディタのツールバー (色選択 / 画像アップロード) のボタンには `onMouseDown={(e) => e.preventDefault()}` を付けて textarea の blur を防いでいる。これがないと色を選ぶたびに blur → commit が走って編集モードが終了してしまう。

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

すべて [`EditorLayout.tsx`](../src/components/editor/EditorLayout.tsx) の冒頭にまとまっている。スピード調整したい場合はここを変更する。

### グリッドサイズ予約

`SIDE_BUTTON_RESERVE = 128px`。左右の並列ナビボタン (`w-12 × 2 = 96px`) + `gap-4 × 2 = 32px` の合計。gridAreaRef の幅からこの分を差し引いて `gridSize` を計算する。
