/**
 * Verifies every family of the logo-maker font catalog against the live Google Fonts CSS API and writes
 * src/lib/brand/fontCatalog.ts (family, category, weights, scripts that really exist). Needs network.
 *   node scripts/gen-brand-fonts.js
 * Why a script: a wrong weight range makes the API answer 400, so the catalog is generated from what the API accepts.
 */
const fs = require('node:fs');
const path = require('node:path');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
// [family, category, hint] - hint: "a..b" variable range, or "400,700" static list
const HINTS = [
  ['Inter', 'sans', '100..900'], ['Poppins', 'sans', '100,200,300,400,500,600,700,800,900'], ['Montserrat', 'sans', '100..900'], ['Raleway', 'sans', '100..900'],
  ['Nunito', 'sans', '200..1000'], ['DM Sans', 'sans', '100..1000'], ['Manrope', 'sans', '200..800'], ['Outfit', 'sans', '100..900'],
  ['Plus Jakarta Sans', 'sans', '200..800'], ['Space Grotesk', 'sans', '300..700'], ['Sora', 'sans', '100..800'], ['Work Sans', 'sans', '100..900'],
  ['Lexend', 'sans', '100..900'], ['Urbanist', 'sans', '100..900'], ['Rubik', 'sans', '300..900'], ['Josefin Sans', 'sans', '100..700'],
  ['Quicksand', 'sans', '300..700'], ['Syne', 'sans', '400..800'], ['Unbounded', 'display', '200..900'], ['Roboto', 'sans', '100..900'], ['Lato', 'sans', '100,300,400,700,900'],
  ['Playfair Display', 'serif', '400..900'], ['Lora', 'serif', '400..700'], ['Merriweather', 'serif', '300,400,700,900'], ['DM Serif Display', 'serif', '400'],
  ['Cormorant Garamond', 'serif', '300..700'], ['Fraunces', 'serif', '100..900'], ['Libre Baskerville', 'serif', '400..700'], ['Bodoni Moda', 'serif', '400..900'],
  ['Abril Fatface', 'display', '400'], ['Cinzel', 'serif', '400..900'], ['EB Garamond', 'serif', '400..800'], ['Crimson Pro', 'serif', '200..900'],
  ['Bebas Neue', 'display', '400'], ['Oswald', 'display', '200..700'], ['Anton', 'display', '400'], ['Righteous', 'display', '400'], ['Fredoka', 'display', '300..700'],
  ['Baloo 2', 'display', '400..800'], ['Archivo Black', 'display', '400'], ['Alfa Slab One', 'display', '400'], ['Comfortaa', 'display', '300..700'], ['Permanent Marker', 'display', '400'],
  ['Pacifico', 'script', '400'], ['Lobster', 'script', '400'], ['Dancing Script', 'script', '400..700'], ['Great Vibes', 'script', '400'], ['Satisfy', 'script', '400'],
  ['Playball', 'script', '400'], ['Caveat', 'script', '400..700'], ['Space Mono', 'mono', '400,700'], ['JetBrains Mono', 'mono', '100..800'],
  ['Cairo', 'arabic', '200..1000'], ['Tajawal', 'arabic', '200,300,400,500,700,800,900'], ['Almarai', 'arabic', '300,400,700,800'], ['Amiri', 'arabic', '400,700'],
  ['Reem Kufi', 'arabic', '400..700'], ['El Messiri', 'arabic', '400..700'], ['Changa', 'arabic', '200..800'], ['Lalezar', 'arabic', '400'], ['Markazi Text', 'arabic', '400..700'],
  ['Harmattan', 'arabic', '400,500,600,700'], ['Lemonada', 'arabic', '300..700'], ['Mada', 'arabic', '200..900'], ['Noto Kufi Arabic', 'arabic', '100..900'],
  ['Noto Naskh Arabic', 'arabic', '400..700'], ['Aref Ruqaa', 'arabic', '400,700'], ['Scheherazade New', 'arabic', '400..700'], ['Rakkas', 'arabic', '400'],
  ['Katibeh', 'arabic', '400'], ['Baloo Bhaijaan 2', 'arabic', '400..800'], ['IBM Plex Sans Arabic', 'arabic', '100,200,300,400,500,600,700'], ['Readex Pro', 'arabic', '160..700'],
  ['Vazirmatn', 'arabic', '100..900'], ['Noto Sans Arabic', 'arabic', '100..900'], ['Alexandria', 'arabic', '100..900'], ['Kufam', 'arabic', '400..900'], ['Jomhuria', 'arabic', '400'],
  ['Heebo', 'intl', '100..900'], ['Noto Sans Hebrew', 'intl', '100..900'], ['Noto Sans JP', 'intl', '100..900'], ['Noto Sans SC', 'intl', '100..900'], ['Noto Sans KR', 'intl', '100..900'],
  ['Noto Sans Devanagari', 'intl', '100..900'], ['Noto Sans Thai', 'intl', '100..900'], ['Noto Serif', 'intl', '100..900'],
];
const spec = (hint) => (hint.includes('..') ? hint : hint.split(',').join(';'));
const url = (family, hint) => `https://fonts.googleapis.com/css2?family=${family.replace(/ /g, '+')}:wght@${spec(hint)}&display=swap`;
async function get(u) { const r = await fetch(u, { headers: { 'User-Agent': UA } }); return { ok: r.ok, status: r.status, text: r.ok ? await r.text() : '' }; }
(async () => {
  const out = []; const bad = [];
  for (const [family, cat, hint] of HINTS) {
    const attempts = [hint, ...(hint.includes('..') ? [`${hint.split('..')[0]},${hint.split('..')[1]}`] : []), '400'];
    let res = null, used = '';
    for (const a of attempts) { const r = await get(url(family, a)); if (r.ok) { res = r; used = a; break; } }
    if (!res) { bad.push(family); continue; }
    const scripts = [...new Set([...res.text.matchAll(/\/\*\s*([a-z-]+)\s*\*\//g)].map((m) => m[1]))];
    const weights = used;
    const axis = used.includes('..') ? [used] : used.split(',');
    const italicUrl = `https://fonts.googleapis.com/css2?family=${family.replace(/ /g, '+')}:ital,wght@${[...axis.map((w) => `0,${w}`), ...axis.map((w) => `1,${w}`)].join(';')}&display=swap`;
    const it = await get(italicUrl);
    out.push({ family, cat, weights, scripts: [...scripts.filter((x) => !/^(math|symbols|symbols2|emoji)$/.test(x)), ...(/^Noto Sans (JP|SC|KR)$/.test(family) ? ['cjk'] : [])], italic: it.ok });
    process.stdout.write(`${family.padEnd(24)} ${used.padEnd(12)} italic=${it.ok} scripts=${scripts.join(',')}\n`);
  }
  if (bad.length) console.log('REJECTED:', bad.join(', '));
  const body = out.map((f) => `  { family: ${JSON.stringify(f.family)}, cat: '${f.cat}', weights: ${JSON.stringify(f.weights)}, italic: ${f.italic}, scripts: ${JSON.stringify(f.scripts.join(' '))} },`).join('\n');
  fs.writeFileSync(path.join(__dirname, '../src/lib/brand/fontCatalog.ts'),
`/* Generated by scripts/gen-brand-fonts.js from the live Google Fonts API - do not edit by hand. */
export type FontCat = 'sans' | 'serif' | 'display' | 'script' | 'mono' | 'arabic' | 'intl';
/** weights: "a..b" = variable range, "400,700" = static list. scripts: space-separated Google subsets the family really ships. */
export interface CatalogFont { family: string; cat: FontCat; weights: string; italic: boolean; scripts: string }
export const FONT_CATALOG: CatalogFont[] = [
${body}
];
`);
  console.log(`wrote ${out.length} fonts`);
})();
