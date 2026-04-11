import express from 'express'
import cors from 'cors'
import helmet from 'helmet'
import cookieParser from 'cookie-parser'
import { rateLimit } from 'express-rate-limit'
import { createServer } from 'http'
import { hub } from './ws/hub.js'
import apiRouter from './http/routes/index.js'
import { errorHandler, notFound } from './http/middleware/errors.js'
import { getPool } from './db.js'

const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
})

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
})

export function createApp() {
  const app = express()

  app.set('trust proxy', 1)
  app.use(helmet())
  app.use(
    cors({
      origin: process.env.FRONTEND_URL ?? 'http://localhost:5173',
      credentials: true,
    })
  )
  app.use(cookieParser())
  app.use(express.json())

  app.get('/health', async (_req, res) => {
    try {
      await getPool().query('SELECT 1')
      res.json({
        status: 'ok',
        uptime: Math.floor(process.uptime()),
        timestamp: new Date().toISOString(),
        wsConnections: hub.connectionCount,
        db: 'ok',
      })
    } catch {
      res.status(503).json({ status: 'error', db: 'unreachable' })
    }
  })

  app.use('/api/auth', authLimiter)
  app.use('/api', apiLimiter, apiRouter)
  app.use(notFound)
  app.use(errorHandler)

  return app
}

export function createHttpServer() {
  const app = createApp()
  const server = createServer(app)
  hub.attach(server)
  return server
}
