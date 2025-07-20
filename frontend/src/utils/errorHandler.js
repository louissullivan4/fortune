/**
 * Centralized error handling utility
 */

export const handleApiError = (error, defaultMessage = 'An unexpected error occurred') => {
  if (error.response?.data?.detail) {
    return error.response.data.detail
  } else if (error.response) {
    return `Server error: ${error.response.status}`
  } else if (error.request) {
    return 'Network error: Unable to connect to server'
  } else {
    return defaultMessage
  }
}

export const createApiError = (message) => {
  return new Error(message)
} 