import { CheckCircle2, LockKeyhole } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { z } from 'zod'
import { Button, Field, Input, Notice, Panel } from '../components/ui'
import { useAuth } from '../contexts/AuthContext'
import { readableError, supabase } from '../lib/supabase'
import { BrandLogo } from '../components/BrandLogo'
import { BRAND } from '../lib/brand'

const passwordSchema = z.object({
  password: z.string().min(8, 'La nuova password deve avere almeno 8 caratteri.'),
  confirmation: z.string()
}).refine((values) => values.password === values.confirmation, {
  message: 'Le due password non coincidono.',
  path: ['confirmation']
})

export function PasswordRecoveryPage() {
  const navigate = useNavigate()
  const { user, finishPasswordRecovery } = useAuth()
  const [password, setPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [loading, setLoading] = useState(false)
  const [success, setSuccess] = useState(false)
  const [error, setError] = useState('')

  function continueToApp() {
    finishPasswordRecovery()
    navigate('/', { replace: true })
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    setError('')
    const parsed = passwordSchema.safeParse({ password, confirmation })
    if (!parsed.success) return setError(parsed.error.issues[0].message)
    if (!supabase || !user) return setError('Il link non è più valido. Richiedi una nuova email di recupero.')

    setLoading(true)
    const { error: updateError } = await supabase.auth.updateUser({ password: parsed.data.password })
    setLoading(false)
    if (updateError) return setError(readableError(updateError))
    setSuccess(true)
  }

  return (
    <main className="grid min-h-dvh place-items-center bg-canvas px-4 py-10">
      <div className="w-full max-w-md">
        <div className="mb-8 flex items-center gap-3">
          <BrandLogo className="size-12 rounded-2xl shadow-sm ring-1 ring-black/5" />
          <div><p className="type-card-title">{BRAND.appName}</p><p className="text-xs text-muted">Accesso privato</p></div>
        </div>
        <Panel className="p-6 sm:p-8">
          {success ? (
            <div className="text-center">
              <div className="mx-auto grid size-12 place-items-center rounded-2xl bg-emerald-100 text-emerald-800"><CheckCircle2 size={25} /></div>
              <h1 className="mt-5 type-page-title">Password aggiornata</h1>
              <p className="mt-3 text-sm leading-6 text-muted">La nuova password è attiva. Puoi tornare alla tua dashboard.</p>
              <Button className="mt-6 w-full" onClick={continueToApp}>Continua in {BRAND.appName}</Button>
            </div>
          ) : (
            <>
              <div className="grid size-12 place-items-center rounded-2xl bg-brand-soft text-brand"><LockKeyhole size={23} /></div>
              <h1 className="mt-5 type-page-title">Scegli una nuova password</h1>
              <p className="mt-3 text-sm leading-6 text-muted">Imposta una password di almeno 8 caratteri per il tuo account {BRAND.name}.</p>
              {!user ? (
                <div className="mt-6 grid gap-4">
                  <Notice tone="error">Il link di recupero è scaduto o non è valido. Torna all’accesso e richiedine uno nuovo.</Notice>
                  <Button variant="secondary" onClick={continueToApp}>Torna all’accesso</Button>
                </div>
              ) : (
                <form className="mt-7 grid gap-5" onSubmit={submit}>
                  <Field label="Nuova password"><Input type="password" autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} /></Field>
                  <Field label="Ripeti la nuova password"><Input type="password" autoComplete="new-password" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} /></Field>
                  {error && <Notice tone="error">{error}</Notice>}
                  <Button type="submit" loading={loading}>Aggiorna password</Button>
                </form>
              )}
            </>
          )}
        </Panel>
      </div>
    </main>
  )
}
