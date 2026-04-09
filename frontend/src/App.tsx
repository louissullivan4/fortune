import { useCallback } from 'react'
import { useWebSocket, type WsMessage } from './api/ws'
import Layout from './components/Layout'
import ToastContainer, { pushToast, type ToastLevel } from './components/Toasts'

export default function App() {
  const handleMessage = useCallback((msg: WsMessage) => {
    if (msg.event === 'toast') {
      const d = msg.data as { message: string; level: ToastLevel }
      pushToast(d.message, d.level)
    }
  }, [])

  const { connected } = useWebSocket(handleMessage)

  return (
    <>
      <Layout wsConnected={connected} />
      <ToastContainer />
    </>
  )
}
