const fs=require('fs'),path=require('path');const {SourceMapConsumer}=require('source-map-js');
const [dir,pref,pat,top]=[process.argv[2],process.argv[3],process.argv[4],+process.argv[5]||20];
for(const f of fs.readdirSync(dir).filter(f=>f.startsWith(pref)&&f.endsWith('.js'))){
 const code=fs.readFileSync(path.join(dir,f),'utf8'),lines=code.split('\n'),c=new SourceMapConsumer(JSON.parse(fs.readFileSync(path.join(dir,f+'.map'),'utf8')));const by={};let p=null;
 c.eachMapping(m=>{if(p){const len=p.l===m.generatedLine?m.generatedColumn-p.c:(lines[p.l-1]||'').length-p.c+1;by[p.s]=(by[p.s]||0)+Math.max(0,len)}p={l:m.generatedLine,c:m.generatedColumn,s:m.source}});
 Object.entries(by).filter(([s])=>new RegExp(pat).test(s||'')).sort((a,b)=>b[1]-a[1]).slice(0,top).forEach(([s,b])=>console.log(String(Math.round(b/1024)).padStart(5)+' KB '+s.replace(/^.*webapp\//,'')));
}
