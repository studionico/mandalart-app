import { useEffect, useState } from 'react'
import { HashRouter, Routes, Route, Navigate } from 'react-router-dom'
import DashboardPage from './pages/DashboardPage'
import EditorPage from './pages/EditorPage'
import ErrorBoundary from './components/ErrorBoundary'
import UpdateDialog from './components/UpdateDialog'
import ConvergeOverlay from './components/ConvergeOverlay'
import HelpDialog from './components/help/HelpDialog'
import { useGlobalShortcut } from './hooks/useGlobalShortcut'
import { useAppUpdate } from './hooks/useAppUpdate'
import { useAuthBootstrap } from './hooks/useAuthBootstrap'
import { useTheme } from './hooks/useTheme'
import { useBeforeQuit } from './hooks/useBeforeQuit'
import { useCloudEmptyCellsCleanup } from './hooks/useCloudEmptyCellsCleanup'
import { useCloudFoldersCleanup } from './hooks/useCloudFoldersCleanup'
import { useWelcomeOnFirstRun } from './hooks/useWelcomeOnFirstRun'

/**
 * Help / Welcome モーダルの表示モード。
 * - `'welcome'`: 初回起動 (auto-advance ON、「次回以降表示しない」チェックボックス表示)
 * - `'manual'`: メニューから手動再表示 (auto-advance OFF、checkbox なし)
 * - `null`: 非表示
 */
type HelpMode = 'welcome' | 'manual' | null

export default function App() {
  useGlobalShortcut()
  useAuthBootstrap()
  useTheme()
  useBeforeQuit()
  useCloudEmptyCellsCleanup()
  useCloudFoldersCleanup()
  const { status, downloadAndInstall, dismiss } = useAppUpdate()

  // Welcome / Help dialog state
  const welcome = useWelcomeOnFirstRun()
  const [helpMode, setHelpMode] = useState<HelpMode>(null)

  // 初回起動時に welcome を出す
  useEffect(() => {
    if (welcome.shouldShow && helpMode === null) {
      setHelpMode('welcome')
    }
  }, [welcome.shouldShow, helpMode])

  // Tauri menu「ヘルプ」→「使い方を見る」 (id='help.show') を購読 → manual で開く
  useEffect(() => {
    let unlisten: (() => void) | undefined
    void import('@tauri-apps/api/event').then(({ listen }) => {
      void listen('menu:help.show', () => {
        setHelpMode('manual')
      }).then((u) => { unlisten = u })
    })
    return () => { unlisten?.() }
  }, [])

  return (
    <ErrorBoundary>
      <HashRouter>
        <Routes>
          <Route path="/" element={<Navigate to="/dashboard" replace />} />
          <Route path="/dashboard" element={<DashboardPage />} />
          <Route path="/mandalart/:id" element={<EditorPage />} />
        </Routes>
        <UpdateDialog status={status} onInstall={downloadAndInstall} onDismiss={dismiss} />
        <HelpDialog
          open={helpMode !== null}
          onClose={() => setHelpMode(null)}
          autoAdvance={helpMode === 'welcome'}
          showDontShowAgain={helpMode === 'welcome'}
          onDismiss={(persist) => welcome.dismiss(persist)}
        />
        {/* マンダラート → カード収束アニメ用 overlay。route 切替で unmount しないよう
            Routes の隣に置く (アニメ中の DOM が遷移を跨いで保持される) */}
        <ConvergeOverlay />
      </HashRouter>
    </ErrorBoundary>
  )
}
