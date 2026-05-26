import { Navigate } from 'react-router-dom'
import { useAuth } from '../../lib/auth'
import { authBypassEnabled } from '../../lib/authBypass'
import { useT } from '../../lib/language'

interface ProtectedRouteProps {
  children: React.ReactNode
  requireAccess?: boolean
}

export default function ProtectedRoute({ children, requireAccess = false }: ProtectedRouteProps) {
  const { user, loading, hasAccess } = useAuth()
  const t = useT()

  if (authBypassEnabled) return <>{children}</>

  if (loading) {
    return (
      <div className="min-h-screen bg-cream flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <div className="w-8 h-8 border-2 border-charcoal border-t-transparent rounded-full animate-spin" />
          <p className="text-muted text-sm font-sans">{t('protected.loading')}</p>
        </div>
      </div>
    )
  }

  if (!user) return <Navigate to="/login" replace />
  if (requireAccess && !hasAccess) return <Navigate to="/#pricing" replace />

  return <>{children}</>
}
