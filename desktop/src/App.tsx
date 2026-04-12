import { HashRouter, Routes, Route, Navigate } from 'react-router-dom'
import DashboardPage from './pages/DashboardPage'
import EditorPage from './pages/EditorPage'
import { useGlobalShortcut } from './hooks/useGlobalShortcut'

export default function App() {
  useGlobalShortcut()

  return (
    <HashRouter>
      <Routes>
        <Route path="/" element={<Navigate to="/dashboard" replace />} />
        <Route path="/dashboard" element={<DashboardPage />} />
        <Route path="/mandalart/:id" element={<EditorPage />} />
      </Routes>
    </HashRouter>
  )
}
