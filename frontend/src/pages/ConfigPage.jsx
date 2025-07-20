import React, { useState } from 'react'
import {
  Pause,
  Play,
  TrashCan,
  Information,
  WarningAlt,
  Checkmark,
  Close,
  Settings,
  List,
} from '@carbon/icons-react'
import Button, { PauseButton, PlayButton, DeleteButton, IconButton, CloseButton } from '../components/common/Button'
import Notification from '../components/common/Notification'
import './ConfigPage.css'
import { 
  pauseTrading, 
  resumeTrading, 
  dumpPositions, 
  getTradingStatus 
} from '../services/api'

const ConfigPage = () => {
  const [error, setError] = useState(null)
  const [showConfirmDialog, setShowConfirmDialog] = useState(false)
  const [confirmAction, setConfirmAction] = useState(null)
  const [confirmMessage, setConfirmMessage] = useState('')
  const [confirmIcon, setConfirmIcon] = useState(null)
  const [confirmTitle, setConfirmTitle] = useState('')
  const [tradingPaused, setTradingPaused] = useState(null)
  const [statusLoading, setStatusLoading] = useState(true)
  const [notification, setNotification] = useState(null)

  React.useEffect(() => {
    const fetchStatus = async () => {
      setStatusLoading(true)
      try {
        const paused = await getTradingStatus()
        setTradingPaused(paused)
      } catch (err) {
        setError(err.message || 'Failed to fetch trading status')
      } finally {
        setStatusLoading(false)
      }
    }
    fetchStatus()
  }, [])

  const showNotification = (type, title, message) => {
    setNotification({ type, title, message })
  }

  const handleEmergencyAction = async (action) => {
    try {
      let result = null
      let message = ''
      let title = ''
      
      switch (action) {
        case 'pause':
          result = await pauseTrading()
          title = 'Trading Paused'
          message = 'All trading has been paused. No new signals will be generated.'
          setTradingPaused(true)
          break
        case 'resume':
          result = await resumeTrading()
          title = 'Trading Resumed'
          message = 'Trading has been resumed. New signals will be processed.'
          setTradingPaused(false)
          break
        case 'dump':
          result = await dumpPositions()
          title = 'Positions Dumped'
          message = result.message || 'All open positions have been closed.'
          break
        default:
          return
      }
      
      showNotification('success', title, message)
    } catch (err) {
      setError(err.message || `Failed to ${action} trading`)
      console.error(`Error ${action}ing trading:`, err)
    }
  }

  const showConfirm = (action, message, callback, icon, title) => {
    setConfirmAction(() => callback)
    setConfirmMessage(message)
    setConfirmIcon(icon)
    setConfirmTitle(title)
    setShowConfirmDialog(true)
  }

  const executeConfirmedAction = () => {
    if (confirmAction) {
      confirmAction()
    }
    setShowConfirmDialog(false)
    setConfirmAction(null)
    setConfirmMessage('')
    setConfirmIcon(null)
    setConfirmTitle('')
  }

  return (
    <div className="config-page" aria-label="System Configuration and Control">
      {/* Notification */}
      {notification && (
        <Notification
          type={notification.type}
          title={notification.title}
          message={notification.message}
          onClose={() => setNotification(null)}
        />
      )}

      <div className="config-header">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 16 }}>
          <h1 style={{ margin: 0 }}>System Configuration & Control</h1>
        </div>
      </div>

      {error && (
        <div className="error-message" role="alert">
          <WarningAlt size={20} className="mr-2 text-danger-red" aria-label="Error" />
          <span style={{ flex: 1 }}>{error}</span>
          <IconButton icon={Close} aria-label="Dismiss error" onClick={() => setError(null)} />
        </div>
      )}

      <div className="config-sections">
        <section className="config-section" aria-labelledby="system-info-title">
          <div className="section-header">
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <h2 id="system-info-title">System Information</h2>
            </div>
          </div>
          <div className="system-info">
            <div className="info-card" tabIndex={0} aria-label="System Status">
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                <Information size={20} className="text-primary-teal" aria-label="Info" />
                <h3 style={{ margin: 0 }}>System Status</h3>
              </div>
              <p className="text-success-green mr-2" aria-label="Operational">All systems operational</p>
              <p className="text-success-green mr-2" aria-label="Database Active">Database connection: <strong>Active</strong></p>
              <p className="text-success-green mr-2" aria-label="Market Data Connected">Market data feed: <strong>Connected</strong></p>
            </div>
          </div>
        </section>

        {/* Emergency Controls Section */}
        <section className="config-section" aria-labelledby="emergency-controls-title">
          <div className="section-header">
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <WarningAlt size={24} className="text-danger-red" aria-label="Emergency" />
              <h2 id="emergency-controls-title">Emergency Controls</h2>
            </div>
            <p className="section-description">
              Critical system controls – use with caution
            </p>
          </div>

          <div className="emergency-controls">
            <div className="control-group">
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                <h3 style={{ margin: 0 }}>Trading Control</h3>
              </div>
              <div className="control-buttons">
                {statusLoading ? (
                  <Button variant="secondary" disabled loading style={{ minWidth: 160 }}>Loading…</Button>
                ) : tradingPaused ? (
                  <PlayButton
                    onClick={() => showConfirm(
                      'resume',
                      'Are you sure you want to resume trading? This will allow new signals to be generated again.',
                      () => handleEmergencyAction('resume'),
                      Play,
                      'Resume Trading'
                    )}
                    aria-label="Resume Trading"
                  >Resume Trading</PlayButton>
                ) : (
                  <PauseButton
                    onClick={() => showConfirm(
                      'pause',
                      'Are you sure you want to pause all trading? This will stop all new signals from being generated.',
                      () => handleEmergencyAction('pause'),
                      Pause,
                      'Pause Trading'
                    )}
                    aria-label="Pause Trading"
                  >Pause Trading</PauseButton>
                )}
              </div>
            </div>

            <div className="control-group">
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                <h3 style={{ margin: 0 }}>Position Management</h3>
              </div>
              <div className="control-buttons">
                <DeleteButton
                  onClick={() => showConfirm(
                    'dump',
                    'WARNING: This will immediately close ALL open positions for ALL strategies. This action cannot be undone. Are you absolutely sure?',
                    () => handleEmergencyAction('dump'),
                    TrashCan,
                    'Dump All Positions'
                  )}
                  aria-label="Dump All Positions"
                >Dump All Positions</DeleteButton>
              </div>
            </div>
          </div>
        </section>
      </div>

      {/* Confirmation Dialog */}
      {showConfirmDialog && (
        <div className="modal-overlay" role="dialog" aria-modal="true" aria-labelledby="confirm-modal-title">
          <div className="modal confirm-modal">
            <div className="modal-header">
              {confirmIcon && React.createElement(confirmIcon, { size: 24, className: 'text-danger-red', style: { marginRight: 8 } })}
              <h2 id="confirm-modal-title" style={{ margin: 0 }}>{confirmTitle || 'Confirm Action'}</h2>
              <IconButton icon={Close} aria-label="Close dialog" onClick={() => setShowConfirmDialog(false)} />
            </div>
            <div className="modal-body">
              <p>{confirmMessage}</p>
            </div>
            <div className="modal-footer">
              <Button variant="secondary" onClick={() => setShowConfirmDialog(false)} aria-label="Cancel">Cancel</Button>
              <Button variant="danger" onClick={executeConfirmedAction} aria-label="Confirm">Confirm</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default ConfigPage 