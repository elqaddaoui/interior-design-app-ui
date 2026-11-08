// Attributes bytes of each generated chunk to node_modules packages / app dirs using the source map "mappings".
const fs=require('fs'),path=require('path');
const dir=process.argv[2]; const only=process.argv[3];
const {SourceMapConsumer}=require('source-map-js');
const files=fs.readdirSync(dir).filter(f=>f.endsWith('.js')&&(!only||f.startsWith(only)));
const tot={};
for(const f of files){
  const code=fs.readFileSync(path.join(dir,f),'utf8'); const mapf=path.join(dir,f+'.map'); if(!fs.existsSync(mapf)) continue;
  const map=JSON.parse(fs.readFileSync(mapf,'utf8'));
  // Metro maps: use sources + approximate by per-segment spans
  const c=new SourceMapConsumer(map); const lines=code.split('\n'); const by={};
  let prev=null;
  c.eachMapping(m=>{ if(prev){ let len; if(prev.l===m.generatedLine) len=m.generatedColumn-prev.c; else len=(lines[prev.l-1]||'').length-prev.c+1; by[prev.s]=(by[prev.s]||0)+Math.max(0,len);} prev={l:m.generatedLine,c:m.generatedColumn,s:m.source}; });
  for(const [s,b] of Object.entries(by)){ let k=s||'?'; const m=k.match(/node_modules\/((?:@[^/]+\/)?[^/]+)/); k=m?'pkg:'+m[1]:(k.replace(/^.*webapp\//,'').split('/').slice(0,3).join('/')); tot[f.split('-')[0]+':'+k]=(tot[f.split('-')[0]+':'+k]||0)+b; }
}
const arr=Object.entries(tot).sort((a,b)=>b[1]-a[1]).slice(0,+process.argv[4]||30);
for(const [k,v] of arr) console.log(String(Math.round(v/1024)).padStart(6)+' KB  '+k);
