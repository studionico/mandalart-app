function timestamp(): string {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
}

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

export async function exportAsPNG(element: HTMLElement, baseName = 'mandalart'): Promise<string> {
  const { toPng } = await import('html-to-image')
  const dataURL = await toPng(element, { pixelRatio: 2, cacheBust: true })
  const res = await fetch(dataURL)
  const blob = await res.blob()
  const filename = `${baseName}-${timestamp()}.png`
  downloadBlob(blob, filename)
  return filename
}

export async function exportAsPDF(element: HTMLElement, baseName = 'mandalart'): Promise<string> {
  const { toPng } = await import('html-to-image')
  const { default: jsPDF } = await import('jspdf')

  const dataURL = await toPng(element, { pixelRatio: 2, cacheBust: true })
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
  const filename = `${baseName}-${timestamp()}.pdf`
  downloadBlob(new Blob([buffer], { type: 'application/pdf' }), filename)
  return filename
}

export async function downloadJSON(data: unknown, baseName = 'mandalart'): Promise<string> {
  const content = JSON.stringify(data, null, 2)
  const filename = `${baseName}-${timestamp()}.json`
  downloadBlob(new Blob([content], { type: 'application/json' }), filename)
  return filename
}

export async function downloadText(content: string, extension: string, baseName = 'mandalart'): Promise<string> {
  const filename = `${baseName}-${timestamp()}.${extension}`
  downloadBlob(new Blob([content], { type: 'text/plain' }), filename)
  return filename
}
