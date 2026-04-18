import { writeFile, BaseDirectory } from '@tauri-apps/plugin-fs'

/**
 * Tauri WebKit では `<a download>` の click() による自動ダウンロードが動かない
 * (ブラウザと違って download フックを intercept しない)。
 * その代わり tauri-plugin-fs で `$DOWNLOAD` (OS のダウンロードフォルダ) に直接書く。
 * 呼び出し側は戻り値のファイル名を toast で表示し、ユーザーが保存先を把握できるようにする。
 */

function timestamp(): string {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
}

/** image/png の dataURL から Uint8Array に変換する (`canvas.toDataURL('image/png')` の結果用) */
function dataURLToBytes(dataURL: string): Uint8Array {
  const base64 = dataURL.split(',', 2)[1] ?? ''
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

/**
 * PNG エクスポート: html2canvas で canvas 化し、バイト列を Downloads/<name>.png に書く。
 * 戻り値は書き出したファイル名 (呼び出し側の toast 用)。
 */
export async function exportAsPNG(element: HTMLElement, baseName = 'mandalart'): Promise<string> {
  const { default: html2canvas } = await import('html2canvas')
  const canvas = await html2canvas(element, { scale: 2, useCORS: true })
  const bytes = dataURLToBytes(canvas.toDataURL('image/png'))
  const filename = `${baseName}-${timestamp()}.png`
  await writeFile(filename, bytes, { baseDir: BaseDirectory.Download })
  return filename
}

/**
 * PDF エクスポート: jsPDF の output('arraybuffer') でバイト列化して書き込む。
 */
export async function exportAsPDF(element: HTMLElement, baseName = 'mandalart'): Promise<string> {
  const { default: html2canvas } = await import('html2canvas')
  const { default: jsPDF } = await import('jspdf')

  const canvas = await html2canvas(element, { scale: 2, useCORS: true })
  const imgData = canvas.toDataURL('image/png')
  const pdf = new jsPDF({ orientation: 'landscape', unit: 'px', format: [canvas.width / 2, canvas.height / 2] })
  pdf.addImage(imgData, 'PNG', 0, 0, canvas.width / 2, canvas.height / 2)

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
