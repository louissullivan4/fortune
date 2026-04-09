import { createHttpServer } from './server.js'

// Catch unhandled rejections so a single failed promise doesn't kill the server.
process.on('unhandledRejection', (reason) => {
  console.error('[server] Unhandled promise rejection:', reason)
})
process.on('uncaughtException', (err) => {
  console.error('[server] Uncaught exception:', err)
})

const PORT = parseInt(process.env.PORT ?? '3000', 10)
const server = createHttpServer()

server.listen(PORT, () => {
  console.log(`[server] API listening on http://localhost:${PORT}`)
  console.log(`[server] WebSocket on ws://localhost:${PORT}/ws`)
  console.log(`[server] Health check: http://localhost:${PORT}/health`)
})

function shutdown(signal: string) {
  console.log(`\n[server] ${signal} — shutting down`)
  // Force exit after 2s in case WebSocket connections are keeping the server open
  const timer = setTimeout(() => process.exit(0), 2000)
  timer.unref()
  server.close(() => process.exit(0))
}

process.once('SIGTERM', () => shutdown('SIGTERM'))
process.once('SIGINT', () => shutdown('SIGINT'))
