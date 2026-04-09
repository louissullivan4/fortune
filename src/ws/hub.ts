import { WebSocketServer, WebSocket } from 'ws'
import type { IncomingMessage } from 'http'
import type { Server } from 'http'

type EventName =
  | 'engine_status'
  | 'portfolio_update'
  | 'decision'
  | 'order'
  | 'signal_refresh'
  | 'toast'

class Hub {
  private clients = new Set<WebSocket>()
  private wss: WebSocketServer | null = null

  attach(server: Server): void {
    this.wss = new WebSocketServer({ server, path: '/ws' })
    this.wss.on('connection', (ws: WebSocket, _req: IncomingMessage) => {
      this.clients.add(ws)
      ws.on('close', () => this.clients.delete(ws))
      ws.on('error', () => this.clients.delete(ws))
    })
  }

  broadcast(event: EventName, data: unknown): void {
    const msg = JSON.stringify({ event, data, ts: new Date().toISOString() })
    for (const ws of this.clients) {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(msg)
      }
    }
  }

  get connectionCount(): number {
    return this.clients.size
  }
}

export const hub = new Hub()
