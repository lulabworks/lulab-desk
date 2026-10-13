-- LuLab Desk — Fase 3
-- Migrazione incrementale: eseguire DOPO 001_initial_schema.sql e 002_phase2_operations.sql.

create type public.material_movement_type as enum ('carico', 'scarico', 'rettifica', 'consumo_commessa', 'consumo_recupero');
create type public.recovered_item_status as enum ('acquisito', 'da_restaurare', 'in_restauro', 'pronto', 'in_vendita', 'venduto');
create type public.antitarlo_status as enum ('da_programmare', 'ritirato', 'dal_collaboratore', 'in_rientro', 'pronto_riconsegna', 'riconsegnato', 'annullato');

create or replace function public.generate_recovery_code()
returns text
language sql
volatile
set search_path = ''
as $$
  select 'REC-' || to_char(current_date, 'YYYY') || '-' || upper(substr(md5(random()::text || clock_timestamp()::text), 1, 6));
$$;

create table public.material_categories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  name text not null check (char_length(name) between 2 and 80),
  created_at timestamptz not null default now(),
  unique (user_id, name)
);

create table public.suppliers (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  name text not null check (char_length(name) between 2 and 160),
  phone text check (phone is null or char_length(phone) <= 40),
  email text check (email is null or char_length(email) <= 320),
  address text check (address is null or char_length(address) <= 500),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, name)
);

create table public.materials (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  category_id uuid references public.material_categories(id) on delete set null,
  supplier_id uuid references public.suppliers(id) on delete set null,
  code text,
  name text not null check (char_length(name) between 2 and 160),
  unit text not null check (unit in ('pz', 'm', 'm²', 'l', 'kg', 'conf')),
  unit_price numeric(12,4) not null default 0 check (unit_price >= 0),
  quantity_available numeric(14,3) not null default 0 check (quantity_available >= 0),
  minimum_stock numeric(14,3) not null default 0 check (minimum_stock >= 0),
  notes text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, code)
);

create table public.recovered_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  job_id uuid references public.jobs(id) on delete set null,
  code text not null default public.generate_recovery_code() unique,
  name text not null check (char_length(name) between 2 and 160),
  description text,
  origin text check (origin is null or char_length(origin) <= 300),
  acquired_on date not null default current_date,
  acquisition_cost numeric(12,2) not null default 0 check (acquisition_cost >= 0),
  initial_condition text,
  required_work text,
  expected_sale_price numeric(12,2) not null default 0 check (expected_sale_price >= 0),
  actual_sale_price numeric(12,2) check (actual_sale_price is null or actual_sale_price >= 0),
  sold_on date,
  status public.recovered_item_status not null default 'acquisito',
  location text check (location is null or char_length(location) <= 200),
  is_archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((status = 'venduto' and actual_sale_price is not null and sold_on is not null) or status <> 'venduto')
);

create table public.recovered_item_files (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  recovered_item_id uuid not null references public.recovered_items(id) on delete cascade,
  storage_path text not null unique,
  file_name text not null,
  mime_type text not null check (mime_type in ('image/jpeg', 'image/png', 'image/webp')),
  size_bytes bigint not null check (size_bytes > 0 and size_bytes <= 15728640),
  created_at timestamptz not null default now()
);

create table public.recovery_time_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  recovered_item_id uuid not null references public.recovered_items(id) on delete cascade,
  work_date date not null default current_date,
  duration_minutes integer not null check (duration_minutes > 0),
  hourly_rate numeric(10,2) not null check (hourly_rate >= 0),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.recovery_expenses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  recovered_item_id uuid not null references public.recovered_items(id) on delete cascade,
  description text not null check (char_length(description) between 2 and 300),
  amount numeric(12,2) not null check (amount > 0),
  incurred_on date not null default current_date,
  supplier text check (supplier is null or char_length(supplier) <= 200),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.material_movements (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  material_id uuid not null references public.materials(id) on delete restrict,
  movement_type public.material_movement_type not null,
  quantity_delta numeric(14,3) not null check (quantity_delta <> 0),
  unit_cost_snapshot numeric(12,4) not null check (unit_cost_snapshot >= 0),
  occurred_on date not null default current_date,
  job_id uuid references public.jobs(id) on delete restrict,
  recovered_item_id uuid references public.recovered_items(id) on delete restrict,
  supplier_id uuid references public.suppliers(id) on delete restrict,
  reversal_of_id uuid unique references public.material_movements(id) on delete restrict,
  notes text,
  created_at timestamptz not null default now(),
  check (
    (reversal_of_id is not null and movement_type = 'rettifica')
    or (reversal_of_id is null and (
      (movement_type = 'carico' and quantity_delta > 0 and job_id is null and recovered_item_id is null)
      or (movement_type in ('scarico', 'rettifica') and job_id is null and recovered_item_id is null)
      or (movement_type = 'consumo_commessa' and quantity_delta < 0 and job_id is not null)
      or (movement_type = 'consumo_recupero' and quantity_delta < 0 and recovered_item_id is not null)
    ))
  )
);

create table public.external_collaborators (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  name text not null check (char_length(name) between 2 and 160),
  phone text check (phone is null or char_length(phone) <= 40),
  email text check (email is null or char_length(email) <= 320),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, name)
);

create table public.antitarlo_treatments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  job_id uuid not null references public.jobs(id) on delete cascade,
  customer_id uuid references public.customers(id) on delete set null,
  recovered_item_id uuid references public.recovered_items(id) on delete set null,
  collaborator_id uuid references public.external_collaborators(id) on delete set null,
  furniture_description text not null check (char_length(furniture_description) between 2 and 500),
  pickup_date date,
  collaborator_delivery_date date,
  expected_return_date date,
  customer_redelivery_date date,
  status public.antitarlo_status not null default 'da_programmare',
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (collaborator_delivery_date is null or pickup_date is null or collaborator_delivery_date >= pickup_date),
  check (expected_return_date is null or collaborator_delivery_date is null or expected_return_date >= collaborator_delivery_date),
  check (customer_redelivery_date is null or pickup_date is null or customer_redelivery_date >= pickup_date)
);

alter table public.job_expenses
  add column antitarlo_treatment_id uuid references public.antitarlo_treatments(id) on delete set null;
alter table public.job_payments
  add column antitarlo_treatment_id uuid references public.antitarlo_treatments(id) on delete set null;
alter table public.agenda_events
  add column antitarlo_treatment_id uuid references public.antitarlo_treatments(id) on delete set null;

create index material_categories_user_name_idx on public.material_categories (user_id, name);
create index suppliers_user_name_idx on public.suppliers (user_id, name);
create index materials_user_name_idx on public.materials (user_id, name);
create index materials_user_stock_idx on public.materials (user_id, quantity_available, minimum_stock) where is_active;
create index material_movements_material_date_idx on public.material_movements (material_id, occurred_on desc);
create index material_movements_job_idx on public.material_movements (job_id) where job_id is not null;
create index material_movements_recovery_idx on public.material_movements (recovered_item_id) where recovered_item_id is not null;
create index recovered_items_user_status_idx on public.recovered_items (user_id, status, updated_at desc);
create unique index recovered_items_job_unique_idx on public.recovered_items (job_id) where job_id is not null;
create index recovered_item_files_item_idx on public.recovered_item_files (recovered_item_id, created_at desc);
create index recovery_time_item_date_idx on public.recovery_time_entries (recovered_item_id, work_date desc);
create index recovery_expenses_item_date_idx on public.recovery_expenses (recovered_item_id, incurred_on desc);
create index collaborators_user_name_idx on public.external_collaborators (user_id, name);
create index antitarlo_user_status_idx on public.antitarlo_treatments (user_id, status, expected_return_date);
create index antitarlo_job_idx on public.antitarlo_treatments (job_id);
create index job_expenses_antitarlo_idx on public.job_expenses (antitarlo_treatment_id) where antitarlo_treatment_id is not null;
create index job_payments_antitarlo_idx on public.job_payments (antitarlo_treatment_id) where antitarlo_treatment_id is not null;
create index agenda_events_antitarlo_idx on public.agenda_events (antitarlo_treatment_id) where antitarlo_treatment_id is not null;

create trigger suppliers_updated_at before update on public.suppliers
for each row execute function public.set_updated_at();
create trigger materials_updated_at before update on public.materials
for each row execute function public.set_updated_at();
create trigger recovered_items_updated_at before update on public.recovered_items
for each row execute function public.set_updated_at();
create trigger recovery_time_entries_updated_at before update on public.recovery_time_entries
for each row execute function public.set_updated_at();
create trigger recovery_expenses_updated_at before update on public.recovery_expenses
for each row execute function public.set_updated_at();
create trigger external_collaborators_updated_at before update on public.external_collaborators
for each row execute function public.set_updated_at();
create trigger antitarlo_treatments_updated_at before update on public.antitarlo_treatments
for each row execute function public.set_updated_at();

create or replace function public.protect_material_stock()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' and new.quantity_available <> 0 then
    raise exception 'La giacenza iniziale deve essere registrata con un movimento di carico';
  end if;
  if tg_op = 'UPDATE'
    and new.quantity_available is distinct from old.quantity_available
    and pg_trigger_depth() = 1 then
    raise exception 'La giacenza può essere modificata soltanto tramite i movimenti di magazzino';
  end if;
  return new;
end;
$$;

create trigger materials_protect_stock
before insert or update of quantity_available on public.materials
for each row execute function public.protect_material_stock();

create or replace function public.validate_recovery_job_link()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.job_id is not distinct from new.job_id then
    return new;
  end if;

  if exists (
    select 1
    from public.material_movements m
    where m.recovered_item_id = new.id
      and m.reversal_of_id is null
      and not exists (
        select 1 from public.material_movements reversal
        where reversal.reversal_of_id = m.id
      )
  ) then
    raise exception 'Prima di cambiare la commessa, stornare tutti i consumi attivi del recupero';
  end if;

  if old.job_id is null and new.job_id is not null and (
    exists (select 1 from public.recovery_time_entries t where t.recovered_item_id = new.id)
    or exists (select 1 from public.recovery_expenses e where e.recovered_item_id = new.id)
  ) then
    raise exception 'Prima di collegare il recupero a una commessa, rimuovere o trasferire ore e spese autonome';
  end if;

  if old.job_id is not null and (
    exists (select 1 from public.time_entries t where t.job_id = old.job_id)
    or exists (select 1 from public.job_expenses e where e.job_id = old.job_id)
  ) then
    raise exception 'La commessa attuale contiene ore o spese: il recupero non può essere scollegato o riassegnato';
  end if;

  if new.job_id is not null and exists (
    select 1 from public.antitarlo_treatments t
    where t.recovered_item_id = new.id and t.job_id <> new.job_id
  ) then
    raise exception 'Il recupero è collegato a un trattamento antitarlo di una commessa diversa';
  end if;
  return new;
end;
$$;

create trigger recovered_items_validate_job_link
before update of job_id on public.recovered_items
for each row execute function public.validate_recovery_job_link();

create or replace function public.validate_material_movement_links()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  recovery_job_id uuid;
  original public.material_movements%rowtype;
begin
  if new.reversal_of_id is not null then
    select m.* into original
    from public.material_movements m
    where m.id = new.reversal_of_id and m.user_id = new.user_id;

    if not found then
      raise exception 'Il movimento da stornare non appartiene allo stesso utente';
    end if;
    if original.reversal_of_id is not null then
      raise exception 'Non è possibile stornare un movimento di storno';
    end if;
    if new.material_id is distinct from original.material_id
      or new.quantity_delta is distinct from -original.quantity_delta
      or new.unit_cost_snapshot is distinct from original.unit_cost_snapshot
      or new.job_id is distinct from original.job_id
      or new.recovered_item_id is distinct from original.recovered_item_id
      or new.supplier_id is distinct from original.supplier_id then
      raise exception 'Lo storno deve invertire esattamente quantità, costo e riferimenti del movimento originale';
    end if;
    return new;
  end if;

  if new.recovered_item_id is not null then
    select r.job_id into recovery_job_id
    from public.recovered_items r
    where r.id = new.recovered_item_id and r.user_id = new.user_id;

    if not found then
      raise exception 'Il mobile recuperato non appartiene allo stesso utente';
    end if;

    if new.movement_type = 'consumo_recupero' and recovery_job_id is not null then
      raise exception 'Un recupero collegato a una commessa deve usare un consumo commessa';
    end if;

    if new.movement_type = 'consumo_commessa'
      and recovery_job_id is distinct from new.job_id then
      raise exception 'Il recupero e il consumo devono appartenere alla stessa commessa';
    end if;
  end if;
  return new;
end;
$$;

create trigger material_movements_validate_links
before insert on public.material_movements
for each row execute function public.validate_material_movement_links();

create or replace function public.prevent_material_movement_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'Lo storico di magazzino è immutabile: registrare un movimento di storno';
end;
$$;

create trigger material_movements_prevent_mutation
before update or delete on public.material_movements
for each row execute function public.prevent_material_movement_mutation();

create or replace function public.validate_antitarlo_references()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  job_customer_id uuid;
  recovery_job_id uuid;
begin
  select j.customer_id into job_customer_id
  from public.jobs j
  where j.id = new.job_id and j.user_id = new.user_id;
  if not found then
    raise exception 'La commessa antitarlo non appartiene allo stesso utente';
  end if;

  if new.customer_id is not null and new.customer_id is distinct from job_customer_id then
    raise exception 'Il cliente del trattamento deve coincidere con quello della commessa';
  end if;

  if new.recovered_item_id is not null then
    select r.job_id into recovery_job_id
    from public.recovered_items r
    where r.id = new.recovered_item_id and r.user_id = new.user_id;
    if not found then
      raise exception 'Il mobile recuperato non appartiene allo stesso utente';
    end if;
    if recovery_job_id is not null and recovery_job_id is distinct from new.job_id then
      raise exception 'Il mobile recuperato è collegato a una commessa diversa';
    end if;
  end if;
  return new;
end;
$$;

create trigger antitarlo_treatments_validate_references
before insert or update of job_id, customer_id, recovered_item_id, user_id on public.antitarlo_treatments
for each row execute function public.validate_antitarlo_references();

create or replace function public.validate_antitarlo_economic_link()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.antitarlo_treatment_id is not null and not exists (
    select 1
    from public.antitarlo_treatments t
    where t.id = new.antitarlo_treatment_id
      and t.job_id = new.job_id
      and t.user_id = new.user_id
  ) then
    raise exception 'Il trattamento antitarlo deve appartenere alla stessa commessa e allo stesso utente';
  end if;
  return new;
end;
$$;

create trigger job_expenses_validate_antitarlo
before insert or update of antitarlo_treatment_id, job_id on public.job_expenses
for each row execute function public.validate_antitarlo_economic_link();
create trigger job_payments_validate_antitarlo
before insert or update of antitarlo_treatment_id, job_id on public.job_payments
for each row execute function public.validate_antitarlo_economic_link();
create trigger agenda_events_validate_antitarlo
before insert or update of antitarlo_treatment_id, job_id on public.agenda_events
for each row execute function public.validate_antitarlo_economic_link();

create or replace function public.apply_material_movement()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  affected_rows integer;
begin
  update public.materials
  set quantity_available = quantity_available + new.quantity_delta
  where id = new.material_id
    and user_id = new.user_id
    and quantity_available + new.quantity_delta >= 0;
  get diagnostics affected_rows = row_count;
  if affected_rows <> 1 then
    raise exception 'Movimento non valido: materiale non trovato o giacenza insufficiente';
  end if;
  return new;
end;
$$;

create trigger material_movements_apply_stock
after insert on public.material_movements
for each row execute function public.apply_material_movement();

alter table public.material_categories enable row level security;
alter table public.suppliers enable row level security;
alter table public.materials enable row level security;
alter table public.material_movements enable row level security;
alter table public.recovered_items enable row level security;
alter table public.recovered_item_files enable row level security;
alter table public.recovery_time_entries enable row level security;
alter table public.recovery_expenses enable row level security;
alter table public.external_collaborators enable row level security;
alter table public.antitarlo_treatments enable row level security;

grant usage on type public.material_movement_type, public.recovered_item_status, public.antitarlo_status to authenticated;

grant select, insert, update, delete on table
  public.material_categories,
  public.suppliers,
  public.materials,
  public.recovered_items,
  public.recovered_item_files,
  public.recovery_time_entries,
  public.recovery_expenses,
  public.external_collaborators,
  public.antitarlo_treatments
to authenticated;

grant select, insert on table public.material_movements to authenticated;
revoke update, delete on table public.material_movements from authenticated;

revoke all privileges on table
  public.material_categories,
  public.suppliers,
  public.materials,
  public.material_movements,
  public.recovered_items,
  public.recovered_item_files,
  public.recovery_time_entries,
  public.recovery_expenses,
  public.external_collaborators,
  public.antitarlo_treatments
from anon;

create policy "Users manage material categories" on public.material_categories
for all using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "Users manage suppliers" on public.suppliers
for all using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "Users manage materials" on public.materials
for all using (user_id = (select auth.uid())) with check (
  user_id = (select auth.uid())
  and (category_id is null or exists (select 1 from public.material_categories c where c.id = category_id and c.user_id = (select auth.uid())))
  and (supplier_id is null or exists (select 1 from public.suppliers s where s.id = supplier_id and s.user_id = (select auth.uid())))
);
create policy "Users read material movements" on public.material_movements
for select using (user_id = (select auth.uid()));
create policy "Users insert material movements" on public.material_movements
for insert with check (
  user_id = (select auth.uid())
  and exists (select 1 from public.materials m where m.id = material_id and m.user_id = (select auth.uid()))
  and (job_id is null or exists (select 1 from public.jobs j where j.id = job_id and j.user_id = (select auth.uid())))
  and (recovered_item_id is null or exists (select 1 from public.recovered_items r where r.id = recovered_item_id and r.user_id = (select auth.uid())))
  and (supplier_id is null or exists (select 1 from public.suppliers s where s.id = supplier_id and s.user_id = (select auth.uid())))
  and (reversal_of_id is null or exists (select 1 from public.material_movements original where original.id = reversal_of_id and original.user_id = (select auth.uid())))
);
create policy "Users manage recovered items" on public.recovered_items
for all using (user_id = (select auth.uid())) with check (
  user_id = (select auth.uid())
  and (job_id is null or exists (select 1 from public.jobs j where j.id = job_id and j.user_id = (select auth.uid())))
);
create policy "Users manage recovery photos" on public.recovered_item_files
for all using (user_id = (select auth.uid())) with check (
  user_id = (select auth.uid())
  and exists (select 1 from public.recovered_items r where r.id = recovered_item_id and r.user_id = (select auth.uid()))
);
create policy "Users manage standalone recovery time" on public.recovery_time_entries
for all using (user_id = (select auth.uid())) with check (
  user_id = (select auth.uid())
  and exists (select 1 from public.recovered_items r where r.id = recovered_item_id and r.user_id = (select auth.uid()) and r.job_id is null)
);
create policy "Users manage standalone recovery expenses" on public.recovery_expenses
for all using (user_id = (select auth.uid())) with check (
  user_id = (select auth.uid())
  and exists (select 1 from public.recovered_items r where r.id = recovered_item_id and r.user_id = (select auth.uid()) and r.job_id is null)
);
create policy "Users manage collaborators" on public.external_collaborators
for all using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "Users manage antitarlo treatments" on public.antitarlo_treatments
for all using (user_id = (select auth.uid())) with check (
  user_id = (select auth.uid())
  and exists (select 1 from public.jobs j where j.id = job_id and j.user_id = (select auth.uid()))
  and (customer_id is null or exists (select 1 from public.customers c where c.id = customer_id and c.user_id = (select auth.uid())))
  and (recovered_item_id is null or exists (select 1 from public.recovered_items r where r.id = recovered_item_id and r.user_id = (select auth.uid())))
  and (collaborator_id is null or exists (select 1 from public.external_collaborators c where c.id = collaborator_id and c.user_id = (select auth.uid())))
);
