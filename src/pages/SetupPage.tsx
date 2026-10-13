import { CheckCircle2, Copy, Database, ExternalLink } from 'lucide-react'
import { useState } from 'react'
import { Button, Panel } from '../components/ui'
import { BrandLogo } from '../components/BrandLogo'
import { BRAND } from '../lib/brand'

export function SetupPage() {
  const [copied, setCopied] = useState(false)
  const command = 'cp .env.example .env.local'

  return (
    <main className="min-h-dvh bg-canvas px-4 py-10 sm:py-16">
      <div className="mx-auto max-w-2xl">
        <div className="mb-8 flex items-center gap-3">
          <BrandLogo className="size-14 rounded-2xl shadow-sm ring-1 ring-black/5" />
          <div><p className="font-display text-2xl font-semibold">{BRAND.appName}</p><p className="text-sm text-muted">Configurazione iniziale</p></div>
        </div>
        <Panel className="p-6 sm:p-8">
          <div className="grid size-12 place-items-center rounded-2xl bg-brand-soft text-brand"><Database size={24} /></div>
          <h1 className="mt-5 font-display text-3xl font-semibold tracking-tight">Collega il database</h1>
          <p className="mt-3 text-sm leading-6 text-muted">L’app è pronta, ma non sono ancora presenti le credenziali Supabase. Servono per autenticazione e dati persistenti reali.</p>
          <ol className="mt-7 grid gap-5 text-sm leading-6">
            <li className="flex gap-3"><span className="step">1</span><span>Crea un progetto gratuito su <a className="font-semibold text-brand underline underline-offset-4" href="https://supabase.com/dashboard" target="_blank" rel="noreferrer">Supabase <ExternalLink className="inline" size={13} /></a>.</span></li>
            <li className="flex gap-3"><span className="step">2</span><span className="min-w-0">Nel SQL Editor esegui tutto il file <code className="break-all">supabase/migrations/001_initial_schema.sql</code>.</span></li>
            <li className="flex gap-3"><span className="step">3</span><span>Copia <strong>Project URL</strong> e <strong>Publishable key</strong> dal pannello Connect o da Settings → API Keys.</span></li>
            <li className="flex gap-3"><span className="step">4</span><span>Crea il file locale e sostituisci i segnaposto:</span></li>
          </ol>
          <button
            onClick={async () => {
              await navigator.clipboard.writeText(command)
              setCopied(true)
              window.setTimeout(() => setCopied(false), 1800)
            }}
            className="mt-3 flex w-full items-center justify-between rounded-xl bg-ink px-4 py-3 font-mono text-xs text-white"
          >
            <span>{command}</span>{copied ? <CheckCircle2 size={17} className="text-emerald-400" /> : <Copy size={17} />}
          </button>
          <p className="mt-5 rounded-xl bg-amber-50 px-4 py-3 text-xs leading-5 text-amber-900">Usa soltanto la <strong>Publishable key</strong> che inizia con <code>sb_publishable_</code>. Non inserire mai una <strong>Secret key</strong> nel progetto web.</p>
          <Button className="mt-6 w-full" onClick={() => window.location.reload()}>Ho configurato Supabase — ricarica</Button>
        </Panel>
      </div>
    </main>
  )
}
