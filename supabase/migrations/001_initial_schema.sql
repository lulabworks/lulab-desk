-- LuLab Desk — schema iniziale Fase 1
-- Eseguire una sola volta nel SQL Editor del progetto Supabase.

create extension if not exists pgcrypto;

create type public.job_type as enum ('restauro', 'su_misura', 'recupero', 'antitarlo');
create type public.job_status as enum (
  'nuova_richiesta',
  'preventivo_da_preparare',
  'preventivo_inviato',
  'confermato',
  'da_iniziare',
  'in_lavorazione',
  'in_attesa',
  'pronto_consegna',
  'consegnato',
  'concluso',
  'non_confermato',
  'annullato'
);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create or replace function public.generate_job_code()
returns text
language sql
volatile
set search_path = ''
as $$
  select 'LL-' || to_char(current_date, 'YYYY') || '-' || upper(substr(md5(random()::text || clock_timestamp()::text), 1, 6));
$$;

create or replace function public.sync_job_completed_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status = 'concluso' and old.status is distinct from 'concluso' then
    new.completed_at = current_date;
  elsif new.status is distinct from 'concluso' and old.status = 'concluso' then
    new.completed_at = null;
  end if;
  return new;
end;
$$;

create table public.user_settings (
  user_id uuid primary key references auth.users(id) on delete cascade default auth.uid(),
  hourly_rate numeric(10,2) not null default 35 check (hourly_rate >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.customers (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  display_name text not null check (char_length(display_name) between 2 and 160),
  phone text check (phone is null or char_length(phone) <= 40),
  email text check (email is null or char_length(email) <= 320),
  address text check (address is null or char_length(address) <= 500),
  notes text check (notes is null or char_length(notes) <= 3000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  customer_id uuid references public.customers(id) on delete set null,
  code text not null default public.generate_job_code() unique,
  title text not null check (char_length(title) between 2 and 120),
  type public.job_type not null,
  description text,
  notes text,
  technical_details text,
  status public.job_status not null default 'nuova_richiesta',
  opened_at date not null default current_date,
  due_date date,
  completed_at date,
  agreed_revenue numeric(12,2) not null default 0 check (agreed_revenue >= 0),
  payments_received numeric(12,2) not null default 0 check (payments_received >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.job_tasks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  job_id uuid not null references public.jobs(id) on delete cascade,
  title text not null check (char_length(title) between 1 and 300),
  is_completed boolean not null default false,
  sort_order integer not null default 0,
  completed_at timestamptz,
  created_at timestamptz not null default now()
);

create index customers_user_name_idx on public.customers (user_id, display_name);
create index jobs_user_status_idx on public.jobs (user_id, status);
create index jobs_user_due_date_idx on public.jobs (user_id, due_date);
create index jobs_customer_id_idx on public.jobs (customer_id);
create index job_tasks_job_id_idx on public.job_tasks (job_id, sort_order);
create index job_tasks_user_open_idx on public.job_tasks (user_id, is_completed);

create trigger user_settings_updated_at before update on public.user_settings
for each row execute function public.set_updated_at();
create trigger customers_updated_at before update on public.customers
for each row execute function public.set_updated_at();
create trigger jobs_updated_at before update on public.jobs
for each row execute function public.set_updated_at();
create trigger jobs_sync_completed_at before update on public.jobs
for each row execute function public.sync_job_completed_at();

alter table public.user_settings enable row level security;
alter table public.customers enable row level security;
alter table public.jobs enable row level security;
alter table public.job_tasks enable row level security;

-- Il progetto non espone automaticamente le nuove tabelle: PostgREST richiede
-- privilegi SQL espliciti oltre alle policy RLS. Solo gli utenti autenticati
-- possono raggiungere le tabelle applicative; RLS limita poi ogni riga al proprietario.
grant usage on schema public to authenticated;
grant usage on type public.job_type, public.job_status to authenticated;
grant select, insert, update, delete on table
  public.user_settings,
  public.customers,
  public.jobs,
  public.job_tasks
to authenticated;

revoke all privileges on table
  public.user_settings,
  public.customers,
  public.jobs,
  public.job_tasks
from anon;

create policy "Users manage their settings" on public.user_settings
for all using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

create policy "Users manage their customers" on public.customers
for all using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

create policy "Users manage their jobs" on public.jobs
for all using ((select auth.uid()) = user_id)
with check (
  (select auth.uid()) = user_id
  and (
    customer_id is null
    or exists (
      select 1 from public.customers c
      where c.id = customer_id and c.user_id = (select auth.uid())
    )
  )
);

create policy "Users manage tasks for their jobs" on public.job_tasks
for all using (
  (select auth.uid()) = user_id
  and exists (
    select 1 from public.jobs j
    where j.id = job_id and j.user_id = (select auth.uid())
  )
)
with check (
  (select auth.uid()) = user_id
  and exists (
    select 1 from public.jobs j
    where j.id = job_id and j.user_id = (select auth.uid())
  )
);

create or replace function public.create_default_user_settings()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
begin
  insert into public.user_settings (user_id) values (new.id)
  on conflict (user_id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.create_default_user_settings();

-- Bucket privato predisposto per fotografie e allegati della Fase 2.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'job-files',
  'job-files',
  false,
  15728640,
  array['image/jpeg', 'image/png', 'image/webp', 'application/pdf']
)
on conflict (id) do nothing;

create policy "Users read their job files" on storage.objects
for select to authenticated
using (bucket_id = 'job-files' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy "Users upload their job files" on storage.objects
for insert to authenticated
with check (bucket_id = 'job-files' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy "Users update their job files" on storage.objects
for update to authenticated
using (bucket_id = 'job-files' and (storage.foldername(name))[1] = (select auth.uid())::text)
with check (bucket_id = 'job-files' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy "Users delete their job files" on storage.objects
for delete to authenticated
using (bucket_id = 'job-files' and (storage.foldername(name))[1] = (select auth.uid())::text);
