import { AnimatePresence, motion, useIsPresent, useReducedMotion, type Variants } from 'motion/react'
import { forwardRef, useLayoutEffect, useRef, type ReactNode } from 'react'
import { Navigate, Route, Routes, useLocation, useNavigationType } from 'react-router-dom'
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
import { SitePage } from './pages/SitePage'
import { SiteContentEditorPage } from './pages/SiteContentEditorPage'
import { BrandLogo } from './components/BrandLogo'
import { isAppPath } from './lib/appPaths'
import { routeSpring } from './lib/animations'

function LoadingScreen() {
  return <div className="grid min-h-dvh place-items-center bg-canvas"><div className="text-center"><BrandLogo className="mx-auto size-16 animate-pulse rounded-2xl shadow-sm ring-1 ring-black/5" /><p className="mt-4 text-sm font-semibold text-muted">Apertura del laboratorio…</p></div></div>
}

function routePosition(pathname: string) {
  const parts = pathname.split('/').filter(Boolean)
  const section = parts[0] ?? ''
  const sectionOrder: Record<string, number> = {
    '': 0,
    lavori: 1,
    agenda: 2,
    clienti: 3,
    materiali: 4,
    recuperi: 5,
    antitarlo: 6,
    statistiche: 7,
    sito: 8,
    altro: 9
  }
  return [sectionOrder[section] ?? 9, parts.length] as const
}

function navigationDirection(previousPath: string, currentPath: string, previousIndex: number | null, currentIndex: number | null, navigationType: string) {
  if (navigationType === 'POP' && previousIndex !== null && currentIndex !== null && currentIndex !== previousIndex) {
    return currentIndex > previousIndex ? 1 : -1
  }
  const previous = routePosition(previousPath)
  const current = routePosition(currentPath)
  if (current[0] !== previous[0]) return current[0] > previous[0] ? 1 : -1
  if (current[1] !== previous[1]) return current[1] > previous[1] ? 1 : -1
  return 1
}

export const RouteLayer = forwardRef<HTMLDivElement, { children: ReactNode; direction: number; reduceMotion: boolean; variants: Variants }>(function RouteLayer({ children, direction, reduceMotion, variants }, ref) {
  const isPresent = useIsPresent()

  return (
    <motion.div
      ref={ref}
      data-route-state={isPresent ? 'present' : 'exiting'}
      style={{ zIndex: isPresent ? 1 : 0 }}
      className="relative isolate min-w-0 bg-canvas"
    >
      <motion.div
        custom={direction}
        variants={variants}
        initial="initial"
        animate="animate"
        exit="exit"
        style={{ visibility: isPresent ? 'visible' : 'hidden' }}
        transition={reduceMotion ? { duration: 0 } : routeSpring}
        className="relative min-w-0"
      >
        {children}
      </motion.div>
    </motion.div>
  )
})

function AnimatedRoutes() {
  const location = useLocation()
  const navigationType = useNavigationType()
  const reduceMotion = useReducedMotion()
  const historyIndex = typeof window.history.state?.idx === 'number' ? window.history.state.idx as number : null
  const previous = useRef({ pathname: location.pathname, historyIndex })
  const direction = navigationDirection(previous.current.pathname, location.pathname, previous.current.historyIndex, historyIndex, navigationType)

  useLayoutEffect(() => {
    previous.current = { pathname: location.pathname, historyIndex }
  }, [historyIndex, location.pathname])

  const routeVariants: Variants = reduceMotion
    ? {
        initial: { x: 0, scale: 1 },
        animate: { x: 0, scale: 1 },
        exit: { x: 0, scale: 1 }
      }
    : {
        initial: (value: number) => ({ x: value * 28, scale: 0.992, zIndex: 1 }),
        animate: { x: 0, scale: 1, zIndex: 1 },
        exit: { x: 0, scale: 1, zIndex: 0 }
      }

  return (
    <div className="relative isolate min-w-0 overflow-x-clip bg-canvas">
      <AnimatePresence initial={false} mode="popLayout" custom={direction}>
        <RouteLayer key={location.pathname} direction={direction} reduceMotion={Boolean(reduceMotion)} variants={routeVariants}>
          <Routes location={location}>
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
            <Route path="/sito" element={<SitePage />} />
            <Route path="/sito/collezione/:id" element={<SiteContentEditorPage />} />
            <Route path="/sito/progetti/:id" element={<SiteContentEditorPage />} />
            <Route path="/altro" element={<MorePage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </RouteLayer>
      </AnimatePresence>
    </div>
  )
}

export default function App() {
  const { user, loading, isPasswordRecovery } = useAuth()
  if (!isSupabaseConfigured) return <SetupPage />
  if (loading) return <LoadingScreen />
  if (isPasswordRecovery || isAppPath('recupera-password')) return <PasswordRecoveryPage />
  if (!user) return <AuthPage />

  return (
    <AppShell>
      <AnimatedRoutes />
    </AppShell>
  )
}
