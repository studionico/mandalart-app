/**
 * Welcome モーダル内で 1 機能 1 スライドを表示する共通 component。
 *
 * title (大きめ) / description (中央寄せ) / スクリーンショット枠 (or placeholder) を縦に配置。
 * 使用は [`HelpDialog`](./HelpDialog.tsx) の Carousel から `kind === 'feature'` のスライドで呼ばれる。
 */

type Props = {
  title: string
  description: string
  /** public/ 配下の URL (例: '/help/home-create.png')。未指定なら placeholder 枠 */
  screenshot?: string
  screenshotAlt?: string
}

export default function FeatureSlide({ title, description, screenshot, screenshotAlt }: Props) {
  return (
    <div className="flex flex-col items-center justify-start gap-6 px-6 py-4 h-full">
      <h2 className="text-2xl font-semibold text-neutral-900 dark:text-neutral-100 text-center">
        {title}
      </h2>
      <p className="text-sm leading-relaxed text-neutral-700 dark:text-neutral-300 text-center max-w-xl">
        {description}
      </p>
      {screenshot ? (
        <img
          src={screenshot}
          alt={screenshotAlt ?? title}
          className="w-full max-w-2xl rounded-lg border border-neutral-200 dark:border-neutral-700 shadow-sm"
        />
      ) : (
        <div
          className="w-full max-w-2xl aspect-video rounded-lg border border-dashed border-neutral-300 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-900 flex items-center justify-center text-xs text-neutral-400 dark:text-neutral-500"
          aria-label="スクリーンショット (準備中)"
        >
          スクリーンショット (準備中)
        </div>
      )}
    </div>
  )
}
