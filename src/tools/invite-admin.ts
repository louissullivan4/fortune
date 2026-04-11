/**
 * Creates an admin invitation and sends the invite email.
 *
 * Usage:
 *   npx tsx src/tools/invite-admin.ts <email>
 *   NODE_ENV=production npx tsx src/tools/invite-admin.ts admin@example.com
 */

import 'dotenv/config'
import crypto from 'node:crypto'
import { runMigrations, getPool } from '../db.js'
import { sendInviteEmail } from '../services/email.js'

const email = process.argv[2]?.trim().toLowerCase()
if (!email || !email.includes('@')) {
  console.error('Usage: npx tsx src/tools/invite-admin.ts <email>')
  process.exit(1)
}

async function main() {
  await runMigrations()
  const pool = getPool()

  // Cancel any existing pending invite for this email
  await pool.query(
    `UPDATE user_invitations SET is_used = true WHERE email = $1 AND is_used = false`,
    [email]
  )

  const token = crypto.randomBytes(32).toString('hex')

  await pool.query(
    `INSERT INTO user_invitations (email, token, is_admin)
     VALUES ($1, $2, true)`,
    [email, token]
  )

  await sendInviteEmail(email, token)

  const frontendUrl = process.env.FRONTEND_URL ?? 'http://localhost:5173'
  const link = `${frontendUrl}/create-account?token=${token}`

  console.log(`\nAdmin invite sent to ${email}`)
  console.log(`Link (expires in 7 days): ${link}\n`)

  process.exit(0)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
