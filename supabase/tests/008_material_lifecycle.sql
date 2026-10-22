-- Solo cluster temporaneo: fixture sintetiche e controlli con errori attesi esatti.
begin;
create function pg_temp.expect_error(statement text, expected_state text, message_part text)
returns void language plpgsql as $$
declare caught boolean := false;
begin
  begin execute statement;
  exception when others then
    if sqlstate <> expected_state or position(message_part in sqlerrm)=0 then raise; end if;
    caught := true;
  end;
  if not caught then raise exception 'Operazione vietata accettata: %', statement; end if;
end $$;
insert into auth.users(id) values ('81000000-0000-4000-8000-000000000001'),('81000000-0000-4000-8000-000000000002');
set local role authenticated;
select set_config('request.jwt.claim.sub','81000000-0000-4000-8000-000000000001',true);
insert into public.materials(id,name,unit,barcode,unit_price) values ('82000000-0000-4000-8000-000000000001','Materiale ciclo','pz','CICLO-008',7.25);
insert into public.material_movements(id,material_id,movement_type,quantity_delta,unit_cost_snapshot) values ('83000000-0000-4000-8000-000000000001','82000000-0000-4000-8000-000000000001','carico',2,7.25);
select pg_temp.expect_error($q$update public.materials set is_active=false where barcode='CICLO-008'$q$,'P0001','giacenza zero');
select pg_temp.expect_error($q$delete from public.materials where barcode='CICLO-008'$q$,'P0001','giacenza diversa da zero');
insert into public.material_movements(id,material_id,movement_type,quantity_delta,unit_cost_snapshot) values ('83000000-0000-4000-8000-000000000002','82000000-0000-4000-8000-000000000001','scarico',-2,7.25);
select pg_temp.expect_error($q$delete from public.materials where barcode='CICLO-008'$q$,'23503','foreign key');
update public.materials set is_active=false where barcode='CICLO-008';
select pg_temp.expect_error($q$insert into public.material_movements(material_id,movement_type,quantity_delta,unit_cost_snapshot) values ('82000000-0000-4000-8000-000000000001','carico',1,7.25)$q$,'P0001','Materiale archiviato');
select pg_temp.expect_error($q$insert into public.material_movements(material_id,movement_type,quantity_delta,unit_cost_snapshot) values ('82000000-0000-4000-8000-000000000001','scarico',-1,7.25)$q$,'P0001','Materiale archiviato');
select pg_temp.expect_error($q$insert into public.material_movements(material_id,movement_type,quantity_delta,unit_cost_snapshot,reversal_of_id) values ('82000000-0000-4000-8000-000000000001','rettifica',2,7.25,'83000000-0000-4000-8000-000000000002')$q$,'P0001','Materiale archiviato');
select pg_temp.expect_error($q$insert into public.materials(name,unit,barcode) values ('Duplicato','pz','CICLO-008')$q$,'23505','unique');
do $$ begin
 if (select count(*) from public.material_movements where material_id='82000000-0000-4000-8000-000000000001')<>2 then raise exception 'Movimento respinto residuo'; end if;
 if not exists(select 1 from public.materials where barcode='CICLO-008' and not is_active and quantity_available=0 and unit_price=7.25) then raise exception 'Dati archiviati alterati'; end if;
end $$;
update public.materials set is_active=true where barcode='CICLO-008';
insert into public.material_movements(material_id,movement_type,quantity_delta,unit_cost_snapshot,reversal_of_id) values ('82000000-0000-4000-8000-000000000001','rettifica',2,7.25,'83000000-0000-4000-8000-000000000002');
do $$ begin
 if not exists(select 1 from public.materials where barcode='CICLO-008' and is_active and quantity_available=2 and unit_price=7.25) then raise exception 'Ripristino/storno errato'; end if;
end $$;
insert into public.materials(name,unit,barcode) values ('Eliminabile','pz','DELETE-008');
delete from public.materials where barcode='DELETE-008';
select pg_temp.expect_error($q$delete from public.material_movements where id='83000000-0000-4000-8000-000000000001'$q$,'42501','permission denied');
select set_config('request.jwt.claim.sub','81000000-0000-4000-8000-000000000002',true);
do $$ begin
 if exists(select 1 from public.materials where barcode='CICLO-008') then raise exception 'RLS cross account'; end if;
 update public.materials set is_active=false where id='82000000-0000-4000-8000-000000000001';
 if found then raise exception 'Modifica cross account'; end if;
 delete from public.materials where id='82000000-0000-4000-8000-000000000001';
 if found then raise exception 'Eliminazione cross account'; end if;
end $$;
set local role anon;
select pg_temp.expect_error($q$select * from public.materials$q$,'42501','permission denied');
select pg_temp.expect_error($q$update public.materials set is_active=false$q$,'42501','permission denied');
rollback;
