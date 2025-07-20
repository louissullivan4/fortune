import React from 'react'
import { 
  ChartLine,
  ArrowUp,
  ArrowDown,
  Currency,
  ChartBar,
  Information,
  Warning,
  Error,
  Checkmark
} from '@carbon/icons-react'

/**
 * Common UI Components - IBM Carbon Design System
 * Optimized components using the new design system
 */

export const LoadingSpinner = ({ message = 'Loading...' }) => (
  <div className="loading">
    <div className="spinner"></div>
    <p className="body-large text-neutral">{message}</p>
  </div>
)

export const ErrorMessage = ({ message }) => (
  <div className="error">
    <div className="flex items-center">
      <Error size={20} className="mr-2 text-danger" />
      <p className="body-large text-danger">{message}</p>
    </div>
  </div>
)

export const SuccessMessage = ({ message }) => (
  <div className="success">
    <div className="flex items-center">
      <Checkmark size={20} className="mr-2 text-success" />
      <p className="body-large text-success">{message}</p>
    </div>
  </div>
)

export const WarningMessage = ({ message }) => (
  <div className="warning">
    <div className="flex items-center">
      <Warning size={20} className="mr-2 text-warning" />
      <p className="body-large text-warning">{message}</p>
    </div>
  </div>
)

export const InfoMessage = ({ message }) => (
  <div className="info">
    <div className="flex items-center">
      <Information size={20} className="mr-2 text-primary" />
      <p className="body-large text-primary">{message}</p>
    </div>
  </div>
)

export const MetricCard = ({ icon, title, value, isPositive, trend, trendValue }) => {
  const getTrendIcon = () => {
    if (trend === 'up') return <ArrowUp size={16} className="text-success" />
    if (trend === 'down') return <ArrowDown size={16} className="text-danger" />
    return null
  }

  const getValueColor = () => {
    if (isPositive === null) return 'text-gray-900'
    return isPositive ? 'text-success' : 'text-danger'
  }

  return (
    <div className="metric-card">
      <div className="flex items-start justify-between">
        <div className="flex-1">
          <div className="flex items-center mb-3">
            {icon && (
              <div className="mr-3 p-2 bg-primary-accent-bg rounded-lg">
                {icon}
              </div>
            )}
            <div>
              <h3 className="caption text-neutral font-medium uppercase tracking-wide">
                {title}
              </h3>
            </div>
          </div>
          <div className="flex items-baseline">
            <span className={`display-small font-semibold ${getValueColor()}`}>
              {value}
            </span>
            {trend && trendValue && (
              <span className="ml-2 body-small font-medium flex items-center">
                {getTrendIcon()}
                <span className={isPositive ? 'text-success' : 'text-danger'}>
                  {trendValue}
                </span>
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

export const FeatureCard = ({ icon, title, description }) => (
  <div className="feature-card">
    {icon && (
      <div className="mx-auto mb-4 p-3 bg-primary-accent-bg rounded-lg w-12 h-12 flex items-center justify-center">
        <div className="text-primary">
          {icon}
        </div>
      </div>
    )}
    <h3 className="heading text-gray-900 mb-2">{title}</h3>
    <p className="body-small text-neutral">{description}</p>
  </div>
)

// Financial metric cards with specific icons
export const ProfitMetricCard = ({ title, value, trend, trendValue }) => (
  <MetricCard
    icon={<Currency size={20} className="text-success" />}
    title={title}
    value={value}
    isPositive={true}
    trend={trend}
    trendValue={trendValue}
  />
)

export const LossMetricCard = ({ title, value, trend, trendValue }) => (
  <MetricCard
    icon={<Currency size={20} className="text-danger" />}
    title={title}
    value={value}
    isPositive={false}
    trend={trend}
    trendValue={trendValue}
  />
)

export const TradeMetricCard = ({ title, value, trend, trendValue }) => (
  <MetricCard
    icon={<ChartBar size={20} className="text-primary" />}
    title={title}
    value={value}
    isPositive={null}
    trend={trend}
    trendValue={trendValue}
  />
)

export const PerformanceMetricCard = ({ title, value, trend, trendValue }) => (
  <MetricCard
    icon={<ChartLine size={20} className="text-primary" />}
    title={title}
    value={value}
    isPositive={trend === 'up'}
    trend={trend}
    trendValue={trendValue}
  />
) 