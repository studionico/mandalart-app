import { useEffect, useState } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import DashboardPage from './pages/DashboardPage'
import EditorPage from './pages/EditorPage'
import AuthCallbackPage from './pages/AuthCallbackPage'
import ErrorBoundary from './components/ErrorBoundary'
import ConvergeOverlay from './components/ConvergeOverlay'
import HelpDialog from './components/help/HelpDialog'
import { useAuthBootstrap } from './hooks/useAuthBootstrap'
import { useVisibilityResync } from './hooks/useVisibilityResync'
import { useRealtimeSync } from './hooks/useRealtimeSync'
import { useTheme } from './hooks/useTheme'
import { useBeforeQuit } from './hooks/useBeforeQuit'
import { useCloudEmptyCellsCleanup } from './hooks/useCloudEmptyCellsCleanup'
import { useCloudFoldersCleanup } from './hooks/useCloudFoldersCleanup'
import { useWelcomeOnFirstRun } from './hooks/useWelcomeOnFirstRun'

type HelpMode = 'welcome' | 'manual' | null

export default function App() {
  useAuthBootstrap()
  useRealtimeSync()
  useVisibilityResync()
  useTheme()
  useBeforeQuit()
  useCloudEmptyCellsCleanup()
  useCloudFoldersCleanup()

  const welcome = useWelcomeOnFirstRun()
  const [helpMode, setHelpMode] = useState<HelpMode>(null)

  useEffect(() => {
    if (welcome.shouldShow && helpMode === null) {
      setHelpMode('welcome')
    }
  }, [welcome.shouldShow, helpMode])

  return (
    <ErrorBoundary>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Navigate to="/dashboard" replace />} />
          <Route path="/dashboard" element={<DashboardPage />} />
          <Route path="/mandalart/:id" element={<EditorPage />} />
          <Route path="/auth/callback" element={<AuthCallbackPage />} />
        </Routes>
        <HelpDialog
          open={helpMode !== null}
          onClose={() => setHelpMode(null)}
          autoAdvance={helpMode === 'welcome'}
          showDontShowAgain={helpMode === 'welcome'}
          onDismiss={(persist) => welcome.dismiss(persist)}
        />
        <ConvergeOverlay />
      </BrowserRouter>
    </ErrorBoundary>
  )
}
