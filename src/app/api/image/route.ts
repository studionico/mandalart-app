import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const path = searchParams.get('path')

  if (!path) {
    return new NextResponse('Missing path', { status: 400 })
  }

  const supabase = await createClient()
  const { data, error } = await supabase.storage
    .from('cell-images')
    .createSignedUrl(path, 3600)

  if (error || !data) {
    return new NextResponse('Not found', { status: 404 })
  }

  // Signed URL にリダイレクト
  return NextResponse.redirect(data.signedUrl)
}
