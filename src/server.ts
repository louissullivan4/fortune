import express from 'express'
import cors from 'cors'
import { createServer } from 'http'
import { hub } from './ws/hub.js'
import apiRouter from './http/routes/index.js'
import { errorHandler, notFound } from './http/middleware/errors.js'

export function createApp() {
  const app = express()

  app.use(cors())
  app.use(express.json())

  // Health check
  app.get('/health', (_req, res) => {
    res.json({
      status: 'ok',
      uptime: Math.floor(process.uptime()),
      timestamp: new Date().toISOString(),
      wsConnections: hub.connectionCount,
    })
  })

  app.use('/api', apiRouter)
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
