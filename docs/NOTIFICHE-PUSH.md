# Notifiche Web Push

## Stato in questo checkout

Il frontend include opt-in esplicito per dispositivo, preferenze per utente, supporto al service worker PWA esistente e deep link. La migrazione `006_web_push_notifications.sql` e le Edge Functions sono preparate localmente. Non sono state applicate a Supabase, le funzioni non sono state distribuite e non è stato creato alcun cron: fino a questi passaggi non viene inviato alcun push reale.

Il payload contiene esclusivamente titolo e testo generici e un deep link interno. Per le richieste del sito la coda viene popolata solo dopo il salvataggio della richiesta, di tutti gli allegati e dei metadati; gli errori di notifica non annullano una richiesta valida. La consegna utilizza un outbox idempotente, claim concorrente con `SKIP LOCKED`, chiavi dedupe e `tag` di notifica stabile. Gli endpoint scaduti (HTTP 404/410) vengono rimossi.

Le sottoscrizioni e la coda hanno RLS attiva senza policy client e sono accessibili soltanto con `service_role` nelle Edge Functions. Le preferenze sono accessibili esclusivamente all'utente proprietario. Le richieste sono inviate soltanto agli editor attivi registrati in `site_editors`.

## Attivazione successiva (non eseguita)

1. Fare un backup secondo la procedura ordinaria e applicare le migrazioni 001–006 nell'ambiente corretto; qui è stata preparata solo la 006.
2. Generare una coppia VAPID con un tool affidabile. Conservare la chiave privata esclusivamente fra i Supabase Edge Function Secrets; la chiave pubblica è destinata al client.
3. Configurare `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` (per esempio `mailto:lulabworks@gmail.com`) e `PUSH_CRON_SECRET` come secrets delle Edge Functions. `SUPABASE_URL`, `SUPABASE_ANON_KEY` e `SUPABASE_SERVICE_ROLE_KEY` sono forniti dal progetto Edge Functions; non copiarli nel frontend.
4. Distribuire `manage-push-subscription` con verifica JWT attiva, `dispatch-push-notifications` con verifica dell'header `X-Push-Cron-Secret` attiva e aggiornare `submit-inquiry` includendo la modifica locale.
5. Abilitare le estensioni `pg_cron`, `pg_net` e Vault dal progetto, creare in Vault i secret `lulab_functions_url`, `lulab_publishable_key` e `lulab_push_cron_secret`, quindi eseguire lo script di pianificazione `supabase/schedules/006_push_dispatch.sql`. La chiamata invia `POST`, l'header `apikey` con la publishable key e `X-Push-Cron-Secret`. La chiave privata VAPID non va inviata nel body o negli header del cron.
6. Per GitHub Pages configurare la variabile Actions `VITE_VAPID_PUBLIC_KEY` con la chiave pubblica. La chiave privata non deve essere un Actions variable/secret né finire nel repository.
7. Distribuire il frontend soltanto dopo aver validato i test in un progetto isolato. Su iPhone l'utente deve installare LuLab Desk nella schermata Home e attivare le notifiche con il pulsante in Impostazioni; su Mac serve un browser compatibile e il consenso esplicito.

L'estensione `pg_cron`/`pg_net` e il cron non vengono creati dalla migrazione 006. Verificare la procedura di schedulazione supportata dal progetto Supabase prima dell'attivazione. `enqueue_due_push_reminders()` usa `Europe/Rome`, comprese le regole DST; `is_push_notification_job_valid()` riverifica stato, data e ciclo del record sorgente appena prima dell'invio.

## Test

- `pnpm test:push` controlla contratti statici, opt-in, scope PWA, riservatezza del payload e ordine richiesta/allegati/outbox.
- `supabase/tests/006_web_push_notifications_security.sql` è un test transazionale da eseguire solo in PostgreSQL/Supabase isolato, dopo 001–006 e con almeno due utenti di test e una commessa senza preventivo accettato; termina con `ROLLBACK`.
- Le prove reali di permessi iPhone/Mac, VAPID, retry di rete, Cron e click/riapertura PWA richiedono le Edge Functions distribuite in un progetto non produttivo e dispositivi/browser reali. Non sono state dichiarate superate.

Web Push è un trasporto best-effort/at-least-once: se il processo perde la risposta dopo che il provider ha accettato il messaggio, non è possibile garantire matematicamente una sola consegna. La chiave idempotente e il `tag` stabile impediscono duplicati logici e sostituiscono la notifica visibile nei browser compatibili.
