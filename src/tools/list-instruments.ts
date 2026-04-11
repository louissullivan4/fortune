import 'dotenv/config'
import { Trading212Client } from '../api/trading212.js'
import { runMigrations, getPool } from '../db.js'
import { decrypt } from '../services/encryption.js'

async function main() {
  await runMigrations()

  const userId = process.env.USER_ID
  let t212: Trading212Client

  if (userId) {
    const pool = getPool()
    const res = await pool.query<{
      t212_key_id_enc: string | null
      t212_key_secret_enc: string | null
      t212_mode: string
    }>('SELECT t212_key_id_enc, t212_key_secret_enc, t212_mode FROM user_api_keys WHERE user_id = $1', [userId])
    const row = res.rows[0]
    if (!row?.t212_key_id_enc || !row?.t212_key_secret_enc) {
      console.error('No T212 API keys found for this user.')
      process.exit(1)
    }
    t212 = new Trading212Client(
      decrypt(row.t212_key_id_enc),
      decrypt(row.t212_key_secret_enc),
      (row.t212_mode ?? 'demo') as 'demo' | 'live'
    )
  } else {
    const keyId = process.env.TRADING_212_API_KEY_ID ?? ''
    const keySecret = process.env.TRADING_212_API_KEY_SECRET ?? ''
    const mode = (process.env.TRADING_212_MODE ?? 'demo') as 'demo' | 'live'
    if (!keyId || !keySecret) {
      console.error('Set USER_ID env var or TRADING_212_API_KEY_ID/SECRET in .env')
      process.exit(1)
    }
    t212 = new Trading212Client(keyId, keySecret, mode)
  }

  const instruments = await t212.getInstruments()

  const query = process.argv[2]?.toLowerCase()

  const list = [...instruments.values()]
    .filter(
      (i) =>
        !query ||
        i.ticker.toLowerCase().includes(query) ||
        i.name.toLowerCase().includes(query) ||
        i.shortName.toLowerCase().includes(query)
    )
    .sort((a, b) => a.ticker.localeCompare(b.ticker))

  console.log(`\n${'Ticker'.padEnd(20)} ${'Short Name'.padEnd(16)} ${'Currency'.padEnd(10)} Name`)
  console.log('─'.repeat(90))
  for (const i of list) {
    console.log(
      `${i.ticker.padEnd(20)} ${i.shortName.padEnd(16)} ${i.currencyCode.padEnd(10)} ${i.name}`
    )
  }
  console.log(`\n${list.length} instrument(s)${query ? ` matching "${query}"` : ''}\n`)
  process.exit(0)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
