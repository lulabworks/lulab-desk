import { LoaderCircle, X } from 'lucide-react'
import { AnimatePresence, motion, useReducedMotion, type HTMLMotionProps } from 'motion/react'
import { useEffect, useState, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react'
import { sheetSpring, tapSpring } from '../lib/animations'

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

  useEffect(() => {
    const media = window.matchMedia('(min-width: 640px) and (hover: hover)')
    const update = () => setDesktop(media.matches)
    update()
    media.addEventListener('change', update)
    return () => media.removeEventListener('change', update)
  }, [])

  const panelInitial = reduceMotion ? { opacity: 0 } : desktop ? { opacity: 0, y: 12, scale: 0.985 } : { opacity: 0, y: '105%' }
  const panelAnimate = reduceMotion ? { opacity: 1 } : { opacity: 1, y: 0, scale: 1 }
  const panelExit = reduceMotion ? { opacity: 0 } : desktop ? { opacity: 0, y: 8, scale: 0.99 } : { opacity: 0, y: '105%' }

  return (
    <motion.div className={`fixed inset-0 z-50 flex justify-center ${desktop ? 'items-center p-6' : 'items-end p-0'}`} role="dialog" aria-modal="true" aria-label={title}>
      <motion.button
        type="button"
        className="absolute inset-0 size-full cursor-default bg-ink/45 backdrop-blur-[2px]"
        aria-label="Chiudi finestra"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: reduceMotion ? 0.08 : 0.18 }}
        onClick={onClose}
      />
      <motion.div
        initial={panelInitial}
        animate={panelAnimate}
        exit={panelExit}
        transition={reduceMotion ? { duration: 0.1 } : sheetSpring}
        className={`relative max-h-[92dvh] w-full overflow-y-auto overscroll-contain bg-canvas shadow-2xl ${desktop ? 'max-w-xl rounded-3xl p-7' : 'rounded-t-3xl px-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-5'}`}
      >
        <div className="mb-5 flex items-center justify-between gap-4">
          <h2 className="type-panel-title text-ink">{title}</h2>
          <motion.button whileTap={reduceMotion ? undefined : { scale: 0.94 }} transition={tapSpring} className="grid size-10 place-items-center rounded-full text-muted hover:bg-stone-200" onClick={onClose} aria-label="Chiudi">
            <X size={20} />
          </motion.button>
        </div>
        {children}
      </motion.div>
    </motion.div>
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
