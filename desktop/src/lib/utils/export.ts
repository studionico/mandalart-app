export async function exportAsPNG(element: HTMLElement, filename = 'mandalart.png'): Promise<void> {
  const { default: html2canvas } = await import('html2canvas')
  const canvas = await html2canvas(element, { scale: 2, useCORS: true })
  const link = document.createElement('a')
  link.download = filename
  link.href = canvas.toDataURL('image/png')
  link.click()
}

export async function exportAsPDF(element: HTMLElement, filename = 'mandalart.pdf'): Promise<void> {
  const { default: html2canvas } = await import('html2canvas')
  const { default: jsPDF } = await import('jspdf')

  const canvas = await html2canvas(element, { scale: 2, useCORS: true })
  const imgData = canvas.toDataURL('image/png')
  const pdf = new jsPDF({ orientation: 'landscape', unit: 'px', format: [canvas.width / 2, canvas.height / 2] })
  pdf.addImage(imgData, 'PNG', 0, 0, canvas.width / 2, canvas.height / 2)
  pdf.save(filename)
}

export function downloadJSON(data: unknown, filename = 'mandalart.json'): void {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
  const link = document.createElement('a')
  link.download = filename
  link.href = URL.createObjectURL(blob)
  link.click()
  URL.revokeObjectURL(link.href)
}

/**
 * プレーンテキスト系 (Markdown / インデントテキスト) のダウンロード。
 * 拡張子は呼び出し側で filename に含める (例: `mandalart.md`, `mandalart.txt`)。
 */
export function downloadText(content: string, filename: string, mime = 'text/plain;charset=utf-8'): void {
  const blob = new Blob([content], { type: mime })
  const link = document.createElement('a')
  link.download = filename
  link.href = URL.createObjectURL(blob)
  link.click()
  URL.revokeObjectURL(link.href)
}
