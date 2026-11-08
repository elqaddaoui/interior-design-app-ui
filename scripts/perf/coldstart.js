// Cold-start cost of the function module graph: time + RSS of require('./server') and per-module top-level load time.
const Module=require('module');const orig=Module.prototype.require;const t=[];let depth=0;
Module.prototype.require=function(id){const s=performance.now();depth++;try{return orig.apply(this,arguments)}finally{depth--;const d=performance.now()-s;if(/^(\.|@aws|web-push|pg$|@electric)|aws|web-push/.test(id)&&d>3)t.push([d,id,depth])}};
const s=performance.now();const r0=process.memoryUsage().rss;
const api=require('../../api/index.js');
const total=performance.now()-s;
console.log('require(api/index.js) ms',total.toFixed(0),'rss +MB',((process.memoryUsage().rss-r0)/1048576).toFixed(0));
t.sort((a,b)=>b[0]-a[0]).slice(0,10).forEach(([d,id,dep])=>console.log(d.toFixed(0).padStart(5),'ms',id,'depth',dep));
const loaded=Object.keys(require.cache).filter(f=>/node_modules/.test(f));
const pk={};for(const f of loaded){const m=f.match(/node_modules\/((?:@[^/]+\/)?[^/]+)/);pk[m[1]]=(pk[m[1]]||0)+1}
console.log('node_modules packages loaded:',Object.entries(pk).sort((a,b)=>b[1]-a[1]).slice(0,8).map(([k,v])=>k+':'+v).join(' '));
