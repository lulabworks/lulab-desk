-- Additiva: nessuna riga o totale esistente viene ricalcolato.
begin;
alter table public.quote_items
  alter column quantity type numeric(20,8),
  add column calculation_mode text not null default 'manual' check (calculation_mode in ('manual','surface')),
  add column item_kind text not null default 'material' check (item_kind in ('material','service')),
  add column width_cm numeric(10,2),
  add column height_cm numeric(10,2),
  add column element_count integer,
  add column faces integer,
  add column labor_included boolean not null default false,
  add constraint quote_items_surface_dimensions check (
    (calculation_mode='manual' and width_cm is null and height_cm is null and element_count is null and faces is null and not labor_included)
    or (calculation_mode='surface' and width_cm is not null and height_cm is not null and element_count is not null and faces is not null
      and width_cm>0 and width_cm<=10000 and height_cm>0 and height_cm<=10000
      and element_count between 1 and 10000 and faces in (1,2) and unit='m²')
  );
create function public.calculate_quote_surface_quantity()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.calculation_mode='surface' then
    new.quantity := round(new.width_cm * new.height_cm * new.element_count * new.faces / 10000,8);
    new.unit := 'm²';
  end if;
  return new;
end;
$$;
create trigger quote_items_surface_quantity before insert or update on public.quote_items
for each row execute function public.calculate_quote_surface_quantity();
revoke all on function public.calculate_quote_surface_quantity() from public, anon, authenticated;
-- RLS, proprietari, GRANT e sincronizzazione commesse esistenti invariati.
notify pgrst, 'reload schema';
commit;
