import { useEffect, useRef, useState } from 'react'
import { HashRouter, Routes, Route, Navigate } from 'react-router-dom'
import DashboardPage from './pages/DashboardPage'
import EditorPage from './pages/EditorPage'
import ErrorBoundary from './components/ErrorBoundary'
import UpdateDialog from './components/UpdateDialog'
import ConvergeOverlay from './components/ConvergeOverlay'
import HelpDialog from './components/help/HelpDialog'
import Toast from './components/ui/Toast'
import { useBootstrapStore } from './store/bootstrapStore'
import { useVaultStore } from './store/vaultStore'
import { loadVaultConfig, shouldRebuildOnStartup } from './lib/vault/config'
import { reconcileVaultToDb } from './lib/vault/_vaultSync'
import { useGlobalShortcut } from './hooks/useGlobalShortcut'
import { useAppUpdate } from './hooks/useAppUpdate'
import { useAuthBootstrap } from './hooks/useAuthBootstrap'
import { useVisibilityResync } from './hooks/useVisibilityResync'
import { useTheme } from './hooks/useTheme'
import { useBeforeQuit } from './hooks/useBeforeQuit'
import { useCloudEmptyCellsCleanup } from './hooks/useCloudEmptyCellsCleanup'
import { useCloudFoldersCleanup } from './hooks/useCloudFoldersCleanup'
import { useWelcomeOnFirstRun } from './hooks/useWelcomeOnFirstRun'
import { useVaultAutoFlush } from './hooks/useVaultAutoFlush'
import { initVaultDevMode } from './lib/vault/dev'

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
  useVisibilityResync()
  useTheme()
  useBeforeQuit()
  useCloudEmptyCellsCleanup()
  useCloudFoldersCleanup()
  useVaultAutoFlush()
  const { status, downloadAndInstall, dismiss } = useAppUpdate()

  // Phase 2 P3: 起動 bootstrap。vaultMode ON なら Routes 描画前に vault→DB 再構築をブロック実行する。
  const ready = useBootstrapStore((s) => s.ready)
  const setReady = useBootstrapStore((s) => s.setReady)
  const vaultRebuildError = useBootstrapStore((s) => s.vaultRebuildError)
  const setVaultRebuildError = useBootstrapStore((s) => s.setVaultRebuildError)
  const bootstrappedRef = useRef(false)

  useEffect(() => {
    if (bootstrappedRef.current) return // StrictMode の二重実行・再 mount を抑止
    bootstrappedRef.current = true
    void (async () => {
      try {
        const cfg = await loadVaultConfig()
        // 同期フック等が同期的に vaultMode を読めるよう in-memory ストアへミラー (ready 前に確定)。
        useVaultStore.getState().setVault({ vaultMode: cfg.vaultMode, vaultPath: cfg.vaultPath })
        if (shouldRebuildOnStartup(cfg) && cfg.vaultPath) {
          // vault を正として DB を作り直す (実 DB 書込み)。失敗しても既存 DB で続行する。
          try {
            const report = await reconcileVaultToDb(cfg.vaultPath)
            console.info('[bootstrap] vault→DB 再構築:', report)
          } catch (e) {
            console.error('[bootstrap] vault→DB 再構築に失敗:', e)
            setVaultRebuildError('vault からの再構築に失敗しました。これまでのデータで起動します。')
          }
        }
      } catch (e) {
        console.error('[bootstrap] vault config 読込に失敗:', e)
      } finally {
        setReady() // 成否に関わらず必ず ready にしてアプリを固めない
      }
    })()
  }, [setReady, setVaultRebuildError])

  // Welcome / Help dialog state
  const welcome = useWelcomeOnFirstRun()
  const [helpMode, setHelpMode] = useState<HelpMode>(null)

  // 初回起動時に welcome を出す
  useEffect(() => {
    if (welcome.shouldShow && helpMode === null) {
      setHelpMode('welcome')
    }
  }, [welcome.shouldShow, helpMode])

  // Phase 2 vault モードの dev エントリ。localStorage フラグ off (= 通常) なら完全 no-op。
  useEffect(() => {
    initVaultDevMode()
  }, [])

  // Tauri menu「ヘルプ」→「使い方を見る」 (id='help.show') を購読 → manual で開く。
  // event 名は `menu:help-show` (ハイフン区切り)。Tauri v2 の event 名は `.` を含められない
  // (英数字 / `-` / `/` / `:` / `_` のみ許可、含むと listen 登録自体が失敗する)。
  useEffect(() => {
    let unlisten: (() => void) | undefined
    void import('@tauri-apps/api/event').then(({ listen }) => {
      void listen('menu:help-show', () => {
        setHelpMode('manual')
      }).then((u) => { unlisten = u })
    })
    return () => { unlisten?.() }
  }, [])

  // ready になるまでは Routes を描画しない (vaultMode ON の起動 rebuild を完了させてから
  // 全ページの初回 DB 読取を走らせる)。vaultMode false なら rebuild 無しで即 ready。
  if (!ready) {
    return (
      <ErrorBoundary>
        <div className="min-h-screen flex items-center justify-center bg-white dark:bg-neutral-900 text-neutral-400 dark:text-neutral-500">
          初期化中…
        </div>
      </ErrorBoundary>
    )
  }

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
      {/* vault 再構築失敗の警告 (既存 DB で続行している旨)。route 非依存で出す。 */}
      {vaultRebuildError && (
        <Toast
          message={vaultRebuildError}
          type="error"
          duration={8000}
          onClose={() => setVaultRebuildError(null)}
        />
      )}
    </ErrorBoundary>
  )
}
