import {
  writeFile, readFile, remove, mkdir, exists, BaseDirectory,
} from '@tauri-apps/plugin-fs'

// AppData 配下の画像保存ディレクトリ（BaseDirectory.AppData からの相対）
const IMAGES_SUBDIR = 'images'

// 読み込み済み image_path → blob URL のキャッシュ
// （DB に複数セルが同じ image_path を持つ場合があるので軽量キャッシュ）
const urlCache = new Map<string, string>()

async function ensureImagesDir(): Promise<void> {
  if (!(await exists(IMAGES_SUBDIR, { baseDir: BaseDirectory.AppData }))) {
    await mkdir(IMAGES_SUBDIR, { baseDir: BaseDirectory.AppData, recursive: true })
  }
}

function pickExtension(name: string): string {
  const dot = name.lastIndexOf('.')
  if (dot === -1) return 'png'
  return name.slice(dot + 1).toLowerCase().replace(/[^a-z0-9]/g, '') || 'png'
}

async function copyBytesToAppData(bytes: Uint8Array, cellId: string, ext: string): Promise<string> {
  await ensureImagesDir()
  const name = `${cellId}-${Date.now()}.${ext}`
  const relPath = `${IMAGES_SUBDIR}/${name}`
  await writeFile(relPath, bytes, { baseDir: BaseDirectory.AppData })
  return relPath
}

/**
 * ブラウザの File オブジェクト（CellEditModal のファイル選択）を AppData へコピー。
 */
export async function uploadCellImage(
  _userId: string,
  _mandalartId: string,
  cellId: string,
  file: File,
): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer())
  const ext = pickExtension(file.name)
  return copyBytesToAppData(bytes, cellId, ext)
}

/**
 * image_path に対応する blob URL がメモリキャッシュに既にあれば返す (同期)。
 * Cell.tsx の `useState` 初期化で「remount 時 1 frame だけ画像が消える」現象を避けるために使う:
 * orbit アニメ後にセル DOM が unmount → remount するとき、`getCellImageUrl` は async なので
 * useEffect 経由だと初期 render 直後に必ず 1 frame `imageUrl=null` の状態が挟まる。
 * 既にキャッシュされた path については本関数で同期取得し、useState 初期値として渡せば
 * remount 1 frame目から画像が表示される (まばたき消滅)。未キャッシュは null を返し、
 * 通常通り useEffect の async load に委譲する。
 */
export function getCachedCellImageUrl(path: string | null | undefined): string | null {
  if (!path) return null
  return urlCache.get(path) ?? null
}

/**
 * image_path（AppData からの相対パス）を blob URL に変換して <img src> で表示できるようにする。
 */
export async function getCellImageUrl(path: string): Promise<string> {
  if (!path) return ''
  const cached = urlCache.get(path)
  if (cached) return cached

  try {
    const bytes = await readFile(path, { baseDir: BaseDirectory.AppData })
    const blob = new Blob([new Uint8Array(bytes)])
    const url = URL.createObjectURL(blob)
    urlCache.set(path, url)
    return url
  } catch (e) {
    console.warn('getCellImageUrl failed:', path, e)
    return ''
  }
}

export async function deleteCellImage(path: string): Promise<void> {
  if (!path) return
  const cached = urlCache.get(path)
  if (cached) {
    URL.revokeObjectURL(cached)
    urlCache.delete(path)
  }
  try {
    await remove(path, { baseDir: BaseDirectory.AppData })
  } catch (e) {
    console.warn('deleteCellImage failed:', path, e)
  }
}
