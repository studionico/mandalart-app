import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import EditorLayout from '@/components/editor/EditorLayout'

type Props = { params: Promise<{ id: string }> }

export default async function MandalartPage({ params }: Props) {
  const { id } = await params
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  // 存在確認
  const { data: mandalart } = await supabase
    .from('mandalarts')
    .select('id')
    .eq('id', id)
    .eq('user_id', user.id)
    .single()

  if (!mandalart) redirect('/dashboard')

  return <EditorLayout mandalartId={id} userId={user.id} />
}
