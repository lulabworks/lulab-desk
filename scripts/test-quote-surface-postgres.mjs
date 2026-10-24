import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {spawnSync} from 'node:child_process'
import assert from 'node:assert/strict'
const root=new URL('../',import.meta.url),read=p=>fs.readFileSync(new URL(p,root),'utf8')
const bin='/opt/homebrew/opt/postgresql@17/bin/'
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'lulab-surface-'))
const env={...process.env};for(const key of Object.keys(env))if(key.startsWith('PG'))delete env[key]
let started=false
const exec=(name,args,input)=>{const r=spawnSync(bin+name,args,{env,input,encoding:'utf8'});assert.equal(r.status,0,r.stderr);return r.stdout.trim()}
const sql=s=>exec('psql',['-X','-qAt','-v','ON_ERROR_STOP=1','-h',dir,'-p','55483','-U',os.userInfo().username,'-d','postgres'],s)
try {
 exec('initdb',['-D',dir+'/data','-A','trust','--no-locale','--encoding=UTF8'])
 exec('pg_ctl',['-D',dir+'/data','-l',dir+'/server.log','-o',`-c listen_addresses='' -k ${dir} -p 55483`,'-w','start']);started=true
 sql(read('scripts/test-material-barcodes-postgres.sh').split("<<'SQL'\n")[1].split('\nSQL')[0])
 for(const file of ['001_initial_schema.sql','002_phase2_operations.sql'])sql(read('supabase/migrations/'+file))
 sql(`insert into auth.users(id) values('91000000-0000-4000-8000-000000000001');
 select set_config('request.jwt.claim.sub','91000000-0000-4000-8000-000000000001',false);
 insert into public.jobs(id,title,type) values('92000000-0000-4000-8000-000000000001','Prova','restauro');
 insert into public.quotes(id,job_id,title) values('93000000-0000-4000-8000-000000000001','92000000-0000-4000-8000-000000000001','Prova');
 insert into public.quote_items(id,quote_id,description,quantity,unit_price) values('94000000-0000-4000-8000-000000000001','93000000-0000-4000-8000-000000000001','Legacy',1.125,2.25);`)
 const before=sql('select to_jsonb(q)::text from public.quotes q')
 sql(read('supabase/migrations/009_quote_surface.sql'))
 assert.equal(sql('select to_jsonb(q)::text from public.quotes q'),before)
 sql(`begin;
 do $$ begin if not exists(select 1 from public.quote_items where description='Legacy' and quantity=1.125 and unit_price=2.25 and calculation_mode='manual' and item_kind='material') then raise exception 'Legacy alterato'; end if; end $$;
 set local role authenticated;
 select set_config('request.jwt.claim.sub','91000000-0000-4000-8000-000000000001',true);
 insert into public.quote_items(quote_id,description,calculation_mode,item_kind,width_cm,height_cm,element_count,faces,unit_price) values('93000000-0000-4000-8000-000000000001','Superficie','surface','service',80,210,3,2,20);
 do $$ begin if not exists(select 1 from public.quote_items where description='Superficie' and quantity=10.08 and unit='m²') then raise exception 'Superficie errata'; end if; end $$;
 update public.quote_items set width_cm=100,faces=1 where description='Superficie';
 do $$ begin if not exists(select 1 from public.quote_items where description='Superficie' and quantity=6.3) then raise exception 'Modifica misure errata'; end if;
 begin update public.quote_items set faces=3 where description='Superficie'; raise exception 'Facce errate accettate'; exception when check_violation then null; end;
 begin update public.quote_items set width_cm=null where description='Superficie'; raise exception 'Misure nulle accettate'; exception when check_violation or not_null_violation then null; end;
 end $$;
 select set_config('request.jwt.claim.sub','91000000-0000-4000-8000-000000000002',true);
 do $$ begin if exists(select 1 from public.quote_items) then raise exception 'RLS violata'; end if; end $$;
 set local role anon;
 do $$ begin begin perform * from public.quote_items; raise exception 'Anon autorizzato'; exception when insufficient_privilege then null; end; end $$;
 rollback;`)
 assert.equal(sql('select count(*) from public.quote_items'),'1')
 console.log('009 PostgreSQL: applicazione, legacy, ricalcolo misure, vincoli, RLS, anon e rollback: OK')
} finally {
 if(started)exec('pg_ctl',['-D',dir+'/data','-m','fast','-w','stop'])
 assert.ok(path.basename(dir).startsWith('lulab-surface-'));fs.rmSync(dir,{recursive:true})
 console.log('Cluster temporaneo arrestato e rimosso.')
}
