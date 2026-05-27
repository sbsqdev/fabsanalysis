import { createContext, useContext, useEffect, useState, ReactNode } from 'react'
import { supabase } from './supabase'
import type { User, Session } from '@supabase/supabase-js'

interface AuthContextType {
  user: User | null
  session: Session | null
  loading: boolean
  hasAccess: boolean
  /** Register with email + password + optional phone */
  signUp: (email: string, password: string, phone?: string) => Promise<{ error: Error | null; needsEmailConfirmation: boolean }>
  /** Login with email + password */
  signIn: (email: string, password: string) => Promise<{ error: Error | null }>
  signOut: () => Promise<void>
  refreshAccess: () => Promise<void>
}

const AuthContext = createContext<AuthContextType | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(true)
  const [hasAccess, setHasAccess] = useState(false)

  async function checkAccess(userId: string) {
    const { data } = await supabase
      .from('profiles')
      .select('subscription_status')
      .eq('id', userId)
      .maybeSingle()
    setHasAccess(data?.subscription_status === 'pro')
  }

  async function refreshAccess() {
    if (user) await checkAccess(user.id)
  }

  useEffect(() => {
    supabase.auth.getSession()
      .then(({ data: { session } }) => {
        setSession(session)
        setUser(session?.user ?? null)
        if (session?.user) checkAccess(session.user.id).finally(() => setLoading(false))
        else setLoading(false)
      })
      .catch(() => {
        // Network error or bad config — treat as logged out
        setLoading(false)
      })

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session)
      setUser(session?.user ?? null)
      if (session?.user) void checkAccess(session.user.id)
      else { setHasAccess(false) }
    })

    return () => subscription.unsubscribe()
  }, [])

  async function signUp(email: string, password: string, phone?: string) {
    const { data, error } = await supabase.auth.signUp({ email, password })

    // Create profile row immediately (also covered by DB trigger as fallback)
    if (!error && data.user) {
      await supabase.from('profiles').upsert(
        {
          id: data.user.id,
          email,
          ...(phone ? { phone } : {}),
          subscription_status: 'pending', // requires Kaspi payment to become 'pro'
          created_at: new Date().toISOString(),
        },
        { onConflict: 'id' },
      )
    }

    // If session is present right away → email autoconfirm is enabled, user is logged in
    const needsEmailConfirmation = !error && !!data.user && !data.session
    return { error, needsEmailConfirmation }
  }

  async function signIn(email: string, password: string) {
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    return { error }
  }

  async function signOut() {
    await supabase.auth.signOut()
  }

  return (
    <AuthContext.Provider value={{ user, session, loading, hasAccess, signIn, signUp, signOut, refreshAccess }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
