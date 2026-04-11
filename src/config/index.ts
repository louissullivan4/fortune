import 'dotenv/config'
import { z } from 'zod'

// ── Server-level config — validated once at startup ─────────────────────────
// API keys (Anthropic, T212) are no longer stored here.
// They live per-user in the database, encrypted at rest.

const ServerSchema = z.object({
  jwtSecret: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  encryptionKey: z
    .string()
    .length(64, 'ENCRYPTION_KEY must be 64 hex characters (32 bytes)'),
})

const result = ServerSchema.safeParse({
  jwtSecret: process.env.JWT_SECRET,
  encryptionKey: process.env.ENCRYPTION_KEY,
})

if (!result.success) {
  console.error('[config] Server configuration error:')
  result.error.issues.forEach((i) => console.error(`  ${i.path.join('.')}: ${i.message}`))
  process.exit(1)
}

export const serverConfig = result.data
