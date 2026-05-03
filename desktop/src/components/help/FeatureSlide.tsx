/**
 * Welcome モーダル内で 1 機能 1 スライドを表示する共通 component。
 *
 * title (大きめ) / description (中央寄せ) / メディア (動画 or 静止画 or placeholder) を縦に配置。
 * 使用は [`HelpDialog`](./HelpDialog.tsx) の Carousel から `kind === 'feature'` のスライドで呼ばれる。
 *
 * メディアの優先順 (上から先勝ち):
 * 1. `video` 指定 → `<video autoPlay loop muted playsInline>` で再生 (実機操作の動画 = 一番伝わる)
 * 2. `screenshot` 指定 → `<img>` で静止画 (動画準備中の fallback、もしくは静的説明用)
 * 3. どちらも未指定 → 「準備中」プレースホルダー
 *
 * 動画は `screenshot` を `poster` 属性に渡すので、ロード待ち中も静止画が見える (= ガクッとしない)。
 */

type Props = {
  title: string
  description: string
  /** public/ 配下の動画 URL (例: '/help/home-create.mp4')。指定時は autoPlay muted の <video> で再生 */
  video?: string
  /** public/ 配下の静止画 URL (例: '/help/home-create.png')。video の poster としても使われる */
  screenshot?: string
  screenshotAlt?: string
  /**
   * 動画再生が終わったときに呼ぶ callback。指定時 = 自動進行モード:
   * `loop` を外して 1 回だけ再生 → onEnded で次スライドへ進む。
   * 未指定時 (= 手動再表示モード): `loop` で永続再生し、ユーザーが ← → で進める。
   */
  onVideoEnded?: () => void
}

export default function FeatureSlide({ title, description, video, screenshot, screenshotAlt, onVideoEnded }: Props) {
  // メディア共通の幅 / 角丸 / 枠スタイル。aspect-video (16:9) を強制して撮影サイズ (1600×900) と一致。
  const mediaClass = 'w-full max-w-2xl aspect-video rounded-lg border border-neutral-200 dark:border-neutral-700 shadow-sm object-cover'
  return (
    <div className="flex flex-col items-center justify-start gap-6 px-6 py-4 h-full">
      <h2 className="text-2xl font-semibold text-neutral-900 dark:text-neutral-100 text-center">
        {title}
      </h2>
      <p className="text-sm leading-relaxed text-neutral-700 dark:text-neutral-300 text-center max-w-xl">
        {description}
      </p>
      {video ? (
        <video
          src={video}
          poster={screenshot}
          autoPlay
          // onVideoEnded があるとき (= 自動進行モード) は loop しない → onEnded で次スライドへ。
          // onVideoEnded が無いとき (= 手動再表示モード) は loop して永続再生する。
          loop={!onVideoEnded}
          muted
          playsInline
          onEnded={onVideoEnded}
          aria-label={screenshotAlt ?? title}
          className={mediaClass}
        />
      ) : screenshot ? (
        <img
          src={screenshot}
          alt={screenshotAlt ?? title}
          className={mediaClass}
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
