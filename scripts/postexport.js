#!/usr/bin/env node
/**
 * Vercel (and several other static hosts) never serve paths containing a `node_modules` segment.
 * `expo export -p web` places fonts/images from packages under `dist/assets/node_modules/...`,
 * which would 404 in production. This script moves them to `dist/assets/vendor/...` and rewrites
 * every reference in the exported HTML/JS/CSS.
 */
const fs = require('fs');
const path = require('path');

const dist = path.resolve(__dirname, '..', process.argv[2] || 'dist');
const from = path.join(dist, 'assets', 'node_modules');
const FROM = 'assets/node_modules';
const TO = 'assets/vendor';

if (!fs.existsSync(dist)) { console.error(`[postexport] ${dist} not found. Run "expo export -p web" first.`); process.exit(1); }

if (fs.existsSync(from)) {
  const to = path.join(dist, 'assets', 'vendor');
  fs.rmSync(to, { recursive: true, force: true });
  fs.renameSync(from, to);
  console.log(`[postexport] moved ${path.relative(process.cwd(), from)} -> ${path.relative(process.cwd(), to)}`);
}

let files = 0, refs = 0;
(function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { walk(p); continue; }
    if (!/\.(js|css|html|json|map)$/.test(e.name)) continue;
    const src = fs.readFileSync(p, 'utf8');
    if (!src.includes(FROM)) continue;
    const n = src.split(FROM).length - 1;
    fs.writeFileSync(p, src.split(FROM).join(TO));
    files++; refs += n;
  }
})(dist);
console.log(`[postexport] rewrote ${refs} reference(s) in ${files} file(s)`);

// Safety net: fail the build if anything still points to a node_modules asset path.
let bad = 0;
(function check(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (e.name === 'node_modules') { console.error('[postexport] leftover folder', p); bad++; } else check(p); continue; }
    if (/\.(js|css|html)$/.test(e.name) && fs.readFileSync(p, 'utf8').includes('/node_modules/')) {
      // only flag asset URLs, not stack-trace / package strings
      if (/assets\/node_modules\//.test(fs.readFileSync(p, 'utf8'))) { console.error('[postexport] leftover asset ref in', p); bad++; }
    }
  }
})(dist);
if (bad) process.exit(1);
// Installable web app (required for web push on iPhone/iPad) - injected into the SPA shell.
const shell = path.join(dist, 'index.html');
if (fs.existsSync(shell)) {
  let html = fs.readFileSync(shell, 'utf8');
  if (!html.includes('rel="manifest"')) {
    const tags = '<link rel="manifest" href="/manifest.webmanifest"><link rel="apple-touch-icon" href="/icons/apple-touch-icon.png"><meta name="theme-color" content="#FFFFFF"><meta name="apple-mobile-web-app-capable" content="yes"><meta name="mobile-web-app-capable" content="yes"><meta name="apple-mobile-web-app-title" content="Dwira">';
    html = html.replace('</head>', tags + '</head>');
    fs.writeFileSync(shell, html);
    console.log('[postexport] injected web app manifest');
  }
}
// Faster first paint: the shell starts the public-content request and the font downloads before the JavaScript bundle has even
// been fetched, and warms the first card's image as soon as the content says which one it is. Everything here is a hint:
// when it fails, the app asks for the same things itself exactly as before.
if (fs.existsSync(shell)) {
  let html = fs.readFileSync(shell, 'utf8');
  if (!html.includes('__dwiraEarly')) {
    const fontDir = path.join(dist, 'assets', 'assets', 'fonts', 'web');
    const fonts = {};
    if (fs.existsSync(fontDir)) for (const f of fs.readdirSync(fontDir)) { const m = /^(.+?)\.[0-9a-f]{32}\.woff2$/.exec(f); if (m) fonts[m[1]] = `/assets/assets/fonts/web/${f}`; }
    // Only the small fonts the first screen's text and icons need. Bigger ones (Lora, 85 KB, logo wordmark only) would compete with the
    // JavaScript bundle for the same slow link; the app requests those itself as soon as it runs.
    const wanted = { icons: fonts.MaterialCommunityIcons, ar: fonts.Tajawal, fr: fonts.Inter };
    const script = `(function(){try{
var d=document,h=d.head,L=localStorage,W=${JSON.stringify(wanted)};
function pre(href,as,extra){if(!href)return;var l=d.createElement('link');l.rel='preload';l.as=as;l.href=href;if(as==='font'){l.type='font/woff2';l.crossOrigin='anonymous'}if(extra)for(var k in extra)l.setAttribute(k,extra[k]);h.appendChild(l)}
function read(k){try{var v=L.getItem((window.__DWIRA_PFX||'dwira:v1:')+k);return v?JSON.parse(v):null}catch(e){return null}}
var lang=read('lang'),local=read('local'),admin=!!(local&&local.adminSession);
pre(W.icons,'font');pre(lang==='fr'?W.fr:W.ar,'font');
var RT=window.__DWIRA_ROUTE||location.pathname,AB=window.__DWIRA_BASE__?'/'+window.__DWIRA_BASE__:'';
if(!/^\\/api\\//.test(RT)){
var e=window.__dwiraEarly={admin:admin};
e.promise=fetch(AB+'/api/content'+(admin?'?a=1':''),{credentials:'include'}).then(function(r){
if(!r.ok||(r.headers.get('content-type')||'').indexOf('application/json')<0)return null;return r.json()}).then(function(s){
e.value=s;
try{var tools=((s.collections||{}).tools||[]).filter(function(t){return t.visible}).sort(function(a,b){return(a.order||0)-(b.order||0)});
var home=RT==='/'||RT==='';for(var i=0;home&&i<2&&i<tools.length;i++){var m=tools[i].media,u=m&&(m.type==='video'?m.poster:m.uri);
if(u&&/^https?:|^\\//.test(u))pre(AB&&u.indexOf('/api/media/')===0?AB+u:u,'image',{fetchpriority:'high'})}
var st=(s.docs||{}).settings||{},B=window.__dwiraBoot;
if(B&&B.apply){var c={enabled:st.loaderEnabled!==false,style:st.loaderStyle||'ring',uri:st.loaderCustomUri||'',anim:st.loaderCustomAnim||'none',delayMs:+st.loaderDelayMs||0};if(/^#[0-9a-fA-F]{6}$/.test(st.loaderColor||''))c.color=st.loaderColor;B.apply(c)}}catch(x){}
return s}).catch(function(){return null})}
}catch(x){}})();`;
    // The Home route's own chunks (root layout, tab layout, Home screen) are only requested once the entry bundle has run,
    // which adds a full extra round trip. Name them in the shell so they download in parallel with the entry bundle.
    // They are found by a stable string each one contains; if a marker ever stops matching the hint is simply omitted.
    const jsDir = path.join(dist, '_expo', 'static', 'js', 'web');
    const markers = [['_layout', 'global-search-input'], ['_layout', 'tabs.home'], ['index', 'hometab-']];
    const routeChunks = [];
    if (fs.existsSync(jsDir)) for (const [prefix, marker] of markers) {
      const hit = fs.readdirSync(jsDir).find((f) => f.startsWith(prefix + '-') && f.endsWith('.js') && fs.readFileSync(path.join(jsDir, f), 'utf8').includes(marker));
      if (hit) routeChunks.push(`/_expo/static/js/web/${hit}`);
    }
    // Root + tab layouts are needed by every start page; the Home screen chunk only on Home (avoids "preloaded but not used").
    const homeChunk = routeChunks.find((href) => /\/index-[^/]+\.js$/.test(href));
    const chunkTags = routeChunks.filter((href) => href !== homeChunk).map((href) => `<link rel="preload" as="script" href="${href}">`).join('')
      + (homeChunk ? `<script>if((window.__DWIRA_ROUTE||location.pathname)==='/'){var l=document.createElement('link');l.rel='preload';l.as='script';l.href=${JSON.stringify(homeChunk)};document.head.appendChild(l)}</script>` : '');
    console.log(`[postexport] preloading ${routeChunks.length}/${markers.length} Home route chunk(s)`);
    // Every other screen is its own lazy chunk (asyncRoutes). Left alone, each is downloaded the first time a page is opened, which is
    // the multi-second blank on a slow link. Once the first screen is up and the browser is idle they are fetched at the lowest priority
    // (rel=prefetch: never competes with the first paint, skipped on Save-Data), so navigating later finds them in the HTTP cache.
    const allChunks = fs.existsSync(jsDir) ? fs.readdirSync(jsDir).filter((f) => f.endsWith('.js') && !f.startsWith('entry-') && !routeChunks.includes(`/_expo/static/js/web/${f}`)).map((f) => `/_expo/static/js/web/${f}`) : [];
    const adminChunks = fs.existsSync(jsDir) ? allChunks.filter((href) => /\/(\[entity\]|admin|branding|chats|credits|interface|notifications|requests|theme|users|assistant)-/.test(href) && fs.readFileSync(path.join(dist, href), 'utf8').length > 0) : [];
    const userChunks = allChunks.filter((href) => !adminChunks.includes(href));
    const prefetchScript = `(function(){try{var c=navigator.connection;if(c&&(c.saveData||/(^|-)2g$/.test(c.effectiveType||'')))return;var U=${JSON.stringify(userChunks)},A=${JSON.stringify(adminChunks)};var all=(window.__DWIRA_ROUTE||location.pathname).indexOf('/admin')===0?A.concat(U):U;`
      + `function go(){var i=0;(function next(){if(i>=all.length)return;var l=document.createElement('link');l.rel='prefetch';l.as='script';l.href=all[i++];document.head.appendChild(l);setTimeout(next,60)})()}`
      + `function idle(){(window.requestIdleCallback||function(f){setTimeout(f,1500)})(go,{timeout:4000})}`
      + `if(document.readyState==='complete')idle();else addEventListener('load',idle)}catch(e){}})();`;
    console.log(`[postexport] prefetching ${userChunks.length} app + ${adminChunks.length} admin route chunk(s) when idle`);
    // Startup loader (admin: Interface > Loading screen): pure HTML/SVG/CSS, painted with the first bytes of the page.
    const loader = require('../src/lib/loaderShell.js');
    const loaderDefaults = { enabled: true, style: 'ring', color: '#111111', bg: '#FFFFFF', uri: '', anim: 'none', delayMs: 0 };
    const tenantHead = `<script>${require('../src/lib/tenantPath.js').shellScript()}</script>`;
    const loaderHead = `<style id="dwira-boot-css">${loader.CSS}</style><script>${loader.headScript(loaderDefaults)}</script>`;
    html = html.replace(/<body([^>]*)>/, (tag) => tag + loader.BODY);
    const tags = `${tenantHead}${loaderHead}<link rel="preconnect" href="https://images.unsplash.com" crossorigin>${chunkTags}<script>${script.replace(/\n/g, '')}</script><script>${prefetchScript}</script>`;
    // First in <head>: earlier than the stylesheet and the (deferred) bundle scripts.
    html = html.replace('<head>', '<head>' + tags);
    fs.writeFileSync(shell, html);
    console.log('[postexport] injected early content fetch + font/image preloads');
  }
}
// Brotli copies of every text asset, made once here so the Node server never compresses on a visitor's request.
{
  const zlib = require('zlib');
  let made = 0;
  (function pack(dir) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { pack(p); continue; }
      if (!/\.(js|css|html|json|svg|webmanifest)$/.test(e.name) || fs.statSync(p).size < 1024) continue;
      const data = fs.readFileSync(p);
      fs.writeFileSync(p + '.br', zlib.brotliCompressSync(data, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 11, [zlib.constants.BROTLI_PARAM_SIZE_HINT]: data.length } }));
      made++;
    }
  })(dist);
  console.log(`[postexport] wrote ${made} brotli file(s)`);
}
console.log('[postexport] OK - dist is safe to deploy on Vercel');
