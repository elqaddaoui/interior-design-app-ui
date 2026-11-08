const base=process.argv[2]||'http://localhost:8080', n=+process.argv[3]||200;
const pct=(a,p)=>a.sort((x,y)=>x-y)[Math.min(a.length-1,Math.floor(a.length*p))];
(async()=>{for(const [name,path,h] of [['health','/api/health',{}],['content','/api/content',{'accept-encoding':'gzip'}],['content-304','/api/content',{'accept-encoding':'gzip','if-none-match':'W/"content:p:'+(await (await fetch(base+'/api/sync')).json()).content+'"'}],['sync','/api/sync',{}]]){
 const t=[];for(let i=0;i<n;i++){const s=performance.now();const r=await fetch(base+path,{headers:h});await r.arrayBuffer();t.push(performance.now()-s)}
 console.log(name.padEnd(12),'p50',pct(t,.5).toFixed(1),'p95',pct(t,.95).toFixed(1),'ms (local, n='+n+')')}})();
