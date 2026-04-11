import {
  createContext,
  useContext,
  useState,
  useCallback,
  type ReactNode,
} from 'react'

export interface AuthUser {
  userId: string
  email: string
  role: 'admin' | 'client'
}

interface AuthContextValue {
  user: AuthUser | null
  accessToken: string | null
  login: (email: string, password: string) => Promise<void>
  logout: () => Promise<void>
  setAuth: (token: string, user: AuthUser) => void
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null)
  const [accessToken, setAccessToken] = useState<string | null>(null)

  const setAuth = useCallback((token: string, u: AuthUser) => {
    setAccessToken(token)
    setUser(u)
  }, [])

  const login = useCallback(async (email: string, password: string) => {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ email, password }),
    })
    if (!res.ok) {
      const body = await res.json().catch(() => ({ error: 'Login failed' }))
      throw new Error(body.error ?? 'Login failed')
    }
    const data = await res.json()
    setAccessToken(data.accessToken)
    setUser(data.user)
  }, [])

  const logout = useCallback(async () => {
    await fetch('/api/auth/logout', {
      method: 'POST',
      credentials: 'include',
    }).catch(() => {})
    setAccessToken(null)
    setUser(null)
  }, [])

  return (
    <AuthContext.Provider value={{ user, accessToken, login, logout, setAuth }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider')
  return ctx
}
