import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import MandalartGrid from '@/components/dashboard/MandalartGrid'
import SignOutButton from '@/components/auth/SignOutButton'
import type { Mandalart, Cell } from '@/types'

export default async function DashboardPage() {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  // マンダラート一覧取得（更新日降順）
  const { data: mandalarts } = await supabase
    .from('mandalarts')
    .select('*')
    .order('updated_at', { ascending: false })

  // 各マンダラートのルートグリッド（最初のひとつ）のセルを取得（プレビュー用）
  const list: (Mandalart & { previewCells: Cell[] })[] = []
  for (const m of mandalarts ?? []) {
    const { data: grids } = await supabase
      .from('grids')
      .select('id')
      .eq('mandalart_id', m.id)
      .is('parent_cell_id', null)
      .order('sort_order')
      .limit(1)

    const gridId = grids?.[0]?.id
    let previewCells: Cell[] = []
    if (gridId) {
      const { data: cells } = await supabase
        .from('cells')
        .select('*')
        .eq('grid_id', gridId)
      previewCells = cells ?? []
    }
    list.push({ ...m, previewCells })
  }

  async function createNew() {
    'use server'
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return

    const { data: m } = await supabase
      .from('mandalarts')
      .insert({ user_id: user.id, title: '' })
      .select()
      .single()

    if (m) {
      // ルートグリッドと9セルを作成
      const { data: grid } = await supabase
        .from('grids')
        .insert({ mandalart_id: m.id, parent_cell_id: null, sort_order: 0 })
        .select()
        .single()

      if (grid) {
        await supabase.from('cells').insert(
          Array.from({ length: 9 }).map((_, i) => ({
            grid_id: grid.id,
            position: i,
            text: '',
          }))
        )
      }

      redirect(`/mandalart/${m.id}`)
    }
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between">
        <h1 className="text-lg font-bold">マンダラート</h1>
        <div className="flex items-center gap-3">
          <form action={createNew}>
            <button
              type="submit"
              className="bg-blue-600 text-white text-sm font-medium px-4 py-2 rounded-lg hover:bg-blue-700 transition-colors"
            >
              + 新規作成
            </button>
          </form>
          <SignOutButton />
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-8">
        <MandalartGrid initialMandalarts={list} />
      </main>
    </div>
  )
}
