import {
  readFile, writeFile, exists, mkdir, BaseDirectory,
} from '@tauri-apps/plugin-fs'
import { supabase, isSupabaseConfigured } from '@/lib/supabase/client'
import { query } from '@/lib/db'

// セル画像のクラウド同期。
//
// 設計: `cells.image_path` は従来どおり AppData 相対パス (`images/<cellId>-<ts>.jpg`) を
// 保持し、スキーマは変更しない。クラウド側 Storage オブジェクトのキーは実行時に
// `<userId>/<basename(image_path)>` で導出する (RLS policy が先頭フォルダ = auth.uid を
// 要求するため)。同一アカウントの全デバイスでキーが一致するので、別デバイスでは
// ローカルに実ファイルが無くても download で復元できる。
//
// バケットは非公開 (`cell-images`)。private なので署名 URL ではなく SDK の download()
// (auth トークン + RLS) でバイトを取得する。Storage は Realtime Messages quota とは
// 無関係なので、緊急停止中 (CLAUDE.md) の同期問題を悪化させない。

const BUCKET = 'cell-images'
const IMAGES_SUBDIR = 'images'

/**
 * image_path (AppData 相対) → Storage オブジェクトキー (`<userId>/<filename>`)。
 * userId は小文字化する: Postgres の `auth.uid()::text` (RLS 比較対象) は小文字 UUID で、
 * iOS の `UUID.uuidString` は大文字を返すため、両プラットフォームでキーを一致させる必要がある
 * (pitfall #23)。
 */
export function storageKeyFor(userId: string, relPath: string): string {
  const base = relPath.split('/').pop() ?? relPath
  return `${userId.toLowerCase()}/${base}`
}

async function ensureImagesDir(): Promise<void> {
  if (!(await exists(IMAGES_SUBDIR, { baseDir: BaseDirectory.AppData }))) {
    await mkdir(IMAGES_SUBDIR, { baseDir: BaseDirectory.AppData, recursive: true })
  }
}

const MAX_DIMENSION = 1600
const JPEG_QUALITY = 0.8

/**
 * File を長辺 max 1600px に縮小 + JPEG quality 0.8 で再エンコードして bytes を返す。
 * WebView の canvas を使う純ブラウザ実装。出力は常に JPEG (iOS の ImageStorage と統一)。
 * 変換に失敗した場合は原データをそのまま返す。
 */
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
    if (!ctx) {
      bitmap.close()
      return new Uint8Array(await file.arrayBuffer())
    }
    // JPEG はアルファを持たないので、透過 PNG が黒背景にならないよう白で塗る。
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

/** 画像 bytes を Storage にアップロード (best-effort、失敗は warn のみ)。 */
export async function uploadImageToCloud(
  userId: string,
  relPath: string,
  bytes: Uint8Array,
): Promise<void> {
  if (!isSupabaseConfigured || !userId) return
  const key = storageKeyFor(userId, relPath)
  const { error } = await supabase.storage.from(BUCKET).upload(key, bytes, {
    contentType: 'image/jpeg',
    upsert: true,
  })
  if (error) console.warn('uploadImageToCloud failed:', key, error)
}

/** Storage から画像 bytes を取得。存在しない/失敗時は null。 */
export async function downloadImageFromCloud(
  userId: string,
  relPath: string,
): Promise<Uint8Array | null> {
  if (!isSupabaseConfigured || !userId) return null
  const key = storageKeyFor(userId, relPath)
  const { data, error } = await supabase.storage.from(BUCKET).download(key)
  if (error || !data) {
    if (error) console.warn('downloadImageFromCloud failed:', key, error)
    return null
  }
  return new Uint8Array(await data.arrayBuffer())
}

/**
 * ローカルにあるが Storage に未アップロードのセル画像を回収する。
 * オフライン中に追加した画像を、オンライン復帰後の同期で拾い上げるための保険。
 * `<userId>/` フォルダの既存キー一覧を 1 回取得し、差分だけ upload する。
 */
export async function backfillUploadLocalImages(userId: string): Promise<void> {
  if (!isSupabaseConfigured || !userId) return
  try {
    const { data: list, error } = await supabase.storage
      .from(BUCKET)
      .list(userId, { limit: 1000 })
    if (error) {
      console.warn('backfillUploadLocalImages list failed:', error)
      return
    }
    const existing = new Set<string>((list ?? []).map((o) => o.name))

    const rows = await query<{ image_path: string }>(
      "SELECT DISTINCT image_path FROM cells WHERE image_path IS NOT NULL AND image_path <> '' AND deleted_at IS NULL",
    )
    for (const { image_path } of rows) {
      const base = image_path.split('/').pop()
      if (!base || existing.has(base)) continue
      if (!(await exists(image_path, { baseDir: BaseDirectory.AppData }))) continue
      const bytes = await readFile(image_path, { baseDir: BaseDirectory.AppData })
      await uploadImageToCloud(userId, image_path, new Uint8Array(bytes))
    }
  } catch (e) {
    console.warn('backfillUploadLocalImages failed:', e)
  }
}

/**
 * Storage から取得した bytes を AppData にローカルキャッシュとして書き込む。
 * download fallback で取得した画像を次回以降ローカルから読めるようにする。
 */
export async function cacheImageLocally(relPath: string, bytes: Uint8Array): Promise<void> {
  try {
    await ensureImagesDir()
    await writeFile(relPath, bytes, { baseDir: BaseDirectory.AppData })
  } catch (e) {
    console.warn('cacheImageLocally failed:', relPath, e)
  }
}
