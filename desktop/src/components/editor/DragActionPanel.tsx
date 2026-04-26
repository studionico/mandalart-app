/**
 * D&D 進行中に右パネル領域に表示する 4 アクションアイコン (縦並び)。
 *
 * 各アイコンは drop target で、`data-action-drop` 属性をキーに `useDragAndDrop` の
 * resolveTargetSlot 相当が検出する。
 *
 * - shred: ターゲットセル + サブグリッド全体を完全削除 (確認 dialog 経由)
 * - move: snapshot をストック追加してから shred (= cut to stock)
 * - copy: snapshot をストック追加 (元はそのまま)
 * - export: snapshot を JSON / Markdown / IndentText で保存
 */
export type ActionDropType = 'shred' | 'move' | 'copy' | 'export'

type Props = {
  /** ホバー中のアクション (`data-action-drop` の値)。`useDragAndDrop` から渡す */
  hoveredAction?: ActionDropType | null
}

const ICON_SIZE = 40
const TILE_SIZE = 96

export default function DragActionPanel({ hoveredAction }: Props) {
  return (
    <div className="flex flex-col items-center justify-center gap-4 h-full select-none">
      <ActionTile action="shred" label="シュレッダー" hovered={hoveredAction === 'shred'}>
        <ShredderIcon />
      </ActionTile>
      <ActionTile action="move" label="移動" hovered={hoveredAction === 'move'}>
        <MoveIcon />
      </ActionTile>
      <ActionTile action="copy" label="コピー" hovered={hoveredAction === 'copy'}>
        <CopyIcon />
      </ActionTile>
      <ActionTile action="export" label="エクスポート" hovered={hoveredAction === 'export'}>
        <ExportIcon />
      </ActionTile>
    </div>
  )
}

function ActionTile({
  action, label, hovered, children,
}: {
  action: ActionDropType
  label: string
  hovered?: boolean
  children: React.ReactNode
}) {
  const baseClass = action === 'shred'
    ? 'border-red-300 dark:border-red-700 text-red-600 dark:text-red-400'
    : 'border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300'
  const hoverClass = hovered
    ? action === 'shred'
      ? 'border-red-500 bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300 scale-[1.04]'
      : 'border-blue-500 bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 scale-[1.04]'
    : ''
  return (
    <div
      data-action-drop={action}
      className={`
        flex flex-col items-center justify-center gap-1
        bg-white dark:bg-gray-900 border-2 rounded-2xl shadow-sm
        transition-all
        ${baseClass} ${hoverClass}
      `}
      style={{ width: TILE_SIZE, height: TILE_SIZE }}
    >
      <div style={{ width: ICON_SIZE, height: ICON_SIZE }}>{children}</div>
      <span className="text-[10px] font-medium">{label}</span>
    </div>
  )
}

function ShredderIcon() {
  return (
    <svg viewBox="0 0 24 24" width="100%" height="100%" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="4" y="4" width="16" height="6" rx="1" />
      <line x1="2" y1="11" x2="22" y2="11" />
      <line x1="6" y1="14" x2="6" y2="20" />
      <line x1="10" y1="14" x2="10" y2="18" />
      <line x1="14" y1="14" x2="14" y2="20" />
      <line x1="18" y1="14" x2="18" y2="17" />
    </svg>
  )
}

function MoveIcon() {
  // ハサミ
  return (
    <svg viewBox="0 0 24 24" width="100%" height="100%" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="6" cy="6" r="3" />
      <circle cx="6" cy="18" r="3" />
      <line x1="20" y1="4" x2="8.12" y2="15.88" />
      <line x1="14.47" y1="14.48" x2="20" y2="20" />
      <line x1="8.12" y1="8.12" x2="12" y2="12" />
    </svg>
  )
}

function CopyIcon() {
  // 二重四角
  return (
    <svg viewBox="0 0 24 24" width="100%" height="100%" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="9" y="9" width="13" height="13" rx="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  )
}

function ExportIcon() {
  // 下向き矢印 + ベース (ダウンロード)
  return (
    <svg viewBox="0 0 24 24" width="100%" height="100%" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="7 10 12 15 17 10" />
      <line x1="12" y1="15" x2="12" y2="3" />
    </svg>
  )
}
