-- Archiviazione e cancellazione: nessuna riscrittura dei dati o delle relazioni.
begin;
lock table public.materials in share row exclusive mode;
do $$ begin
  if exists (select 1 from public.materials where not is_active and quantity_available <> 0) then
    raise exception '008 non applicata: esistono materiali archiviati con giacenza non zero. Ripristinarli e regolarizzarli tramite i normali movimenti, senza modifiche automatiche.';
  end if;
end $$;

alter table public.materials add constraint materials_archived_zero_stock
  check (is_active or quantity_available = 0);

create function public.guard_material_lifecycle()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    if old.quantity_available <> 0 then
      raise exception 'Non puoi eliminare un materiale con giacenza diversa da zero. Regolarizzala tramite i movimenti.';
    end if;
    return old;
  end if;
  if not new.is_active and new.quantity_available <> 0 then
    raise exception 'Puoi archiviare soltanto materiali con giacenza zero. Regolarizzala tramite i normali movimenti.';
  end if;
  return new;
end;
$$;
create trigger materials_guard_lifecycle
before insert or update or delete on public.materials
for each row execute function public.guard_material_lifecycle();

-- UPDATE dei materiali e movimenti contendono la stessa riga. Il lock dura
-- fino al termine della transazione: nessun controllo separato dal salvataggio.
create or replace function public.apply_material_movement()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  material_active boolean;
  affected_rows integer;
begin
  select m.is_active into material_active from public.materials m
  where m.id = new.material_id and m.user_id = new.user_id
  for no key update;
  if not found then
    raise exception 'Movimento non valido: materiale non trovato';
  end if;
  if not material_active then
    raise exception 'Materiale archiviato: ripristinalo in Materiali prima di registrare movimenti o storni.';
  end if;
  update public.materials
  set quantity_available = quantity_available + new.quantity_delta
  where id = new.material_id and user_id = new.user_id
    and quantity_available + new.quantity_delta >= 0;
  get diagnostics affected_rows = row_count;
  if affected_rows <> 1 then
    raise exception 'Movimento non valido: materiale non trovato o giacenza insufficiente';
  end if;
  return new;
end;
$$;
revoke all on function public.guard_material_lifecycle() from public, anon, authenticated;
-- Nessuna nuova autorizzazione; RLS, FK RESTRICT e storico immutabile invariati.
notify pgrst, 'reload schema';
commit;
