import { LockKeyhole, Mail } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { z } from 'zod'
import { Button, Field, Input, Notice } from '../components/ui'
import { readableError, supabase } from '../lib/supabase'
import { BRAND } from '../lib/brand'
import { BrandLogo } from '../components/BrandLogo'
import { absoluteAppUrl } from '../lib/appPaths'

const credentialsSchema = z.object({
  email: z.string().email('Inserisci un indirizzo email valido.'),
  password: z.string().min(8, 'La password deve avere almeno 8 caratteri.')
})

export function AuthPage() {
  const [mode, setMode] = useState<'login' | 'signup' | 'reset'>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState<{ tone: 'error' | 'success'; text: string } | null>(null)

  async function submit(event: FormEvent) {
    event.preventDefault()
    setMessage(null)
    if (!supabase) return

    if (mode === 'reset') {
      const parsedEmail = z.string().email('Inserisci un indirizzo email valido.').safeParse(email)
      if (!parsedEmail.success) return setMessage({ tone: 'error', text: parsedEmail.error.issues[0].message })
      setLoading(true)
      const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: absoluteAppUrl('recupera-password') })
      setLoading(false)
      setMessage(error ? { tone: 'error', text: readableError(error) } : { tone: 'success', text: 'Controlla la tua email per reimpostare la password.' })
      return
    }

    const parsed = credentialsSchema.safeParse({ email, password })
    if (!parsed.success) return setMessage({ tone: 'error', text: parsed.error.issues[0].message })

    setLoading(true)
    const result = mode === 'login'
      ? await supabase.auth.signInWithPassword({ email, password })
      : await supabase.auth.signUp({ email, password, options: { data: { display_name: BRAND.name } } })
    setLoading(false)
    setMessage(
      result.error
        ? { tone: 'error', text: readableError(result.error) }
        : mode === 'signup' && !result.data.session
          ? { tone: 'success', text: 'Account creato. Controlla la tua email per confermare l’accesso.' }
          : null
    )
  }

  return (
    <main className="grid min-h-dvh bg-canvas lg:grid-cols-[1.05fr_.95fr]">
      <section className="hidden overflow-hidden bg-brand p-12 text-white lg:flex lg:flex-col lg:justify-between">
        <div className="flex items-center gap-4"><BrandLogo className="size-16 rounded-[1.35rem] shadow-lg ring-1 ring-white/20" /><div><p className="type-page-title">{BRAND.name}</p><p className="type-meta mt-1 text-white/65">Desk</p></div></div>
        <div className="max-w-xl">
          <p className="text-sm font-medium text-accent">{BRAND.tagline}</p>
          <h1 className="mt-4 max-w-lg text-5xl font-bold leading-[1.08] tracking-[-0.025em]">Più tempo al lavoro.<br />Meno tempo a cercare.</h1>
          <p className="mt-6 max-w-lg text-base leading-7 text-white/72">Commesse, clienti e attività in un unico posto, pensato per il ritmo reale di un laboratorio artigianale.</p>
        </div>
        <a className="w-fit text-sm text-white/55 transition hover:text-white" href={`mailto:${BRAND.email}`}>{BRAND.email}</a>
      </section>
      <section className="flex items-center justify-center px-4 py-10 sm:px-8">
        <div className="w-full max-w-md">
          <div className="mb-9 flex items-center gap-3 lg:hidden"><BrandLogo className="size-12 rounded-2xl shadow-sm ring-1 ring-black/5" /><span className="type-panel-title">{BRAND.appName}</span></div>
          <p className="text-xs font-medium text-brand">Accesso privato</p>
          <h2 className="mt-2 type-page-title">{mode === 'login' ? 'Bentornato' : mode === 'signup' ? 'Crea il tuo accesso' : 'Recupera password'}</h2>
          <p className="mt-3 text-sm leading-6 text-muted">{mode === 'login' ? `Accedi al tuo spazio di lavoro ${BRAND.name}.` : mode === 'signup' ? 'Crea il primo account del laboratorio.' : 'Riceverai un link sicuro via email.'}</p>
          <form className="mt-8 grid gap-5" onSubmit={submit}>
            <Field label="Email"><div className="relative"><Mail className="absolute left-3.5 top-3.5 text-stone-400" size={17} /><Input className="pl-10" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="nome@esempio.it" /></div></Field>
            {mode !== 'reset' && <Field label="Password"><div className="relative"><LockKeyhole className="absolute left-3.5 top-3.5 text-stone-400" size={17} /><Input className="pl-10" type="password" autoComplete={mode === 'login' ? 'current-password' : 'new-password'} value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Almeno 8 caratteri" /></div></Field>}
            {message && <Notice tone={message.tone}>{message.text}</Notice>}
            <Button type="submit" loading={loading}>{mode === 'login' ? 'Accedi' : mode === 'signup' ? 'Crea account' : 'Invia link di recupero'}</Button>
          </form>
          <div className="mt-6 flex flex-wrap gap-x-5 gap-y-2 text-sm">
            {mode !== 'login' && <button className="font-semibold text-brand" onClick={() => { setMode('login'); setMessage(null) }}>Torna all’accesso</button>}
            {mode === 'login' && <><button className="font-semibold text-brand" onClick={() => { setMode('signup'); setMessage(null) }}>Primo accesso?</button><button className="text-muted hover:text-ink" onClick={() => { setMode('reset'); setMessage(null) }}>Password dimenticata</button></>}
          </div>
        </div>
      </section>
    </main>
  )
}
