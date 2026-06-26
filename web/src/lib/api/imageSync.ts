import { supabase, isSupabaseConfigured } from '@/lib/supabase/client'

const BUCKET = 'cell-images'

export function storageKeyFor(userId: string, relPath: string): string {
  const base = relPath.split('/').pop() ?? relPath
  return `${userId.toLowerCase()}/${base}`
}

const MAX_DIMENSION = 1600
const JPEG_QUALITY = 0.8

export async function compressImageToJpeg(file: File): Promise<Uint8Array> {
  try {
    const bitmap = await createImageBitmap(file)
    const longSide = Math.max(bitmap.width, bitmap.height)
    const scale = longSide > MAX_DIMENSION ? MAX_DIMENSION / longSide : 1
    const w = Math.max(1, Math.round(bitmap.width * scale))
    const h = Math.max(1, Math.round(bitmap.height * scale))
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')
    if (!ctx) { bitmap.close(); return new Uint8Array(await file.arrayBuffer()) }
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, w, h)
    ctx.drawImage(bitmap, 0, 0, w, h)
    bitmap.close()
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob((b) => resolve(b), 'image/jpeg', JPEG_QUALITY),
    )
    if (!blob) return new Uint8Array(await file.arrayBuffer())
    return new Uint8Array(await blob.arrayBuffer())
  } catch (e) {
    console.warn('compressImageToJpeg failed, using original:', e)
    return new Uint8Array(await file.arrayBuffer())
  }
}

export async function uploadImageToCloud(userId: string, relPath: string, bytes: Uint8Array): Promise<void> {
  if (!isSupabaseConfigured || !userId) return
  const key = storageKeyFor(userId, relPath)
  const { error } = await supabase.storage.from(BUCKET).upload(key, bytes, {
    contentType: 'image/jpeg',
    upsert: true,
  })
  if (error) console.warn('uploadImageToCloud failed:', key, error)
}

export async function downloadImageFromCloud(userId: string, relPath: string): Promise<Uint8Array | null> {
  if (!isSupabaseConfigured || !userId) return null
  const key = storageKeyFor(userId, relPath)
  const { data, error } = await supabase.storage.from(BUCKET).download(key)
  if (error || !data) {
    if (error) console.warn('downloadImageFromCloud failed:', key, error)
    return null
  }
  return new Uint8Array(await data.arrayBuffer())
}

export async function getCloudImageUrl(userId: string, relPath: string): Promise<string | null> {
  if (!isSupabaseConfigured || !userId) return null
  const key = storageKeyFor(userId, relPath)
  const { data } = supabase.storage.from(BUCKET).getPublicUrl(key)
  return data?.publicUrl ?? null
}

// ブラウザ版ではローカルキャッシュ不要 — スタブとして残す
export async function cacheImageLocally(_relPath: string, _bytes: Uint8Array): Promise<void> {
  // no-op in web version
}

export async function backfillUploadLocalImages(_userId: string): Promise<void> {
  // web 版ではローカルファイルが存在しないため何もしない
}
