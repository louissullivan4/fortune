import { describe, it, expect, vi } from 'vitest'
import { errorHandler, notFound } from './errors.js'
import type { Request, Response, NextFunction } from 'express'

function makeRes() {
  const json = vi.fn()
  const status = vi.fn().mockReturnValue({ json })
  return { res: { status, json } as unknown as Response, status, json }
}

describe('errorHandler', () => {
  it('uses statusCode from the error when present', () => {
    const err = Object.assign(new Error('Not found'), { statusCode: 404 })
    const { res, status } = makeRes()
    errorHandler(err, {} as Request, res, (() => {}) as NextFunction)
    expect(status).toHaveBeenCalledWith(404)
  })

  it('defaults to 500 when statusCode is absent', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const err = new Error('Something broke')
    const { res, status } = makeRes()
    errorHandler(err, {} as Request, res, (() => {}) as NextFunction)
    expect(status).toHaveBeenCalledWith(500)
    vi.restoreAllMocks()
  })

  it('responds with the error message', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const err = new Error('Validation failed')
    const json = vi.fn()
    const status = vi.fn().mockReturnValue({ json })
    errorHandler(
      err,
      {} as Request,
      { status, json } as unknown as Response,
      (() => {}) as NextFunction
    )
    expect(json).toHaveBeenCalledWith({ error: 'Validation failed' })
    vi.restoreAllMocks()
  })

  it('calls console.error for 5xx errors', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const err = new Error('Server error')
    const { res } = makeRes()
    errorHandler(err, {} as Request, res, (() => {}) as NextFunction)
    expect(spy).toHaveBeenCalled()
    spy.mockRestore()
  })

  it('does not call console.error for 4xx errors', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const err = Object.assign(new Error('Bad request'), { statusCode: 400 })
    const { res } = makeRes()
    errorHandler(err, {} as Request, res, (() => {}) as NextFunction)
    expect(spy).not.toHaveBeenCalled()
    spy.mockRestore()
  })
})

describe('notFound', () => {
  it('responds with 404 and a not-found message', () => {
    const json = vi.fn()
    const status = vi.fn().mockReturnValue({ json })
    const res = { status, json } as unknown as Response
    notFound({} as Request, res)
    expect(status).toHaveBeenCalledWith(404)
    expect(json).toHaveBeenCalledWith({ error: 'Not found' })
  })
})
