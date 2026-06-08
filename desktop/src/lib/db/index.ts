import Database from '@tauri-apps/plugin-sql'

let db: Database | null = null

export async function getDb(): Promise<Database> {
  if (!db) {
    db = await Database.load('sqlite:mandalart.db')
    // スキーマ側で FK 制約を張らない方針に統一（migration 001 参照）のため
    // PRAGMA foreign_keys 設定は不要。
    //
    // WAL モード: writer と reader が並行できるようにする。
    // 同期中に DashboardPage が読み込みを行うと "database is locked" (code 5)
    // が出るのを回避する。WAL モードは DB ファイルに永続化されるので
    // 初回接続時に一度設定すれば OK。
    try {
      await db.execute('PRAGMA journal_mode = WAL')
      // busy_timeout: ロック遭遇時に即失敗せず最大 5 秒待機する
      await db.execute('PRAGMA busy_timeout = 5000')
    } catch (e) {
      console.warn('[db] failed to set WAL / busy_timeout pragmas:', e)
    }
  }
  return db
}

export async function query<T>(sql: string, params: unknown[] = []): Promise<T[]> {
  const database = await getDb()
  return database.select<T[]>(sql, params)
}

export async function execute(sql: string, params: unknown[] = []): Promise<void> {
  const database = await getDb()
  await database.execute(sql, params)
}

export function generateId(): string {
  return crypto.randomUUID()
}

export function now(): string {
  return new Date().toISOString()
}
