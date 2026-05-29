// DB-backed implementation of the FxPersistence hook declared in api/fx.ts.
// Kept separate so api/fx.ts has no direct DB dependency and stays unit-testable.
//
// Wire this up once at process startup:
//   setFxPersistence(dbFxPersistence)
//   await seedFxCacheFromDb()

import { getPool } from '../db.js'
import { setFxPersistence, type FxPersistence } from './fx.js'

export const dbFxPersistence: FxPersistence = {
  async load() {
    const pool = getPool()
    const { rows } = await pool.query<{ currency: string; rate: number }>(
      'SELECT currency, rate FROM fx_rates'
    )
    return rows
  },
  async save(currency, rate) {
    const pool = getPool()
    await pool.query(
      `INSERT INTO fx_rates (currency, rate, updated_at)
       VALUES ($1, $2, NOW())
       ON CONFLICT (currency) DO UPDATE SET rate = EXCLUDED.rate, updated_at = NOW()`,
      [currency, rate]
    )
  },
}

/** Install the DB-backed FX persistence hook. Call once at startup. */
export function installDbFxPersistence(): void {
  setFxPersistence(dbFxPersistence)
}
