/**
 * Welcome モーダル (新規ユーザー導入用) のスライドデータ。
 *
 * 7 スライドを時系列順に並べ、新規ユーザーがアプリを初めて触るときに辿る順序で
 * 「コンセプト → 作成 → 編集 → 階層移動 → 9×9 → ホーム戻り → 再訪」を物語る。
 *
 * - スライド 1 (concept): 専用 [`ConceptSlide`](./ConceptSlide.tsx) component で render。
 *   マンダラート手法の階層展開を CSS keyframe アニメで表現する (~12 秒)
 * - スライド 2-7 (feature): 共通 [`FeatureSlide`](./FeatureSlide.tsx) component で render。
 *   title + description + screenshot 枠 (5 秒)
 *
 * `screenshot` は雛形では undefined (placeholder 枠が表示される)。撮影後は
 * `desktop/public/help/<slug>.png` に置いて URL `/help/<slug>.png` をここに埋める。
 *
 * 内容を更新したら [`constants/welcome.ts`](../../constants/welcome.ts) の
 * `WELCOME_VERSION` を bump して全 user に再表示させる。
 */

export type FeatureSlide = {
  kind: 'feature'
  title: string
  description: string
  /**
   * 動画ファイル URL (例: '/help/home-create.mp4')。指定時は FeatureSlide が
   * `<video autoPlay loop muted playsInline>` で自動再生する。
   * 動画準備中の slide は未指定 → screenshot fallback で静止画を表示する 3 段階運用。
   */
  video?: string
  screenshot?: string
  screenshotAlt?: string
  durationMs: number
}

export type ConceptSlide = {
  kind: 'concept'
  durationMs: number
}

export type WelcomeSlide = ConceptSlide | FeatureSlide

const STANDARD_DURATION_MS = 5000
const CONCEPT_DURATION_MS = 12000

export const WELCOME_SLIDES: WelcomeSlide[] = [
  // 1. コンセプト (専用アニメ)
  { kind: 'concept', durationMs: CONCEPT_DURATION_MS },
  // 2. マンダラートを新規作成
  {
    kind: 'feature',
    title: 'マンダラートを新規作成',
    description: 'ホーム画面の「+」カードをクリックすると、新しいマンダラートが作れます。',
    video: '/help/home-create.mp4',
    screenshot: '/help/home-create.png',
    screenshotAlt: 'ホーム画面の「+」カードから新規マンダラートを作る動画',
    durationMs: STANDARD_DURATION_MS,
  },
  // 3. セルを編集
  {
    kind: 'feature',
    title: 'セルを編集',
    description: '空のセルはクリック、文字が入っているセルはダブルクリックで編集できます。編集中にテキスト欄をダブルクリックすると拡大表示になり、色や画像も追加できます。',
    video: '/help/cell-edit.mp4',
    screenshot: '/help/cell-edit.png',
    screenshotAlt: '拡大エディタで色や画像を追加する動画',
    durationMs: STANDARD_DURATION_MS,
  },
  // 4. 階層の移動
  {
    kind: 'feature',
    title: '階層の移動',
    description: '入力済みの周辺セルをクリックすると、そのセルを中心とした新しい 9 マスが開きます (掘り下げ)。中心セルをクリックすると親階層へ戻れます。',
    video: '/help/drill-down.mp4',
    screenshot: '/help/drill-down.png',
    screenshotAlt: 'セルを掘り下げて新しい 9 マスを開く動画',
    durationMs: STANDARD_DURATION_MS,
  },
  // 5. 9×9 表示
  {
    kind: 'feature',
    title: '9×9 表示',
    description: '画面上部の `[9x9]` ボタンを押すと、現在の階層と下の階層を一度に見渡せます (表示のみ、編集はできません)。元に戻すときは `[3x3]` ボタンを押します。',
    video: '/help/view-9x9.mp4',
    screenshot: '/help/view-9x9.png',
    screenshotAlt: '9×9 表示で 81 セルを一度に見渡す動画',
    durationMs: STANDARD_DURATION_MS,
  },
  // 6. ホームへ戻る
  {
    kind: 'feature',
    title: 'ホームへ戻る',
    description: '最初の階層 (一番上) の中心セルをクリックすると、ホーム画面に戻ります。',
    video: '/help/home-return.mp4',
    screenshot: '/help/home-return.png',
    screenshotAlt: 'ルートグリッドの中心セルからホーム画面に戻る動画',
    durationMs: STANDARD_DURATION_MS,
  },
  // 7. マンダラートを開く
  {
    kind: 'feature',
    title: 'マンダラートを開く',
    description: 'ホームに並ぶカードをクリックすると、前回開いていた階層から続きを編集できます。',
    video: '/help/open-from.mp4',
    screenshot: '/help/open-from.png',
    screenshotAlt: 'ホームのカードからマンダラートを再オープンする動画',
    durationMs: STANDARD_DURATION_MS,
  },
]
