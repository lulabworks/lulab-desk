import { Armchair, BarChart3, Boxes, CalendarDays, Globe2, Hammer, Home, Menu, MoreHorizontal, ShieldCheck, Users, X, LogOut } from 'lucide-react'
import { AnimatePresence, LayoutGroup, motion, useReducedMotion } from 'motion/react'
import { useState, type ReactNode } from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { navIndicatorSpring, tapSpring } from '../lib/animations'
import { BRAND } from '../lib/brand'
import { BrandLogo } from './BrandLogo'

const navigation = [
  { to: '/', label: 'Home', icon: Home, end: true },
  { to: '/lavori', label: 'Lavori', icon: Hammer },
  { to: '/agenda', label: 'Agenda', icon: CalendarDays },
  { to: '/clienti', label: 'Clienti', icon: Users },
  { to: '/materiali', label: 'Materiali', icon: Boxes },
  { to: '/recuperi', label: 'Recuperi', icon: Armchair },
  { to: '/antitarlo', label: 'Antitarlo', icon: ShieldCheck },
  { to: '/statistiche', label: 'Statistiche', icon: BarChart3 },
  { to: '/sito', label: 'Sito', icon: Globe2 },
  { to: '/altro', label: 'Altro', icon: MoreHorizontal }
]

const mobileNavigation = navigation.filter((item) => ['/', '/lavori', '/agenda', '/clienti', '/altro'].includes(item.to))
const MotionNavLink = motion.create(NavLink)

function NavItems({ onNavigate }: { onNavigate?: () => void }) {
  const reduceMotion = useReducedMotion()
  return (
    <nav className="grid gap-1">
      {navigation.map(({ to, label, icon: Icon, end }) => (
        <MotionNavLink
          key={to}
          to={to}
          end={end}
          onClick={onNavigate}
          whileTap={reduceMotion ? undefined : { scale: 0.98 }}
          transition={tapSpring}
          className={({ isActive }) =>
            `flex min-h-11 items-center gap-3 rounded-xl px-3.5 text-sm font-semibold transition ${
              isActive ? 'bg-brand text-white shadow-sm' : 'text-stone-600 hover:bg-white hover:text-ink'
            }`
          }
        >
          <Icon size={19} strokeWidth={2} />
          {label}
        </MotionNavLink>
      ))}
    </nav>
  )
}

export function AppShell({ children }: { children: ReactNode }) {
  const { user, signOut } = useAuth()
  const location = useLocation()
  const [drawerOpen, setDrawerOpen] = useState(false)
  const reduceMotion = useReducedMotion()

  return (
    <LayoutGroup id="lulab-desk-shell">
    <div className="min-h-dvh bg-canvas text-ink">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 border-r border-line bg-sidebar px-4 py-6 lg:flex lg:flex-col">
        <div className="mb-9 flex items-center gap-3 px-2">
          <BrandLogo className="size-12 rounded-2xl shadow-sm ring-1 ring-black/5" />
          <div>
            <p className="type-card-title leading-none">{BRAND.name}</p>
            <p className="mt-1 text-xs font-medium text-muted">Desk</p>
          </div>
        </div>
        <NavItems />
        <div className="mt-auto border-t border-line pt-4">
          <p className="truncate px-3 text-xs text-muted">{user?.email}</p>
          <motion.button whileTap={reduceMotion ? undefined : { scale: 0.98 }} transition={tapSpring} onClick={() => signOut()} className="mt-2 flex min-h-11 w-full items-center gap-3 rounded-xl px-3.5 text-sm font-semibold text-stone-600 hover:bg-white hover:text-ink">
            <LogOut size={18} /> Esci
          </motion.button>
        </div>
      </aside>

      <header className="sticky top-0 z-20 flex h-[calc(4rem+env(safe-area-inset-top))] items-center justify-between border-b border-line bg-canvas/90 px-4 pt-[env(safe-area-inset-top)] backdrop-blur lg:hidden">
        <div className="flex items-center gap-2.5">
          <BrandLogo className="size-10 rounded-xl shadow-sm ring-1 ring-black/5" />
          <span className="type-card-title">{BRAND.appName}</span>
        </div>
        <motion.button whileTap={reduceMotion ? undefined : { scale: 0.94 }} transition={tapSpring} className="grid size-11 place-items-center rounded-xl hover:bg-white" onClick={() => setDrawerOpen(true)} aria-label="Apri menu">
          <Menu size={22} />
        </motion.button>
      </header>

      <AnimatePresence>
      {drawerOpen && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-50 bg-ink/40 lg:hidden" onClick={() => setDrawerOpen(false)}>
          <motion.aside initial={reduceMotion ? { opacity: 0 } : { x: '100%' }} animate={reduceMotion ? { opacity: 1 } : { x: 0 }} exit={reduceMotion ? { opacity: 0 } : { x: '100%' }} transition={reduceMotion ? { duration: 0.12 } : tapSpring} className="ml-auto flex h-full w-72 flex-col bg-sidebar px-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-[max(1.25rem,env(safe-area-inset-top))] shadow-2xl" onClick={(event) => event.stopPropagation()}>
            <div className="mb-7 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <BrandLogo className="size-10 rounded-xl ring-1 ring-black/5" />
                <div><p className="type-card-title leading-none">{BRAND.appName}</p><p className="mt-1 text-[13px] font-medium text-muted">Menu</p></div>
              </div>
              <motion.button whileTap={reduceMotion ? undefined : { scale: 0.94 }} transition={tapSpring} className="grid size-10 place-items-center rounded-xl hover:bg-white" onClick={() => setDrawerOpen(false)} aria-label="Chiudi menu">
                <X size={20} />
              </motion.button>
            </div>
            <NavItems onNavigate={() => setDrawerOpen(false)} />
            <motion.button whileTap={reduceMotion ? undefined : { scale: 0.98 }} transition={tapSpring} onClick={() => signOut()} className="mt-auto flex min-h-11 items-center gap-3 rounded-xl px-3.5 text-sm font-semibold text-stone-600 hover:bg-white">
              <LogOut size={18} /> Esci
            </motion.button>
          </motion.aside>
        </motion.div>
      )}
      </AnimatePresence>

      <main className="mx-auto min-w-0 max-w-[1500px] px-4 pb-28 pt-6 sm:px-7 lg:ml-64 lg:px-10 lg:pb-10 lg:pt-9">{children}</main>

      <nav className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-5 border-t border-line bg-white/95 px-1 pb-[max(.35rem,env(safe-area-inset-bottom))] pt-1.5 backdrop-blur lg:hidden">
        {mobileNavigation.map(({ to, label, icon: Icon, end }) => (
          <MotionNavLink
            key={to}
            to={to}
            end={end}
            whileTap={reduceMotion ? undefined : { scale: 0.94 }}
            transition={tapSpring}
            className={({ isActive }) => { const active = isActive || (to === '/altro' && ['/materiali', '/recuperi', '/antitarlo', '/statistiche'].some((path) => location.pathname.startsWith(path))); return `relative flex min-h-14 flex-col items-center justify-center gap-1 rounded-xl text-[13px] font-semibold ${active ? 'text-brand' : 'text-stone-500'}` }}
          >
            {({ isActive }) => { const active = isActive || (to === '/altro' && ['/materiali', '/recuperi', '/antitarlo', '/statistiche'].some((path) => location.pathname.startsWith(path))); return <>{active && <motion.span layoutId="mobile-navigation-indicator" transition={reduceMotion ? { duration: 0 } : navIndicatorSpring} className="absolute inset-1 rounded-xl bg-brand-soft" />}<Icon className="relative z-10" size={21} strokeWidth={active ? 2.5 : 2} /><span className="relative z-10">{label}</span></> }}
          </MotionNavLink>
        ))}
      </nav>
    </div>
    </LayoutGroup>
  )
}
