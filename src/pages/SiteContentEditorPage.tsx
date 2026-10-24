import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  Camera,
  Check,
  Eye,
  FileImage,
  Globe2,
  ImagePlus,
  Save,
  Sparkles,
  Trash2,
  Undo2
} from 'lucide-react'
import { useEffect, useMemo, useState, type ChangeEvent } from 'react'
import { Link, useLocation, useParams } from 'react-router-dom'
import { Button, EmptyState, Field, Input, Modal, ModalPresence, Notice, Panel, Select, Textarea } from '../components/ui'
import {
  changeSitePublication,
  deleteSiteImage,
  isPublicSiteUnavailable,
  uploadSiteImages,
  withSiteImageUrls,
  type SiteContentKind,
  type SiteImage
} from '../lib/site'
import { readableError, supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { recordSuccessfulOperation } from '../lib/adaptive/usage'
import { EditorialAssistant } from '../components/EditorialAssistant'
import {
  SITE_COLLECTION_AVAILABILITIES,
  SITE_PORTFOLIO_IMAGE_KINDS,
  SITE_PUBLICATION_STATUSES,
  type SiteCollectionAvailability,
  type SiteCollectionImage,
  type SiteCollectionItem,
  type SitePortfolioImage,
  type SitePortfolioImageKind,
  type SitePortfolioProject
} from '../lib/types'

export function SiteContentEditorPage() {
  const { user } = useAuth()
  const { id } = useParams()
  const location = useLocation()
  const kind: SiteContentKind = location.pathname.includes('/collezione/') ? 'collection' : 'portfolio'
  const [content, setContent] = useState<SiteCollectionItem | SitePortfolioProject | null>(null)
  const [images, setImages] = useState<SiteImage[]>([])
  const [sourceLabel, setSourceLabel] = useState('Scheda indipendente')
  const [editorialSource, setEditorialSource] = useState<Record<string, string>>({})
  const [uploadKind, setUploadKind] = useState<SitePortfolioImageKind>('durante')
  const [preview, setPreview] = useState(false)
  const [saving, setSaving] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [unavailable, setUnavailable] = useState(false)

  const table = kind === 'collection' ? 'site_collection_items' : 'site_portfolio_projects'
  const imageTable = kind === 'collection' ? 'site_collection_images' : 'site_portfolio_images'
  const parentColumn = kind === 'collection' ? 'collection_item_id' : 'portfolio_project_id'

  async function load() {
    if (!supabase || !id) return
    setError('')
    const [contentResult, imageResult] = await Promise.all([
      supabase.from(table).select('*').eq('id', id).single(),
      supabase.from(imageTable).select('*').eq(parentColumn, id).order('sort_order').order('created_at')
    ])
    const firstError = contentResult.error || imageResult.error
    if (firstError) {
      setUnavailable(isPublicSiteUnavailable(firstError))
      setError(isPublicSiteUnavailable(firstError) ? '' : readableError(firstError))
      return
    }
    setContent(contentResult.data as SiteCollectionItem | SitePortfolioProject)
    setEditorialSource({})
    setImages(await withSiteImageUrls((imageResult.data ?? []) as SiteImage[]))

    if (kind === 'collection') {
      const { data: source } = await supabase.from('site_collection_item_sources').select('recovered_item_id').eq('collection_item_id', id).maybeSingle()
      if (source?.recovered_item_id) {
        const { data: recovered } = await supabase.from('recovered_items').select('code,name,description,initial_condition,required_work').eq('id', source.recovered_item_id).maybeSingle()
        if (recovered) {
          setSourceLabel(`${recovered.code} · ${recovered.name}`)
          setEditorialSource({ item_name: recovered.name, item_description: recovered.description ?? '', initial_condition: recovered.initial_condition ?? '', required_work: recovered.required_work ?? '' })
        }
      }
    } else {
      const { data: source } = await supabase.from('site_portfolio_project_sources').select('job_id').eq('portfolio_project_id', id).maybeSingle()
      if (source?.job_id) {
        const { data: job } = await supabase.from('jobs').select('code,title,type,description,technical_details').eq('id', source.job_id).maybeSingle()
        if (job) {
          setSourceLabel(`${job.code} · ${job.title}`)
          setEditorialSource({ job_title: job.title, job_type: job.type, job_description: job.description ?? '', technical_details: job.technical_details ?? '' })
        }
      }
    }
  }

  useEffect(() => { void load() }, [id, kind])

  function setField(key: string, value: unknown) {
    setContent((current) => current ? { ...current, [key]: value } as SiteCollectionItem | SitePortfolioProject : current)
  }

  async function persistContent(showMessage = true) {
    if (!supabase || !content) return false
    setSaving(true)
    setError('')
    const payload = kind === 'collection'
      ? {
          title: content.title.trim(),
          description: (content as SiteCollectionItem).description.trim(),
          materials: (content as SiteCollectionItem).materials?.trim() || null,
          dimensions: (content as SiteCollectionItem).dimensions?.trim() || null,
          condition_description: (content as SiteCollectionItem).condition_description?.trim() || null,
          availability: (content as SiteCollectionItem).availability,
          is_featured: content.is_featured,
          featured_order: content.is_featured ? Number(content.featured_order ?? 0) : null,
          sort_order: Number(content.sort_order),
          seo_title: content.seo_title?.trim() || null,
          seo_description: content.seo_description?.trim() || null,
          show_price: false,
          public_price: null
        }
      : {
          title: content.title.trim(),
          summary: (content as SitePortfolioProject).summary.trim(),
          description: (content as SitePortfolioProject).description.trim(),
          category: (content as SitePortfolioProject).category.trim(),
          is_featured: content.is_featured,
          featured_order: content.is_featured ? Number(content.featured_order ?? 0) : null,
          sort_order: Number(content.sort_order),
          seo_title: content.seo_title?.trim() || null,
          seo_description: content.seo_description?.trim() || null
        }
    const { error: saveError } = await supabase.from(table).update(payload).eq('id', content.id)
    setSaving(false)
    if (saveError) {
      setError(readableError(saveError))
      return false
    }
    recordSuccessfulOperation(user?.id, 'site.content_saved')
    if (showMessage) setMessage('Modifiche salvate.')
    return true
  }

  async function upload(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? [])
    event.target.value = ''
    if (!content || files.length === 0) return
    setUploading(true)
    setError('')
    setMessage('')
    try {
      await uploadSiteImages({
        kind,
        parentId: content.id,
        files,
        altText: content.title,
        portfolioKind: uploadKind,
        startOrder: images.length,
        setFirstAsCover: images.length === 0
      })
      recordSuccessfulOperation(user?.id, 'site.image_uploaded')
      setMessage(files.length === 1 ? 'Fotografia aggiunta alla bozza.' : `${files.length} fotografie aggiunte alla bozza.`)
      await load()
    } catch (uploadError) {
      setError(readableError(uploadError))
    } finally {
      setUploading(false)
    }
  }

  async function updateImage(image: SiteImage, changes: Record<string, unknown>) {
    if (!supabase) return
    const { error: updateError } = await supabase.from(imageTable).update(changes).eq('id', image.id)
    if (updateError) return setError(readableError(updateError))
    recordSuccessfulOperation(user?.id, 'site.image_updated')
    setImages((current) => current.map((item) => item.id === image.id ? { ...item, ...changes } as SiteImage : item))
  }

  async function makeCover(image: SiteImage) {
    if (!supabase) return
    setSaving(true)
    const sameBucketIds = images.filter((item) => item.storage_bucket === image.storage_bucket).map((item) => item.id)
    const { error: clearError } = await supabase.from(imageTable).update({ is_cover: false }).in('id', sameBucketIds)
    const { error: coverError } = clearError ? { error: clearError } : await supabase.from(imageTable).update({ is_cover: true }).eq('id', image.id)
    setSaving(false)
    if (coverError) return setError(readableError(coverError))
    recordSuccessfulOperation(user?.id, 'site.image_updated')
    setImages((current) => current.map((item) => item.storage_bucket === image.storage_bucket ? { ...item, is_cover: item.id === image.id } as SiteImage : item))
    setMessage('Copertina aggiornata.')
  }

  async function moveImage(image: SiteImage, direction: -1 | 1) {
    if (!supabase) return
    const index = images.findIndex((item) => item.id === image.id)
    const targetIndex = index + direction
    if (index < 0 || targetIndex < 0 || targetIndex >= images.length) return
    const reordered = [...images]
    const [moved] = reordered.splice(index, 1)
    reordered.splice(targetIndex, 0, moved)
    setImages(reordered.map((item, order) => ({ ...item, sort_order: order }) as SiteImage))
    const updates = reordered.map((item, order) => supabase!.from(imageTable).update({ sort_order: order }).eq('id', item.id))
    const results = await Promise.all(updates)
    const updateError = results.find((result) => result.error)?.error
    if (updateError) {
      setError(readableError(updateError))
      await load()
    } else recordSuccessfulOperation(user?.id, 'site.image_reordered')
  }

  async function removeImage(image: SiteImage) {
    if (!window.confirm('Eliminare questa fotografia?')) return
    setSaving(true)
    setError('')
    try {
      await deleteSiteImage(kind, image)
      recordSuccessfulOperation(user?.id, 'site.image_deleted')
      setImages((current) => current.filter((item) => item.id !== image.id))
      setMessage('Fotografia eliminata.')
    } catch (removeError) {
      setError(readableError(removeError))
      await load()
    } finally {
      setSaving(false)
    }
  }

  async function changePublication(next: 'pubblicato' | 'non_pubblicato') {
    if (!content) return
    if (next === 'pubblicato' && images.length === 0 && !window.confirm('Pubblicare senza fotografie?')) return
    if (next === 'non_pubblicato' && !window.confirm('Ritirare questo contenuto dal sito? Le copie pubbliche verranno riportate nella bozza privata.')) return
    const saved = await persistContent(false)
    if (!saved) return
    setSaving(true)
    setError('')
    setMessage('')
    try {
      await changeSitePublication({ kind, parentId: content.id, images, nextStatus: next })
      recordSuccessfulOperation(user?.id, next === 'pubblicato' ? 'site.published' : 'site.withdrawn')
      setMessage(next === 'pubblicato'
        ? 'Pubblicato su Supabase. Il sito pubblico si aggiornerà automaticamente entro pochi minuti.'
        : 'Ritirato da Supabase. Il sito pubblico si aggiornerà automaticamente entro pochi minuti.')
      await load()
    } catch (publicationError) {
      setError(readableError(publicationError))
      await load()
    } finally {
      setSaving(false)
    }
  }

  const cover = useMemo(() => images.find((image) => image.is_cover && image.storage_bucket === (content?.publication_status === 'pubblicato' ? 'site-public' : 'site-drafts')) ?? images.find((image) => image.is_cover) ?? images[0], [content?.publication_status, images])
  const hasDraftUpdates = images.some((image) => image.storage_bucket === 'site-drafts')
  const statusMeta = SITE_PUBLICATION_STATUSES.find((item) => item.value === content?.publication_status)
  const editorialData = useMemo(() => content ? ({ ...content, ...editorialSource }) : {}, [content, editorialSource])

  if (unavailable) return <Notice>La migrazione <strong>004_public_site.sql</strong> non è ancora disponibile nel database.</Notice>
  if (!content) return <div>{error ? <Notice tone="error">{error}</Notice> : <div className="h-96 animate-pulse rounded-2xl bg-white" />}</div>

  return <div>
    <div className="mb-5 flex flex-wrap items-center justify-between gap-3"><Link to="/sito" className="inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-brand"><ArrowLeft size={18} /> Torna a Sito</Link><div className="flex flex-wrap gap-2"><Button variant="secondary" onClick={() => setPreview(true)}><Eye size={17} /> Anteprima</Button><Button onClick={() => void persistContent()} loading={saving}><Save size={17} /> Salva</Button></div></div>
    {error && <div className="mb-5"><Notice tone="error">{error}</Notice></div>}
    {message && <div className="mb-5"><Notice tone="success">{message}</Notice></div>}
    <header className="mb-6"><div className="flex flex-wrap items-center gap-2"><span className={`rounded-full px-2.5 py-1 text-[13px] font-medium ${statusMeta?.tone}`}>{statusMeta?.label}</span>{content.is_featured && <span className="inline-flex items-center gap-1 text-[13px] font-medium text-brand"><Sparkles size={14} /> Homepage</span>}</div><h1 className="mt-3 break-words type-page-title">{content.title}</h1><p className="mt-2 text-sm text-muted">Origine: {sourceLabel}</p></header>

    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_22rem]">
      <div className="grid min-w-0 gap-6">
        <EditorialAssistant kind={kind} data={editorialData} onApply={(draft, keys) => {
          const values = Object.fromEntries(keys.map(key => [key, key === 'title' || key.startsWith('seo_') ? (draft as unknown as Record<string,string>)[key] || null : (draft as unknown as Record<string,string>)[key]]))
          setContent(current => current ? { ...current, ...values } as SiteCollectionItem | SitePortfolioProject : current)
        }} />
        <Panel><p className="section-kicker">Contenuto pubblico</p><h2 className="type-panel-title">Testi e informazioni</h2><div className="mt-5 grid gap-4">
          <Field label="Titolo"><Input required minLength={2} value={content.title} onChange={(event) => setField('title', event.target.value)} /></Field>
          {kind === 'collection' ? <CollectionFields item={content as SiteCollectionItem} onChange={setField} /> : <ProjectFields item={content as SitePortfolioProject} onChange={setField} />}
          <div className="grid gap-4 sm:grid-cols-2"><Field label="Titolo per motori di ricerca" hint="Facoltativo, massimo 70 caratteri."><Input maxLength={70} value={content.seo_title ?? ''} onChange={(event) => setField('seo_title', event.target.value || null)} /></Field><Field label="Ordine nell’elenco"><Input type="number" min="0" value={content.sort_order} onChange={(event) => setField('sort_order', Number(event.target.value))} /></Field></div>
          <Field label="Descrizione per motori di ricerca" hint="Facoltativa, massimo 170 caratteri."><Textarea maxLength={170} className="min-h-24" value={content.seo_description ?? ''} onChange={(event) => setField('seo_description', event.target.value || null)} /></Field>
        </div></Panel>

        <Panel><div className="mb-5 flex flex-wrap items-center justify-between gap-3"><div><p className="section-kicker">Galleria</p><h2 className="type-panel-title">Fotografie</h2></div><div className="flex flex-wrap gap-2">{kind === 'portfolio' && <Select className="w-auto" value={uploadKind} onChange={(event) => setUploadKind(event.target.value as SitePortfolioImageKind)}>{SITE_PORTFOLIO_IMAGE_KINDS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</Select>}<label className={`inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-xl bg-brand px-4 py-2.5 text-[15px] font-semibold text-white ${uploading ? 'pointer-events-none opacity-55' : ''}`}><ImagePlus size={17} /> {uploading ? 'Preparazione…' : 'Aggiungi foto'}<input className="sr-only" type="file" multiple accept="image/*" onChange={(event) => void upload(event)} /></label></div></div>
          <p className="mb-5 text-sm leading-6 text-muted">Le immagini vengono ridimensionate e ottimizzate in WebP, o in JPEG se il browser non supporta WebP. Finché la scheda non viene pubblicata restano nel deposito privato.</p>
          {images.length === 0 ? <EmptyState icon={<Camera size={22} />} title="Nessuna fotografia" description="Aggiungi le fotografie selezionate per il sito. Gli originali operativi restano separati e privati." /> : <div className="grid min-w-0 gap-4 sm:grid-cols-2 lg:grid-cols-3">{images.map((image, index) => <PhotoCard key={image.id} image={image} kind={kind} first={index === 0} last={index === images.length - 1} onMove={moveImage} onCover={makeCover} onUpdate={updateImage} onRemove={removeImage} />)}</div>}
        </Panel>
      </div>

      <div className="grid content-start gap-6"><Panel><p className="section-kicker">Pubblicazione</p><h2 className="type-panel-title">Visibilità sul sito</h2><p className="mt-3 text-sm leading-6 text-muted">I prezzi restano sempre nascosti. Soltanto testi e fotografie selezionate vengono resi pubblici.</p><label className="mt-5 flex items-center gap-3 rounded-xl bg-brand-soft p-3 text-sm font-medium"><input type="checkbox" className="size-5 accent-brand" checked={content.is_featured} onChange={(event) => setField('is_featured', event.target.checked)} /><span>Mostra in evidenza sulla homepage</span></label>{content.is_featured && <div className="mt-3"><Field label="Ordine in evidenza"><Input type="number" min="0" value={content.featured_order ?? 0} onChange={(event) => setField('featured_order', Number(event.target.value))} /></Field></div>}<div className="mt-5 grid gap-2">{content.publication_status === 'pubblicato' ? <><Button onClick={() => void changePublication('pubblicato')} loading={saving} disabled={!hasDraftUpdates}><Globe2 size={17} /> {hasDraftUpdates ? 'Pubblica aggiornamenti' : 'Contenuto aggiornato'}</Button><Button variant="secondary" onClick={() => void changePublication('non_pubblicato')} disabled={saving}><Undo2 size={17} /> Ritira dal sito</Button></> : <Button onClick={() => void changePublication('pubblicato')} loading={saving}><Globe2 size={17} /> Pubblica sul sito</Button>}</div></Panel>
        <Panel><p className="section-kicker">Controllo rapido</p><h2 className="type-panel-title">Prima di pubblicare</h2><div className="mt-4 grid gap-3 text-sm"><Checklist done={content.title.trim().length >= 2} label="Titolo completo" /><Checklist done={(kind === 'collection' ? (content as SiteCollectionItem).description : (content as SitePortfolioProject).description).trim().length > 20} label="Descrizione completa" /><Checklist done={images.length > 0} label="Almeno una fotografia" /><Checklist done={Boolean(cover)} label="Copertina selezionata" /></div></Panel>
      </div>
    </div>

    <ModalPresence>{preview && <Modal title="Anteprima della scheda" onClose={() => setPreview(false)}><article className="overflow-hidden rounded-2xl border border-line bg-white">{cover?.display_url ? <img src={cover.display_url} alt={cover.alt_text} className="aspect-[16/10] w-full object-cover" /> : <div className="grid aspect-[16/10] place-items-center bg-stone-100 text-stone-300"><FileImage size={42} /></div>}<div className="p-5"><p className="section-kicker">{kind === 'collection' ? 'Collezione LuLab' : (content as SitePortfolioProject).category}</p><h2 className="type-panel-title">{content.title}</h2><p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-muted">{kind === 'collection' ? (content as SiteCollectionItem).description : (content as SitePortfolioProject).summary}</p>{kind === 'collection' && <p className="mt-4 text-sm font-semibold text-brand">{SITE_COLLECTION_AVAILABILITIES.find((item) => item.value === (content as SiteCollectionItem).availability)?.label}</p>}</div></article><Notice>Anteprima interna: nessun dato privato o prezzo viene mostrato.</Notice></Modal>}</ModalPresence>
  </div>
}

function CollectionFields({ item, onChange }: { item: SiteCollectionItem; onChange: (key: string, value: unknown) => void }) {
  return <><Field label="Descrizione"><Textarea required value={item.description} onChange={(event) => onChange('description', event.target.value)} /></Field><div className="grid gap-4 sm:grid-cols-2"><Field label="Materiali"><Input value={item.materials ?? ''} onChange={(event) => onChange('materials', event.target.value || null)} placeholder="Es. legno massello, ottone" /></Field><Field label="Dimensioni"><Input value={item.dimensions ?? ''} onChange={(event) => onChange('dimensions', event.target.value || null)} placeholder="Es. 120 × 45 × 80 cm" /></Field></div><Field label="Condizioni"><Textarea value={item.condition_description ?? ''} onChange={(event) => onChange('condition_description', event.target.value || null)} /></Field><Field label="Disponibilità"><Select value={item.availability} onChange={(event) => onChange('availability', event.target.value as SiteCollectionAvailability)}>{SITE_COLLECTION_AVAILABILITIES.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</Select></Field><Notice>I costi e i prezzi del recupero non vengono copiati in questa scheda. La visualizzazione dei prezzi pubblici è disattivata.</Notice></>
}

function ProjectFields({ item, onChange }: { item: SitePortfolioProject; onChange: (key: string, value: unknown) => void }) {
  return <><div className="grid gap-4 sm:grid-cols-2"><Field label="Categoria"><Input required minLength={2} value={item.category} onChange={(event) => onChange('category', event.target.value)} /></Field><Field label="Sommario"><Input required value={item.summary} onChange={(event) => onChange('summary', event.target.value)} /></Field></div><Field label="Descrizione dell’intervento"><Textarea required value={item.description} onChange={(event) => onChange('description', event.target.value)} /></Field></>
}

function PhotoCard({ image, kind, first, last, onMove, onCover, onUpdate, onRemove }: {
  image: SiteImage
  kind: SiteContentKind
  first: boolean
  last: boolean
  onMove: (image: SiteImage, direction: -1 | 1) => void
  onCover: (image: SiteImage) => void
  onUpdate: (image: SiteImage, changes: Record<string, unknown>) => void
  onRemove: (image: SiteImage) => void
}) {
  return <article className="min-w-0 overflow-hidden rounded-2xl border border-line bg-stone-50"><div className="relative aspect-square bg-stone-100">{image.display_url ? <img src={image.display_url} alt={image.alt_text} className="h-full w-full object-cover" /> : <div className="grid h-full place-items-center text-stone-300"><FileImage size={34} /></div>}<span className={`absolute left-2 top-2 rounded-full px-2 py-1 text-xs font-semibold ${image.storage_bucket === 'site-public' ? 'bg-emerald-100 text-emerald-800' : 'bg-white/90 text-stone-700'}`}>{image.storage_bucket === 'site-public' ? 'Pubblica' : 'Bozza privata'}</span>{image.is_cover && <span className="absolute right-2 top-2 rounded-full bg-brand px-2 py-1 text-xs font-semibold text-white">Copertina</span>}</div><div className="grid gap-3 p-3"><Input aria-label="Testo alternativo" defaultValue={image.alt_text} maxLength={300} onBlur={(event) => { const value = event.target.value.trim(); if (value && value !== image.alt_text) void onUpdate(image, { alt_text: value }) }} />{kind === 'portfolio' && <Select aria-label="Fase fotografia" value={(image as SitePortfolioImage).image_kind} onChange={(event) => void onUpdate(image, { image_kind: event.target.value as SitePortfolioImageKind })}>{SITE_PORTFOLIO_IMAGE_KINDS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</Select>}<div className="flex items-center justify-between gap-2"><div className="flex gap-1"><button type="button" disabled={first} onClick={() => onMove(image, -1)} className="grid size-9 place-items-center rounded-lg border border-line bg-white text-muted disabled:opacity-30" aria-label="Sposta prima"><ArrowUp size={16} /></button><button type="button" disabled={last} onClick={() => onMove(image, 1)} className="grid size-9 place-items-center rounded-lg border border-line bg-white text-muted disabled:opacity-30" aria-label="Sposta dopo"><ArrowDown size={16} /></button></div><div className="flex gap-1">{!image.is_cover && <button type="button" onClick={() => onCover(image)} className="grid size-9 place-items-center rounded-lg border border-line bg-white text-brand" aria-label="Imposta come copertina"><Check size={16} /></button>}<button type="button" onClick={() => onRemove(image)} className="grid size-9 place-items-center rounded-lg border border-line bg-white text-red-700" aria-label="Elimina fotografia"><Trash2 size={16} /></button></div></div></div></article>
}

function Checklist({ done, label }: { done: boolean; label: string }) {
  return <div className="flex items-center gap-2"><span className={`grid size-6 place-items-center rounded-full ${done ? 'bg-emerald-100 text-emerald-800' : 'bg-stone-100 text-stone-400'}`}>{done ? <Check size={14} /> : <span className="size-1.5 rounded-full bg-current" />}</span><span className={done ? 'text-ink' : 'text-muted'}>{label}</span></div>
}
