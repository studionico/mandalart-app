import { createClient } from '@/lib/supabase/client'

export async function uploadCellImage(params: {
  file: File
  userId: string
  mandalartId: string
  cellId: string
}): Promise<string> {
  const supabase = createClient()
  const ext = params.file.name.split('.').pop()
  const path = `${params.userId}/${params.mandalartId}/${params.cellId}/${Date.now()}.${ext}`

  const { error } = await supabase.storage.from('cell-images').upload(path, params.file)
  if (error) throw error
  return path
}

export async function getCellImageUrl(path: string): Promise<string> {
  const supabase = createClient()
  const { data, error } = await supabase.storage
    .from('cell-images')
    .createSignedUrl(path, 3600)
  if (error) throw error
  return data.signedUrl
}

export async function deleteCellImage(path: string): Promise<void> {
  const supabase = createClient()
  const { error } = await supabase.storage.from('cell-images').remove([path])
  if (error) throw error
}
