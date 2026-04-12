
type Props = {
  currentIndex: number
  total: number
  onPrev: () => void
  onNext: () => void
}

export default function ParallelNav({ currentIndex, total, onPrev, onNext }: Props) {
  if (total <= 1) return null

  return (
    <div className="flex items-center gap-3">
      <button
        onClick={onPrev}
        disabled={currentIndex === 0}
        className="w-9 h-9 flex items-center justify-center rounded-full border border-gray-300 hover:bg-gray-100 disabled:opacity-30 transition-colors"
        aria-label="前のグリッド"
      >
        ←
      </button>
      <span className="text-xs text-gray-400">{currentIndex + 1} / {total}</span>
      <button
        onClick={onNext}
        disabled={currentIndex === total - 1}
        className="w-9 h-9 flex items-center justify-center rounded-full border border-gray-300 hover:bg-gray-100 disabled:opacity-30 transition-colors"
        aria-label="次のグリッド"
      >
        →
      </button>
    </div>
  )
}
