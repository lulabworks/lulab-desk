import {
  ArrowRight,
  BriefcaseBusiness,
  CheckCircle2,
  Clock3,
  ExternalLink,
  FileImage,
  Inbox,
  Mail,
  PackageOpen,
  Phone,
  Plus,
  Search,
  Sparkles
} from 'lucide-react'
import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Button, EmptyState, Field, Input, Modal, ModalPresence, Notice, PageHeader, Panel, Select, Textarea } from '../components/ui'
import { formatDate } from '../lib/format'
import { isPublicSiteUnavailable, makeSiteSlug, withSiteImageUrls } from '../lib/site'
import { readableError, supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { recordSuccessfulOperation } from '../lib/adaptive/usage'
import {
  CUSTOMER_INQUIRY_STATUSES,
  SITE_PUBLICATION_STATUSES,
  type CustomerInquiry,
  type CustomerInquiryFile,
  type CustomerInquiryStatus,
  type Job,
  type RecoveredItem,
  type SiteCollectionImage,
  type SiteCollectionItem,
  type SitePortfolioImage,
  type SitePortfolioProject
} from '../lib/types'

type Area = 'collection' | 'projects' | 'inquiries'
type CreateKind = Exclude<Area, 'inquiries'>

const areaOptions: Array<{ value: Area; label: string; icon: typeof PackageOpen }> = [
  { value: 'collection', label: 'Collezione', icon: PackageOpen },
  { value: 'projects', label: 'Progetti', icon: BriefcaseBusiness },
  { value: 'inquiries', label: 'Richieste', icon: Inbox }
]

export function SitePage() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const [area, setArea] = useState<Area>('collection')
  const [collection, setCollection] = useState<SiteCollectionItem[]>([])
  const [projects, setProjects] = useState<SitePortfolioProject[]>([])
  const [collectionImages, setCollectionImages] = useState<SiteCollectionImage[]>([])
  const [projectImages, setProjectImages] = useState<SitePortfolioImage[]>([])
  const [inquiries, setInquiries] = useState<CustomerInquiry[]>([])
  const [recoveries, setRecoveries] = useState<RecoveredItem[]>([])
  const [jobs, setJobs] = useState<Job[]>([])
  const [usedRecoveryIds, setUsedRecoveryIds] = useState<Set<string>>(new Set())
  const [usedJobIds, setUsedJobIds] = useState<Set<string>>(new Set())
  const [query, setQuery] = useState('')
  const [createKind, setCreateKind] = useState<CreateKind | null>(null)
  const [createForm, setCreateForm] = useState({ source_id: '', title: '', description: '', category: 'Restauro' })
  const [selectedInquiry, setSelectedInquiry] = useState<CustomerInquiry | null>(null)
  const [inquiryFiles, setInquiryFiles] = useState<CustomerInquiryFile[]>([])
  const [saving, setSaving] = useState(false)
  const [loading, setLoading] = useState(true)
  const [editor, setEditor] = useState(false)
  const [unavailable, setUnavailable] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')

  async function load() {
    if (!supabase) return
    setLoading(true)
    setError('')
    const editorResult = await supabase.rpc('is_site_editor')
    if (editorResult.error) {
      setUnavailable(isPublicSiteUnavailable(editorResult.error))
      if (!isPublicSiteUnavailable(editorResult.error)) setError(readableError(editorResult.error))
      setLoading(false)
      return
    }
    const allowed = Boolean(editorResult.data)
    setEditor(allowed)
    if (!allowed) {
      setLoading(false)
      return
    }

    const [collectionResult, projectResult, collectionImageResult, projectImageResult, inquiryResult, recoveryResult, jobResult, recoverySourceResult, jobSourceResult] = await Promise.all([
      supabase.from('site_collection_items').select('*').order('updated_at', { ascending: false }),
      supabase.from('site_portfolio_projects').select('*').order('updated_at', { ascending: false }),
      supabase.from('site_collection_images').select('*').eq('is_cover', true).order('sort_order'),
      supabase.from('site_portfolio_images').select('*').eq('is_cover', true).order('sort_order'),
      supabase.from('customer_inquiries').select('*').order('submitted_at', { ascending: false }),
      supabase.from('recovered_items').select('*').eq('is_archived', false).order('updated_at', { ascending: false }),
      supabase.from('jobs').select('*').order('created_at', { ascending: false }),
      supabase.from('site_collection_item_sources').select('recovered_item_id'),
      supabase.from('site_portfolio_project_sources').select('job_id')
    ])
    const firstError = collectionResult.error || projectResult.error || collectionImageResult.error || projectImageResult.error || inquiryResult.error || recoverySourceResult.error || jobSourceResult.error
    if (firstError) {
      setUnavailable(isPublicSiteUnavailable(firstError))
      setError(isPublicSiteUnavailable(firstError) ? '' : readableError(firstError))
    } else {
      setCollection((collectionResult.data ?? []) as SiteCollectionItem[])
      setProjects((projectResult.data ?? []) as SitePortfolioProject[])
      setCollectionImages(await withSiteImageUrls((collectionImageResult.data ?? []) as SiteCollectionImage[]))
      setProjectImages(await withSiteImageUrls((projectImageResult.data ?? []) as SitePortfolioImage[]))
      setInquiries((inquiryResult.data ?? []) as CustomerInquiry[])
      setUsedRecoveryIds(new Set((recoverySourceResult.data ?? []).map((row) => String(row.recovered_item_id))))
      setUsedJobIds(new Set((jobSourceResult.data ?? []).map((row) => String(row.job_id))))
    }
    if (!recoveryResult.error) setRecoveries((recoveryResult.data ?? []) as RecoveredItem[])
    if (!jobResult.error) setJobs((jobResult.data ?? []) as Job[])
    setLoading(false)
  }

  useEffect(() => { void load() }, [])

  const filteredCollection = useMemo(() => collection.filter((item) => `${item.title} ${item.description}`.toLocaleLowerCase('it').includes(query.toLocaleLowerCase('it'))), [collection, query])
  const filteredProjects = useMemo(() => projects.filter((item) => `${item.title} ${item.summary} ${item.category}`.toLocaleLowerCase('it').includes(query.toLocaleLowerCase('it'))), [projects, query])
  const filteredInquiries = useMemo(() => inquiries.filter((item) => `${item.reference_code} ${item.customer_name} ${item.email ?? ''} ${item.phone ?? ''} ${item.message}`.toLocaleLowerCase('it').includes(query.toLocaleLowerCase('it'))), [inquiries, query])

  function openCreate(kind: CreateKind) {
    setCreateForm({ source_id: '', title: '', description: '', category: 'Restauro' })
    setCreateKind(kind)
  }

  function chooseSource(sourceId: string) {
    if (!createKind) return
    if (createKind === 'collection') {
      const source = recoveries.find((item) => item.id === sourceId)
      setCreateForm((current) => ({ ...current, source_id: sourceId, title: source?.name ?? current.title, description: source?.description ?? current.description }))
    } else {
      const source = jobs.find((item) => item.id === sourceId)
      setCreateForm((current) => ({ ...current, source_id: sourceId, title: source?.title ?? current.title, description: source?.description ?? current.description }))
    }
  }

  async function createContent(event: FormEvent) {
    event.preventDefault()
    if (!supabase || !createKind) return
    setSaving(true)
    setError('')
    const title = createForm.title.trim()
    if (createKind === 'collection') {
      const source = recoveries.find((item) => item.id === createForm.source_id)
      const { data, error: insertError } = await supabase.from('site_collection_items').insert({
        slug: makeSiteSlug(title),
        title,
        description: createForm.description.trim() || source?.description || `Scheda Collezione di ${title}.`,
        condition_description: source?.initial_condition ?? null,
        availability: source?.status === 'venduto' ? 'non_disponibile' : 'disponibile',
        show_price: false,
        public_price: null
      }).select().single()
      if (insertError) {
        setSaving(false)
        return setError(readableError(insertError))
      }
      if (source) {
        const { error: sourceError } = await supabase.from('site_collection_item_sources').insert({ collection_item_id: data.id, recovered_item_id: source.id })
        if (sourceError) {
          await supabase.from('site_collection_items').delete().eq('id', data.id)
          setSaving(false)
          return setError(readableError(sourceError))
        }
      }
      recordSuccessfulOperation(user?.id, 'site.content_created')
      setCreateKind(null)
      navigate(`/sito/collezione/${data.id}`)
    } else {
      const source = jobs.find((item) => item.id === createForm.source_id)
      const description = createForm.description.trim() || source?.description || `Progetto LuLab: ${title}.`
      const { data, error: insertError } = await supabase.from('site_portfolio_projects').insert({
        slug: makeSiteSlug(title),
        title,
        summary: description.slice(0, 1000),
        description,
        category: createForm.category.trim() || 'Restauro'
      }).select().single()
      if (insertError) {
        setSaving(false)
        return setError(readableError(insertError))
      }
      if (source) {
        const { error: sourceError } = await supabase.from('site_portfolio_project_sources').insert({ portfolio_project_id: data.id, job_id: source.id })
        if (sourceError) {
          await supabase.from('site_portfolio_projects').delete().eq('id', data.id)
          setSaving(false)
          return setError(readableError(sourceError))
        }
      }
      recordSuccessfulOperation(user?.id, 'site.content_created')
      setCreateKind(null)
      navigate(`/sito/progetti/${data.id}`)
    }
    setSaving(false)
  }

  async function openInquiry(item: CustomerInquiry) {
    if (!supabase) return
    setSelectedInquiry(item)
    setInquiryFiles([])
    const { data, error: filesError } = await supabase.from('customer_inquiry_files').select('*').eq('inquiry_id', item.id).order('created_at')
    if (filesError) return setError(readableError(filesError))
    const signed = await Promise.all(((data ?? []) as CustomerInquiryFile[]).map(async (file) => ({
      ...file,
      signed_url: (await supabase!.storage.from('inquiry-uploads').createSignedUrl(file.storage_path, 3600)).data?.signedUrl
    })))
    setInquiryFiles(signed)
  }

  async function updateInquiryStatus(status: CustomerInquiryStatus) {
    if (!supabase || !selectedInquiry) return
    setSaving(true)
    const { error: updateError } = await supabase.from('customer_inquiries').update({ status }).eq('id', selectedInquiry.id)
    setSaving(false)
    if (updateError) return setError(readableError(updateError))
    recordSuccessfulOperation(user?.id, 'site.inquiry_updated')
    setSelectedInquiry((current) => current ? { ...current, status } : current)
    setInquiries((current) => current.map((item) => item.id === selectedInquiry.id ? { ...item, status } : item))
    setMessage('Stato della richiesta aggiornato.')
  }

  const action = area === 'collection'
    ? <Button onClick={() => openCreate('collection')}><Plus size={17} /> Nuovo oggetto</Button>
    : area === 'projects'
      ? <Button onClick={() => openCreate('projects')}><Plus size={17} /> Nuovo progetto</Button>
      : undefined

  return <div>
    <PageHeader eyebrow="Presenza online" title="Sito" description="Prepara Collezione e progetti pubblici, controlla cosa è online e gestisci le richieste ricevute." action={editor && !unavailable ? action : undefined} />
    {unavailable && <Notice>La sezione è pronta, ma il database non contiene ancora la migrazione <strong>004_public_site.sql</strong>.</Notice>}
    {!unavailable && !loading && !editor && <Notice tone="error">Il tuo account non è autorizzato a gestire i contenuti del sito.</Notice>}
    {error && <div className="mb-5"><Notice tone="error">{error}</Notice></div>}
    {message && <div className="mb-5"><Notice tone="success">{message}</Notice></div>}
    {!unavailable && editor && <>
      <div className="mb-5 flex min-w-0 max-w-full gap-2 overflow-x-auto pb-1">
        {areaOptions.map(({ value, label, icon: Icon }) => <button key={value} onClick={() => { setArea(value); setQuery('') }} className={`inline-flex min-h-11 shrink-0 items-center gap-2 rounded-xl px-4 text-sm font-semibold ${area === value ? 'bg-brand text-white' : 'border border-line bg-white text-muted hover:text-ink'}`}><Icon size={17} /> {label}{value === 'inquiries' && inquiries.filter((item) => item.status === 'nuova').length > 0 && <span className="rounded-full bg-accent px-1.5 text-xs text-ink">{inquiries.filter((item) => item.status === 'nuova').length}</span>}</button>)}
      </div>
      <div className="mb-5 relative"><Search className="absolute left-3.5 top-3.5 text-stone-400" size={18} /><Input className="pl-10" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={area === 'inquiries' ? 'Cerca nome, recapito o messaggio…' : 'Cerca titolo o descrizione…'} /></div>
      {loading ? <div className="h-72 animate-pulse rounded-2xl bg-white" /> : area === 'collection' ? <ContentGrid kind="collection" items={filteredCollection} images={collectionImages} /> : area === 'projects' ? <ContentGrid kind="projects" items={filteredProjects} images={projectImages} /> : <InquiryList items={filteredInquiries} onOpen={openInquiry} />}
    </>}

    <ModalPresence>{createKind && <Modal title={createKind === 'collection' ? 'Nuovo oggetto della Collezione' : 'Nuovo progetto'} onClose={() => setCreateKind(null)}><form className="grid gap-4" onSubmit={createContent}>
      <Field label={createKind === 'collection' ? 'Parti da un recupero (facoltativo)' : 'Parti da una commessa (facoltativo)'}><Select value={createForm.source_id} onChange={(event) => chooseSource(event.target.value)}><option value="">Crea una scheda indipendente</option>{createKind === 'collection' ? recoveries.filter((item) => !usedRecoveryIds.has(item.id)).map((item) => <option key={item.id} value={item.id}>{item.code} · {item.name}</option>) : jobs.filter((item) => !usedJobIds.has(item.id)).map((item) => <option key={item.id} value={item.id}>{item.code} · {item.title}</option>)}</Select></Field>
      <Field label="Titolo"><Input required minLength={2} value={createForm.title} onChange={(event) => setCreateForm((current) => ({ ...current, title: event.target.value }))} /></Field>
      {createKind === 'projects' && <Field label="Categoria"><Input required minLength={2} value={createForm.category} onChange={(event) => setCreateForm((current) => ({ ...current, category: event.target.value }))} placeholder="Es. Restauro mobili" /></Field>}
      <Field label="Descrizione iniziale" hint="Potrai completarla nella scheda successiva."><Textarea value={createForm.description} onChange={(event) => setCreateForm((current) => ({ ...current, description: event.target.value }))} /></Field>
      <Notice>La nuova scheda nasce come bozza e non è visibile sul sito.</Notice>
      <Button type="submit" loading={saving}>Crea e continua</Button>
    </form></Modal>}</ModalPresence>

    <ModalPresence>{selectedInquiry && <Modal title={selectedInquiry.reference_code} onClose={() => setSelectedInquiry(null)}><div className="grid gap-5">
      <div><p className="type-card-title">{selectedInquiry.customer_name}</p><p className="mt-1 text-sm text-muted">{selectedInquiry.request_type} · {formatDate(selectedInquiry.submitted_at)}</p></div>
      <div className="flex flex-wrap gap-2">{selectedInquiry.email && <a href={`mailto:${selectedInquiry.email}`} className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-line bg-white px-3.5 text-sm font-semibold text-brand"><Mail size={16} /> {selectedInquiry.email}</a>}{selectedInquiry.phone && <a href={`tel:${selectedInquiry.phone}`} className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-line bg-white px-3.5 text-sm font-semibold text-brand"><Phone size={16} /> {selectedInquiry.phone}</a>}</div>
      <Panel className="shadow-none"><p className="whitespace-pre-wrap text-sm leading-6">{selectedInquiry.message}</p></Panel>
      <Field label="Stato"><Select disabled={saving} value={selectedInquiry.status} onChange={(event) => void updateInquiryStatus(event.target.value as CustomerInquiryStatus)}>{CUSTOMER_INQUIRY_STATUSES.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</Select></Field>
      {inquiryFiles.length > 0 && <div><p className="mb-3 text-sm font-semibold">Fotografie allegate</p><div className="grid grid-cols-2 gap-3">{inquiryFiles.map((file) => <a key={file.id} href={file.signed_url} target="_blank" rel="noreferrer" className="group relative aspect-square overflow-hidden rounded-xl bg-stone-100">{file.signed_url ? <img src={file.signed_url} alt={file.file_name} className="h-full w-full object-cover" /> : <FileImage className="m-auto text-stone-400" />}<ExternalLink className="absolute right-2 top-2 rounded-lg bg-white/90 p-1.5 text-brand" size={28} /></a>)}</div></div>}
    </div></Modal>}</ModalPresence>
  </div>
}

function ContentGrid({ kind, items, images }: {
  kind: 'collection' | 'projects'
  items: Array<SiteCollectionItem | SitePortfolioProject>
  images: Array<SiteCollectionImage | SitePortfolioImage>
}) {
  if (items.length === 0) return <EmptyState icon={kind === 'collection' ? <PackageOpen size={23} /> : <BriefcaseBusiness size={23} />} title={kind === 'collection' ? 'Nessun oggetto nella Collezione' : 'Nessun progetto pubblico'} description="Crea una bozza, completa testi e fotografie, poi pubblicala quando è pronta." />
  return <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{items.map((item) => {
    const image = images.find((candidate) => kind === 'collection' ? 'collection_item_id' in candidate && candidate.collection_item_id === item.id : 'portfolio_project_id' in candidate && candidate.portfolio_project_id === item.id)
    const status = SITE_PUBLICATION_STATUSES.find((candidate) => candidate.value === item.publication_status)!
    return <Link key={item.id} to={`/sito/${kind === 'collection' ? 'collezione' : 'progetti'}/${item.id}`} className="group min-w-0 overflow-hidden rounded-2xl border border-line bg-white shadow-card transition-shadow hover:shadow-md"><div className="aspect-[16/10] overflow-hidden bg-stone-100">{image?.display_url ? <img src={image.display_url} alt={image.alt_text} className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.02]" /> : <div className="grid h-full place-items-center text-stone-300"><FileImage size={38} /></div>}</div><div className="p-5"><div className="flex items-center justify-between gap-3"><span className={`rounded-full px-2.5 py-1 text-[13px] font-medium ${status.tone}`}>{status.label}</span>{item.is_featured && <span className="inline-flex items-center gap-1 text-[13px] font-medium text-brand"><Sparkles size={14} /> In evidenza</span>}</div><h2 className="mt-4 break-words type-card-title">{item.title}</h2><p className="mt-2 line-clamp-2 text-sm leading-5 text-muted">{'summary' in item ? item.summary : item.description}</p><div className="mt-4 flex items-center justify-between border-t border-line pt-4 text-sm font-semibold text-brand"><span>Gestisci</span><ArrowRight size={17} /></div></div></Link>
  })}</div>
}

function InquiryList({ items, onOpen }: { items: CustomerInquiry[]; onOpen: (item: CustomerInquiry) => void }) {
  if (items.length === 0) return <EmptyState icon={<Inbox size={23} />} title="Nessuna richiesta" description="Le richieste inviate dal sito compariranno qui quando sarà collegato il modulo pubblico." />
  return <div className="grid gap-3">{items.map((item) => {
    const status = CUSTOMER_INQUIRY_STATUSES.find((candidate) => candidate.value === item.status)!
    return <button key={item.id} onClick={() => void onOpen(item)} className="flex min-w-0 items-center gap-4 rounded-2xl border border-line bg-white p-4 text-left shadow-card hover:border-stone-300"><div className={`grid size-11 shrink-0 place-items-center rounded-xl ${item.status === 'nuova' ? 'bg-blue-100 text-blue-800' : 'bg-stone-100 text-muted'}`}>{item.status === 'nuova' ? <Clock3 size={19} /> : <CheckCircle2 size={19} />}</div><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><p className="truncate text-sm font-semibold">{item.customer_name}</p><span className={`rounded-full px-2 py-0.5 text-xs font-medium ${status.tone}`}>{status.label}</span></div><p className="mt-1 truncate text-sm text-muted">{item.request_type} · {item.message}</p><p className="mt-1 text-xs text-muted">{item.reference_code} · {formatDate(item.submitted_at)}</p></div><ArrowRight size={18} className="shrink-0 text-stone-300" /></button>
  })}</div>
}
