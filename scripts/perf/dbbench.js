// EXPLAIN (ANALYZE, BUFFERS) of every hot-path query on realistic data, on a throw-away PGlite (never production).
// usage: node .perf/dbbench.js <label> [--indexes]   -> .perf/db-<label>.json
const fs=require('fs'),path=require('path');
const label=process.argv[2]||'base', withIdx=process.argv.includes('--indexes');
const dir=path.join(require('os').tmpdir(),'pgl-'+label); fs.rmSync(dir,{recursive:true,force:true});
process.env.PGLITE_DIR=dir; delete process.env.DATABASE_URL;
const {createDb}=require('../../server/db');
const INDEXES=fs.existsSync(path.join(__dirname,'indexes.sql'))?fs.readFileSync(path.join(__dirname,'indexes.sql'),'utf8'):'';
(async()=>{
 const db=createDb(process.env); await db.query('SELECT 1');
 const now=Date.now(), N={clients:10000,requests:50000,sessions:15000,claims:15000,subs:8000,deliveries:30000,outbox:40};
 const t0=Date.now();
 await db.query(`INSERT INTO clients(id,phone,name,free_used,credits,created_at,blocked,last_seen) SELECT 'c'||g,'+2126'||lpad(g::text,8,'0'),'Client '||g,g%2,g%7,${now}-g::bigint*60000,(g%50=0)::int,${now}-(g%90)::bigint*86400000 FROM generate_series(1,${N.clients}) g`);
 await db.query(`INSERT INTO user_sessions SELECT md5('t'||g)||md5('u'||g),'c'||(1+g%${N.clients}),CASE WHEN g%3=0 THEN ${now}-86400000 ELSE ${now}+86400000::bigint*100 END FROM generate_series(1,${N.sessions}) g`);
 await db.query(`INSERT INTO claims(id,client_id,free,created_at) SELECT 'k'||g,'c'||(1+g%${N.clients}),g%2,${now}-g::bigint*50000 FROM generate_series(1,${N.claims}) g`);
 await db.query(`INSERT INTO requests(id,user_id,client_request_id,created_at,data) SELECT 'r'||g,'c'||(1+g%${N.clients}),'cr'||g,${now}-g::bigint*30000,jsonb_build_object('id','r'||g,'name','Client','whatsapp','+212600000000','status','pending','photoUri','/api/media/'||md5(g::text)||'.jpg','draft',jsonb_build_object('toolId','t1','styleId','s1','prompt',repeat('x',200)))::text FROM generate_series(1,${N.requests}) g`);
 await db.query(`INSERT INTO subscriptions(id,data,owner_type,owner_id,device_id) SELECT 's'||g,'{"endpoint":"https://push.example/'||g||'"}','client','c'||(1+g%${N.clients}),'d'||g FROM generate_series(1,${N.subs}) g`);
 await db.query(`INSERT INTO subscriptions(id,data,owner_type,owner_id,device_id) VALUES('sa1','{}','admin','admin','da1')`);
 await db.query(`INSERT INTO campaigns(id,kind,data,status,next_at,created_at,updated_at) VALUES('cmp1','once','{}','sending',${now},${now},${now})`);
 await db.query(`INSERT INTO campaign_deliveries(id,campaign_id,client_id,occurrence,status,next_at,created_at) SELECT 'd'||g,'cmp1','c'||(1+g%${N.clients}),'o'||g,CASE WHEN g%100=0 THEN 'pending' ELSE 'sent' END,${now}-g::bigint*1000,${now} FROM generate_series(1,${N.deliveries}) g`);
 await db.query(`INSERT INTO space(id,client_id,kind,value) SELECT 'sp-c-'||g,'c'||g,'conversations',jsonb_build_object('id','sp-c-'||g,'title','chat','updatedAt',${now}-g::bigint*1000,'messages',(SELECT jsonb_agg(jsonb_build_object('id','m'||i,'role','user','text',repeat('hello ',20),'createdAt',${now}-i)) FROM generate_series(1,CASE WHEN g<=200 THEN 400 ELSE 4 END) i))::text FROM generate_series(1,${N.clients}) g`);
 await db.query(`INSERT INTO space(id,client_id,kind,value) SELECT 'sp-h-'||g,'c'||g,'history',(SELECT jsonb_agg(jsonb_build_object('id','h'||i,'toolId','t1','createdAt',${now}-i,'uri','/api/media/'||md5(i::text)||'.jpg')) FROM generate_series(1,6) i)::text FROM generate_series(1,${N.clients}) g`);
 await db.query(`INSERT INTO outbox(request_id,attempts,next_at) SELECT 'r'||g,1,${now}+60000 FROM generate_series(1,${N.outbox}) g`);
 await db.query(`INSERT INTO sync_state(key,version) VALUES('content',7),('requests',9),('clients',3)`);
 if(withIdx&&INDEXES) await db.query(INDEXES);
 await db.query('ANALYZE');
 const sizes=await db.query(`SELECT relname AS t, pg_total_relation_size(oid)::bigint AS bytes, reltuples::bigint AS rows FROM pg_class WHERE relkind='r' AND relnamespace='public'::regnamespace AND reltuples>0 ORDER BY 2 DESC`);
 const UPDATED="CASE WHEN (s.value::jsonb->>'updatedAt') ~ '^[0-9]{1,15}$' THEN (s.value::jsonb->>'updatedAt')::bigint ELSE 0 END";
 const tok=require('crypto').createHash('md5').update('t3001').digest('hex')+require('crypto').createHash('md5').update('u3001').digest('hex');
 const Q=[
  ['auth: session+client lookup (every authenticated call)',"SELECT id,phone,name,free_used,credits,created_at,blocked,last_seen FROM user_sessions s JOIN clients c ON c.id=s.client_id WHERE s.token_hash=$1 AND s.expires_at>$2",[tok,now]],
  ['sync: version counters',"SELECT key,version FROM sync_state WHERE key = ANY($1)",[['content','c:c5','c:c5:history']]],
  ['sync: outbox waiting (Vercel, every poll)',"SELECT 1 FROM outbox WHERE next_at<=$1 LIMIT 1",[now]],
  ['client: own requests',"SELECT data FROM requests WHERE user_id=$1 ORDER BY created_at DESC",['c1234']],
  ['admin: requests page (LIMIT 50)',"SELECT data FROM requests ORDER BY created_at DESC LIMIT 50",[]],
  ['client: space read',"SELECT id,kind,value FROM space WHERE client_id=$1",['c1234']],
  ['login: purge expired sessions',"DELETE FROM user_sessions WHERE expires_at<=$1 AND false",[now]],
  ['campaigns: loadClients (per tick/preview)',"SELECT c.id, c.name, c.created_at, c.last_seen, c.prefs,(SELECT COUNT(*) FROM claims k WHERE k.client_id=c.id)::int AS designs,(SELECT MIN(k.created_at) FROM claims k WHERE k.client_id=c.id) AS first_design,(SELECT COUNT(*) FROM subscriptions s WHERE s.owner_type='client' AND s.owner_id=c.id)::int AS devices FROM clients c WHERE c.blocked=0",[]],
  ['campaigns: due deliveries',"SELECT d.*, c.name AS client_name FROM campaign_deliveries d JOIN clients c ON c.id=d.client_id WHERE d.status='pending' AND d.next_at<=$1 ORDER BY d.next_at LIMIT 200",[now]],
  ['push: devices of one client',"SELECT id,data,owner_id FROM subscriptions WHERE owner_type='client' AND owner_id=$1",['c1234']],
  ['admin: users list (unbounded)',"SELECT id,phone,name,free_used,credits,created_at,blocked,last_seen FROM clients ORDER BY created_at DESC",[]],
  ['admin: chats list (top 300 by JSON updatedAt)',`SELECT s.id, ${UPDATED} AS at FROM space s WHERE s.kind='conversations' AND CASE WHEN jsonb_typeof(s.value::jsonb->'messages')='array' THEN jsonb_array_length(s.value::jsonb->'messages') ELSE 0 END > 0 ORDER BY at DESC LIMIT 300`,[]],
  ['claim lookup by client',"SELECT 1 FROM claims WHERE id=$1 AND client_id=$2",['k100','c101']],
 ];
 const out=[];
 for(const [name,sql,params] of Q){
  const runs=[];let plan='';
  for(let i=0;i<7;i++){const rows=await db.query('EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT) '+sql,params);const txt=rows.map(r=>r['QUERY PLAN']).join('\n');const m=txt.match(/Execution Time: ([\d.]+) ms/);runs.push(+m[1]);if(i===6)plan=txt}
  runs.sort((a,b)=>a-b);
  const scans=[...plan.matchAll(/(Seq Scan|Index Scan|Index Only Scan|Bitmap Heap Scan) (?:using (\S+) )?on (\S+)/g)].map(m=>(m[1].replace(' Scan','')+(m[2]?'('+m[2]+')':'')+':'+m[3]));
  const buf=(plan.match(/Buffers: shared hit=(\d+)/)||[])[1]|0;
  out.push({name,p50:+runs[3].toFixed(2),max:+runs[6].toFixed(2),buffers:buf,scans:[...new Set(scans)].join(', ')});
 }
 fs.writeFileSync(path.join(require('os').tmpdir(),'db-'+label+'.json'),JSON.stringify({seedSecs:(Date.now()-t0)/1000,sizes:sizes.map(s=>({t:s.t,MB:+(Number(s.bytes)/1048576).toFixed(1),rows:Number(s.rows)})),queries:out},null,1));
 console.log('done',label,(Date.now()-t0)/1000+'s');
 await db.close();process.exit(0);
})().catch(e=>{console.error(e);process.exit(1)});
