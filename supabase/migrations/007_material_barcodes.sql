-- LuLab Desk: codici commerciali separati dal codice interno. Additiva: nessun
-- materiale, movimento o privilegio esistente viene riscritto.
begin;

alter table public.materials add column barcode text;
alter table public.materials add constraint materials_barcode_format_check
  check (barcode is null or (
    char_length(barcode) between 1 and 128
    and barcode = btrim(barcode)
    and barcode ~ '^[ -~]+$'
  ));

-- UPC-A a 12 cifre ed EAN-13 con zero iniziale identificano lo stesso articolo.
-- L'unicità è per utente, anche per materiali inattivi; i NULL restano liberi.
create unique index materials_user_barcode_unique_idx
  on public.materials (user_id, (case
    when barcode ~ '^[0-9]{12}$' then '0' || barcode
    else barcode
  end)) where barcode is not null;
create index materials_user_barcode_lookup_idx
  on public.materials (user_id, barcode) where barcode is not null;

comment on column public.materials.barcode is
  'Codice a barre commerciale opzionale, privato per utente. Non è materials.code. UPC-A/EAN-13 equivalenti sono univoci per utente.';

-- La policy 003 consultava material_movements dentro il proprio WITH CHECK:
-- PostgreSQL può rilevare ricorsione anche su un carico senza storno. Il trigger
-- material_movements_validate_links verifica già proprietario e corrispondenza
-- esatta dello storno. Eliminiamo soltanto quella sottoquery ridondante,
-- qualificando tutti i riferimenti esterni. Gli altri controlli restano identici.
alter policy "Users insert material movements" on public.material_movements
with check (
  user_id = (select auth.uid())
  and exists (select 1 from public.materials m where m.id = material_movements.material_id and m.user_id = (select auth.uid()))
  and (job_id is null or exists (select 1 from public.jobs j where j.id = material_movements.job_id and j.user_id = (select auth.uid())))
  and (recovered_item_id is null or exists (select 1 from public.recovered_items r where r.id = material_movements.recovered_item_id and r.user_id = (select auth.uid())))
  and (supplier_id is null or exists (select 1 from public.suppliers s where s.id = material_movements.supplier_id and s.user_id = (select auth.uid())))
);

-- RLS e GRANT di materials restano invariati. Nessuna nuova funzione
-- SECURITY DEFINER o autorizzazione anonima.
notify pgrst, 'reload schema';
commit;
