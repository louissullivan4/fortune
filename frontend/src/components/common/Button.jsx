import React from 'react'
import {
  Add,
  Edit,
  TrashCan,
  Play,
  Pause,
  Download,
  Upload,
  Search,
  Close
} from '@carbon/icons-react'

/**
 * Button System - IBM Carbon Design System
 * Comprehensive button component with all variants and states
 */

const Button = ({
  children,
  variant = 'primary',
  size = 'medium',
  icon,
  iconPosition = 'left',
  disabled = false,
  loading = false,
  fullWidth = false,
  className = '',
  ...props
}) => {
  const baseClasses = 'inline-flex items-center justify-center font-medium transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed'
  
  const sizeClasses = {
    small: 'px-3 py-1.5 text-sm rounded',
    medium: 'px-4 py-2 text-base rounded',
    large: 'px-6 py-3 text-lg rounded'
  }
  
  const variantClasses = {
    primary: 'bg-primary-teal text-white hover:bg-primary-teal-hover focus:ring-primary-teal shadow-sm',
    secondary: 'bg-white text-primary-teal border border-primary-teal hover:bg-gray-50 focus:ring-primary-teal',
    danger: 'bg-danger-red text-white hover:bg-red-700 focus:ring-danger-red shadow-sm',
    ghost: 'bg-transparent text-primary-teal hover:bg-primary-accent-light focus:ring-primary-teal',
    success: 'bg-success-green text-white hover:bg-green-700 focus:ring-success-green shadow-sm',
    warning: 'bg-warning-orange text-white hover:bg-orange-700 focus:ring-warning-orange shadow-sm'
  }
  
  const widthClass = fullWidth ? 'w-full' : ''
  
  const classes = [
    baseClasses,
    sizeClasses[size],
    variantClasses[variant],
    widthClass,
    className
  ].filter(Boolean).join(' ')
  
  const renderIcon = () => {
    if (!icon) return null
    
    const iconSize = size === 'small' ? 14 : size === 'large' ? 20 : 16
    const iconClass = iconPosition === 'right' ? 'ml-2' : 'mr-2'
    
    const IconComponent = icon
    
    return (
      <IconComponent 
        size={iconSize} 
        className={iconClass}
        aria-hidden="true"
      />
    )
  }
  
  return (
    <button
      className={classes}
      disabled={disabled || loading}
      {...props}
    >
      {loading && (
        <div className="mr-2 w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
      )}
      {!loading && iconPosition === 'left' && renderIcon()}
      {children}
      {!loading && iconPosition === 'right' && renderIcon()}
    </button>
  )
}

// Predefined button variants for common actions
export const AddButton = ({ children = 'Add', ...props }) => (
  <Button icon={Add} variant="primary" {...props}>
    {children}
  </Button>
)

export const EditButton = ({ children = 'Edit', ...props }) => (
  <Button icon={Edit} variant="secondary" {...props}>
    {children}
  </Button>
)

export const DeleteButton = ({ children = 'Delete', ...props }) => (
  <Button icon={TrashCan} variant="danger" {...props}>
    {children}
  </Button>
)

export const RunButton = ({ children = 'Run', ...props }) => (
  <Button icon={Play} variant="primary" {...props}>
    {children}
  </Button>
)

export const PlayButton = ({ children = 'Play', ...props }) => (
  <Button icon={Play} variant="success" {...props}>
    {children}
  </Button>
)

export const PauseButton = ({ children = 'Pause', ...props }) => (
  <Button icon={Pause} variant="warning" {...props}>
    {children}
  </Button>
)

export const DownloadButton = ({ children = 'Download', ...props }) => (
  <Button icon={Download} variant="secondary" {...props}>
    {children}
  </Button>
)

export const UploadButton = ({ children = 'Upload', ...props }) => (
  <Button icon={Upload} variant="secondary" {...props}>
    {children}
  </Button>
)

export const SearchButton = ({ children = 'Search', ...props }) => (
  <Button icon={Search} variant="ghost" {...props}>
    {children}
  </Button>
)

export const CloseButton = ({ children, ...props }) => (
  <Button icon={Close} variant="ghost" size="small" {...props}>
    {children}
  </Button>
)

// Icon-only button for compact actions
export const IconButton = ({ 
  icon, 
  size = 'medium', 
  variant = 'ghost',
  'aria-label': ariaLabel,
  ...props 
}) => {
  const sizeClasses = {
    small: 'p-1.5 rounded',
    medium: 'p-2 rounded',
    large: 'p-3 rounded'
  }
  
  const iconSizes = {
    small: 16,
    medium: 20,
    large: 24
  }
  
  const IconComponent = icon
  
  return (
    <Button
      variant={variant}
      size={size}
      className={sizeClasses[size]}
      aria-label={ariaLabel}
      {...props}
    >
      <IconComponent size={iconSizes[size]} />
    </Button>
  )
}

export default Button 