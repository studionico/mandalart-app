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
    description: 'ホーム画面のカードグリッド先頭の「+」をクリックすると、新しいマンダラートが作れます。',
    durationMs: STANDARD_DURATION_MS,
  },
  // 3. セルを編集
  {
    kind: 'feature',
    title: 'セルを編集',
    description: 'セルをクリックで文字を入力。ダブルクリックで拡大エディタが開き、色や画像も付けられます。',
    durationMs: STANDARD_DURATION_MS,
  },
  // 4. 階層の移動
  {
    kind: 'feature',
    title: '階層の移動',
    description: '入力済みの周辺セルをクリックすると、そのセルを中心に新しい 3×3 が開きます (ドリルダウン)。中心セルをクリックすると親階層へ戻れます。',
    durationMs: STANDARD_DURATION_MS,
  },
  // 5. 9×9 表示
  {
    kind: 'feature',
    title: '9×9 表示',
    description: '右上のトグルで切替。現在のグリッドと直下のサブグリッドを 2 階層まとめて俯瞰できます (読み取り専用)。',
    durationMs: STANDARD_DURATION_MS,
  },
  // 6. ホームへ戻る
  {
    kind: 'feature',
    title: 'ホームへ戻る',
    description: 'ルートグリッドの中心セルをクリックすると、ダッシュボード (ホーム画面) へ戻ります。',
    durationMs: STANDARD_DURATION_MS,
  },
  // 7. マンダラートを開く
  {
    kind: 'feature',
    title: 'マンダラートを開く',
    description: 'ホームに並んでいるカードをクリックすると、その続きをいつでも編集できます。',
    durationMs: STANDARD_DURATION_MS,
  },
]
