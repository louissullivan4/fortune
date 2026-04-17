import { describe, it, expect, vi, beforeAll } from 'vitest'
import jwt from 'jsonwebtoken'
import { requireAuth, requireAdmin } from './auth.js'
import type { Request, Response, NextFunction } from 'express'
import type { JwtPayload } from '../../types/user.js'

const JWT_SECRET = 'test-jwt-secret-that-is-at-least-32-characters-long'

beforeAll(() => {
  process.env.JWT_SECRET = JWT_SECRET
})

function makeReq(authorization?: string): Request & { user?: JwtPayload } {
  return {
    headers: authorization ? { authorization } : {},
  } as unknown as Request & { user?: JwtPayload }
}

function makeRes() {
  const json = vi.fn()
  const status = vi.fn().mockReturnValue({ json })
  return { res: { status, json } as unknown as Response, status, json }
}

const adminPayload: JwtPayload = { userId: 'u1', email: 'admin@example.com', role: 'admin' }
const clientPayload: JwtPayload = { userId: 'u2', email: 'client@example.com', role: 'client' }

describe('requireAuth', () => {
  it('rejects requests with no Authorization header', () => {
    const req = makeReq()
    const { res, status } = makeRes()
    const next = vi.fn() as unknown as NextFunction
    requireAuth(req, res, next)
    expect(status).toHaveBeenCalledWith(401)
    expect(next).not.toHaveBeenCalled()
  })

  it('rejects requests using a non-Bearer scheme', () => {
    const req = makeReq('Basic dXNlcjpwYXNz')
    const { res, status } = makeRes()
    const next = vi.fn() as unknown as NextFunction
    requireAuth(req, res, next)
    expect(status).toHaveBeenCalledWith(401)
    expect(next).not.toHaveBeenCalled()
  })

  it('rejects a malformed JWT token', () => {
    const req = makeReq('Bearer not.a.valid.token')
    const { res, status } = makeRes()
    const next = vi.fn() as unknown as NextFunction
    requireAuth(req, res, next)
    expect(status).toHaveBeenCalledWith(401)
    expect(next).not.toHaveBeenCalled()
  })

  it('rejects an expired JWT token', () => {
    const token = jwt.sign(adminPayload, JWT_SECRET, { expiresIn: -1 })
    const req = makeReq(`Bearer ${token}`)
    const { res, status } = makeRes()
    const next = vi.fn() as unknown as NextFunction
    requireAuth(req, res, next)
    expect(status).toHaveBeenCalledWith(401)
    expect(next).not.toHaveBeenCalled()
  })

  it('calls next and populates req.user for a valid admin token', () => {
    const token = jwt.sign(adminPayload, JWT_SECRET)
    const req = makeReq(`Bearer ${token}`)
    const { res } = makeRes()
    const next = vi.fn() as unknown as NextFunction
    requireAuth(req, res, next)
    expect(next).toHaveBeenCalledOnce()
    expect(req.user).toMatchObject({ userId: 'u1', email: 'admin@example.com', role: 'admin' })
  })

  it('calls next and populates req.user for a valid client token', () => {
    const token = jwt.sign(clientPayload, JWT_SECRET)
    const req = makeReq(`Bearer ${token}`)
    const { res } = makeRes()
    const next = vi.fn() as unknown as NextFunction
    requireAuth(req, res, next)
    expect(next).toHaveBeenCalledOnce()
    expect(req.user?.role).toBe('client')
  })

  it('rejects a token signed with the wrong secret', () => {
    const token = jwt.sign(adminPayload, 'wrong-secret-that-is-also-at-least-32-chars')
    const req = makeReq(`Bearer ${token}`)
    const { res, status } = makeRes()
    const next = vi.fn() as unknown as NextFunction
    requireAuth(req, res, next)
    expect(status).toHaveBeenCalledWith(401)
    expect(next).not.toHaveBeenCalled()
  })
})

describe('requireAdmin', () => {
  it('returns 401 when req.user is not set', () => {
    const req = makeReq()
    const { res, status } = makeRes()
    const next = vi.fn() as unknown as NextFunction
    requireAdmin(req, res, next)
    expect(status).toHaveBeenCalledWith(401)
    expect(next).not.toHaveBeenCalled()
  })

  it('returns 403 for a client role', () => {
    const req = makeReq()
    req.user = clientPayload
    const { res, status } = makeRes()
    const next = vi.fn() as unknown as NextFunction
    requireAdmin(req, res, next)
    expect(status).toHaveBeenCalledWith(403)
    expect(next).not.toHaveBeenCalled()
  })

  it('calls next for an admin role', () => {
    const req = makeReq()
    req.user = adminPayload
    const { res } = makeRes()
    const next = vi.fn() as unknown as NextFunction
    requireAdmin(req, res, next)
    expect(next).toHaveBeenCalledOnce()
  })
})
