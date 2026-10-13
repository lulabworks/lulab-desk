import { LoaderCircle, X } from 'lucide-react'
import { AnimatePresence, motion, useReducedMotion, type HTMLMotionProps } from 'motion/react'
import { useEffect, useId, useRef, useState, type InputHTMLAttributes, type KeyboardEvent as ReactKeyboardEvent, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react'
import { createPortal } from 'react-dom'
import { sheetSpring, tapSpring } from '../lib/animations'

type ModalViewport = { top: number; left: number; width: number; height: number }

type ModalLockSnapshot = {
  scrollY: number
  restoreFocus: HTMLElement | null
  bodyOverflow: string
  bodyPosition: string
  bodyTop: string
  bodyLeft: string
  bodyRight: string
  bodyWidth: string
  bodyPaddingRight: string
  htmlOverflow: string
  rootAriaHidden: string | null
  rootWasInert: boolean
}

let activeModalLocks = 0
let modalLockSnapshot: ModalLockSnapshot | null = null
let restoreFocusFrame = 0

function readModalViewport(): ModalViewport {
  if (typeof window === 'undefined') return { top: 0, left: 0, width: 0, height: 0 }
  const viewport = window.visualViewport
  return {
    top: viewport?.offsetTop ?? 0,
    left: viewport?.offsetLeft ?? 0,
    width: viewport?.width ?? window.innerWidth,
    height: viewport?.height ?? window.innerHeight
  }
}

function lockPageForModal(restoreFocus: HTMLElement | null) {
  if (restoreFocusFrame) cancelAnimationFrame(restoreFocusFrame)
  if (activeModalLocks === 0) {
    const { body, documentElement } = document
    const appRoot = document.getElementById('root')
    const scrollY = window.scrollY
    modalLockSnapshot = {
      scrollY,
      restoreFocus,
      bodyOverflow: body.style.overflow,
      bodyPosition: body.style.position,
      bodyTop: body.style.top,
      bodyLeft: body.style.left,
      bodyRight: body.style.right,
      bodyWidth: body.style.width,
      bodyPaddingRight: body.style.paddingRight,
      htmlOverflow: documentElement.style.overflow,
      rootAriaHidden: appRoot?.getAttribute('aria-hidden') ?? null,
      rootWasInert: appRoot?.hasAttribute('inert') ?? false
    }

    const scrollbarWidth = Math.max(0, window.innerWidth - documentElement.clientWidth)
    documentElement.style.overflow = 'hidden'
    body.style.overflow = 'hidden'
    body.style.position = 'fixed'
    body.style.top = `-${scrollY}px`
    body.style.left = '0'
    body.style.right = '0'
    body.style.width = '100%'
    if (scrollbarWidth > 0) body.style.paddingRight = `${scrollbarWidth}px`
    appRoot?.setAttribute('aria-hidden', 'true')
    appRoot?.setAttribute('inert', '')
  }
  activeModalLocks += 1
}

function unlockPageForModal() {
  activeModalLocks = Math.max(0, activeModalLocks - 1)
  if (activeModalLocks > 0 || !modalLockSnapshot) return

  const snapshot = modalLockSnapshot
  const { body, documentElement } = document
  const appRoot = document.getElementById('root')
  body.style.overflow = snapshot.bodyOverflow
  body.style.position = snapshot.bodyPosition
  body.style.top = snapshot.bodyTop
  body.style.left = snapshot.bodyLeft
  body.style.right = snapshot.bodyRight
  body.style.width = snapshot.bodyWidth
  body.style.paddingRight = snapshot.bodyPaddingRight
  documentElement.style.overflow = snapshot.htmlOverflow
  if (snapshot.rootAriaHidden === null) appRoot?.removeAttribute('aria-hidden')
  else appRoot?.setAttribute('aria-hidden', snapshot.rootAriaHidden)
  if (!snapshot.rootWasInert) appRoot?.removeAttribute('inert')
  window.scrollTo(0, snapshot.scrollY)
  modalLockSnapshot = null

  restoreFocusFrame = requestAnimationFrame(() => {
    if (activeModalLocks === 0 && snapshot.restoreFocus?.isConnected) snapshot.restoreFocus.focus({ preventScroll: true })
    restoreFocusFrame = 0
  })
}

function focusableElements(container: HTMLElement) {
  return Array.from(container.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'))
    .filter((element) => element.getClientRects().length > 0 && element.getAttribute('aria-hidden') !== 'true')
}

export function Button({
  className = '',
  variant = 'primary',
  loading = false,
  children,
  disabled,
  ...props
}: Omit<HTMLMotionProps<'button'>, 'children'> & {
  children?: ReactNode
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger'
  loading?: boolean
}) {
  const reduceMotion = useReducedMotion()
  const tones = {
    primary: 'bg-brand text-white hover:bg-brand-dark shadow-sm',
    secondary: 'bg-white text-ink border border-line hover:bg-stone-50',
    ghost: 'text-muted hover:bg-stone-100 hover:text-ink',
    danger: 'bg-red-600 text-white hover:bg-red-700'
  }
  return (
    <motion.button
      whileTap={reduceMotion || disabled || loading ? undefined : { scale: 0.98 }}
      transition={tapSpring}
      className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-[15px] font-semibold leading-5 transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand disabled:cursor-not-allowed disabled:opacity-55 ${tones[variant]} ${className}`}
      disabled={disabled || loading}
      {...props}
    >
      {loading && <LoaderCircle size={17} className="animate-spin" />}
      {children}
    </motion.button>
  )
}

export function Field({ label, hint, error, children }: { label: string; hint?: string; error?: string; children: ReactNode }) {
  return (
    <label className="grid gap-1.5 text-sm font-medium text-ink">
      <span>{label}</span>
      {children}
      {error ? <span className="text-xs text-red-700">{error}</span> : hint ? <span className="text-xs font-normal text-muted">{hint}</span> : null}
    </label>
  )
}

const fieldClass =
  'min-h-11 w-full rounded-xl border border-line bg-white px-3.5 py-2.5 text-base text-ink outline-none transition placeholder:text-stone-400 focus:border-brand focus:ring-3 focus:ring-brand/10'

export function Input({ className = '', ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={`${fieldClass} ${className}`} {...props} />
}

export function Select({ className = '', ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={`${fieldClass} ${className}`} {...props} />
}

export function Textarea({ className = '', ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={`${fieldClass} min-h-28 resize-y ${className}`} {...props} />
}

export function Panel({ className = '', children }: { className?: string; children: ReactNode }) {
  return <section className={`min-w-0 max-w-full rounded-2xl border border-line bg-white p-5 shadow-card ${className}`}>{children}</section>
}

export function PageHeader({ eyebrow, title, description, action }: { eyebrow?: string; title: string; description?: string; action?: ReactNode }) {
  return (
    <header className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div>
        {eyebrow && <p className="section-kicker">{eyebrow}</p>}
        <h1 className="type-page-title text-ink">{title}</h1>
        {description && <p className="mt-2 max-w-2xl text-sm leading-6 text-muted">{description}</p>}
      </div>
      {action}
    </header>
  )
}

export function ModalPresence({ children }: { children: ReactNode }) {
  return <AnimatePresence>{children}</AnimatePresence>
}

export function Modal({ title, children, onClose }: { title: string; children: ReactNode; onClose: () => void }) {
  const reduceMotion = useReducedMotion()
  const [desktop, setDesktop] = useState(() => typeof window !== 'undefined' && window.matchMedia('(min-width: 640px) and (hover: hover)').matches)
  const [viewport, setViewport] = useState(readModalViewport)
  const dialogRef = useRef<HTMLDivElement>(null)
  const restoreFocusRef = useRef<HTMLElement | null>(typeof document !== 'undefined' && document.activeElement instanceof HTMLElement ? document.activeElement : null)
  const titleId = useId()

  useEffect(() => {
    const media = window.matchMedia('(min-width: 640px) and (hover: hover)')
    const update = () => setDesktop(media.matches)
    update()
    media.addEventListener('change', update)
    return () => media.removeEventListener('change', update)
  }, [])

  useEffect(() => {
    const visualViewport = window.visualViewport
    const update = () => setViewport(readModalViewport())
    const updateAndRevealFocus = () => {
      update()
      requestAnimationFrame(() => {
        const activeElement = document.activeElement
        if (activeElement instanceof HTMLElement && dialogRef.current?.contains(activeElement)) {
          activeElement.scrollIntoView({ block: 'nearest', inline: 'nearest' })
        }
      })
    }
    update()
    window.addEventListener('resize', updateAndRevealFocus)
    visualViewport?.addEventListener('resize', updateAndRevealFocus)
    visualViewport?.addEventListener('scroll', update)
    return () => {
      window.removeEventListener('resize', updateAndRevealFocus)
      visualViewport?.removeEventListener('resize', updateAndRevealFocus)
      visualViewport?.removeEventListener('scroll', update)
    }
  }, [])

  useEffect(() => {
    lockPageForModal(restoreFocusRef.current)
    const focusFrame = requestAnimationFrame(() => {
      const dialog = dialogRef.current
      if (!dialog || dialog.contains(document.activeElement)) return
      const requestedFocus = dialog.querySelector<HTMLElement>('[autofocus]')
      const focusTarget = requestedFocus ?? focusableElements(dialog)[0] ?? dialog
      focusTarget.focus({ preventScroll: true })
    })
    return () => {
      cancelAnimationFrame(focusFrame)
      unlockPageForModal()
    }
  }, [])

  function handleKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      onClose()
      return
    }
    if (event.key !== 'Tab' || !dialogRef.current) return

    const focusable = focusableElements(dialogRef.current)
    if (focusable.length === 0) {
      event.preventDefault()
      dialogRef.current.focus({ preventScroll: true })
      return
    }
    const first = focusable[0]
    const last = focusable[focusable.length - 1]
    if (event.shiftKey && (document.activeElement === first || !dialogRef.current.contains(document.activeElement))) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      first.focus()
    }
  }

  const panelInitial = reduceMotion ? { opacity: 0 } : desktop ? { opacity: 0, y: 12, scale: 0.985 } : { opacity: 0, y: '105%' }
  const panelAnimate = reduceMotion ? { opacity: 1 } : { opacity: 1, y: 0, scale: 1 }
  const panelExit = reduceMotion ? { opacity: 0 } : desktop ? { opacity: 0, y: 8, scale: 0.99 } : { opacity: 0, y: '105%' }

  if (typeof document === 'undefined') return null

  return createPortal(
    <motion.div
      className={`fixed z-50 flex justify-center ${desktop ? 'items-center p-6' : 'items-end pt-[max(.75rem,env(safe-area-inset-top))]'}`}
      style={{ top: viewport.top, left: viewport.left, width: viewport.width, height: viewport.height }}
      data-modal-viewport="visual"
    >
      <motion.button
        type="button"
        className="absolute inset-0 size-full cursor-default bg-ink/45 backdrop-blur-[2px]"
        aria-hidden="true"
        tabIndex={-1}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: reduceMotion ? 0.08 : 0.18 }}
        onClick={onClose}
      />
      <motion.div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onKeyDown={handleKeyDown}
        initial={panelInitial}
        animate={panelAnimate}
        exit={panelExit}
        transition={reduceMotion ? { duration: 0.1 } : sheetSpring}
        className={`relative z-10 flex max-h-full w-full flex-col overflow-hidden bg-canvas shadow-2xl outline-none ${desktop ? 'max-w-xl rounded-3xl' : 'rounded-t-3xl'}`}
      >
        <div className={`z-10 flex shrink-0 items-center justify-between gap-4 bg-canvas ${desktop ? 'px-7 pb-5 pt-7' : 'px-5 pb-5 pt-5'}`}>
          <h2 id={titleId} className="type-panel-title text-ink">{title}</h2>
          <motion.button type="button" whileTap={reduceMotion ? undefined : { scale: 0.94 }} transition={tapSpring} className="grid size-10 shrink-0 place-items-center rounded-full text-muted hover:bg-stone-200" onClick={onClose} aria-label="Chiudi">
            <X size={20} />
          </motion.button>
        </div>
        <div className={`min-h-0 overflow-y-auto overscroll-contain touch-pan-y ${desktop ? 'px-7 pb-7' : 'px-5 pb-[max(1.25rem,env(safe-area-inset-bottom))]'}`} data-modal-scroll-region>
          {children}
        </div>
      </motion.div>
    </motion.div>,
    document.body
  )
}

export function EmptyState({ icon, title, description, action }: { icon: ReactNode; title: string; description: string; action?: ReactNode }) {
  return (
    <div className="grid min-h-60 place-items-center rounded-2xl border border-dashed border-stone-300 bg-white/60 px-6 py-10 text-center">
      <div>
        <div className="mx-auto mb-4 grid size-12 place-items-center rounded-2xl bg-brand-soft text-brand">{icon}</div>
        <h3 className="type-card-title text-ink">{title}</h3>
        <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-muted">{description}</p>
        {action && <div className="mt-5">{action}</div>}
      </div>
    </div>
  )
}

export function Notice({ tone = 'info', children }: { tone?: 'info' | 'success' | 'error'; children: ReactNode }) {
  const tones = {
    info: 'border-blue-200 bg-blue-50 text-blue-900',
    success: 'border-emerald-200 bg-emerald-50 text-emerald-900',
    error: 'border-red-200 bg-red-50 text-red-900'
  }
  return <div className={`rounded-xl border px-4 py-3 text-sm leading-6 ${tones[tone]}`}>{children}</div>
}
