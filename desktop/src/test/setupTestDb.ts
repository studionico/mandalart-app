/**
 * テスト用 in-memory SQLite DB と `@/lib/db` モック実装。
 *
 * Tauri ランタイムの tauri-plugin-sql は Node 単体テストでは使えないため、`better-sqlite3`
 * (Node native) で `:memory:` 接続を作り、`desktop/src-tauri/migrations/*.sql` を順に流す。
 * これで実 DB と同じスキーマで cascade / sync-aware 削除等のロジックをテスト可能になる。
 *
 * 使い方:
 * ```ts
 * import { vi } from 'vitest'
 * vi.mock('@/lib/db', () => import('@/test/setupTestDb'))
 *
 * import { describe, beforeEach, afterEach, it, expect } from 'vitest'
 * import { createTestDb, bindTestDb, unbindTestDb } from '@/test/setupTestDb'
 * import { createMandalart } from '@/lib/api/mandalarts'
 *
 * describe('mandalarts', () => {
 *   let db: ReturnType<typeof createTestDb>
 *   beforeEach(() => { db = createTestDb(); bindTestDb(db) })
 *   afterEach(() => { unbindTestDb(); db.close() })
 *
 *   it('creates a mandalart row', async () => {
 *     const m = await createMandalart('test')
 *     expect(m.title).toBe('test')
 *   })
 * })
 * ```
 */

import Database from 'better-sqlite3'
import { fileURLToPath } from 'node:url'
import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const MIGRATIONS_DIR = path.resolve(__dirname, '../../src-tauri/migrations')

/**
 * `:memory:` SQLite を新規に開き、全 migration を順に流して返す。
 * テストごとに 1 個作って `bindTestDb` でアクティブにする想定。
 */
export function createTestDb(): Database.Database {
  const db = new Database(':memory:')
  const files = fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort()
  for (const file of files) {
    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8')
    db.exec(sql)
  }
  return db
}

let activeDb: Database.Database | null = null

/** モック `query` / `execute` の実体となる DB を差し込む。 */
export function bindTestDb(db: Database.Database): void {
  activeDb = db
}

/** バインド解除 (afterEach 用)。テスト間の隔離のため必ず呼ぶ。 */
export function unbindTestDb(): void {
  activeDb = null
}

function requireDb(): Database.Database {
  if (!activeDb) {
    throw new Error(
      '[setupTestDb] test DB not bound. Call bindTestDb(createTestDb()) in beforeEach.',
    )
  }
  return activeDb
}

// --- @/lib/db API surface のモック実装 ---
// `vi.mock('@/lib/db', () => import('@/test/setupTestDb'))` で差し替えると、
// API 層 (`lib/api/*.ts`) の query / execute がこちらに向く。

export function query<T>(sql: string, params: unknown[] = []): Promise<T[]> {
  const db = requireDb()
  // better-sqlite3 は `?` プレースホルダ + positional params を受ける。tauri-plugin-sql と同じ。
  const rows = db.prepare(sql).all(...(params as unknown[])) as T[]
  return Promise.resolve(rows)
}

export function execute(sql: string, params: unknown[] = []): Promise<void> {
  const db = requireDb()
  db.prepare(sql).run(...(params as unknown[]))
  return Promise.resolve()
}

export function generateId(): string {
  return randomUUID()
}

export function now(): string {
  return new Date().toISOString()
}
