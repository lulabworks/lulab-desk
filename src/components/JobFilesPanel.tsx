import { Camera, ExternalLink, File, Image, Trash2, Upload } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { formatDate } from '../lib/format'
import { isPhase2Unavailable } from '../lib/phase2'
import { readableError, supabase } from '../lib/supabase'
import { FILE_CATEGORIES, type JobFile, type JobFileCategory } from '../lib/types'
import { recordSuccessfulOperation } from '../lib/adaptive/usage'
import { EmptyState, Notice, Panel } from './ui'

const MAX_SIZE = 15 * 1024 * 1024

export function JobFilesPanel({ jobId }: { jobId: string }) {
  const { user } = useAuth()
  const [files, setFiles] = useState<JobFile[]>([])
  const [active, setActive] = useState<JobFileCategory>('prima')
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState('')
  const [unavailable, setUnavailable] = useState(false)

  useEffect(() => {
    async function load() {
      if (!supabase) return
      const { data, error: loadError } = await supabase.from('job_files').select('*').eq('job_id', jobId).order('created_at', { ascending: false })
      if (loadError) {
        setUnavailable(isPhase2Unavailable(loadError))
        if (!isPhase2Unavailable(loadError)) setError(readableError(loadError))
        return
      }
      const rows = (data ?? []) as JobFile[]
      const withUrls = await Promise.all(rows.map(async (file) => {
        const { data: signed } = await supabase!.storage.from('job-files').createSignedUrl(file.storage_path, 3600)
        return { ...file, signed_url: signed?.signedUrl }
      }))
      setFiles(withUrls)
    }
    load()
  }, [jobId])

  async function upload(selected: FileList | null, category: JobFileCategory) {
    const file = selected?.[0]
    if (!file || !supabase || !user) return
    setError('')
    if (file.size > MAX_SIZE) return setError('Il file supera il limite di 15 MB.')
    const allowed = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf']
    if (!allowed.includes(file.type)) return setError('Formato non supportato. Usa JPG, PNG, WebP o PDF.')

    setUploading(true)
    const safeName = file.name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z0-9._-]/g, '-').slice(-120)
    const path = `${user.id}/${jobId}/${category}/${crypto.randomUUID()}-${safeName}`
    const { error: storageError } = await supabase.storage.from('job-files').upload(path, file, { contentType: file.type, upsert: false })
    if (storageError) {
      setUploading(false)
      return setError(readableError(storageError))
    }
    const { data, error: dbError } = await supabase.from('job_files').insert({ job_id: jobId, category, storage_path: path, file_name: file.name, mime_type: file.type, size_bytes: file.size }).select().single()
    if (dbError) {
      await supabase.storage.from('job-files').remove([path])
      setUploading(false)
      return setError(readableError(dbError))
    }
    recordSuccessfulOperation(user.id, 'files.uploaded')
    const { data: signed } = await supabase.storage.from('job-files').createSignedUrl(path, 3600)
    setFiles((current) => [{ ...(data as JobFile), signed_url: signed?.signedUrl }, ...current])
    setActive(category)
    setUploading(false)
  }

  async function remove(file: JobFile) {
    if (!supabase || !window.confirm(`Eliminare “${file.file_name}”?`)) return
    const { error: dbError } = await supabase.from('job_files').delete().eq('id', file.id)
    if (dbError) return setError(readableError(dbError))
    const { error: storageError } = await supabase.storage.from('job-files').remove([file.storage_path])
    if (storageError) setError(`Record eliminato, ma il file non è stato rimosso dallo storage: ${readableError(storageError)}`)
    recordSuccessfulOperation(user?.id, 'files.deleted')
    setFiles((current) => current.filter((item) => item.id !== file.id))
  }

  const visible = files.filter((file) => file.category === active)
  const isPhotoCategory = active !== 'documento'

  return (
    <Panel>
      <div className="mb-5 flex min-w-0 flex-wrap items-center justify-between gap-3"><div className="min-w-0"><p className="section-kicker">Archivio</p><h2 className="break-words type-panel-title">Foto e allegati</h2></div>{!unavailable && <label className={`inline-flex min-h-11 shrink-0 cursor-pointer items-center gap-2 rounded-xl bg-brand px-4 py-2.5 text-sm font-semibold text-white ${uploading ? 'pointer-events-none opacity-55' : ''}`}><Upload size={17} /> {uploading ? 'Caricamento…' : 'Carica file'}<input className="sr-only" type="file" accept={isPhotoCategory ? 'image/jpeg,image/png,image/webp' : 'image/jpeg,image/png,image/webp,application/pdf'} capture={isPhotoCategory ? 'environment' : undefined} onChange={(event) => { void upload(event.target.files, active); event.target.value = '' }} /></label>}</div>
      {unavailable ? <Notice>Applica la migrazione <strong>002_phase2_operations.sql</strong> per attivare foto e allegati.</Notice> : <>
        <div className="mb-5 flex min-w-0 max-w-full gap-2 overflow-x-auto overscroll-x-contain pb-1">{FILE_CATEGORIES.map((category) => <button key={category.value} onClick={() => setActive(category.value)} className={`min-h-10 shrink-0 rounded-xl px-3.5 text-sm font-semibold ${active === category.value ? 'bg-brand text-white' : 'bg-stone-100 text-muted hover:text-ink'}`}>{category.label}<span className="ml-1.5 text-xs opacity-70">{files.filter((file) => file.category === category.value).length}</span></button>)}</div>
        {error && <div className="mb-4"><Notice tone="error">{error}</Notice></div>}
        {visible.length === 0 ? <EmptyState icon={isPhotoCategory ? <Camera size={22} /> : <File size={22} />} title={`Nessun file in “${FILE_CATEGORIES.find((item) => item.value === active)?.label}”`} description={isPhotoCategory ? 'Scatta una foto dal telefono o caricala dal Mac.' : 'Carica disegni, schede tecniche o documenti PDF.'} /> : <div className="grid min-w-0 grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">{visible.map((file) => <article key={file.id} className="group min-w-0 overflow-hidden rounded-xl border border-line bg-stone-50"><a href={file.signed_url} target="_blank" rel="noreferrer" className="grid aspect-square min-w-0 place-items-center overflow-hidden bg-stone-100">{file.mime_type.startsWith('image/') && file.signed_url ? <img src={file.signed_url} alt={file.file_name} className="h-full w-full object-cover" /> : <File size={32} className="text-stone-400" />}</a><div className="min-w-0 p-3"><p className="truncate text-xs font-semibold" title={file.file_name}>{file.file_name}</p><p className="mt-1 text-[13px] text-muted">{formatDate(file.created_at)}</p><div className="mt-2 flex justify-between"><a href={file.signed_url} target="_blank" rel="noreferrer" className="grid size-8 place-items-center rounded-lg text-brand hover:bg-white" aria-label="Apri file"><ExternalLink size={15} /></a><button onClick={() => remove(file)} className="grid size-8 place-items-center rounded-lg text-stone-400 hover:bg-red-50 hover:text-red-700" aria-label="Elimina file"><Trash2 size={15} /></button></div></div></article>)}</div>}
      </>}
    </Panel>
  )
}
