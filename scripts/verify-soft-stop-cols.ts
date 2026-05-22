import 'dotenv/config'
import pg from 'pg'

async function main() {
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL })
  try {
    const r = await pool.query<{ column_name: string; column_default: string | null }>(
      `SELECT column_name, column_default
       FROM information_schema.columns
       WHERE table_name = 'user_configs' AND column_name LIKE 'soft%'
       ORDER BY column_name`
    )
    console.log('soft_stop columns:', r.rows)
  } finally {
    await pool.end()
  }
}
main().catch((e) => {
  console.error('FAIL:', e.message)
  process.exit(1)
})
