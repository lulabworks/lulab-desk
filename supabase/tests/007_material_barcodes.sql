-- Solo database di prova. Il runner locale applica 001–003 e 007.
-- ON_ERROR_STOP obbligatorio; tutte le fixture di questa suite sono annullate.
begin;
do $$ begin
  if not exists (select 1 from public.materials where code = 'LEGACY' and barcode is null and quantity_available = 2) then
    raise exception 'La migrazione non ha preservato il materiale preesistente';
  end if;
  if not (select relrowsecurity from pg_class where oid = 'public.materials'::regclass) then
    raise exception 'RLS disattivata';
  end if;
end $$;
insert into auth.users(id) values ('71000000-0000-4000-8000-000000000001'), ('71000000-0000-4000-8000-000000000002');
set local role authenticated;
select set_config('request.jwt.claim.sub', '71000000-0000-4000-8000-000000000001', true);
insert into public.materials(id,name,code,barcode,unit,unit_price) values
  ('70000000-0000-4000-8000-000000000001','Materiale di prova','INTERNO','036000291452','m',5.25),
  ('70000000-0000-4000-8000-000000000002','Senza codice uno',null,null,'pz',0),
  ('70000000-0000-4000-8000-000000000003','Senza codice due',null,null,'pz',0);
do $$ begin
  begin
    insert into public.materials(name,barcode,unit) values ('Duplicato','036000291452','pz');
    raise exception 'Codice duplicato accettato';
  exception when unique_violation then null; end;
  begin
    insert into public.materials(name,barcode,unit) values ('Alias duplicato','0036000291452','pz');
    raise exception 'Alias UPC/EAN duplicato accettato';
  exception when unique_violation then null; end;
  begin
    update public.materials set barcode = ' ' where code = 'INTERNO';
    raise exception 'Codice vuoto accettato';
  exception when check_violation then null; end;
  begin
    update public.materials set barcode = E'ABC\nDEF' where code = 'INTERNO';
    raise exception 'Controlli accettati nel barcode';
  exception when check_violation then null; end;
  begin
    update public.materials set barcode = repeat('A',129) where code = 'INTERNO';
    raise exception 'Barcode troppo lungo accettato';
  exception when check_violation then null; end;
end $$;
insert into public.jobs(id,title,type) values ('72000000-0000-4000-8000-000000000001','Commessa sintetica','restauro');
insert into public.recovered_items(id,name,job_id) values
  ('73000000-0000-4000-8000-000000000001','Recupero autonomo',null),
  ('73000000-0000-4000-8000-000000000002','Recupero collegato','72000000-0000-4000-8000-000000000001');
insert into public.material_movements(material_id,movement_type,quantity_delta,unit_cost_snapshot)
values ('70000000-0000-4000-8000-000000000001','carico',10,5.25);
insert into public.material_movements(material_id,movement_type,quantity_delta,unit_cost_snapshot,job_id)
values ('70000000-0000-4000-8000-000000000001','consumo_commessa',-2,5.25,'72000000-0000-4000-8000-000000000001');
insert into public.material_movements(id,material_id,movement_type,quantity_delta,unit_cost_snapshot,recovered_item_id)
values ('74000000-0000-4000-8000-000000000001','70000000-0000-4000-8000-000000000001','consumo_recupero',-1,5.25,'73000000-0000-4000-8000-000000000001');
insert into public.material_movements(material_id,movement_type,quantity_delta,unit_cost_snapshot,recovered_item_id,job_id)
values ('70000000-0000-4000-8000-000000000001','consumo_commessa',-1,5.25,'73000000-0000-4000-8000-000000000002','72000000-0000-4000-8000-000000000001');
insert into public.material_movements(material_id,movement_type,quantity_delta,unit_cost_snapshot)
values ('70000000-0000-4000-8000-000000000001','scarico',-0.5,5.25);
insert into public.material_movements(material_id,movement_type,quantity_delta,unit_cost_snapshot,recovered_item_id,reversal_of_id)
values ('70000000-0000-4000-8000-000000000001','rettifica',1,5.25,'73000000-0000-4000-8000-000000000001','74000000-0000-4000-8000-000000000001');
update public.materials set unit_price=99 where code='INTERNO';
do $$ declare rejected boolean := false; begin
  if (select quantity_available from public.materials where code='INTERNO') <> 6.5 then raise exception 'Giacenza errata dopo carichi, consumi e storno'; end if;
  if exists (select 1 from public.material_movements where unit_cost_snapshot <> 5.25) then raise exception 'Costo storico alterato'; end if;
  if (select count(*) from public.materials where barcode in ('036000291452','0036000291452')) <> 1 then raise exception 'Lookup barcode non univoco'; end if;
  begin
    insert into public.material_movements(material_id,movement_type,quantity_delta,unit_cost_snapshot)
    values ('70000000-0000-4000-8000-000000000001','scarico',-100,5.25);
  exception when raise_exception then rejected := true; end;
  if not rejected then raise exception 'Scarico oltre giacenza accettato'; end if;
  rejected := false;
  begin update public.materials set quantity_available=200 where code='INTERNO';
  exception when raise_exception then rejected := true; end;
  if not rejected then raise exception 'Modifica diretta giacenza accettata'; end if;
  rejected := false;
  begin
    insert into public.material_movements(material_id,movement_type,quantity_delta,unit_cost_snapshot,recovered_item_id)
    values ('70000000-0000-4000-8000-000000000001','consumo_recupero',-1,5.25,'73000000-0000-4000-8000-000000000002');
  exception when raise_exception then rejected := true; end;
  if not rejected then raise exception 'Consumo autonomo su recupero collegato accettato'; end if;
  rejected := false;
  begin
    insert into public.material_movements(material_id,movement_type,quantity_delta,unit_cost_snapshot,recovered_item_id,reversal_of_id)
    values ('70000000-0000-4000-8000-000000000001','rettifica',2,5.25,'73000000-0000-4000-8000-000000000001','74000000-0000-4000-8000-000000000001');
  exception when raise_exception then rejected := true; end;
  if not rejected then raise exception 'Storno con quantità incoerente accettato'; end if;
  begin
    insert into public.material_movements(material_id,movement_type,quantity_delta,unit_cost_snapshot,recovered_item_id,reversal_of_id)
    values ('70000000-0000-4000-8000-000000000001','rettifica',1,5.25,'73000000-0000-4000-8000-000000000001','74000000-0000-4000-8000-000000000001');
    raise exception 'Doppio storno accettato';
  exception when unique_violation then null; end;
  begin
    delete from public.material_movements where id='74000000-0000-4000-8000-000000000001';
    raise exception 'Eliminazione storico consentita';
  exception when insufficient_privilege then null; end;
  if (select quantity_available from public.materials where code='INTERNO') <> 6.5 then raise exception 'Un tentativo respinto ha alterato la giacenza'; end if;
end $$;
-- Il codice può essere modificato/rimosso, mantenendo distinto quello interno.
update public.materials set barcode='LuLab-128 A' where code='INTERNO';
do $$ begin
  if not exists(select 1 from public.materials where code='INTERNO' and barcode='LuLab-128 A') then raise exception 'Modifica barcode fallita'; end if;
end $$;
update public.materials set barcode='036000291452' where code='INTERNO';
select set_config('request.jwt.claim.sub', '71000000-0000-4000-8000-000000000002', true);
insert into public.materials(name,barcode,unit) values ('Secondo utente','0036000291452','pz');
do $$ declare rejected boolean := false; begin
  if exists (select 1 from public.materials where id='70000000-0000-4000-8000-000000000001') then raise exception 'RLS espone il materiale di un altro utente'; end if;
  if (select count(*) from public.materials) <> 1 then raise exception 'Isolamento utente fallito'; end if;
  begin
    insert into public.material_movements(material_id,movement_type,quantity_delta,unit_cost_snapshot)
    values ('70000000-0000-4000-8000-000000000001','carico',1,1);
    raise exception 'Movimento cross-account accettato';
  exception when insufficient_privilege then null; end;
  begin
    insert into public.material_movements(material_id,movement_type,quantity_delta,unit_cost_snapshot,recovered_item_id,reversal_of_id)
    values ('70000000-0000-4000-8000-000000000001','rettifica',1,5.25,'73000000-0000-4000-8000-000000000001','74000000-0000-4000-8000-000000000001');
  exception when raise_exception or insufficient_privilege then rejected := true; end;
  if not rejected then raise exception 'Storno cross-account accettato'; end if;
end $$;
set local role anon;
do $$ begin
  begin perform barcode from public.materials; raise exception 'Lettura anonima consentita';
  exception when insufficient_privilege then null; end;
end $$;
rollback;
\echo '007: unicità, alias UPC/EAN, RLS, anon, legacy, consumi collegati, costo storico, storno e giacenza: OK'
