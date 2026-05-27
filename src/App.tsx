import { lazy, Suspense } from 'react'
import { BrowserRouter, Navigate, Routes, Route } from 'react-router-dom'
import { AuthProvider } from './lib/auth'
import ProtectedRoute from './components/auth/ProtectedRoute'
import { authBypassEnabled } from './lib/authBypass'
import LandingPage from './pages/LandingPage'
import LoginPage from './pages/LoginPage'
import RegisterPage from './pages/RegisterPage'
import DashboardPage from './pages/DashboardPage'
import AnalysisPage from './pages/AnalysisPage'
import AnalysisDetailPage from './pages/AnalysisDetailPage'
import AnalysisFeaturePage from './pages/AnalysisFeaturePage'
import SuccessPage from './pages/SuccessPage'
import ForgotPasswordPage from './pages/ForgotPasswordPage'
import ResetPasswordPage from './pages/ResetPasswordPage'

const DevProportionOverlayPage = import.meta.env.DEV
  ? lazy(() => import('./pages/DevProportionOverlayPage'))
  : null

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={authBypassEnabled ? <Navigate to="/analysis" replace /> : <LandingPage />} />
          {/* Preview landing page even in dev mode */}
          <Route path="/landing" element={<LandingPage />} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/register" element={<RegisterPage />} />
          <Route path="/forgot-password" element={<ForgotPasswordPage />} />
          <Route path="/reset-password" element={<ResetPasswordPage />} />
          <Route path="/success" element={<SuccessPage />} />
          <Route
            path="/dashboard"
            element={
              <ProtectedRoute>
                <DashboardPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/analysis"
            element={
              <ProtectedRoute>
                <AnalysisPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/analysis/:id"
            element={
              <ProtectedRoute>
                <AnalysisDetailPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/analysis/:id/feature/:featureName"
            element={
              <ProtectedRoute>
                <AnalysisFeaturePage />
              </ProtectedRoute>
            }
          />
          {import.meta.env.DEV && DevProportionOverlayPage && (
            <Route
              path="/dev/proportion-overlay"
              element={
                <Suspense fallback={null}>
                  <DevProportionOverlayPage />
                </Suspense>
              }
            />
          )}
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  )
}
