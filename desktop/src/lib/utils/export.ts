import { writeFile, BaseDirectory } from '@tauri-apps/plugin-fs'

/**
 * Tauri WebKit では `<a download>` の click() による自動ダウンロードが動かないので、
 * tauri-plugin-fs で `$DOWNLOAD` (OS のダウンロードフォルダ) に直接書く。
 * 呼び出し側は戻り値のファイル名を toast で表示してユーザーに保存先を知らせる。
 *
 * 画像変換は html2canvas ではなく `html-to-image` を使う。
 * 理由: Tailwind CSS v4 の既定カラーは `oklch()` で、html2canvas はこれをパースできず
 * "Attempting to parse an unsupported color function" で失敗する。
 * html-to-image は SVG foreignObject 経由で DOM をそのままレンダリングするので
 * モダン CSS (oklch / color-mix / 等) を正しく扱える。
 */

function timestamp(): string {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
}

/** image/png の dataURL から Uint8Array に変換する */
function dataURLToBytes(dataURL: string): Uint8Array {
  const base64 = dataURL.split(',', 2)[1] ?? ''
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

/**
 * DOM 要素を PNG として Downloads に保存する。
 */
export async function exportAsPNG(element: HTMLElement, baseName = 'mandalart'): Promise<string> {
  const { toPng } = await import('html-to-image')
  const dataURL = await toPng(element, {
    pixelRatio: 2,
    cacheBust: true,
  })
  const bytes = dataURLToBytes(dataURL)
  const filename = `${baseName}-${timestamp()}.png`
  await writeFile(filename, bytes, { baseDir: BaseDirectory.Download })
  return filename
}

/**
 * DOM 要素を PDF として Downloads に保存する (png 経由 → jsPDF 埋め込み)。
 */
export async function exportAsPDF(element: HTMLElement, baseName = 'mandalart'): Promise<string> {
  const { toPng } = await import('html-to-image')
  const { default: jsPDF } = await import('jspdf')

  const dataURL = await toPng(element, { pixelRatio: 2, cacheBust: true })

  // 画像の実寸を得るため一度 Image に読み込む
  const { width, height } = await new Promise<{ width: number; height: number }>((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight })
    img.onerror = () => reject(new Error('PDF 生成時の画像読み込みに失敗'))
    img.src = dataURL
  })

  const pdf = new jsPDF({
    orientation: width > height ? 'landscape' : 'portrait',
    unit: 'px',
    format: [width / 2, height / 2],
  })
  pdf.addImage(dataURL, 'PNG', 0, 0, width / 2, height / 2)

  const buffer = pdf.output('arraybuffer')
  const bytes = new Uint8Array(buffer)
  const filename = `${baseName}-${timestamp()}.pdf`
  await writeFile(filename, bytes, { baseDir: BaseDirectory.Download })
  return filename
}

/** JSON を pretty-print して Downloads に書く。 */
export async function downloadJSON(data: unknown, baseName = 'mandalart'): Promise<string> {
  const content = JSON.stringify(data, null, 2)
  const filename = `${baseName}-${timestamp()}.json`
  const bytes = new TextEncoder().encode(content)
  await writeFile(filename, bytes, { baseDir: BaseDirectory.Download })
  return filename
}

/**
 * プレーンテキスト (Markdown / インデントテキスト) を Downloads に書く。
 * 拡張子は呼び出し側が extension で指定する (例: 'md', 'txt')。
 */
export async function downloadText(content: string, extension: string, baseName = 'mandalart'): Promise<string> {
  const filename = `${baseName}-${timestamp()}.${extension}`
  const bytes = new TextEncoder().encode(content)
  await writeFile(filename, bytes, { baseDir: BaseDirectory.Download })
  return filename
}
