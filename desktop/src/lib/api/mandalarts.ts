import { query, execute, generateId, now } from '../db'
import type { Mandalart } from '../../types'

export async function getMandalarts(): Promise<Mandalart[]> {
  return query<Mandalart>(
    'SELECT * FROM mandalarts ORDER BY updated_at DESC'
  )
}

export async function getMandalart(id: string): Promise<Mandalart | null> {
  const rows = await query<Mandalart>('SELECT * FROM mandalarts WHERE id = ?', [id])
  return rows[0] ?? null
}

export async function createMandalart(title = ''): Promise<Mandalart> {
  const id = generateId()
  const ts = now()
  await execute(
    'INSERT INTO mandalarts (id, title, created_at, updated_at) VALUES (?, ?, ?, ?)',
    [id, title, ts, ts]
  )
  return { id, title, created_at: ts, updated_at: ts, user_id: '' }
}

export async function updateMandalartTitle(id: string, title: string): Promise<void> {
  await execute(
    'UPDATE mandalarts SET title = ?, updated_at = ? WHERE id = ?',
    [title, now(), id]
  )
}

export async function deleteMandalart(id: string): Promise<void> {
  await execute('DELETE FROM mandalarts WHERE id = ?', [id])
}

export async function searchMandalarts(q: string): Promise<Mandalart[]> {
  const like = `%${q}%`
  return query<Mandalart>(
    'SELECT * FROM mandalarts WHERE title LIKE ? ORDER BY updated_at DESC',
    [like]
  )
}
