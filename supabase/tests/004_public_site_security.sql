-- Test transazionali per 004_public_site.sql.
-- Eseguire esclusivamente su un database locale/temporaneo dopo le migrazioni.
-- Il rollback finale lascia il database invariato.

begin;

insert into public.site_collection_items (
  id, slug, title, description, publication_status
) values
  ('00000000-0000-4000-8000-000000000001', 'test-collezione-pubblica', 'Collezione pubblica', 'Contenuto pubblico di test.', 'pubblicato'),
  ('00000000-0000-4000-8000-000000000002', 'test-collezione-bozza', 'Collezione in bozza', 'Contenuto privato di test.', 'bozza');

-- Nei test SQL viene creata soltanto la riga di metadati Storage; non viene
-- scritto alcun file fisico. È sufficiente per verificare trigger e RLS.
insert into storage.objects (bucket_id, name) values
  ('site-public', 'collection/00000000-0000-4000-8000-000000000001/test.webp'),
  ('site-drafts', 'collection/00000000-0000-4000-8000-000000000002/test.webp'),
  ('site-public', 'portfolio/00000000-0000-4000-8000-000000000021/test.webp'),
  ('site-drafts', 'portfolio/00000000-0000-4000-8000-000000000022/test.webp');

insert into public.site_collection_images (
  id, collection_item_id, storage_bucket, storage_path, alt_text, mime_type, size_bytes, is_cover
) values
  (
    '00000000-0000-4000-8000-000000000011',
    '00000000-0000-4000-8000-000000000001',
    'site-public',
    'collection/00000000-0000-4000-8000-000000000001/test.webp',
    'Immagine pubblica di test',
    'image/webp',
    1024,
    true
  ),
  (
    '00000000-0000-4000-8000-000000000012',
    '00000000-0000-4000-8000-000000000002',
    'site-drafts',
    'collection/00000000-0000-4000-8000-000000000002/test.webp',
    'Immagine privata di test',
    'image/webp',
    1024,
    true
  );

insert into public.site_portfolio_projects (
  id, slug, title, summary, description, category, publication_status
) values
  (
    '00000000-0000-4000-8000-000000000021',
    'test-portfolio-pubblico',
    'Portfolio pubblico',
    'Sommario pubblico.',
    'Descrizione pubblica di test.',
    'Restauro',
    'pubblicato'
  ),
  (
    '00000000-0000-4000-8000-000000000022',
    'test-portfolio-bozza',
    'Portfolio in bozza',
    'Sommario privato.',
    'Descrizione privata di test.',
    'Restauro',
    'bozza'
  );

insert into public.site_portfolio_images (
  id, portfolio_project_id, storage_bucket, storage_path, alt_text, mime_type, size_bytes, is_cover
) values
  (
    '00000000-0000-4000-8000-000000000023',
    '00000000-0000-4000-8000-000000000021',
    'site-public',
    'portfolio/00000000-0000-4000-8000-000000000021/test.webp',
    'Portfolio pubblico di test',
    'image/webp',
    1024,
    true
  ),
  (
    '00000000-0000-4000-8000-000000000024',
    '00000000-0000-4000-8000-000000000022',
    'site-drafts',
    'portfolio/00000000-0000-4000-8000-000000000022/test.webp',
    'Portfolio privato di test',
    'image/webp',
    1024,
    true
  );

insert into public.customer_inquiries (
  id, request_type, customer_name, email, message, privacy_consent_at
) values (
  '00000000-0000-4000-8000-000000000031',
  'Restauro mobile',
  'Cliente di test',
  'cliente-test@example.invalid',
  'Richiesta privata usata esclusivamente dal test transazionale.',
  now()
);

insert into storage.objects (bucket_id, name) values (
  'inquiry-uploads',
  'inquiries/00000000-0000-4000-8000-000000000031/test.webp'
);

insert into public.customer_inquiry_files (
  id, inquiry_id, storage_path, file_name, mime_type, size_bytes
) values (
  '00000000-0000-4000-8000-000000000032',
  '00000000-0000-4000-8000-000000000031',
  'inquiries/00000000-0000-4000-8000-000000000031/test.webp',
  'test.webp',
  'image/webp',
  1024
);

do $$
declare
  missing_object_blocked boolean := false;
begin
  begin
    insert into public.customer_inquiry_files (
      inquiry_id, storage_path, file_name, mime_type, size_bytes
    ) values (
      '00000000-0000-4000-8000-000000000031',
      'inquiries/00000000-0000-4000-8000-000000000031/assente.webp',
      'assente.webp',
      'image/webp',
      1024
    );
  exception when raise_exception then
    missing_object_blocked := true;
  end;
  if not missing_object_blocked then
    raise exception 'Integrità allegati fallita: creato un metadato senza oggetto Storage.';
  end if;
end;
$$;

set local role anon;

do $$
declare
  visible_collection integer;
  visible_images integer;
  visible_portfolio integer;
  visible_portfolio_images integer;
begin
  select count(*) into visible_collection from public.site_collection_items;
  select count(*) into visible_images from public.site_collection_images;
  select count(*) into visible_portfolio from public.site_portfolio_projects;
  select count(*) into visible_portfolio_images from public.site_portfolio_images;

  if visible_collection <> 1 then
    raise exception 'RLS anon fallita: atteso 1 elemento Collezione pubblicato, trovati %.', visible_collection;
  end if;
  if visible_images <> 1 then
    raise exception 'RLS anon fallita: attesa 1 immagine pubblicata, trovate %.', visible_images;
  end if;
  if visible_portfolio <> 1 then
    raise exception 'RLS anon fallita: atteso 1 progetto Portfolio pubblicato, trovati %.', visible_portfolio;
  end if;
  if visible_portfolio_images <> 1 then
    raise exception 'RLS anon fallita: attesa 1 immagine Portfolio pubblicata, trovate %.', visible_portfolio_images;
  end if;
end;
$$;

do $$
declare
  access_blocked boolean := false;
begin
  begin
    perform count(*) from public.customer_inquiries;
  exception when insufficient_privilege then
    access_blocked := true;
  end;
  if not access_blocked then
    raise exception 'Sicurezza fallita: anon può leggere customer_inquiries.';
  end if;
end;
$$;

do $$
declare
  access_blocked boolean := false;
begin
  begin
    perform count(*) from public.site_collection_item_sources;
  exception when insufficient_privilege then
    access_blocked := true;
  end;
  if not access_blocked then
    raise exception 'Sicurezza fallita: anon può leggere i collegamenti alle fonti.';
  end if;
end;
$$;

do $$
declare
  write_blocked boolean := false;
begin
  begin
    insert into public.site_collection_items (slug, title, description)
    values ('inserimento-anon-non-consentito', 'Inserimento anon', 'Questo inserimento deve fallire.');
  exception when insufficient_privilege then
    write_blocked := true;
  end;
  if not write_blocked then
    raise exception 'Sicurezza fallita: anon può inserire contenuti.';
  end if;
end;
$$;

reset role;
select set_config(
  'request.jwt.claim.sub',
  '00000000-0000-4000-8000-000000000099',
  true
);
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-4000-8000-000000000099","role":"authenticated"}',
  true
);
set local role authenticated;

do $$
declare
  visible_collection integer;
  write_blocked boolean := false;
begin
  if public.is_site_editor() then
    raise exception 'Autorizzazione fallita: un utente non inserito nella allowlist risulta editor.';
  end if;

  select count(*) into visible_collection from public.site_collection_items;
  if visible_collection <> 1 then
    raise exception 'RLS authenticated fallita: un non-editor deve vedere solo il contenuto pubblicato.';
  end if;

  begin
    insert into public.site_collection_items (slug, title, description)
    values ('inserimento-non-editor', 'Inserimento non editor', 'Questo inserimento deve fallire.');
  exception when insufficient_privilege then
    write_blocked := true;
  end;
  if not write_blocked then
    raise exception 'Autorizzazione fallita: un authenticated non autorizzato può pubblicare.';
  end if;
end;
$$;

reset role;

do $$
declare
  publication_blocked boolean := false;
  withdrawal_blocked boolean := false;
begin
  begin
    update public.site_collection_items
    set publication_status = 'pubblicato'
    where id = '00000000-0000-4000-8000-000000000002';
  exception when raise_exception then
    publication_blocked := true;
  end;
  if not publication_blocked then
    raise exception 'Media lifecycle fallito: una bozza con immagini private è stata pubblicata senza promozione.';
  end if;

  begin
    update public.site_collection_items
    set publication_status = 'non_pubblicato'
    where id = '00000000-0000-4000-8000-000000000001';
  exception when raise_exception then
    withdrawal_blocked := true;
  end;
  if not withdrawal_blocked then
    raise exception 'Media lifecycle fallito: il ritiro ha lasciato metadati o oggetti nel bucket pubblico.';
  end if;
end;
$$;

do $$
declare
  invalid_price_blocked boolean := false;
begin
  begin
    insert into public.site_collection_items (
      slug, title, description, show_price, public_price
    ) values (
      'prezzo-nascosto-non-valido',
      'Prezzo nascosto',
      'Il prezzo non deve restare interrogabile quando show_price è falso.',
      false,
      100
    );
  exception when check_violation then
    invalid_price_blocked := true;
  end;
  if not invalid_price_blocked then
    raise exception 'Prezzi falliti: public_price è valorizzabile con show_price=false.';
  end if;
end;
$$;

do $$
declare
  candidate_owner uuid;
  removal_blocked boolean := false;
begin
  select user_id into candidate_owner
  from public.site_editors
  where role = 'owner'::public.site_editor_role and is_active
  order by user_id
  limit 1;

  if candidate_owner is null then
    select id into candidate_owner from auth.users order by created_at limit 1;
    if candidate_owner is null then
      raise notice 'Test ultimo owner non eseguito: nessun utente Auth nel database temporaneo.';
      return;
    end if;

    insert into public.site_editors (user_id, role, is_active)
    values (candidate_owner, 'owner', true)
    on conflict (user_id) do update
    set role = 'owner', is_active = true;
  else
    -- Il rollback finale ripristina gli owner. Portare temporaneamente
    -- l'allowlist a un solo owner rende il controllo deterministico.
    update public.site_editors
    set is_active = false
    where role = 'owner'::public.site_editor_role
      and is_active
      and user_id <> candidate_owner;
  end if;

  begin
    update public.site_editors set is_active = false where user_id = candidate_owner;
  exception when raise_exception then
    removal_blocked := true;
  end;

  if not removal_blocked then
    raise exception 'Allowlist fallita: è stato possibile disattivare l''ultimo owner.';
  end if;
end;
$$;

do $$
declare
  missing_rls integer;
  unsafe_anon_grants integer;
begin
  select count(*) into missing_rls
  from pg_catalog.pg_class relation
  join pg_catalog.pg_namespace namespace on namespace.oid = relation.relnamespace
  where namespace.nspname = 'public'
    and relation.relname in (
      'site_editors',
      'site_collection_items',
      'site_collection_item_sources',
      'site_collection_images',
      'site_portfolio_projects',
      'site_portfolio_project_sources',
      'site_portfolio_images',
      'customer_inquiries',
      'customer_inquiry_files'
    )
    and not relation.relrowsecurity;

  if missing_rls <> 0 then
    raise exception 'Configurazione fallita: % nuove tabelle non hanno RLS attiva.', missing_rls;
  end if;

  select count(*) into unsafe_anon_grants
  from information_schema.role_table_grants grant_row
  where grant_row.grantee = 'anon'
    and grant_row.table_schema = 'public'
    and (
      grant_row.privilege_type <> 'SELECT'
      or grant_row.table_name not in (
        'site_collection_items',
        'site_collection_images',
        'site_portfolio_projects',
        'site_portfolio_images'
      )
    );

  if unsafe_anon_grants <> 0 then
    raise exception 'Configurazione fallita: rilevati % grant anon non ammessi nello schema public.', unsafe_anon_grants;
  end if;

  if has_function_privilege('anon', 'public.is_site_editor()', 'EXECUTE')
    or has_function_privilege('anon', 'public.is_site_owner()', 'EXECUTE') then
    raise exception 'SECURITY DEFINER fallita: anon può eseguire funzioni editoriali.';
  end if;

  if not has_function_privilege('authenticated', 'public.is_site_editor()', 'EXECUTE')
    or not has_function_privilege('authenticated', 'public.is_site_owner()', 'EXECUTE') then
    raise exception 'SECURITY DEFINER fallita: authenticated non può valutare la propria allowlist.';
  end if;

  if has_function_privilege('authenticated', 'public.prevent_last_site_owner_removal()', 'EXECUTE')
    or has_function_privilege('authenticated', 'public.guard_site_publication_media()', 'EXECUTE')
    or has_function_privilege('authenticated', 'public.validate_site_image_storage_object()', 'EXECUTE')
    or has_function_privilege('authenticated', 'public.validate_inquiry_file_storage_object()', 'EXECUTE') then
    raise exception 'SECURITY DEFINER fallita: una funzione trigger-only è eseguibile direttamente.';
  end if;

  if exists (
    select 1 from pg_catalog.pg_policies policy
    where policy.schemaname = 'storage'
      and policy.tablename = 'objects'
      and policy.roles && array['anon'::name, 'public'::name]
  ) then
    raise exception 'Storage fallito: esiste una policy storage.objects applicabile ad anon.';
  end if;

  if not exists (
    select 1 from storage.buckets
    where id = 'site-drafts' and not public
  ) then
    raise exception 'Configurazione fallita: bucket site-drafts assente o non privato.';
  end if;

  if not exists (
    select 1 from storage.buckets
    where id = 'site-public' and public
  ) then
    raise exception 'Configurazione fallita: bucket site-public assente o non pubblico.';
  end if;

  if not exists (
    select 1 from storage.buckets
    where id = 'inquiry-uploads' and not public
  ) then
    raise exception 'Configurazione fallita: bucket inquiry-uploads assente o non privato.';
  end if;
end;
$$;

rollback;
