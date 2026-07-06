import { lazy, Suspense, useCallback, useEffect, useState } from 'react'
import NavBar from './components/layout/NavBar'
import MainLayout from './components/layout/MainLayout'
import ConfirmDialog from './components/shared/ConfirmDialog'
import ErrorBoundary from './components/shared/ErrorBoundary'
import SetupPage from './components/auth/SetupPage'
import LoginPage from './components/auth/LoginPage'
import useAuthStore from './stores/authStore'
import useSettingsStore from './stores/settingsStore'
import useUiStore from './stores/uiStore'
import SettingsOverlay from './components/settings/SettingsOverlay'
import ToastStack from './components/ui/ToastStack'
import ConnectionBanner from './components/ui/ConnectionBanner'
import { getPtyFeature } from './api/admin'
import safeStorage from './utils/safeStorage'

const IntroPanel = lazy(() => import('./components/intro/IntroPanel'))
const SetupWizardModal = lazy(() => import('./components/chat/SetupWizardModal'))

const INTRO_SEEN_KEY_PREFIX = 'vivian-intro-seen'

function getIntroSeenKey(user) {
  return user?.username ? `${INTRO_SEEN_KEY_PREFIX}:${user.username}` : null
}

export default function App() {
  const loading = useAuthStore((s) => s.loading)
  const needsSetup = useAuthStore((s) => s.needsSetup)
  const user = useAuthStore((s) => s.user)
  const initialize = useAuthStore((s) => s.initialize)
  const logout = useAuthStore((s) => s.logout)
  const hasEnv = useSettingsStore((s) => s.hasEnv)
  const fetchEnvStatus = useSettingsStore((s) => s.fetchEnvStatus)
  const fetchEnv = useSettingsStore((s) => s.fetchEnv)
  const fetchVisionModel = useSettingsStore((s) => s.fetchVisionModel)
  const openIntro = useUiStore((s) => s.openIntro)
  const introOpen = useUiStore((s) => s.introOpen)
  const setTerminalFeatureEnabled = useUiStore((s) => s.setTerminalFeatureEnabled)
  const [showSetupWizard, setShowSetupWizard] = useState(false)

  useEffect(() => {
    const stored = safeStorage.getItem('theme') || 'light'
    document.documentElement.dataset.theme = stored
  }, [])

  useEffect(() => {
    initialize()
  }, [initialize])

  useEffect(() => {
    const handler = () => logout()
    window.addEventListener('auth:unauthorized', handler)
    return () => window.removeEventListener('auth:unauthorized', handler)
  }, [logout])

  // Check env status after login
  useEffect(() => {
    if (user) {
      fetchEnvStatus().then((has) => {
        if (has) {
          // Also fetch full env for model selector defaults
          fetchEnv()
        }
      })
      fetchVisionModel()
      getPtyFeature()
        .then((data) => setTerminalFeatureEnabled(!!data?.enabled))
        .catch(() => setTerminalFeatureEnabled(false))
    }
  }, [user, fetchEnvStatus, fetchEnv, fetchVisionModel, setTerminalFeatureEnabled])

  const maybeAutoOpenIntro = useCallback((currentUser) => {
    const key = getIntroSeenKey(currentUser)
    if (!key || safeStorage.getItem(key)) return

    safeStorage.setItem(key, String(Date.now()))
    openIntro()
  }, [openIntro])

  // Show setup wizard if user has no env configured.
  // After the initial setup flow is completed or skipped, auto-open the intro once.
  useEffect(() => {
    if (!user) {
      setShowSetupWizard(false)
      return
    }

    if (hasEnv == null) return

    if (hasEnv === false) {
      const dismissed = safeStorage.getItem('env-setup-dismissed')
      if (dismissed) {
        const elapsed = Date.now() - parseInt(dismissed, 10)
        if (elapsed < 24 * 60 * 60 * 1000) {
          setShowSetupWizard(false)
          maybeAutoOpenIntro(user)
          return
        }
      }

      if (!showSetupWizard) {
        setShowSetupWizard(true)
      }
      return
    }

    if (showSetupWizard) return
    maybeAutoOpenIntro(user)
  }, [user, hasEnv, maybeAutoOpenIntro, showSetupWizard])

  const handleSetupWizardComplete = useCallback(() => {
    setShowSetupWizard(false)
    maybeAutoOpenIntro(user)
  }, [maybeAutoOpenIntro, user])

  if (loading) {
    return <div style={{ minHeight: '100vh', background: 'var(--bg-base)' }} />
  }

  if (needsSetup && !user) {
    return <SetupPage />
  }

  if (!user) {
    return <LoginPage />
  }

  return (
    <>
      <ConnectionBanner />
      <ErrorBoundary resetKey={user?.username}>
        <NavBar />
        <MainLayout />
      </ErrorBoundary>
      <ConfirmDialog />
      <SettingsOverlay />
      <ToastStack />
      {introOpen && (
        <Suspense fallback={null}>
          <IntroPanel />
        </Suspense>
      )}
      {showSetupWizard && (
        <Suspense fallback={null}>
          <SetupWizardModal onComplete={handleSetupWizardComplete} />
        </Suspense>
      )}
    </>
  )
}
