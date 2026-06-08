import { vi, describe, beforeEach, afterEach, it, expect } from 'vitest'

vi.mock('@/lib/db', () => import('@/test/setupTestDb'))

import type Database from 'better-sqlite3'
import { createTestDb, bindTestDb, unbindTestDb } from '@/test/setupTestDb'
import { createMandalart, updateMandalartTitle, deleteMandalart } from '@/lib/api/mandalarts'
import { getRootGrids } from '@/lib/api/grids'
import { upsertCellAt } from '@/lib/api/cells'
import { mirrorAllToFolder, type MirrorFs, type MirrorEnvelope } from '../mirrorSync'
import { mirrorFilename } from '../mirrorFilename'

/**
 * mirrorAllToFolder の契約をロックする (実 SQLite in-memory + in-memory fs adapter)。
 * 検証: envelope encode / rename 旧ファイル削除 / 削除(ゴミ箱)時のファイル削除 / 冪等性 /
 * 外部 (非 mirror) ファイルを消さない安全性。
 */

let db: Database.Database

beforeEach(() => {
  db = createTestDb()
  bindTestDb(db)
})
afterEach(() => {
  unbindTestDb()
  db.close()
})

/** name→content の in-memory ファイルシステム (単一フォルダ前提)。 */
function memFs(): { fs: MirrorFs; files: Map<string, string> } {
  const files = new Map<string, string>()
  const fs: MirrorFs = {
    async ensureDir() {},
    async writeFile(_dir, name, content) {
      files.set(name, content)
    },
    async removeFile(_dir, name) {
      files.delete(name)
    },
    async listJsonFiles() {
      return [...files.keys()].filter((n) => n.endsWith('.json'))
    },
    async readFile(_dir, name) {
      return files.get(name) ?? null
    },
  }
  return { fs, files }
}

const DIR = '/mirror'

describe('mirrorAllToFolder', () => {
  it('マンダラートを envelope として書き出す', async () => {
    const m = await createMandalart('健康')
    const root = (await getRootGrids(m.id))[0]
    await upsertCellAt(root.id, 2, { text: '運動' })

    const { fs, files } = memFs()
    const res = await mirrorAllToFolder(DIR, fs)

    expect(res.written).toBe(1)
    expect(res.deleted).toBe(0)
    const name = mirrorFilename('健康', m.id)
    expect(files.has(name)).toBe(true)

    const env = JSON.parse(files.get(name)!) as MirrorEnvelope
    expect(env.version).toBe(1)
    expect(env.id).toBe(m.id)
    expect(env.title).toBe('健康')
    expect(env.snapshot.cells.some((c) => c.text === '運動')).toBe(true)
  })

  it('タイトル変更で旧 slug ファイルを削除し新名で書き直す (rename)', async () => {
    const m = await createMandalart('旧名')
    const { fs, files } = memFs()
    await mirrorAllToFolder(DIR, fs)
    const oldName = mirrorFilename('旧名', m.id)
    expect(files.has(oldName)).toBe(true)

    await updateMandalartTitle(m.id, '新名')
    const res = await mirrorAllToFolder(DIR, fs)

    const newName = mirrorFilename('新名', m.id)
    expect(files.has(newName)).toBe(true)
    expect(files.has(oldName)).toBe(false)
    expect(res.deleted).toBe(1)
  })

  it('ゴミ箱(soft-delete)でファイルを削除する', async () => {
    const m = await createMandalart('消す')
    const { fs, files } = memFs()
    await mirrorAllToFolder(DIR, fs)
    expect(files.size).toBe(1)

    await deleteMandalart(m.id)
    const res = await mirrorAllToFolder(DIR, fs)

    expect(files.size).toBe(0)
    expect(res.written).toBe(0)
    expect(res.deleted).toBe(1)
  })

  it('再実行は冪等 (書込みは更新するが余計な削除をしない)', async () => {
    await createMandalart('A')
    await createMandalart('B')
    const { fs } = memFs()
    await mirrorAllToFolder(DIR, fs)
    const res = await mirrorAllToFolder(DIR, fs)
    expect(res.written).toBe(2)
    expect(res.deleted).toBe(0)
  })

  it('mirror が書いていない外部 .json ファイルは削除しない', async () => {
    await createMandalart('A')
    const { fs, files } = memFs()
    files.set('user-notes.json', '{"hello":"world"}')
    const res = await mirrorAllToFolder(DIR, fs)
    expect(files.has('user-notes.json')).toBe(true)
    expect(res.deleted).toBe(0)
  })
})
