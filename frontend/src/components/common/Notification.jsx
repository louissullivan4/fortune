import React, { useState, useEffect } from 'react'
import { Checkmark, WarningAlt, Information, Close } from '@carbon/icons-react'
import IconButton from './Button'

const Notification = ({
  type = 'info',
  title,
  message,
  duration = 5000,
  onClose,
  className = '',
  ...props
}) => {
  const [isVisible, setIsVisible] = useState(true)

  useEffect(() => {
    if (duration > 0) {
      const timer = setTimeout(() => {
        setIsVisible(false)
        setTimeout(() => onClose?.(), 300) // Wait for fade out animation
      }, duration)
      return () => clearTimeout(timer)
    }
  }, [duration, onClose])

  const handleClose = () => {
    setIsVisible(false)
    setTimeout(() => onClose?.(), 300)
  }

  const getIcon = () => {
    switch (type) {
      case 'success':
        return <Checkmark size={20} className="text-success-green" />
      case 'error':
        return <WarningAlt size={20} className="text-danger-red" />
      case 'warning':
        return <WarningAlt size={20} className="text-warning-orange" />
      case 'info':
      default:
        return <Information size={20} className="text-primary-teal" />
    }
  }

  const getTypeClasses = () => {
    switch (type) {
      case 'success':
        return 'bg-success-green-light border-success-green text-success-green'
      case 'error':
        return 'bg-danger-red-light border-danger-red text-danger-red'
      case 'warning':
        return 'bg-orange-50 border-warning-orange text-warning-orange'
      case 'info':
      default:
        return 'bg-primary-accent-light border-primary-teal text-primary-teal'
    }
  }

  if (!isVisible) return null

  return (
    <div
      className={`notification ${getTypeClasses()} ${className}`}
      role="alert"
      aria-live="polite"
      {...props}
    >
      <div className="notification-content">
        <div className="notification-icon">
          {getIcon()}
        </div>
        <div className="notification-text">
          {title && <div className="notification-title">{title}</div>}
          {message && <div className="notification-message">{message}</div>}
        </div>
      </div>
      <IconButton
        icon={Close}
        variant="ghost"
        size="small"
        onClick={handleClose}
        aria-label="Close notification"
        className="notification-close"
      />
    </div>
  )
}

export default Notification 