
import { useEditorStore, BreadcrumbItem } from '@/store/editorStore'

type Props = {
  onHome: () => void
}

export default function Breadcrumb({ onHome }: Props) {
  const { breadcrumb, popBreadcrumbTo } = useEditorStore()

  function handleItemClick(item: BreadcrumbItem, idx: number) {
    if (idx === breadcrumb.length - 1) return // 現在地はクリック不要
    popBreadcrumbTo(item.gridId)
  }

  return (
    <nav className="flex items-center gap-1 overflow-x-auto py-1 px-1 text-sm">
      <button
        onClick={onHome}
        className="flex items-center gap-1 shrink-0 px-2 py-1 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-500 dark:text-gray-400 transition-colors"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6"/>
        </svg>
        ホーム
      </button>

      {breadcrumb.map((item, idx) => (
        <div key={item.gridId} className="flex items-center gap-1 shrink-0">
          <span className="text-gray-300 dark:text-gray-600">/</span>
          <button
            onClick={() => handleItemClick(item, idx)}
            className={`px-2 py-1 rounded-lg transition-colors ${
              idx === breadcrumb.length - 1
                ? 'text-gray-900 dark:text-gray-100 font-medium bg-gray-100 dark:bg-gray-800'
                : 'text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800'
            }`}
          >
            <span className="max-w-[160px] truncate inline-block align-middle">{item.label.split('\n')[0] || '（未入力）'}</span>
          </button>
        </div>
      ))}
    </nav>
  )
}
