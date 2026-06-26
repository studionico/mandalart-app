import { supabase } from '@/lib/supabase/client'
import { useAuthStore } from '@/store/authStore'
import {
  compressImageToJpeg, uploadImageToCloud, downloadImageFromCloud, storageKeyFor,
} from '@/lib/api/imageSync'

const BUCKET = 'cell-images'

// blob URL キャッシュ (image_path → blob URL)
const urlCache = new Map<string, string>()

export function getCachedCellImageUrl(path: string | null | undefined): string | null {
  if (!path) return null
  return urlCache.get(path) ?? null
}

/**
 * image_path に対応する表示 URL を返す。
 * ブラウザ版では Supabase Storage から直接 download して blob URL に変換する。
 */
export async function getCellImageUrl(path: string): Promise<string> {
  if (!path) return ''
  const cached = urlCache.get(path)
  if (cached) return cached

  const userId = useAuthStore.getState().user?.id
  if (!userId) return ''

  const bytes = await downloadImageFromCloud(userId, path)
  if (bytes) {
    const url = URL.createObjectURL(new Blob([bytes], { type: 'image/jpeg' }))
    urlCache.set(path, url)
    return url
  }
  return ''
}

/**
 * File を圧縮して Supabase Storage にアップロードする。
 * ブラウザ版ではローカルファイルは使わない。image_path として Storage のキーを返す。
 */
export async function uploadCellImage(
  userId: string,
  _mandalartId: string,
  cellId: string,
  file: File,
): Promise<string> {
  const bytes = await compressImageToJpeg(file)
  const relPath = `images/${cellId}-${Date.now()}.jpg`
  await uploadImageToCloud(userId, relPath, bytes)
  // 即時キャッシュして remount 時の再 download を避ける
  const url = URL.createObjectURL(new Blob([bytes], { type: 'image/jpeg' }))
  urlCache.set(relPath, url)
  return relPath
}

export async function deleteCellImage(path: string): Promise<void> {
  if (!path) return
  const cached = urlCache.get(path)
  if (cached) {
    URL.revokeObjectURL(cached)
    urlCache.delete(path)
  }
  // Storage からも削除 (best-effort)
  const userId = useAuthStore.getState().user?.id
  if (!userId) return
  const key = storageKeyFor(userId, path)
  await supabase.storage.from(BUCKET).remove([key])
}
