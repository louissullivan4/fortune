import React from "react";

/**
 * Card System - IBM Carbon Design System
 * Comprehensive card components for different content types
 */

const Card = ({
  children,
  variant = "default",
  interactive = false,
  className = "",
  ...props
}) => {
  const baseClasses = "bg-white rounded-lg border transition-all duration-200";

  const variantClasses = {
    default: "border-gray-200 shadow-sm",
    interactive:
      "border-gray-200 shadow-sm hover:shadow-md hover:border-gray-300 cursor-pointer",
    metric: "border-gray-200 shadow-sm",
    status: "border-gray-200 shadow-sm",
    content: "border-gray-200 shadow-sm",
  };

  const classes = [
    baseClasses,
    interactive ? variantClasses.interactive : variantClasses[variant],
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={classes} {...props}>
      {children}
    </div>
  );
};

// Metric Card for displaying key performance indicators
export const MetricCard = ({
  title,
  value,
  subtitle,
  trend,
  trendValue,
  icon,
  status = "neutral",
  className = "",
}) => {
  const statusClasses = {
    positive: "text-success-green",
    negative: "text-danger-red",
    neutral: "text-gray-70",
  };

  const trendIcon = trend === "up" ? "↗" : trend === "down" ? "↘" : null;

  return (
    <Card variant="metric" className={`p-6 ${className}`}>
      <div className="flex items-start justify-between">
        <div className="flex-1">
          <div className="flex items-center mb-2">
            {icon && (
              <div className="mr-3 p-2 bg-primary-accent-light rounded-lg">
                {icon}
              </div>
            )}
            <div>
              <h3 className="caption text-gray-70 font-medium uppercase tracking-wide">
                {title}
              </h3>
              {subtitle && (
                <p className="body-small text-gray-70 mt-1">{subtitle}</p>
              )}
            </div>
          </div>
          <div className="flex items-baseline">
            <span className="display-small font-semibold text-gray-90">
              {value}
            </span>
            {trend && trendValue && (
              <span
                className={`ml-2 body-small font-medium ${statusClasses[status]}`}
              >
                {trendIcon} {trendValue}
              </span>
            )}
          </div>
        </div>
      </div>
    </Card>
  );
};

// Content Card for general content display
export const ContentCard = ({
  title,
  subtitle,
  children,
  actions,
  className = "",
}) => {
  return (
    <Card variant="content" className={className}>
      {(title || subtitle || actions) && (
        <div className="px-6 py-4 border-b border-gray-20">
          <div className="flex items-center justify-between">
            <div>
              {title && <h3 className="heading text-gray-90">{title}</h3>}
              {subtitle && (
                <p className="body-small text-gray-70 mt-1">{subtitle}</p>
              )}
            </div>
            {actions && (
              <div className="flex items-center space-x-2">{actions}</div>
            )}
          </div>
        </div>
      )}
      <div className="p-6">{children}</div>
    </Card>
  );
};

// Status Card for displaying status information
export const StatusCard = ({
  title,
  status,
  message,
  icon,
  actions,
  className = "",
}) => {
  const statusConfig = {
    success: {
      color: "text-success-green",
      bg: "bg-success-green-light",
      border: "border-success-green",
    },
    warning: {
      color: "text-warning-orange",
      bg: "bg-orange-50",
      border: "border-warning-orange",
    },
    error: {
      color: "text-danger-red",
      bg: "bg-danger-red-light",
      border: "border-danger-red",
    },
    info: {
      color: "text-primary-teal",
      bg: "bg-primary-accent-light",
      border: "border-primary-teal",
    },
  };

  const config = statusConfig[status] || statusConfig.info;

  return (
    <Card
      variant="status"
      className={`border-l-4 ${config.border} ${className}`}
    >
      <div className="p-4">
        <div className="flex items-start">
          {icon && (
            <div className={`mr-3 p-2 rounded-lg ${config.bg}`}>
              <div className={config.color}>{icon}</div>
            </div>
          )}
          <div className="flex-1">
            <h3 className={`heading font-semibold ${config.color}`}>{title}</h3>
            {message && (
              <p className="body-small text-gray-70 mt-1">{message}</p>
            )}
            {actions && (
              <div className="flex items-center space-x-2 mt-3">{actions}</div>
            )}
          </div>
        </div>
      </div>
    </Card>
  );
};

// Interactive Card for clickable content
export const InteractiveCard = ({ children, onClick, className = "" }) => {
  return (
    <Card
      interactive
      className={`cursor-pointer ${className}`}
      onClick={onClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onClick?.();
        }
      }}
    >
      {children}
    </Card>
  );
};

// Feature Card for displaying feature information
export const FeatureCard = ({ icon, title, description, className = "" }) => {
  return (
    <Card variant="content" className={`text-center p-6 ${className}`}>
      {icon && (
        <div className="mx-auto mb-4 p-3 bg-primary-accent-light rounded-lg w-12 h-12 flex items-center justify-center">
          <div className="text-primary-teal text-xl">{icon}</div>
        </div>
      )}
      <h3 className="heading text-gray-90 mb-2">{title}</h3>
      <p className="body-small text-gray-70">{description}</p>
    </Card>
  );
};

export default Card;
