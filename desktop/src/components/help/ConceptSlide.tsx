/**
 * Welcome モーダル 1 番目「コンセプト」スライド (v4: shrink-to-center + 放射状直線版)。
 *
 * 真紅 `rgb(221, 58, 63)` 背景で、セル枠 + 白フチ円のマンダラートが階層的に広がる
 * フルスクリーンアニメ。中央セルから周辺セルへ伸びる直線で「思考が広がる」演出を強化。
 *
 * Phase 構成 (合計 ~12 秒):
 *   Phase 1 (0〜3s):   中央セルが fade-in (キャプションなし)
 *   Phase 2 (3〜6s):   周辺 8 セルが ORBIT_ORDER_PERIPHERAL 順 stagger fade-in
 *                      + **同時に中心 → 周辺セルへの直線**もそれぞれ fade-in
 *   Phase 3a (6〜7.5s): 3×3 grid が中央に集約 (scale 1 → 1/3)
 *   Phase 3b (7.5〜10s): 周囲 8 ブロック (各 3×3) が ORBIT_ORDER_PERIPHERAL 順
 *                       (時計回り) で fade-in。**同時に中央ブロック → 各周辺ブロックへの直線**もペアで fade-in
 *   Phase 4 (10〜12s):  全体が縮小 + フェードアウト、catchphrase が fade-in
 *
 * 実装ポイント:
 * - 3×3 grid の縮小は CSS `transform: scale(1) → scale(1/3)` で実現 (内部の cells と
 *   Phase 2 lines が同時にスケール)
 * - 中央 ブロック (Phase 3 の中心 1/9 領域) は shrunk 3×3 grid そのもの。9×9 grid 側では
 *   block 4 (中央) を render しない (二重描画を避ける)
 * - 直線は SVG `<line>` で描画。各 line に `orbit-fade-in` を delay 付きで適用
 * - 円は `border-[3px] border-white rounded-full` で白フチ + セルいっぱい (padding なし)。
 *   `backgroundColor: rgb(221, 58, 63)` で塗って線を円の内側に通さない
 */

import { ORBIT_ORDER_PERIPHERAL } from '@/constants/grid'

const RED_BG = 'rgb(221, 58, 63)'

const PHASE2_START_MS = 3000
const PHASE3_START_MS = 6000
const PHASE3_SHRINK_DURATION_MS = 1500
const PHASE3_BLOCK_FIRST_DELAY_MS = PHASE3_SHRINK_DURATION_MS  // 3×3 縮小完了後にブロック展開開始
const PHASE3_BLOCK_STAGGER_MS = 250
const PHASE3_BLOCK_FADE_MS = 600
const PHASE4_START_MS = 10000

const PHASE1_FADE_MS = 1000
const PHASE2_STAGGER_MS = 350
const PHASE2_CELL_DURATION_MS = 600
const PHASE2_LINE_DURATION_MS = 600

/** 3×3 grid 内のセル中心 / 9×9 layout 内のブロック中心の (x, y) % 座標 */
function gridCenterPercent(position: number): { cx: number; cy: number } {
  const col = position % 3
  const row = Math.floor(position / 3)
  return { cx: col * (100 / 3) + 100 / 6, cy: row * (100 / 3) + 100 / 6 }
}

/**
 * セルの強調レベル (= 外枠の太さに意味を持たせる、実際のマンダラート慣習に倣う):
 * - `main`:    grand center (Phase 1-2 の中央セル、9×9 全体の絶対中心)。最も太い border
 * - `sub`:     sub-theme (Phase 3 周辺ブロックの中央セル、または central block の周辺セル =
 *              いずれも「テーマ」相当)。中ぐらいの border
 * - `regular`: leaf cell (周辺ブロックの周辺 8 セル)。最も細い border
 *
 * 中央 3×3 が Phase 3a で scale 1/3 に縮むことを考慮し、main / sub の太さを実 px ではなく
 * 「shrink 後に階層が保たれる」逆算値で指定する:
 *   main (Phase 1-2 中央): border-[12px] → shrink 後 4px (絶対中心、最太)
 *   sub  (Phase 1-2 周辺): border-[6px]  → shrink 後 2px (= 周辺ブロック中心と同太)
 *   sub  (周辺ブロック中央、scale なし): border-2 (2px)
 *   regular (周辺ブロック leaf、scale なし): border (1px)
 * shrink 後の階層: 4px > 2px > 1px ← 実マンダラートの 6px > 2px > 1px と相似
 */
type CellEmphasis = 'main' | 'sub' | 'regular'

const CELL_BORDER_CLASS: Record<CellEmphasis, string> = {
  main: 'border-[12px] border-white',
  sub: 'border-[6px] border-white',
  regular: 'border border-white/50',
}

/** セル 1 マス (枠 + セルいっぱいの白フチ円)。円の内側は背景色で塗りつぶし、線を貫通させない */
function ConceptCell({
  emphasis = 'regular', animation, gridColumnStart, gridRowStart,
}: {
  emphasis?: CellEmphasis
  animation?: string
  gridColumnStart?: number
  gridRowStart?: number
}) {
  return (
    <div
      className={`${CELL_BORDER_CLASS[emphasis]} flex items-center justify-center`}
      style={{ animation, gridColumnStart, gridRowStart }}
    >
      <div
        className="border-2 border-white rounded-full w-full h-full"
        style={{ backgroundColor: RED_BG }}
      />
    </div>
  )
}

/**
 * 3×3 = 9 セルのブロック (Phase 3 周辺ブロック用)。
 * 中央セル (position 4) は sub-theme として border-2、周辺 8 セルは leaf として border-1。
 * Phase 3 で block 単位 fade-in。中央ブロックは別扱い (上の縮小 3×3 が担当)。
 *
 * 周辺ブロックは scale なしなので、ここでは emphasis ごとの実 px をそのまま使う:
 *   center (sub):     border-2 (2px)
 *   peripheral (leaf): border (1px)
 *
 * ※ Phase 3 周辺ブロックの sub center は ConceptCell の `sub` ではなく `border-2` 直接指定
 *   (CELL_BORDER_CLASS.sub は Phase 1-2 の縮小逆算値 6px なのでここでは別ルート)
 */
function ConceptBlock3x3({
  animation, gridColumnStart, gridRowStart,
}: {
  animation: string
  gridColumnStart: number
  gridRowStart: number
}) {
  return (
    <div
      className="grid grid-cols-3 grid-rows-3 gap-1"
      style={{ animation, gridColumnStart, gridRowStart }}
    >
      {Array.from({ length: 9 }).map((_, i) => {
        const isBlockCenter = i === 4
        return (
          <div
            key={i}
            className={`${isBlockCenter ? 'border-2 border-white' : 'border border-white/50'} flex items-center justify-center`}
          >
            <div
              className="border-2 border-white rounded-full w-full h-full"
              style={{ backgroundColor: RED_BG }}
            />
          </div>
        )
      })}
    </div>
  )
}

export default function ConceptSlide() {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ backgroundColor: RED_BG }}
      aria-hidden={false}
    >
      <div className="relative" style={{ width: 'min(80vmin, 600px)', height: 'min(80vmin, 600px)' }}>
        {/* outer container: Phase 4 で全体を scale + fade out */}
        <div
          className="absolute inset-0"
          style={{ animation: `concept-grid-shrink-fadeout 2000ms ease-in-out ${PHASE4_START_MS}ms both` }}
        >
          {/* === Phase 1-2 + 中央ブロック (Phase 3 で scale 1/3 へ縮小) === */}
          <div
            className="absolute inset-0"
            style={{
              transformOrigin: 'center center',
              animation: `concept-3x3-shrink-to-center ${PHASE3_SHRINK_DURATION_MS}ms ease-in-out ${PHASE3_START_MS}ms both`,
            }}
          >
            {/* 3×3 grid: cells (中央 = main、周辺 8 = sub-theme) */}
            <div className="absolute inset-0 grid grid-cols-3 grid-rows-3 gap-3">
              <ConceptCell
                emphasis="main"
                gridColumnStart={2}
                gridRowStart={2}
                animation={`orbit-fade-in ${PHASE1_FADE_MS}ms ease-out 0ms both`}
              />
              {ORBIT_ORDER_PERIPHERAL.map((position, idx) => {
                const col = (position % 3) + 1
                const row = Math.floor(position / 3) + 1
                const delay = PHASE2_START_MS + idx * PHASE2_STAGGER_MS
                return (
                  <ConceptCell
                    key={position}
                    emphasis="sub"
                    gridColumnStart={col}
                    gridRowStart={row}
                    animation={`orbit-fade-in ${PHASE2_CELL_DURATION_MS}ms ease-out ${delay}ms both`}
                  />
                )
              })}
            </div>

            {/* Phase 2 lines: 中心セル → 周辺 8 セル */}
            <svg
              className="absolute inset-0 w-full h-full pointer-events-none"
              viewBox="0 0 100 100"
              preserveAspectRatio="none"
              style={{ zIndex: -1 }}
            >
              {ORBIT_ORDER_PERIPHERAL.map((position, idx) => {
                const { cx, cy } = gridCenterPercent(position)
                const delay = PHASE2_START_MS + idx * PHASE2_STAGGER_MS
                return (
                  <line
                    key={position}
                    x1={50}
                    y1={50}
                    x2={cx}
                    y2={cy}
                    stroke="white"
                    strokeWidth="0.4"
                    vectorEffect="non-scaling-stroke"
                    style={{ animation: `orbit-fade-in ${PHASE2_LINE_DURATION_MS}ms ease-out ${delay}ms both` }}
                  />
                )
              })}
            </svg>
          </div>

          {/* === Phase 3 周辺ブロック展開: 8 blocks (中央 block は除外、上の縮小 3×3 が担う) === */}
          <div className="absolute inset-0 grid grid-cols-3 grid-rows-3 gap-3">
            {Array.from({ length: 9 }).map((_, blockPos) => {
              if (blockPos === 4) return null
              const orbitIdx = ORBIT_ORDER_PERIPHERAL.indexOf(blockPos)
              const blockDelayMs =
                PHASE3_BLOCK_FIRST_DELAY_MS + Math.max(0, orbitIdx) * PHASE3_BLOCK_STAGGER_MS
              const col = (blockPos % 3) + 1
              const row = Math.floor(blockPos / 3) + 1
              return (
                <ConceptBlock3x3
                  key={blockPos}
                  gridColumnStart={col}
                  gridRowStart={row}
                  animation={`orbit-fade-in ${PHASE3_BLOCK_FADE_MS}ms ease-out ${PHASE3_START_MS + blockDelayMs}ms both`}
                />
              )
            })}
          </div>

          {/* Phase 3 lines: 中央 (= container 中心) → 周辺 8 ブロック中心 */}
          <svg
            className="absolute inset-0 w-full h-full pointer-events-none"
            viewBox="0 0 100 100"
            preserveAspectRatio="none"
            style={{ zIndex: -1 }}
          >
            {ORBIT_ORDER_PERIPHERAL.map((blockPos, idx) => {
              const { cx, cy } = gridCenterPercent(blockPos)
              const blockDelayMs = PHASE3_BLOCK_FIRST_DELAY_MS + idx * PHASE3_BLOCK_STAGGER_MS
              return (
                <line
                  key={blockPos}
                  x1={50}
                  y1={50}
                  x2={cx}
                  y2={cy}
                  stroke="white"
                  strokeWidth="0.3"
                  vectorEffect="non-scaling-stroke"
                  style={{ animation: `orbit-fade-in ${PHASE3_BLOCK_FADE_MS}ms ease-out ${PHASE3_START_MS + blockDelayMs}ms both` }}
                />
              )
            })}
          </svg>
        </div>

        {/* Phase 4: catchphrase fade-in (outer container の外側に置いて scale + fade out の影響を受けない) */}
        <p
          className="absolute inset-0 flex flex-col items-center justify-center text-center text-white font-semibold pointer-events-none px-8"
          style={{
            fontSize: 'clamp(20px, 4vmin, 36px)',
            animation: `concept-catchphrase-fadein 2000ms ease-in-out ${PHASE4_START_MS}ms both`,
          }}
        >
          <span>思考を、階層で広げる</span>
          <span className="text-base font-normal opacity-80 mt-2">─ Mandalart</span>
        </p>
      </div>
    </div>
  )
}
