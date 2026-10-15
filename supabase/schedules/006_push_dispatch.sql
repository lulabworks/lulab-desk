-- Configurazione opzionale, da eseguire SOLO dopo aver abilitato pg_cron,
-- pg_net e Vault e dopo aver distribuito l'Edge Function.
-- Richiede tre secret Vault: lulab_functions_url (base URL /functions/v1),
-- lulab_publishable_key e lulab_push_cron_secret.
-- Questo file NON fa parte della migrazione 006 e non viene eseguito dall'app.

select cron.unschedule(jobid)
from cron.job
where jobname = 'lulab-push-dispatch';

select cron.schedule(
  'lulab-push-dispatch',
  '* * * * *',
  $job$
    select net.http_post(
      url := (select decrypted_secret || '/dispatch-push-notifications'
        from vault.decrypted_secrets where name = 'lulab_functions_url'),
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'apikey', (select decrypted_secret from vault.decrypted_secrets where name = 'lulab_publishable_key'),
        'X-Push-Cron-Secret', (select decrypted_secret from vault.decrypted_secrets where name = 'lulab_push_cron_secret')
      ),
      body := '{}'::jsonb,
      timeout_milliseconds := 10000
    );
  $job$
);
