-- LuLab Desk — fondazione dati per il sito pubblico
-- Migrazione incrementale: eseguire DOPO 001, 002 e 003.
--
-- La migrazione non abilita automaticamente alcun editor. Il primo proprietario
-- deve essere inserito esplicitamente in public.site_editors da un amministratore
-- del database dopo aver verificato il relativo UUID in auth.users.

begin;

create type public.site_editor_role as enum ('owner', 'editor');
create type public.site_publication_status as enum ('bozza', 'pubblicato', 'non_pubblicato');
create type public.site_collection_availability as enum ('disponibile', 'riservato', 'non_disponibile');
create type public.site_portfolio_image_kind as enum ('prima', 'durante', 'dopo');
create type public.customer_inquiry_status as enum ('nuova', 'in_valutazione', 'convertita', 'archiviata', 'spam');

-- Allowlist editoriale. Non viene popolata automaticamente dagli utenti Auth.
create table public.site_editors (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role public.site_editor_role not null default 'editor',
  is_active boolean not null default true,
  granted_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.is_site_editor()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.site_editors editor
    where editor.user_id = (select auth.uid())
      and editor.is_active
  );
$$;

create or replace function public.is_site_owner()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.site_editors editor
    where editor.user_id = (select auth.uid())
      and editor.is_active
      and editor.role = 'owner'::public.site_editor_role
  );
$$;

create or replace function public.prevent_last_site_owner_removal()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  removes_active_owner boolean := false;
  has_other_owner boolean := false;
begin
  -- Serializza le rimozioni/demozioni concorrenti degli owner. Senza questo
  -- lock due transazioni potrebbero entrambe vedere l'altro owner ancora attivo.
  perform pg_catalog.pg_advisory_xact_lock(1280654402::bigint);

  if tg_op = 'DELETE' then
    removes_active_owner := old.role = 'owner'::public.site_editor_role and old.is_active;
  else
    removes_active_owner := old.role = 'owner'::public.site_editor_role
      and old.is_active
      and (new.role <> 'owner'::public.site_editor_role or not new.is_active);
  end if;

  if removes_active_owner then
    select exists (
      select 1
      from public.site_editors editor
      where editor.user_id <> old.user_id
        and editor.role = 'owner'::public.site_editor_role
        and editor.is_active
    ) into has_other_owner;

    if not has_other_owner then
      raise exception 'Non è possibile rimuovere o disattivare l''ultimo proprietario del sito.';
    end if;
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

create or replace function public.sync_site_publication_metadata()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.publication_status = 'pubblicato'::public.site_publication_status then
    if tg_op = 'INSERT' then
      new.published_at = coalesce(new.published_at, now());
    elsif old.publication_status is distinct from 'pubblicato'::public.site_publication_status
      or new.published_at is null then
      new.published_at = now();
    end if;
  else
    new.published_at = null;
  end if;
  return new;
end;
$$;

create table public.site_collection_items (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (
    char_length(slug) between 2 and 160
    and slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'
  ),
  title text not null check (char_length(title) between 2 and 160),
  description text not null check (char_length(description) between 1 and 12000),
  materials text check (materials is null or char_length(materials) <= 2000),
  dimensions text check (dimensions is null or char_length(dimensions) <= 500),
  condition_description text check (condition_description is null or char_length(condition_description) <= 3000),
  availability public.site_collection_availability not null default 'non_disponibile',
  publication_status public.site_publication_status not null default 'bozza',
  show_price boolean not null default false,
  public_price numeric(12,2) check (public_price is null or public_price > 0),
  is_featured boolean not null default false,
  featured_order integer check (featured_order is null or featured_order >= 0),
  sort_order integer not null default 0 check (sort_order >= 0),
  seo_title text check (seo_title is null or char_length(seo_title) <= 70),
  seo_description text check (seo_description is null or char_length(seo_description) <= 170),
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    (show_price and public_price is not null)
    or (not show_price and public_price is null)
  ),
  check (
    (publication_status = 'pubblicato' and published_at is not null)
    or (publication_status <> 'pubblicato' and published_at is null)
  )
);

-- Collegamento privato: gli UUID delle fonti operative non sono esposti al sito.
create table public.site_collection_item_sources (
  collection_item_id uuid primary key references public.site_collection_items(id) on delete cascade,
  recovered_item_id uuid not null unique references public.recovered_items(id) on delete restrict,
  linked_at timestamptz not null default now()
);

create table public.site_collection_images (
  id uuid primary key default gen_random_uuid(),
  collection_item_id uuid not null references public.site_collection_items(id) on delete restrict,
  storage_bucket text not null default 'site-drafts' check (storage_bucket in ('site-drafts', 'site-public')),
  storage_path text not null,
  alt_text text not null check (char_length(alt_text) between 1 and 300),
  caption text check (caption is null or char_length(caption) <= 1000),
  mime_type text not null check (mime_type in ('image/jpeg', 'image/png', 'image/webp', 'image/avif')),
  size_bytes bigint not null check (size_bytes > 0 and size_bytes <= 10485760),
  width integer check (width is null or width > 0),
  height integer check (height is null or height > 0),
  is_cover boolean not null default false,
  sort_order integer not null default 0 check (sort_order >= 0),
  created_at timestamptz not null default now(),
  check (storage_path like ('collection/' || collection_item_id::text || '/%')),
  unique (storage_bucket, storage_path)
);

-- Le immagini pubbliche sono copie deliberate e ottimizzate: non esiste una FK
-- verso recovered_item_files o job_files, così gli originali restano privati.

create table public.site_portfolio_projects (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (
    char_length(slug) between 2 and 160
    and slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'
  ),
  title text not null check (char_length(title) between 2 and 160),
  summary text not null check (char_length(summary) between 1 and 1000),
  description text not null check (char_length(description) between 1 and 12000),
  category text not null check (char_length(category) between 2 and 100),
  publication_status public.site_publication_status not null default 'bozza',
  is_featured boolean not null default false,
  featured_order integer check (featured_order is null or featured_order >= 0),
  sort_order integer not null default 0 check (sort_order >= 0),
  seo_title text check (seo_title is null or char_length(seo_title) <= 70),
  seo_description text check (seo_description is null or char_length(seo_description) <= 170),
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    (publication_status = 'pubblicato' and published_at is not null)
    or (publication_status <> 'pubblicato' and published_at is null)
  )
);

-- Collegamento privato: nessun dato della commessa entra nella proiezione pubblica.
create table public.site_portfolio_project_sources (
  portfolio_project_id uuid primary key references public.site_portfolio_projects(id) on delete cascade,
  job_id uuid not null unique references public.jobs(id) on delete restrict,
  linked_at timestamptz not null default now()
);

create table public.site_portfolio_images (
  id uuid primary key default gen_random_uuid(),
  portfolio_project_id uuid not null references public.site_portfolio_projects(id) on delete restrict,
  image_kind public.site_portfolio_image_kind not null default 'durante',
  storage_bucket text not null default 'site-drafts' check (storage_bucket in ('site-drafts', 'site-public')),
  storage_path text not null,
  alt_text text not null check (char_length(alt_text) between 1 and 300),
  caption text check (caption is null or char_length(caption) <= 1000),
  mime_type text not null check (mime_type in ('image/jpeg', 'image/png', 'image/webp', 'image/avif')),
  size_bytes bigint not null check (size_bytes > 0 and size_bytes <= 10485760),
  width integer check (width is null or width > 0),
  height integer check (height is null or height > 0),
  is_cover boolean not null default false,
  sort_order integer not null default 0 check (sort_order >= 0),
  created_at timestamptz not null default now(),
  check (storage_path like ('portfolio/' || portfolio_project_id::text || '/%')),
  unique (storage_bucket, storage_path)
);

-- Impedisce di pubblicare metadati che puntano allo staging privato e impedisce
-- di ritirare/eliminare una scheda finché esistono copie ancora pubbliche.
-- La funzione è trigger-only e usa nomi qualificati con search_path vuoto.
create or replace function public.guard_site_publication_media()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  entity_id uuid;
  object_prefix text;
  has_private_metadata boolean := false;
  has_missing_public_objects boolean := false;
  has_orphan_public_objects boolean := false;
  has_public_metadata boolean := false;
  has_public_objects boolean := false;
  is_publishing boolean := false;
  is_withdrawing boolean := false;
begin
  entity_id := case when tg_op = 'DELETE' then old.id else new.id end;

  if tg_table_name = 'site_collection_items' then
    object_prefix := 'collection/' || entity_id::text || '/';

    if tg_op = 'UPDATE' then
      is_publishing := new.publication_status = 'pubblicato'::public.site_publication_status
        and old.publication_status is distinct from 'pubblicato'::public.site_publication_status;
      is_withdrawing := old.publication_status = 'pubblicato'::public.site_publication_status
        and new.publication_status is distinct from 'pubblicato'::public.site_publication_status;
    elsif tg_op = 'DELETE' then
      is_withdrawing := true;
    end if;

    if is_publishing then
      select exists (
        select 1 from public.site_collection_images image
        where image.collection_item_id = entity_id
          and image.storage_bucket <> 'site-public'
      ) into has_private_metadata;

      select exists (
        select 1 from public.site_collection_images image
        where image.collection_item_id = entity_id
          and image.storage_bucket = 'site-public'
          and not exists (
            select 1 from storage.objects object
            where object.bucket_id = 'site-public'
              and object.name = image.storage_path
          )
      ) into has_missing_public_objects;

      select exists (
        select 1 from storage.objects object
        where object.bucket_id = 'site-public'
          and object.name like object_prefix || '%'
          and not exists (
            select 1 from public.site_collection_images image
            where image.collection_item_id = entity_id
              and image.storage_bucket = 'site-public'
              and image.storage_path = object.name
          )
      ) into has_orphan_public_objects;
    end if;

    if is_withdrawing then
      select exists (
        select 1 from public.site_collection_images image
        where image.collection_item_id = entity_id
          and image.storage_bucket = 'site-public'
      ) into has_public_metadata;
    end if;
  elsif tg_table_name = 'site_portfolio_projects' then
    object_prefix := 'portfolio/' || entity_id::text || '/';

    if tg_op = 'UPDATE' then
      is_publishing := new.publication_status = 'pubblicato'::public.site_publication_status
        and old.publication_status is distinct from 'pubblicato'::public.site_publication_status;
      is_withdrawing := old.publication_status = 'pubblicato'::public.site_publication_status
        and new.publication_status is distinct from 'pubblicato'::public.site_publication_status;
    elsif tg_op = 'DELETE' then
      is_withdrawing := true;
    end if;

    if is_publishing then
      select exists (
        select 1 from public.site_portfolio_images image
        where image.portfolio_project_id = entity_id
          and image.storage_bucket <> 'site-public'
      ) into has_private_metadata;

      select exists (
        select 1 from public.site_portfolio_images image
        where image.portfolio_project_id = entity_id
          and image.storage_bucket = 'site-public'
          and not exists (
            select 1 from storage.objects object
            where object.bucket_id = 'site-public'
              and object.name = image.storage_path
          )
      ) into has_missing_public_objects;

      select exists (
        select 1 from storage.objects object
        where object.bucket_id = 'site-public'
          and object.name like object_prefix || '%'
          and not exists (
            select 1 from public.site_portfolio_images image
            where image.portfolio_project_id = entity_id
              and image.storage_bucket = 'site-public'
              and image.storage_path = object.name
          )
      ) into has_orphan_public_objects;
    end if;

    if is_withdrawing then
      select exists (
        select 1 from public.site_portfolio_images image
        where image.portfolio_project_id = entity_id
          and image.storage_bucket = 'site-public'
      ) into has_public_metadata;
    end if;
  else
    raise exception 'Tabella non supportata dal controllo media: %.', tg_table_name;
  end if;

  if is_publishing and has_private_metadata then
    raise exception 'Prima della pubblicazione tutte le immagini devono essere promosse da site-drafts a site-public.';
  end if;
  if is_publishing and has_missing_public_objects then
    raise exception 'La pubblicazione contiene metadati di immagini senza il corrispondente oggetto in site-public.';
  end if;
  if is_publishing and has_orphan_public_objects then
    raise exception 'Sono presenti oggetti pubblici senza metadati coerenti per la scheda.';
  end if;

  if is_withdrawing then
    select exists (
      select 1 from storage.objects object
      where object.bucket_id = 'site-public'
        and object.name like object_prefix || '%'
    ) into has_public_objects;

    if has_public_metadata or has_public_objects then
      raise exception 'Rimuovere prima metadati e oggetti da site-public; il ritiro non può lasciare file pubblici raggiungibili.';
    end if;
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

-- Mantiene coerenti i metadati applicativi con la riga dell'oggetto Storage.
-- L'upload dell'oggetto deve avvenire prima dell'inserimento/aggiornamento dei
-- metadati; la cancellazione avviene nell'ordine inverso.
create or replace function public.validate_site_image_storage_object()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1
    from storage.objects object
    where object.bucket_id = new.storage_bucket
      and object.name = new.storage_path
  ) then
    raise exception 'Oggetto Storage assente per %.', new.storage_bucket || '/' || new.storage_path;
  end if;
  return new;
end;
$$;

create or replace function public.generate_inquiry_reference()
returns text
language sql
volatile
set search_path = ''
as $$
  select 'RICH-' || to_char(current_date, 'YYYY') || '-' || upper(substr(md5(random()::text || clock_timestamp()::text), 1, 8));
$$;

create table public.customer_inquiries (
  id uuid primary key default gen_random_uuid(),
  reference_code text not null default public.generate_inquiry_reference() unique,
  status public.customer_inquiry_status not null default 'nuova',
  request_type text not null check (char_length(request_type) between 2 and 100),
  customer_name text not null check (char_length(btrim(customer_name)) between 2 and 160),
  email text check (email is null or char_length(btrim(email)) between 3 and 320),
  phone text check (phone is null or char_length(btrim(phone)) between 3 and 40),
  message text not null check (char_length(message) between 10 and 6000),
  source_page text check (source_page is null or char_length(source_page) <= 500),
  privacy_consent_at timestamptz not null,
  handled_by uuid references auth.users(id) on delete set null,
  converted_job_id uuid references public.jobs(id) on delete set null,
  submitted_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (email is not null or phone is not null)
);

create table public.customer_inquiry_files (
  id uuid primary key default gen_random_uuid(),
  inquiry_id uuid not null references public.customer_inquiries(id) on delete restrict,
  storage_path text not null unique,
  file_name text not null check (char_length(file_name) between 1 and 255),
  mime_type text not null check (mime_type in ('image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif')),
  size_bytes bigint not null check (size_bytes > 0 and size_bytes <= 15728640),
  created_at timestamptz not null default now(),
  check (storage_path like ('inquiries/' || inquiry_id::text || '/%'))
);

-- Gli allegati delle richieste seguono lo stesso ordine sicuro dei media del
-- sito: prima viene creato l'oggetto privato, poi il relativo metadato.
create or replace function public.validate_inquiry_file_storage_object()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1
    from storage.objects object
    where object.bucket_id = 'inquiry-uploads'
      and object.name = new.storage_path
  ) then
    raise exception 'Oggetto Storage assente per inquiry-uploads/%.', new.storage_path;
  end if;
  return new;
end;
$$;

create index site_collection_public_idx
on public.site_collection_items (sort_order, published_at desc)
where publication_status = 'pubblicato';
create index site_collection_featured_idx
on public.site_collection_items (featured_order, sort_order)
where publication_status = 'pubblicato' and is_featured;
create index site_collection_images_item_idx
on public.site_collection_images (collection_item_id, sort_order, created_at);
create unique index site_collection_one_cover_idx
on public.site_collection_images (collection_item_id, storage_bucket)
where is_cover;

create index site_portfolio_public_idx
on public.site_portfolio_projects (sort_order, published_at desc)
where publication_status = 'pubblicato';
create index site_portfolio_category_idx
on public.site_portfolio_projects (category, sort_order)
where publication_status = 'pubblicato';
create index site_portfolio_featured_idx
on public.site_portfolio_projects (featured_order, sort_order)
where publication_status = 'pubblicato' and is_featured;
create index site_portfolio_images_project_idx
on public.site_portfolio_images (portfolio_project_id, image_kind, sort_order, created_at);
create unique index site_portfolio_one_cover_idx
on public.site_portfolio_images (portfolio_project_id, storage_bucket)
where is_cover;

create index customer_inquiries_status_date_idx
on public.customer_inquiries (status, submitted_at desc);
create index customer_inquiries_converted_job_idx
on public.customer_inquiries (converted_job_id)
where converted_job_id is not null;
create index customer_inquiry_files_inquiry_idx
on public.customer_inquiry_files (inquiry_id, created_at);

create trigger site_editors_updated_at before update on public.site_editors
for each row execute function public.set_updated_at();
create trigger site_editors_keep_owner before update or delete on public.site_editors
for each row execute function public.prevent_last_site_owner_removal();

create trigger site_collection_items_updated_at before update on public.site_collection_items
for each row execute function public.set_updated_at();
create trigger site_collection_items_publication before insert or update of publication_status, published_at on public.site_collection_items
for each row execute function public.sync_site_publication_metadata();
create trigger site_collection_items_media_guard_update before update of publication_status on public.site_collection_items
for each row execute function public.guard_site_publication_media();
create trigger site_collection_items_media_guard_delete before delete on public.site_collection_items
for each row execute function public.guard_site_publication_media();
create trigger site_collection_images_validate_storage before insert or update of storage_bucket, storage_path on public.site_collection_images
for each row execute function public.validate_site_image_storage_object();

create trigger site_portfolio_projects_updated_at before update on public.site_portfolio_projects
for each row execute function public.set_updated_at();
create trigger site_portfolio_projects_publication before insert or update of publication_status, published_at on public.site_portfolio_projects
for each row execute function public.sync_site_publication_metadata();
create trigger site_portfolio_projects_media_guard_update before update of publication_status on public.site_portfolio_projects
for each row execute function public.guard_site_publication_media();
create trigger site_portfolio_projects_media_guard_delete before delete on public.site_portfolio_projects
for each row execute function public.guard_site_publication_media();
create trigger site_portfolio_images_validate_storage before insert or update of storage_bucket, storage_path on public.site_portfolio_images
for each row execute function public.validate_site_image_storage_object();

create trigger customer_inquiries_updated_at before update on public.customer_inquiries
for each row execute function public.set_updated_at();
create trigger customer_inquiry_files_validate_storage before insert or update of storage_path on public.customer_inquiry_files
for each row execute function public.validate_inquiry_file_storage_object();

alter table public.site_editors enable row level security;
alter table public.site_collection_items enable row level security;
alter table public.site_collection_item_sources enable row level security;
alter table public.site_collection_images enable row level security;
alter table public.site_portfolio_projects enable row level security;
alter table public.site_portfolio_project_sources enable row level security;
alter table public.site_portfolio_images enable row level security;
alter table public.customer_inquiries enable row level security;
alter table public.customer_inquiry_files enable row level security;

-- Nessun privilegio implicito: si parte da una matrice vuota.
revoke all privileges on table
  public.site_editors,
  public.site_collection_items,
  public.site_collection_item_sources,
  public.site_collection_images,
  public.site_portfolio_projects,
  public.site_portfolio_project_sources,
  public.site_portfolio_images,
  public.customer_inquiries,
  public.customer_inquiry_files
from anon, authenticated;

grant usage on schema public to anon, authenticated, service_role;
grant usage on type
  public.site_publication_status,
  public.site_collection_availability,
  public.site_portfolio_image_kind
to anon, authenticated;
grant usage on type
  public.site_editor_role,
  public.customer_inquiry_status
to authenticated;
grant usage on type
  public.site_editor_role,
  public.site_publication_status,
  public.site_collection_availability,
  public.site_portfolio_image_kind,
  public.customer_inquiry_status
to service_role;

-- Gli utenti anonimi leggono esclusivamente le proiezioni pubbliche. RLS
-- nasconde bozze e contenuti ritirati; nessuna tabella operativa viene concessa.
grant select on table
  public.site_collection_items,
  public.site_collection_images,
  public.site_portfolio_projects,
  public.site_portfolio_images
to anon;

grant select, insert, update, delete on table
  public.site_editors,
  public.site_collection_items,
  public.site_collection_item_sources,
  public.site_collection_images,
  public.site_portfolio_projects,
  public.site_portfolio_project_sources,
  public.site_portfolio_images
to authenticated;

-- Le richieste saranno create in una fase successiva da una Edge Function.
-- Per ora gli editor possono leggerle, aggiornarle e cancellarle secondo RLS,
-- ma non inserirle direttamente dal frontend autenticato.
grant select, update, delete on table public.customer_inquiries to authenticated;
grant select, delete on table public.customer_inquiry_files to authenticated;

grant all privileges on table
  public.site_editors,
  public.site_collection_items,
  public.site_collection_item_sources,
  public.site_collection_images,
  public.site_portfolio_projects,
  public.site_portfolio_project_sources,
  public.site_portfolio_images,
  public.customer_inquiries,
  public.customer_inquiry_files
to service_role;

revoke all on function
  public.is_site_editor(),
  public.is_site_owner(),
  public.prevent_last_site_owner_removal(),
  public.sync_site_publication_metadata(),
  public.guard_site_publication_media(),
  public.validate_site_image_storage_object(),
  public.validate_inquiry_file_storage_object(),
  public.generate_inquiry_reference()
from public, anon, authenticated;

grant execute on function public.is_site_editor(), public.is_site_owner() to authenticated;
grant execute on function public.generate_inquiry_reference() to service_role;

create policy "Users read their own editorial authorization" on public.site_editors
for select to authenticated
using (user_id = (select auth.uid()) or public.is_site_owner());

create policy "Site owners add editors" on public.site_editors
for insert to authenticated
with check (public.is_site_owner());

create policy "Site owners update editors" on public.site_editors
for update to authenticated
using (public.is_site_owner())
with check (public.is_site_owner());

create policy "Site owners remove editors" on public.site_editors
for delete to authenticated
using (public.is_site_owner());

create policy "Public reads published collection items" on public.site_collection_items
for select to anon, authenticated
using (
  publication_status = 'pubblicato'::public.site_publication_status
  and published_at is not null
  and published_at <= now()
);

create policy "Site editors read all collection items" on public.site_collection_items
for select to authenticated
using (public.is_site_editor());

create policy "Site editors create collection items" on public.site_collection_items
for insert to authenticated
with check (public.is_site_editor());

create policy "Site editors update collection items" on public.site_collection_items
for update to authenticated
using (public.is_site_editor())
with check (public.is_site_editor());

create policy "Site owners delete collection items" on public.site_collection_items
for delete to authenticated
using (public.is_site_owner());

create policy "Site editors read collection sources" on public.site_collection_item_sources
for select to authenticated
using (public.is_site_editor());

create policy "Site editors link their recovered items" on public.site_collection_item_sources
for insert to authenticated
with check (
  public.is_site_editor()
  and exists (
    select 1
    from public.recovered_items recovered
    where recovered.id = recovered_item_id
      and recovered.user_id = (select auth.uid())
  )
);

create policy "Site editors update their recovered item links" on public.site_collection_item_sources
for update to authenticated
using (
  public.is_site_editor()
  and exists (
    select 1
    from public.recovered_items recovered
    where recovered.id = recovered_item_id
      and recovered.user_id = (select auth.uid())
  )
)
with check (
  public.is_site_editor()
  and exists (
    select 1
    from public.recovered_items recovered
    where recovered.id = recovered_item_id
      and recovered.user_id = (select auth.uid())
  )
);

create policy "Site editors unlink collection sources" on public.site_collection_item_sources
for delete to authenticated
using (
  public.is_site_editor()
  and exists (
    select 1
    from public.recovered_items recovered
    where recovered.id = recovered_item_id
      and recovered.user_id = (select auth.uid())
  )
);

create policy "Public reads images of published collection items" on public.site_collection_images
for select to anon, authenticated
using (
  storage_bucket = 'site-public'
  and exists (
    select 1
    from public.site_collection_items item
    where item.id = collection_item_id
      and item.publication_status = 'pubblicato'::public.site_publication_status
      and item.published_at is not null
      and item.published_at <= now()
  )
);

create policy "Site editors manage collection images" on public.site_collection_images
for all to authenticated
using (public.is_site_editor())
with check (public.is_site_editor());

create policy "Public reads published portfolio projects" on public.site_portfolio_projects
for select to anon, authenticated
using (
  publication_status = 'pubblicato'::public.site_publication_status
  and published_at is not null
  and published_at <= now()
);

create policy "Site editors read all portfolio projects" on public.site_portfolio_projects
for select to authenticated
using (public.is_site_editor());

create policy "Site editors create portfolio projects" on public.site_portfolio_projects
for insert to authenticated
with check (public.is_site_editor());

create policy "Site editors update portfolio projects" on public.site_portfolio_projects
for update to authenticated
using (public.is_site_editor())
with check (public.is_site_editor());

create policy "Site owners delete portfolio projects" on public.site_portfolio_projects
for delete to authenticated
using (public.is_site_owner());

create policy "Site editors read portfolio sources" on public.site_portfolio_project_sources
for select to authenticated
using (public.is_site_editor());

create policy "Site editors link their jobs" on public.site_portfolio_project_sources
for insert to authenticated
with check (
  public.is_site_editor()
  and exists (
    select 1
    from public.jobs job
    where job.id = job_id
      and job.user_id = (select auth.uid())
  )
);

create policy "Site editors update their job links" on public.site_portfolio_project_sources
for update to authenticated
using (
  public.is_site_editor()
  and exists (
    select 1
    from public.jobs job
    where job.id = job_id
      and job.user_id = (select auth.uid())
  )
)
with check (
  public.is_site_editor()
  and exists (
    select 1
    from public.jobs job
    where job.id = job_id
      and job.user_id = (select auth.uid())
  )
);

create policy "Site editors unlink portfolio sources" on public.site_portfolio_project_sources
for delete to authenticated
using (
  public.is_site_editor()
  and exists (
    select 1
    from public.jobs job
    where job.id = job_id
      and job.user_id = (select auth.uid())
  )
);

create policy "Public reads images of published portfolio projects" on public.site_portfolio_images
for select to anon, authenticated
using (
  storage_bucket = 'site-public'
  and exists (
    select 1
    from public.site_portfolio_projects project
    where project.id = portfolio_project_id
      and project.publication_status = 'pubblicato'::public.site_publication_status
      and project.published_at is not null
      and project.published_at <= now()
  )
);

create policy "Site editors manage portfolio images" on public.site_portfolio_images
for all to authenticated
using (public.is_site_editor())
with check (public.is_site_editor());

create policy "Site editors read customer inquiries" on public.customer_inquiries
for select to authenticated
using (public.is_site_editor());

create policy "Site editors update customer inquiries" on public.customer_inquiries
for update to authenticated
using (
  public.is_site_editor()
  and (handled_by is null or handled_by = (select auth.uid()))
  and (
    converted_job_id is null
    or exists (
      select 1
      from public.jobs job
      where job.id = converted_job_id
        and job.user_id = (select auth.uid())
    )
  )
)
with check (
  public.is_site_editor()
  and (handled_by is null or handled_by = (select auth.uid()))
  and (
    converted_job_id is null
    or exists (
      select 1
      from public.jobs job
      where job.id = converted_job_id
        and job.user_id = (select auth.uid())
    )
  )
);

create policy "Site owners delete customer inquiries" on public.customer_inquiries
for delete to authenticated
using (public.is_site_owner());

create policy "Site editors read inquiry files" on public.customer_inquiry_files
for select to authenticated
using (
  public.is_site_editor()
  and exists (
    select 1
    from public.customer_inquiries inquiry
    where inquiry.id = inquiry_id
  )
);

create policy "Site owners delete inquiry file records" on public.customer_inquiry_files
for delete to authenticated
using (public.is_site_owner());

-- Staging privato per preparare schede complete, fotografie comprese, senza
-- rendere pubblici i file. Non sostituisce job-files, che resta invariato.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'site-drafts',
  'site-drafts',
  false,
  10485760,
  array['image/jpeg', 'image/png', 'image/webp', 'image/avif']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- Bucket pubblico: contiene esclusivamente copie approvate e ottimizzate.
-- Gli originali operativi restano nel bucket privato job-files, non modificato qui.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'site-public',
  'site-public',
  true,
  10485760,
  array['image/jpeg', 'image/png', 'image/webp', 'image/avif']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- Bucket privato: nessuna policy anonima viene creata. Upload pubblici e URL
-- firmati saranno gestiti in una fase successiva tramite Edge Function.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'inquiry-uploads',
  'inquiry-uploads',
  false,
  15728640,
  array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create policy "Site editors read draft media objects" on storage.objects
for select to authenticated
using (bucket_id = 'site-drafts' and public.is_site_editor());

create policy "Site editors upload draft media objects" on storage.objects
for insert to authenticated
with check (
  bucket_id = 'site-drafts'
  and public.is_site_editor()
  and (
    (
      (storage.foldername(name))[1] = 'collection'
      and exists (
        select 1
        from public.site_collection_items item
        where item.id::text = (storage.foldername(name))[2]
      )
    )
    or (
      (storage.foldername(name))[1] = 'portfolio'
      and exists (
        select 1
        from public.site_portfolio_projects project
        where project.id::text = (storage.foldername(name))[2]
      )
    )
  )
);

create policy "Site editors update unreferenced draft media objects" on storage.objects
for update to authenticated
using (
  bucket_id = 'site-drafts'
  and public.is_site_editor()
  and not exists (
    select 1 from public.site_collection_images image
    where image.storage_bucket = bucket_id and image.storage_path = name
  )
  and not exists (
    select 1 from public.site_portfolio_images image
    where image.storage_bucket = bucket_id and image.storage_path = name
  )
)
with check (
  bucket_id = 'site-drafts'
  and public.is_site_editor()
  and (
    (
      (storage.foldername(name))[1] = 'collection'
      and exists (
        select 1
        from public.site_collection_items item
        where item.id::text = (storage.foldername(name))[2]
      )
    )
    or (
      (storage.foldername(name))[1] = 'portfolio'
      and exists (
        select 1
        from public.site_portfolio_projects project
        where project.id::text = (storage.foldername(name))[2]
      )
    )
  )
);

create policy "Site editors delete unreferenced draft media objects" on storage.objects
for delete to authenticated
using (
  bucket_id = 'site-drafts'
  and public.is_site_editor()
  and not exists (
    select 1 from public.site_collection_images image
    where image.storage_bucket = bucket_id and image.storage_path = name
  )
  and not exists (
    select 1 from public.site_portfolio_images image
    where image.storage_bucket = bucket_id and image.storage_path = name
  )
);

create policy "Site editors read public media objects" on storage.objects
for select to authenticated
using (bucket_id = 'site-public' and public.is_site_editor());

create policy "Site editors upload public media objects" on storage.objects
for insert to authenticated
with check (
  bucket_id = 'site-public'
  and public.is_site_editor()
  and (
    (
      (storage.foldername(name))[1] = 'collection'
      and exists (
        select 1
        from public.site_collection_items item
        where item.id::text = (storage.foldername(name))[2]
      )
    )
    or (
      (storage.foldername(name))[1] = 'portfolio'
      and exists (
        select 1
        from public.site_portfolio_projects project
        where project.id::text = (storage.foldername(name))[2]
      )
    )
  )
);

create policy "Site editors update unreferenced public media objects" on storage.objects
for update to authenticated
using (
  bucket_id = 'site-public'
  and public.is_site_editor()
  and not exists (
    select 1 from public.site_collection_images image
    where image.storage_bucket = bucket_id and image.storage_path = name
  )
  and not exists (
    select 1 from public.site_portfolio_images image
    where image.storage_bucket = bucket_id and image.storage_path = name
  )
)
with check (
  bucket_id = 'site-public'
  and public.is_site_editor()
  and (
    (
      (storage.foldername(name))[1] = 'collection'
      and exists (
        select 1
        from public.site_collection_items item
        where item.id::text = (storage.foldername(name))[2]
      )
    )
    or (
      (storage.foldername(name))[1] = 'portfolio'
      and exists (
        select 1
        from public.site_portfolio_projects project
        where project.id::text = (storage.foldername(name))[2]
      )
    )
  )
);

create policy "Site editors delete unreferenced public media objects" on storage.objects
for delete to authenticated
using (
  bucket_id = 'site-public'
  and public.is_site_editor()
  and not exists (
    select 1 from public.site_collection_images image
    where image.storage_bucket = bucket_id and image.storage_path = name
  )
  and not exists (
    select 1 from public.site_portfolio_images image
    where image.storage_bucket = bucket_id and image.storage_path = name
  )
);

create policy "Site editors read inquiry upload objects" on storage.objects
for select to authenticated
using (bucket_id = 'inquiry-uploads' and public.is_site_editor());

create policy "Site editors upload inquiry objects" on storage.objects
for insert to authenticated
with check (
  bucket_id = 'inquiry-uploads'
  and public.is_site_editor()
  and (storage.foldername(name))[1] = 'inquiries'
  and exists (
    select 1
    from public.customer_inquiries inquiry
    where inquiry.id::text = (storage.foldername(name))[2]
  )
);

create policy "Site editors update unreferenced inquiry objects" on storage.objects
for update to authenticated
using (
  bucket_id = 'inquiry-uploads'
  and public.is_site_editor()
  and not exists (
    select 1
    from public.customer_inquiry_files inquiry_file
    where inquiry_file.storage_path = name
  )
)
with check (
  bucket_id = 'inquiry-uploads'
  and public.is_site_editor()
  and (storage.foldername(name))[1] = 'inquiries'
  and exists (
    select 1
    from public.customer_inquiries inquiry
    where inquiry.id::text = (storage.foldername(name))[2]
  )
);

create policy "Site owners delete unreferenced inquiry upload objects" on storage.objects
for delete to authenticated
using (
  bucket_id = 'inquiry-uploads'
  and public.is_site_owner()
  and not exists (
    select 1
    from public.customer_inquiry_files inquiry_file
    where inquiry_file.storage_path = name
  )
);

commit;
