
import { useEditorStore, BreadcrumbItem } from '@/store/editorStore'
import { CENTER_POSITION, GRID_SIDE } from '@/constants/grid'

type Props = {
  onHome: () => void
  /**
   * パンくず項目クリック時に親コンポーネントへ通知するためのフック。
   * 渡された場合はこちらが呼ばれ、ストアの popBreadcrumbTo は使わない。
   * EditorLayout 側で「空のグリッドを削除してから遷移」などの処理を差し込むのに使う。
   */
  onNavigate?: (targetGridId: string) => void
}

// 1 マスの一辺 (px)。3×3 で 21px 角のアイコンになる
const MAP_UNIT_PX = 7

/**
 * 現在地マップアイコン。1 つの正方形を縦 2 本・横 2 本の線で 3×3 に区切り、
 * その階層で「展開したセルの position」の 1 マスだけを塗りつぶす。
 * ルートは中心 (CENTER_POSITION)、以降は親グリッドで展開した周辺セルの position
 * (highlightPosition、ルートは null → 中心扱い)。横に並ぶと現在地の経路マップになる。
 */
function LocationMapIcon({ item }: { item: BreadcrumbItem }) {
  const filledPosition = item.highlightPosition ?? CENTER_POSITION
  const col = filledPosition % GRID_SIDE
  const row = Math.floor(filledPosition / GRID_SIDE)
  const size = MAP_UNIT_PX * GRID_SIDE
  // 内側の区切り線位置 (縦 2 / 横 2)
  const dividers = Array.from({ length: GRID_SIDE - 1 }, (_, i) => (i + 1) * MAP_UNIT_PX)
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="block" shapeRendering="crispEdges">
      {/* 塗りつぶしセル */}
      <rect
        x={col * MAP_UNIT_PX}
        y={row * MAP_UNIT_PX}
        width={MAP_UNIT_PX}
        height={MAP_UNIT_PX}
        className="fill-neutral-900 dark:fill-neutral-100"
      />
      {/* 外枠 + 内側の区切り線 */}
      <g className="stroke-neutral-400 dark:stroke-neutral-500" strokeWidth={1} fill="none">
        <rect x={0.5} y={0.5} width={size - 1} height={size - 1} />
        {dividers.map((p) => (
          <line key={`v${p}`} x1={p} y1={0} x2={p} y2={size} />
        ))}
        {dividers.map((p) => (
          <line key={`h${p}`} x1={0} y1={p} x2={size} y2={p} />
        ))}
      </g>
    </svg>
  )
}

export default function Breadcrumb({ onHome, onNavigate }: Props) {
  const { breadcrumb, popBreadcrumbTo } = useEditorStore()

  function handleItemClick(item: BreadcrumbItem, idx: number) {
    if (idx === breadcrumb.length - 1) return // 現在地はクリック不要
    if (onNavigate) {
      onNavigate(item.gridId)
    } else {
      popBreadcrumbTo(item.gridId)
    }
  }

  return (
    <nav className="flex items-center gap-1 overflow-x-auto py-1 px-1 text-sm [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      <button
        onClick={onHome}
        // data-converge-target は EditorLayout の収束アニメで「ホーム位置」のターゲット解決に使う
        data-converge-target="home"
        title="ホーム"
        aria-label="ホーム"
        // mr-6: ホームアイコンとルートアイコンの間を明確に大きく空ける (chevron は出さない)
        className="shrink-0 p-1 mr-6 rounded-lg hover:bg-neutral-100 dark:hover:bg-neutral-800 text-neutral-500 dark:text-neutral-400 transition-colors"
      >
        <svg className="w-[21px] h-[21px]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6"/>
        </svg>
      </button>

      {breadcrumb.map((item, idx) => {
        const isCurrent = idx === breadcrumb.length - 1
        // テキストは廃しアイコンのみ運用なので、ホバー/スクリーンリーダー用に元ラベルを退避
        const label = item.label.split('\n')[0] || '（未入力）'
        return (
          <div key={item.gridId} className="flex items-center gap-1 shrink-0">
            {/* ホーム → ルート間 (idx 0) は chevron を出さず、ホームボタンの mr-6 で間隔を空ける */}
            {idx > 0 && (
              <svg className="w-3.5 h-3.5 text-neutral-500 dark:text-neutral-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M9 5l7 7-7 7" />
              </svg>
            )}
            <button
              onClick={() => handleItemClick(item, idx)}
              title={label}
              aria-label={label}
              aria-current={isCurrent ? 'page' : undefined}
              className={`p-1 rounded-lg transition-colors ${
                isCurrent ? '' : 'hover:bg-neutral-100 dark:hover:bg-neutral-800'
              }`}
            >
              <LocationMapIcon item={item} />
            </button>
          </div>
        )
      })}
    </nav>
  )
}
