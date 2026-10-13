-- LuLab Desk — Fase 2
-- Migrazione incrementale: eseguire DOPO 001_initial_schema.sql.

create type public.job_file_category as enum ('prima', 'durante', 'dopo', 'documento');
create type public.quote_status as enum ('bozza', 'inviato', 'accettato', 'rifiutato');
create type public.agenda_event_type as enum ('appuntamento', 'sopralluogo', 'ritiro', 'consegna', 'lavorazione', 'scadenza');
create type public.expense_category as enum ('materiali', 'servizi', 'trasporto', 'altro');
create type public.payment_kind as enum ('acconto', 'saldo', 'altro');

create or replace function public.generate_quote_code()
returns text
language sql
volatile
set search_path = ''
as $$
  select 'PREV-' || to_char(current_date, 'YYYY') || '-' || upper(substr(md5(random()::text || clock_timestamp()::text), 1, 6));
$$;

create table public.job_files (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  job_id uuid not null references public.jobs(id) on delete cascade,
  category public.job_file_category not null,
  storage_path text not null unique,
  file_name text not null,
  mime_type text not null,
  size_bytes bigint not null check (size_bytes > 0 and size_bytes <= 15728640),
  note text check (note is null or char_length(note) <= 500),
  created_at timestamptz not null default now()
);

create table public.quotes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  job_id uuid not null references public.jobs(id) on delete cascade,
  code text not null default public.generate_quote_code() unique,
  title text not null default 'Preventivo' check (char_length(title) between 2 and 160),
  status public.quote_status not null default 'bozza',
  quote_date date not null default current_date,
  valid_until date,
  labor_hours numeric(10,2) not null default 0 check (labor_hours >= 0),
  hourly_rate numeric(10,2) not null default 0 check (hourly_rate >= 0),
  transport_cost numeric(12,2) not null default 0 check (transport_cost >= 0),
  other_costs numeric(12,2) not null default 0 check (other_costs >= 0),
  margin_percent numeric(7,2) not null default 0 check (margin_percent >= 0),
  subtotal numeric(12,2) not null default 0 check (subtotal >= 0),
  margin_amount numeric(12,2) not null default 0 check (margin_amount >= 0),
  total numeric(12,2) not null default 0 check (total >= 0),
  notes text,
  terms text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index one_accepted_quote_per_job_idx
on public.quotes (job_id) where status = 'accettato';

create table public.quote_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  quote_id uuid not null references public.quotes(id) on delete cascade,
  description text not null check (char_length(description) between 1 and 300),
  quantity numeric(12,3) not null default 1 check (quantity > 0),
  unit text not null default 'pz' check (char_length(unit) between 1 and 20),
  unit_price numeric(12,2) not null default 0 check (unit_price >= 0),
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.agenda_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  job_id uuid references public.jobs(id) on delete cascade,
  title text not null check (char_length(title) between 2 and 160),
  event_type public.agenda_event_type not null default 'appuntamento',
  starts_at timestamptz not null,
  ends_at timestamptz,
  all_day boolean not null default false,
  location text check (location is null or char_length(location) <= 300),
  notes text,
  is_completed boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_at is null or ends_at >= starts_at)
);

create table public.time_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  job_id uuid not null references public.jobs(id) on delete cascade,
  work_date date not null default current_date,
  started_at timestamptz,
  ended_at timestamptz,
  duration_minutes integer not null default 0 check (duration_minutes >= 0),
  hourly_rate numeric(10,2) not null default 0 check (hourly_rate >= 0),
  notes text check (notes is null or char_length(notes) <= 1000),
  is_running boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (not is_running or (started_at is not null and ended_at is null))
);

create unique index one_running_timer_per_user_idx
on public.time_entries (user_id) where is_running;

create table public.job_expenses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  job_id uuid not null references public.jobs(id) on delete cascade,
  category public.expense_category not null default 'altro',
  description text not null check (char_length(description) between 2 and 300),
  amount numeric(12,2) not null check (amount > 0),
  incurred_on date not null default current_date,
  supplier text check (supplier is null or char_length(supplier) <= 200),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.job_payments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  job_id uuid not null references public.jobs(id) on delete cascade,
  kind public.payment_kind not null default 'acconto',
  amount numeric(12,2) not null check (amount > 0),
  paid_on date not null default current_date,
  method text check (method is null or char_length(method) <= 100),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Conserva gli incassi già registrati nella Fase 1 trasformandoli in movimenti.
insert into public.job_payments (user_id, job_id, kind, amount, paid_on, method, notes)
select
  user_id,
  id,
  'altro'::public.payment_kind,
  payments_received,
  opened_at,
  'Importazione Fase 1',
  'Importo preesistente alla migrazione Fase 2'
from public.jobs
where payments_received > 0;

create index job_files_job_category_idx on public.job_files (job_id, category, created_at);
create index quotes_job_idx on public.quotes (job_id, created_at desc);
create index quote_items_quote_idx on public.quote_items (quote_id, sort_order);
create index agenda_events_user_start_idx on public.agenda_events (user_id, starts_at);
create index agenda_events_job_idx on public.agenda_events (job_id);
create index time_entries_job_date_idx on public.time_entries (job_id, work_date desc);
create index job_expenses_job_date_idx on public.job_expenses (job_id, incurred_on desc);
create index job_payments_job_date_idx on public.job_payments (job_id, paid_on desc);

create trigger quotes_updated_at before update on public.quotes
for each row execute function public.set_updated_at();
create trigger quote_items_updated_at before update on public.quote_items
for each row execute function public.set_updated_at();
create trigger agenda_events_updated_at before update on public.agenda_events
for each row execute function public.set_updated_at();
create trigger time_entries_updated_at before update on public.time_entries
for each row execute function public.set_updated_at();
create trigger job_expenses_updated_at before update on public.job_expenses
for each row execute function public.set_updated_at();
create trigger job_payments_updated_at before update on public.job_payments
for each row execute function public.set_updated_at();

create or replace function public.sync_job_payment_total()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_job_id uuid;
begin
  if tg_op = 'DELETE' then
    target_job_id := old.job_id;
  else
    target_job_id := new.job_id;
  end if;
  update public.jobs
  set payments_received = (
    select coalesce(sum(p.amount), 0)
    from public.job_payments p
    where p.job_id = target_job_id
  )
  where id = target_job_id;

  if tg_op = 'UPDATE' and old.job_id is distinct from new.job_id then
    update public.jobs
    set payments_received = (
      select coalesce(sum(p.amount), 0)
      from public.job_payments p
      where p.job_id = old.job_id
    )
    where id = old.job_id;
  end if;

  return null;
end;
$$;

create trigger job_payments_sync_total
after insert or update or delete on public.job_payments
for each row execute function public.sync_job_payment_total();

create or replace function public.sync_job_from_quote()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  should_sync_accepted boolean := false;
  should_sync_sent boolean := false;
begin
  if tg_op = 'INSERT' then
    should_sync_accepted := new.status = 'accettato';
    should_sync_sent := new.status = 'inviato';
  elsif tg_op = 'UPDATE' then
    should_sync_accepted := new.status = 'accettato'
      and (old.status is distinct from 'accettato' or new.total is distinct from old.total);
    should_sync_sent := new.status = 'inviato'
      and old.status is distinct from 'inviato';
  end if;

  if should_sync_accepted then
    update public.jobs
    set agreed_revenue = new.total,
        status = case
          when status in ('nuova_richiesta', 'preventivo_da_preparare', 'preventivo_inviato') then 'confermato'
          else status
        end
    where id = new.job_id;
  elsif should_sync_sent then
    update public.jobs
    set status = case
      when status in ('nuova_richiesta', 'preventivo_da_preparare') then 'preventivo_inviato'
      else status
    end
    where id = new.job_id;
  end if;
  return new;
end;
$$;

create trigger quotes_sync_job
after insert or update of status, total on public.quotes
for each row execute function public.sync_job_from_quote();

alter table public.job_files enable row level security;
alter table public.quotes enable row level security;
alter table public.quote_items enable row level security;
alter table public.agenda_events enable row level security;
alter table public.time_entries enable row level security;
alter table public.job_expenses enable row level security;
alter table public.job_payments enable row level security;

grant usage on type
  public.job_file_category,
  public.quote_status,
  public.agenda_event_type,
  public.expense_category,
  public.payment_kind
to authenticated;

grant select, insert, update, delete on table
  public.job_files,
  public.quotes,
  public.quote_items,
  public.agenda_events,
  public.time_entries,
  public.job_expenses,
  public.job_payments
to authenticated;

revoke all privileges on table
  public.job_files,
  public.quotes,
  public.quote_items,
  public.agenda_events,
  public.time_entries,
  public.job_expenses,
  public.job_payments
from anon;

create policy "Users manage files for their jobs" on public.job_files
for all using (
  user_id = (select auth.uid())
  and exists (select 1 from public.jobs j where j.id = job_id and j.user_id = (select auth.uid()))
)
with check (
  user_id = (select auth.uid())
  and exists (select 1 from public.jobs j where j.id = job_id and j.user_id = (select auth.uid()))
);

create policy "Users manage quotes for their jobs" on public.quotes
for all using (
  user_id = (select auth.uid())
  and exists (select 1 from public.jobs j where j.id = job_id and j.user_id = (select auth.uid()))
)
with check (
  user_id = (select auth.uid())
  and exists (select 1 from public.jobs j where j.id = job_id and j.user_id = (select auth.uid()))
);

create policy "Users manage their quote items" on public.quote_items
for all using (
  user_id = (select auth.uid())
  and exists (select 1 from public.quotes q where q.id = quote_id and q.user_id = (select auth.uid()))
)
with check (
  user_id = (select auth.uid())
  and exists (select 1 from public.quotes q where q.id = quote_id and q.user_id = (select auth.uid()))
);

create policy "Users manage their agenda" on public.agenda_events
for all using (
  user_id = (select auth.uid())
  and (job_id is null or exists (select 1 from public.jobs j where j.id = job_id and j.user_id = (select auth.uid())))
)
with check (
  user_id = (select auth.uid())
  and (job_id is null or exists (select 1 from public.jobs j where j.id = job_id and j.user_id = (select auth.uid())))
);

create policy "Users manage time for their jobs" on public.time_entries
for all using (
  user_id = (select auth.uid())
  and exists (select 1 from public.jobs j where j.id = job_id and j.user_id = (select auth.uid()))
)
with check (
  user_id = (select auth.uid())
  and exists (select 1 from public.jobs j where j.id = job_id and j.user_id = (select auth.uid()))
);

create policy "Users manage expenses for their jobs" on public.job_expenses
for all using (
  user_id = (select auth.uid())
  and exists (select 1 from public.jobs j where j.id = job_id and j.user_id = (select auth.uid()))
)
with check (
  user_id = (select auth.uid())
  and exists (select 1 from public.jobs j where j.id = job_id and j.user_id = (select auth.uid()))
);

create policy "Users manage payments for their jobs" on public.job_payments
for all using (
  user_id = (select auth.uid())
  and exists (select 1 from public.jobs j where j.id = job_id and j.user_id = (select auth.uid()))
)
with check (
  user_id = (select auth.uid())
  and exists (select 1 from public.jobs j where j.id = job_id and j.user_id = (select auth.uid()))
);
