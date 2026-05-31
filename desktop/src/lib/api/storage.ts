import {
  writeFile, readFile, remove, mkdir, exists, BaseDirectory,
} from '@tauri-apps/plugin-fs'
import { useAuthStore } from '@/store/authStore'
import {
  compressImageToJpeg, uploadImageToCloud, downloadImageFromCloud, cacheImageLocally,
} from '@/lib/api/imageSync'

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

async function copyBytesToAppData(bytes: Uint8Array, cellId: string, ext: string): Promise<string> {
  await ensureImagesDir()
  const name = `${cellId}-${Date.now()}.${ext}`
  const relPath = `${IMAGES_SUBDIR}/${name}`
  await writeFile(relPath, bytes, { baseDir: BaseDirectory.AppData })
  return relPath
}

/**
 * ブラウザの File オブジェクト（CellEditModal のファイル選択）を圧縮して AppData へコピーし、
 * 同じ bytes を Supabase Storage にもアップロードする（別デバイス表示用、best-effort）。
 * 出力は常に JPEG。`userId` 未指定 / Supabase 未設定ならローカル保存のみ。
 */
export async function uploadCellImage(
  userId: string,
  _mandalartId: string,
  cellId: string,
  file: File,
): Promise<string> {
  const bytes = await compressImageToJpeg(file)
  const relPath = await copyBytesToAppData(bytes, cellId, 'jpg')
  await uploadImageToCloud(userId, relPath, bytes)
  return relPath
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
 * ローカルに実ファイルが無い場合（別デバイスで追加された画像）は Supabase Storage から
 * download してローカルにキャッシュしてから blob URL を返す。
 */
export async function getCellImageUrl(path: string): Promise<string> {
  if (!path) return ''
  const cached = urlCache.get(path)
  if (cached) return cached

  try {
    const bytes = await readFile(path, { baseDir: BaseDirectory.AppData })
    const url = URL.createObjectURL(new Blob([new Uint8Array(bytes)]))
    urlCache.set(path, url)
    return url
  } catch {
    // ローカルに無い → クラウドから取得を試みる（別デバイス作成の画像）
    const userId = useAuthStore.getState().user?.id
    if (userId) {
      const bytes = await downloadImageFromCloud(userId, path)
      if (bytes) {
        await cacheImageLocally(path, bytes)
        const url = URL.createObjectURL(new Blob([new Uint8Array(bytes)]))
        urlCache.set(path, url)
        return url
      }
    }
    return ''
  }
}

/**
 * ローカルの画像ファイルを削除する（セルから画像を外したとき）。
 * v1 では Storage 側は削除しない: copyCellSubtree / stock snapshot で image_path が
 * 複数セルに共有されうるため、消すと共有先の表示が壊れる。Storage の orphan 整理は将来課題。
 */
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
