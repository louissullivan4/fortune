import axios from 'axios'

const API_BASE_URL = '/api'

const api = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
})

export const analyzePerformance = async (initialCapital) => {
  try {
    const response = await api.post('/analysis', {
      initial_capital: initialCapital
    })
    return response.data
  } catch (error) {
    if (error.response) {
      throw new Error(`Server error: ${error.response.status}`)
    } else if (error.request) {
      throw new Error('Network error: Unable to connect to server')
    } else {
      throw new Error('An unexpected error occurred')
    }
  }
}

export const getSignals = async () => {
  try {
    const response = await api.get('/signals')
    return response.data
  } catch (error) {
    throw new Error('Failed to fetch signals')
  }
}

export const getTrades = async () => {
  try {
    const response = await api.get('/trades')
    return response.data
  } catch (error) {
    throw new Error('Failed to fetch trades')
  }
} 