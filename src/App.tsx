import { Navigate, Route, Routes } from 'react-router-dom'
import { AppShell } from './components/AppShell'
import { useAuth } from './contexts/AuthContext'
import { isSupabaseConfigured } from './lib/supabase'
import { AgendaPage } from './pages/AgendaPage'
import { AuthPage } from './pages/AuthPage'
import { CustomersPage } from './pages/CustomersPage'
import { DashboardPage } from './pages/DashboardPage'
import { JobDetailPage } from './pages/JobDetailPage'
import { JobsPage } from './pages/JobsPage'
import { MorePage } from './pages/MorePage'
import { PasswordRecoveryPage } from './pages/PasswordRecoveryPage'
import { QuoteEditorPage } from './pages/QuoteEditorPage'
import { SetupPage } from './pages/SetupPage'
import { MaterialsPage } from './pages/MaterialsPage'
import { RecoveriesPage } from './pages/RecoveriesPage'
import { RecoveryDetailPage } from './pages/RecoveryDetailPage'
import { AntitarloPage } from './pages/AntitarloPage'
import { StatisticsPage } from './pages/StatisticsPage'
import { BrandLogo } from './components/BrandLogo'
import { isAppPath } from './lib/appPaths'

function LoadingScreen() {
  return <div className="grid min-h-dvh place-items-center bg-canvas"><div className="text-center"><BrandLogo className="mx-auto size-16 animate-pulse rounded-2xl shadow-sm ring-1 ring-black/5" /><p className="mt-4 text-sm font-semibold text-muted">Apertura del laboratorio…</p></div></div>
}

export default function App() {
  const { user, loading, isPasswordRecovery } = useAuth()
  if (!isSupabaseConfigured) return <SetupPage />
  if (loading) return <LoadingScreen />
  if (isPasswordRecovery || isAppPath('recupera-password')) return <PasswordRecoveryPage />
  if (!user) return <AuthPage />

  return (
    <AppShell>
      <Routes>
        <Route path="/" element={<DashboardPage />} />
        <Route path="/lavori" element={<JobsPage />} />
        <Route path="/lavori/:id/preventivi/:quoteId" element={<QuoteEditorPage />} />
        <Route path="/lavori/:id" element={<JobDetailPage />} />
        <Route path="/agenda" element={<AgendaPage />} />
        <Route path="/clienti" element={<CustomersPage />} />
        <Route path="/materiali" element={<MaterialsPage />} />
        <Route path="/recuperi" element={<RecoveriesPage />} />
        <Route path="/recuperi/:id" element={<RecoveryDetailPage />} />
        <Route path="/antitarlo" element={<AntitarloPage />} />
        <Route path="/statistiche" element={<StatisticsPage />} />
        <Route path="/altro" element={<MorePage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AppShell>
  )
}
