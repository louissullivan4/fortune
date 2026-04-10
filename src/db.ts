import { Pool } from 'pg'
import { readFileSync, readdirSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const MIGRATIONS_DIR = join(__dirname, '..', 'migrations')

let _pool: Pool | null = null

export function getPool(): Pool {
  if (_pool) return _pool
  const connectionString = process.env.DATABASE_URL
  if (!connectionString) throw new Error('DATABASE_URL environment variable is required')
  _pool = new Pool({ connectionString })
  return _pool
}

export async function runMigrations(): Promise<void> {
  const pool = getPool()

  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version TEXT PRIMARY KEY,
      run_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `)

  const applied = new Set(
    (
      await pool.query<{ version: string }>(
        'SELECT version FROM schema_migrations ORDER BY version'
      )
    ).rows.map((r) => r.version)
  )

  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort()

  for (const file of files) {
    if (applied.has(file)) continue
    console.log(`[db] Running migration: ${file}`)
    const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf-8')
    await pool.query(sql)
    await pool.query('INSERT INTO schema_migrations (version) VALUES ($1)', [file])
    console.log(`[db] Migration applied: ${file}`)
  }
}

export async function closePool(): Promise<void> {
  if (_pool) {
    await _pool.end()
    _pool = null
  }
}
