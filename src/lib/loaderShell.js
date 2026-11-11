/* eslint-disable */
/**
 * Startup loader markup shared by:
 *  - scripts/postexport.js, which writes it into index.html so it paints with the first bytes of the page (before JS);
 *  - the web admin preview and the web dev fallback (src/components/BootLoader.tsx), so the admin sees exactly what visitors get.
 * Plain CommonJS on purpose: Node (build script) and Metro (app) both load it.
 *
 * Every built-in style is an inline SVG: SVG counts as "contentful" for First Contentful Paint, plain coloured <div>s do not.
 */
const MARKUP = {
  ring: '<svg class="db-ring" viewBox="0 0 50 50" width="48" height="48" aria-hidden="true"><circle cx="25" cy="25" r="20" fill="none" stroke="currentColor" stroke-opacity=".18" stroke-width="5"/><circle class="db-arc" cx="25" cy="25" r="20" fill="none" stroke="currentColor" stroke-width="5" stroke-linecap="round" stroke-dasharray="80 126"/></svg>',
  dots: '<svg class="db-dots" viewBox="0 0 64 20" width="64" height="20" aria-hidden="true"><circle cx="10" cy="10" r="6" fill="currentColor"/><circle cx="32" cy="10" r="6" fill="currentColor"/><circle cx="54" cy="10" r="6" fill="currentColor"/></svg>',
  pulse: '<svg class="db-pulse" viewBox="0 0 50 50" width="56" height="56" aria-hidden="true"><circle cx="25" cy="25" r="22" fill="currentColor"/><circle cx="25" cy="25" r="22" fill="currentColor"/></svg>',
  bars: '<svg class="db-bars" viewBox="0 0 50 40" width="50" height="40" aria-hidden="true"><rect x="3" y="0" width="7" height="40" rx="3" fill="currentColor"/><rect x="15" y="0" width="7" height="40" rx="3" fill="currentColor"/><rect x="27" y="0" width="7" height="40" rx="3" fill="currentColor"/><rect x="39" y="0" width="7" height="40" rx="3" fill="currentColor"/></svg>',
  // Moroccan interior collection: zellige star, horseshoe arches, fanous lantern and a zellige tile wave.
  zellige: '<svg class="db-zellige" viewBox="0 0 60 60" width="60" height="60" aria-hidden="true"><circle cx="30" cy="30" r="27" fill="none" stroke="currentColor" stroke-opacity=".15" stroke-width="2"/><rect class="db-za" x="15" y="15" width="30" height="30" rx="2" fill="none" stroke="currentColor" stroke-width="3" stroke-linejoin="round"/><rect class="db-zb" x="15" y="15" width="30" height="30" rx="2" fill="none" stroke="currentColor" stroke-width="3" stroke-linejoin="round"/><circle class="db-zc" cx="30" cy="30" r="5" fill="currentColor"/></svg>',
  arch: '<svg class="db-arch" viewBox="0 0 60 60" width="60" height="60" aria-hidden="true"><path d="M10 56V32C4 22 14 4 30 4C46 4 56 22 50 32V56" fill="none" stroke="currentColor" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M19 56V34C15 28 21 15 30 15C39 15 45 28 41 34V56" fill="none" stroke="currentColor" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M26 56V39C24 35 27 29 30 29C33 29 36 35 34 39V56" fill="none" stroke="currentColor" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  lantern: '<svg class="db-lanternsvg" viewBox="0 0 50 64" width="48" height="62" aria-hidden="true"><g class="db-lantern"><line x1="25" y1="1" x2="25" y2="9" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/><path d="M18 17L25 9L32 17Z" fill="currentColor"/><path d="M14 17H36V38C36 47 31 51 25 57C19 51 14 47 14 38Z" fill="none" stroke="currentColor" stroke-width="3" stroke-linejoin="round"/><circle class="db-glow" cx="25" cy="35" r="12" fill="currentColor" fill-opacity=".14"/><ellipse class="db-flame" cx="25" cy="38" rx="4" ry="7" fill="currentColor"/></g></svg>',
  mosaic: '<svg class="db-mosaic" viewBox="0 0 60 60" width="60" height="60" aria-hidden="true"><polygon points="12,4 20,12 12,20 4,12" fill="currentColor"/><polygon points="30,4 38,12 30,20 22,12" fill="currentColor"/><polygon points="48,4 56,12 48,20 40,12" fill="currentColor"/><polygon points="12,22 20,30 12,38 4,30" fill="currentColor"/><polygon points="30,22 38,30 30,38 22,30" fill="currentColor"/><polygon points="48,22 56,30 48,38 40,30" fill="currentColor"/><polygon points="12,40 20,48 12,56 4,48" fill="currentColor"/><polygon points="30,40 38,48 30,56 22,48" fill="currentColor"/><polygon points="48,40 56,48 48,56 40,48" fill="currentColor"/></svg>',
};

const CSS = [
  '.db-root{position:fixed;inset:0;z-index:2147483000;display:flex;align-items:center;justify-content:center;transition:opacity .2s ease}',
  '.db-root.db-out{opacity:0;pointer-events:none}',
  '.db-box{display:flex;align-items:center;justify-content:center;width:96px;height:96px}',
  '.db-box svg *{transform-box:fill-box;transform-origin:center}',
  '.db-ring{animation:db-spin 1s linear infinite}',
  '.db-dots circle{animation:db-dot 1s ease-in-out infinite}',
  '.db-dots circle:nth-child(2){animation-delay:.15s}.db-dots circle:nth-child(3){animation-delay:.3s}',
  '.db-pulse circle{animation:db-pulse 1.4s ease-out infinite}.db-pulse circle:nth-child(2){animation-delay:.7s}',
  '.db-bars rect{animation:db-bar 1s ease-in-out infinite}',
  '.db-bars rect:nth-child(2){animation-delay:.12s}.db-bars rect:nth-child(3){animation-delay:.24s}.db-bars rect:nth-child(4){animation-delay:.36s}',
  '.db-img{max-width:96px;max-height:96px;object-fit:contain}',
  '.db-a-spin{animation:db-spin 1.2s linear infinite}.db-a-pulse{animation:db-breathe 1.2s ease-in-out infinite}',
  '@keyframes db-spin{to{transform:rotate(360deg)}}',
  '@keyframes db-dot{0%,80%,100%{transform:scale(.55);opacity:.45}40%{transform:scale(1);opacity:1}}',
  '@keyframes db-pulse{0%{transform:scale(.1);opacity:.9}100%{transform:scale(1);opacity:0}}',
  '@keyframes db-bar{0%,100%{transform:scaleY(.35)}50%{transform:scaleY(1)}}',
  '@keyframes db-breathe{0%,100%{transform:scale(.85);opacity:.7}50%{transform:scale(1);opacity:1}}',
  // Moroccan collection
  '.db-za{animation:db-spin 4s linear infinite}.db-zb{animation:db-spin-r 4s linear infinite}.db-zc{animation:db-breathe 1.6s ease-in-out infinite}',
  '.db-arch path{animation:db-arch 1.8s ease-in-out infinite}.db-arch path:nth-child(2){animation-delay:.25s}.db-arch path:nth-child(3){animation-delay:.5s}',
  '.db-lanternsvg{overflow:visible}.db-box .db-lantern{transform-origin:50% 0;animation:db-swing 2.4s ease-in-out infinite}.db-flame{animation:db-flicker .9s ease-in-out infinite}.db-glow{animation:db-breathe 1.8s ease-in-out infinite}',
  '.db-mosaic polygon{animation:db-tile 1.5s ease-in-out infinite}',
  '.db-mosaic polygon:nth-child(2),.db-mosaic polygon:nth-child(4){animation-delay:.15s}.db-mosaic polygon:nth-child(3),.db-mosaic polygon:nth-child(5),.db-mosaic polygon:nth-child(7){animation-delay:.3s}.db-mosaic polygon:nth-child(6),.db-mosaic polygon:nth-child(8){animation-delay:.45s}.db-mosaic polygon:nth-child(9){animation-delay:.6s}',
  '@keyframes db-spin-r{from{transform:rotate(45deg)}to{transform:rotate(-315deg)}}',
  '@keyframes db-arch{0%,100%{opacity:.18}35%,60%{opacity:1}}',
  '@keyframes db-swing{0%,100%{transform:rotate(-9deg)}50%{transform:rotate(9deg)}}',
  '@keyframes db-flicker{0%,100%{transform:scale(1,1);opacity:1}30%{transform:scale(.85,1.18);opacity:.85}60%{transform:scale(1.1,.9);opacity:1}}',
  '@keyframes db-tile{0%,100%{transform:scale(.3);opacity:.3}50%{transform:scale(1);opacity:1}}',
  '@media (prefers-reduced-motion:reduce){.db-box *{animation-duration:2.4s!important}}',
].join('');

/** Only image URLs the page may load: http(s), same-origin paths and inline images. */
const SAFE_URI = /^(https?:\/\/|\/(?!\/)|data:image\/(png|jpeg|gif|webp|svg\+xml|avif);base64,)/;

const KEYS = ['ring', 'dots', 'pulse', 'bars', 'zellige', 'arch', 'lantern', 'mosaic', 'custom'];
/**
 * Returns render(box, cfg): fills `box` (a DOM element) with the loader for `cfg`. A factory with explicit parameters so the
 * same source runs in the app and, stringified, inside index.html. Custom images are created with DOM APIs, never through
 * HTML strings, so an image URL can never inject markup.
 */
function makeRender(markup, keys, safeUri) {
  return function (box, cfg) {
    var style = cfg && keys.indexOf(cfg.style) >= 0 ? cfg.style : 'ring';
    box.style.color = cfg && /^#[0-9a-fA-F]{6}$/.test(cfg.color || '') ? cfg.color : '#111111';
    if (style === 'custom') {
      if (cfg.uri && safeUri.test(cfg.uri)) {
        var img = document.createElement('img');
        img.className = 'db-img' + (cfg.anim === 'spin' ? ' db-a-spin' : cfg.anim === 'pulse' ? ' db-a-pulse' : '');
        img.alt = '';
        img.src = cfg.uri;
        box.textContent = '';
        box.appendChild(img);
        return;
      }
      style = 'ring';
    }
    box.innerHTML = markup[style];
  };
}

/**
 * Head script: defines window.__dwiraBoot = { apply(cfg), hide(), active }.
 * Reads the configuration remembered from the previous visit (localStorage `dwira:v1:loader`, written by the app).
 * A safety timer removes the loader even if the JavaScript bundle never runs.
 */
function headScript(defaults) {
  return '(function(){var render=(' + makeRender.toString() + ')(' + JSON.stringify(MARKUP) + ',' + JSON.stringify(KEYS) + ',' + SAFE_URI.toString() + ');' +
    'var cfg=' + JSON.stringify(defaults) + ';try{var s=localStorage.getItem((window.__DWIRA_PFX||"dwira:v1:")+"loader");if(s){var p=JSON.parse(s);for(var k in p)cfg[k]=p[k]}}catch(e){}' +
    'var B=window.__dwiraBoot={active:cfg.enabled!==false,' +
    'mount:function(){try{var bc=localStorage.getItem((window.__DWIRA_PFX||"dwira:v1:")+"bar-color");if(/^#[0-9a-fA-F]{6}$/.test(bc||"")){var mt=document.querySelector("meta[name=theme-color]");if(mt)mt.content=bc;document.documentElement.style.background=bc}}catch(e){}' +
    'var r=document.getElementById("dwira-boot");if(!r)return;if(!B.active){r.remove();return}' +
    'if(/^#[0-9a-fA-F]{6}$/.test(cfg.bg||""))r.style.background=cfg.bg;render(r.firstChild,cfg);' +
    'setTimeout(B.hide,Math.max(12000,(+cfg.delayMs||0)+4000))},' +
    'apply:function(n){if(!B.active)return;for(var k in n)cfg[k]=n[k];if(cfg.enabled===false)return B.hide();var r=document.getElementById("dwira-boot");if(!r)return;' +
    'if(/^#[0-9a-fA-F]{6}$/.test(cfg.bg||""))r.style.background=cfg.bg;render(r.firstChild,cfg)},' +
    'hide:function(){if(!B.active)return;B.active=false;var r=document.getElementById("dwira-boot");if(!r)return;r.className+=" db-out";setTimeout(function(){r.remove()},220)}};' +
    '})();';
}

/** Body markup: placed right after <body> so it is the first thing painted. */
const BODY = '<div id="dwira-boot" class="db-root" style="background:#FFFFFF" role="progressbar" aria-label="Loading"><div class="db-box"></div></div><script>window.__dwiraBoot&&window.__dwiraBoot.mount()</script>';

module.exports = { MARKUP, CSS, SAFE_URI, BODY, headScript, render: makeRender(MARKUP, KEYS, SAFE_URI) };
