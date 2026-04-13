import { Router } from 'express'
import { randomBytes } from 'crypto'
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import { getPool } from '../../db.js'
import { sendPasswordResetEmail } from '../../services/email.js'
import { requireAuth } from '../middleware/auth.js'
import type { JwtPayload } from '../../types/user.js'

const router = Router()

const ACCESS_TTL = '15m'
const REFRESH_TTL = '7d'
const REFRESH_TTL_MS = 7 * 24 * 60 * 60 * 1000

function signAccess(payload: JwtPayload): string {
  return jwt.sign(payload, process.env.JWT_SECRET!, { expiresIn: ACCESS_TTL })
}

function signRefresh(payload: JwtPayload): string {
  return jwt.sign(payload, process.env.JWT_SECRET!, { expiresIn: REFRESH_TTL })
}

function setRefreshCookie(res: import('express').Response, token: string): void {
  res.cookie('refreshToken', token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: REFRESH_TTL_MS,
    path: '/api/auth',
  })
}

// ── POST /api/auth/login ───────────────────────────────────────────────────
router.post('/login', async (req, res, next) => {
  try {
    const { identifier, password } = req.body as { identifier: string; password: string }
    if (!identifier || !password) {
      return res.status(400).json({ error: 'Email/username and password are required' })
    }

    const pool = getPool()
    const result = await pool.query<{
      user_id: string
      email: string
      password_hash: string
      user_role: string
      is_active: boolean
    }>(
      'SELECT user_id, email, password_hash, user_role, is_active FROM users WHERE email = LOWER($1) OR LOWER(username) = LOWER($1)',
      [identifier.trim()]
    )

    const user = result.rows[0]
    if (!user) {
      return res.status(401).json({ error: 'Invalid email/username or password' })
    }
    if (!user.is_active) {
      return res.status(401).json({ error: 'Account is not active. Please complete registration.' })
    }

    const valid = await bcrypt.compare(password, user.password_hash)
    if (!valid) {
      return res.status(401).json({ error: 'Invalid email/username or password' })
    }

    const payload: JwtPayload = {
      userId: user.user_id,
      email: user.email,
      role: user.user_role as 'admin' | 'client',
    }
    const accessToken = signAccess(payload)
    const refreshToken = signRefresh(payload)
    setRefreshCookie(res, refreshToken)

    res.json({
      accessToken,
      user: { userId: user.user_id, email: user.email, role: user.user_role },
    })
  } catch (err) {
    next(err)
  }
})

// ── POST /api/auth/refresh ─────────────────────────────────────────────────
router.post('/refresh', (req, res) => {
  const token = req.cookies?.refreshToken as string | undefined
  if (!token) {
    return res.status(401).json({ error: 'No refresh token' })
  }
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET!) as JwtPayload
    const newPayload: JwtPayload = {
      userId: payload.userId,
      email: payload.email,
      role: payload.role,
    }
    const accessToken = signAccess(newPayload)
    const newRefresh = signRefresh(newPayload)
    setRefreshCookie(res, newRefresh)
    res.json({ accessToken })
  } catch {
    res.status(401).json({ error: 'Invalid or expired refresh token' })
  }
})

// ── POST /api/auth/logout ──────────────────────────────────────────────────
router.post('/logout', (_req, res) => {
  res.clearCookie('refreshToken', { path: '/api/auth' })
  res.json({ ok: true })
})

// ── GET /api/auth/me ───────────────────────────────────────────────────────
router.get('/me', requireAuth, async (req, res, next) => {
  try {
    const pool = getPool()
    const result = await pool.query<{
      user_id: string
      email: string
      username: string
      first_name: string
      last_name: string
      user_role: string
    }>(
      'SELECT user_id, email, username, first_name, last_name, user_role FROM users WHERE user_id = $1',
      [req.user!.userId]
    )
    const user = result.rows[0]
    if (!user) return res.status(404).json({ error: 'User not found' })
    res.json(user)
  } catch (err) {
    next(err)
  }
})

// ── GET /api/auth/invite/verify?token=... ─────────────────────────────────
router.get('/invite/verify', async (req, res, next) => {
  try {
    const { token } = req.query as { token: string }
    if (!token) return res.status(400).json({ error: 'Token is required' })

    const pool = getPool()
    const result = await pool.query<{
      email: string
      is_used: boolean
      expires_at: string
    }>('SELECT email, is_used, expires_at FROM user_invitations WHERE token = $1', [token])
    const invite = result.rows[0]
    if (!invite) return res.status(404).json({ error: 'Invitation not found' })
    if (invite.is_used) return res.status(400).json({ error: 'Invitation has already been used' })
    if (new Date(invite.expires_at) < new Date()) {
      return res.status(400).json({ error: 'Invitation has expired' })
    }

    res.json({ email: invite.email, valid: true })
  } catch (err) {
    next(err)
  }
})

// ── POST /api/auth/create-account ─────────────────────────────────────────
router.post('/create-account', async (req, res, next) => {
  try {
    const {
      token,
      password,
      username,
      firstName,
      lastName,
      dob,
      address1,
      address2,
      city,
      county,
      country,
      zipcode,
      phone,
    } = req.body as {
      token: string
      password: string
      username: string
      firstName: string
      lastName: string
      dob?: string
      address1?: string
      address2?: string
      city?: string
      county?: string
      country?: string
      zipcode?: string
      phone?: string
    }

    if (!token || !password || !username || !firstName || !lastName) {
      return res.status(400).json({ error: 'Missing required fields' })
    }
    if (password.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters' })
    }

    const pool = getPool()
    const inviteResult = await pool.query<{
      email: string
      is_used: boolean
      expires_at: string
      id: number
      is_admin: boolean
    }>('SELECT id, email, is_used, expires_at, is_admin FROM user_invitations WHERE token = $1', [
      token,
    ])

    const invite = inviteResult.rows[0]
    if (!invite) return res.status(404).json({ error: 'Invitation not found' })
    if (invite.is_used) return res.status(400).json({ error: 'Invitation already used' })
    if (new Date(invite.expires_at) < new Date()) {
      return res.status(400).json({ error: 'Invitation has expired' })
    }

    // Check username uniqueness
    const usernameCheck = await pool.query('SELECT id FROM users WHERE username = $1', [
      username.trim(),
    ])
    if (usernameCheck.rows.length > 0) {
      return res.status(409).json({ error: 'Username already taken' })
    }

    const passwordHash = await bcrypt.hash(password, 12)
    const role = invite.is_admin ? 'admin' : 'client'

    const userResult = await pool.query<{ user_id: string }>(
      `INSERT INTO users
         (email, password_hash, username, first_name, last_name, dob, address1, address2, city, county, country, zipcode, phone, user_role, is_active)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, true)
       RETURNING user_id`,
      [
        invite.email.toLowerCase(),
        passwordHash,
        username.trim(),
        firstName.trim(),
        lastName.trim(),
        dob || null,
        address1 || null,
        address2 || null,
        city || null,
        county || null,
        country || null,
        zipcode || null,
        phone || null,
        role,
      ]
    )
    const userId = userResult.rows[0].user_id

    // Seed per-user config and api_keys rows
    await pool.query(
      `INSERT INTO user_configs (user_id) VALUES ($1) ON CONFLICT (user_id) DO NOTHING`,
      [userId]
    )
    await pool.query(
      `INSERT INTO user_api_keys (user_id) VALUES ($1) ON CONFLICT (user_id) DO NOTHING`,
      [userId]
    )

    // Mark invitation as used
    await pool.query(`UPDATE user_invitations SET is_used = true, used_at = NOW() WHERE id = $1`, [
      invite.id,
    ])

    const payload: JwtPayload = { userId, email: invite.email, role }
    const accessToken = signAccess(payload)
    const refreshToken = signRefresh(payload)
    setRefreshCookie(res, refreshToken)

    res.status(201).json({
      accessToken,
      user: { userId, email: invite.email, role },
    })
  } catch (err) {
    next(err)
  }
})

// ── POST /api/auth/forgot-password ────────────────────────────────────────
router.post('/forgot-password', async (req, res, next) => {
  try {
    const { email } = req.body as { email: string }
    if (!email) return res.status(400).json({ error: 'Email is required' })

    const pool = getPool()
    const result = await pool.query<{ user_id: string }>(
      'SELECT user_id FROM users WHERE email = $1 AND is_active = true',
      [email.toLowerCase().trim()]
    )

    // Always return 200 to prevent email enumeration
    if (result.rows.length === 0) {
      return res.json({ ok: true })
    }

    const userId = result.rows[0].user_id
    const token = randomBytes(32).toString('hex')

    // Invalidate old tokens
    await pool.query(
      `UPDATE password_reset_tokens SET is_used = true WHERE user_id = $1 AND is_used = false`,
      [userId]
    )
    await pool.query(`INSERT INTO password_reset_tokens (user_id, token) VALUES ($1, $2)`, [
      userId,
      token,
    ])

    await sendPasswordResetEmail(email, token)
    res.json({ ok: true })
  } catch (err) {
    next(err)
  }
})

// ── POST /api/auth/reset-password ─────────────────────────────────────────
router.post('/reset-password', async (req, res, next) => {
  try {
    const { token, password } = req.body as { token: string; password: string }
    if (!token || !password) {
      return res.status(400).json({ error: 'Token and password are required' })
    }
    if (password.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters' })
    }

    const pool = getPool()
    const result = await pool.query<{
      id: number
      user_id: string
      is_used: boolean
      expires_at: string
    }>('SELECT id, user_id, is_used, expires_at FROM password_reset_tokens WHERE token = $1', [
      token,
    ])

    const resetToken = result.rows[0]
    if (!resetToken) return res.status(404).json({ error: 'Reset token not found' })
    if (resetToken.is_used) return res.status(400).json({ error: 'Reset token already used' })
    if (new Date(resetToken.expires_at) < new Date()) {
      return res.status(400).json({ error: 'Reset token has expired' })
    }

    const passwordHash = await bcrypt.hash(password, 12)
    await pool.query('UPDATE users SET password_hash = $1, updated_at = NOW() WHERE user_id = $2', [
      passwordHash,
      resetToken.user_id,
    ])
    await pool.query(
      `UPDATE password_reset_tokens SET is_used = true, used_at = NOW() WHERE id = $1`,
      [resetToken.id]
    )

    res.json({ ok: true })
  } catch (err) {
    next(err)
  }
})

export default router
