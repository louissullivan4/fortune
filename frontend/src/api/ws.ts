import { useEffect, useRef, useState, useCallback } from 'react'

export interface WsMessage {
  event: string
  data: unknown
  ts: string
}

export function useWebSocket(onMessage: (msg: WsMessage) => void) {
  const ws = useRef<WebSocket | null>(null)
  const [connected, setConnected] = useState(false)
  const reconnectTimer = useRef<ReturnType<typeof setTimeout>>()
  const onMessageRef = useRef(onMessage)
  // eslint-disable-next-line react-hooks/refs
  onMessageRef.current = onMessage

  // Hold connect in a ref so onclose can schedule a reconnect without
  // the useCallback needing connect in its dependency array
  const connectRef = useRef<() => void>()

  const connect = useCallback(() => {
    const protocol = location.protocol === 'https:' ? 'wss' : 'ws'
    const socket = new WebSocket(`${protocol}://${location.host}/ws`)
    ws.current = socket

    socket.onopen = () => setConnected(true)

    socket.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data as string) as WsMessage
        onMessageRef.current(msg)
      } catch {
        // ignore malformed messages
      }
    }

    socket.onclose = () => {
      setConnected(false)
      reconnectTimer.current = setTimeout(() => connectRef.current?.(), 3000)
    }

    socket.onerror = () => socket.close()
  }, [])

  // eslint-disable-next-line react-hooks/refs
  connectRef.current = connect

  useEffect(() => {
    connect()
    return () => {
      clearTimeout(reconnectTimer.current)
      ws.current?.close()
    }
  }, [connect])

  return { connected }
}
