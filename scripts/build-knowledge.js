/**
 * Builds server/knowledge/kb.json, the facts the AI assistant answers from.
 *   - docs/APP_KNOWLEDGE.md           curated sections ("## id | Title", a "kw:" line, then facts)
 *   - server/seed-content.json        what the app really offers: tools, room types, styles, palettes (names in 3 languages)
 *   - src/app/**                      the customer screens (routes)
 * `node scripts/build-knowledge.js --check` exits 1 when kb.json is stale (run by `npm run check:knowledge` and the tests).
 */
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const OUT = path.join(root, 'server', 'knowledge', 'kb.json');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

function parseCurated(text) {
  const body = text.replace(/<!--[\s\S]*?-->/g, '');
  const sections = [];
  for (const block of body.split(/^## /m).slice(1)) {
    const [head, ...rest] = block.split('\n');
    const [id, title] = head.split('|').map(part => part.trim());
    if (!id || !title) throw new Error(`APP_KNOWLEDGE.md: bad heading "${head}"`);
    const lines = rest.join('\n').trim().split('\n');
    const kwLine = lines[0].startsWith('kw:') ? lines.shift().slice(3) : '';
    sections.push({ id, title, keywords: kwLine.split(',').map(k => k.trim()).filter(Boolean), text: lines.join('\n').trim() });
  }
  if (!sections.length) throw new Error('APP_KNOWLEDGE.md has no sections');
  return sections;
}

const names = item => [item.title?.fr, item.title?.ar, item.title?.dar].filter(Boolean).filter((v, i, all) => all.indexOf(v) === i);
const visible = list => (list || []).filter(item => item.visible !== false).sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

function derived() {
  const seed = JSON.parse(read('server/seed-content.json')).collections;
  const out = [];
  const tools = visible(seed.tools);
  if (tools.length) out.push({
    id: 'tools', title: 'Design tools in the app (from the app data)',
    keywords: ['tool', 'tools', 'outil', 'outils', 'card', 'carte', 'garden', 'jardin', 'exterior', 'extérieur', 'staging', 'floor plan', 'plan', 'paint', 'peinture', 'furnish', 'meubler', 'أداة', 'أدوات', 'جنان', 'صباغة', 'تأثيث', 'wach kayn', 'واش كاين'],
    text: 'The Home screen offers these design tools (names as shown in French / Arabic / Darija):\n' + tools.map(t => `- ${names(t).join(' / ')}${t.subtitle?.fr ? `: ${t.subtitle.fr}` : ''}`).join('\n') + '\nThe owner can add, hide or rename tools, so the Home screen is the reference.',
  });
  const rooms = visible(seed.roomTypes);
  if (rooms.length) out.push({
    id: 'rooms', title: 'Room types (from the app data)',
    keywords: ['room', 'rooms', 'pièce', 'pièces', 'salon', 'chambre', 'cuisine', 'bathroom', 'salle de bain', 'living', 'bedroom', 'kitchen', 'غرفة', 'صالون', 'كوزينة', 'حمام', 'بيت', 'bit', 'salon'],
    text: 'Room types the user can pick:\n' + rooms.map(r => `- ${names(r).join(' / ')}`).join('\n'),
  });
  const styles = visible(seed.styles);
  if (styles.length) out.push({
    id: 'styles', title: 'Decor styles (from the app data)',
    keywords: ['style', 'styles', 'modern', 'moderne', 'moroccan', 'marocain', 'boho', 'scandinave', 'luxe', 'industrial', 'ستايل', 'عصري', 'مغربي', 'ريفي', 'wach kayn', 'واش كاين'],
    text: 'Styles the user can pick:\n' + styles.map(s => `- ${names(s).join(' / ')}`).join('\n'),
  });
  const palettes = visible(seed.palettes);
  if (palettes.length) out.push({
    id: 'palettes', title: 'Colour palettes (from the app data)',
    keywords: ['palette', 'palettes', 'color', 'colour', 'colours', 'couleur', 'couleurs', 'ألوان', 'لون', 'لوان', 'alwan', 'couleurs'],
    text: 'Colour palettes offered in the last wizard step:\n' + palettes.map(p => `- ${names(p).join(' / ')}`).join('\n') + '\nThe user can also type exact colours.',
  });
  return out;
}

function screens() {
  const dir = path.join(root, 'src', 'app');
  const found = [];
  (function walk(folder) {
    for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
      const full = path.join(folder, entry.name);
      if (entry.isDirectory()) { if (entry.name !== 'admin') walk(full); continue; }
      if (!/\.tsx$/.test(entry.name) || /^(_layout|\+not-found)/.test(entry.name)) continue;
      found.push(path.relative(dir, full).replace(/\.tsx$/, '').replace(/\/index$/, '').replace(/\(tabs\)\//, ''));
    }
  })(dir);
  return found.sort();
}

function build() {
  const curated = parseCurated(read('docs/APP_KNOWLEDGE.md'));
  const ids = new Set(curated.map(s => s.id));
  const sections = [...curated, ...derived().filter(s => !ids.has(s.id))];
  return { version: 1, sections, screens: screens() };
}

const kb = build();
const text = JSON.stringify(kb, null, 1) + '\n';
if (process.argv.includes('--check')) {
  const current = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8') : '';
  if (current !== text) { console.error('server/knowledge/kb.json is stale: run `npm run build:knowledge`'); process.exit(1); }
  console.log(`knowledge base up to date (${kb.sections.length} sections)`);
} else {
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, text);
  console.log(`wrote ${path.relative(root, OUT)} (${kb.sections.length} sections, ${kb.screens.length} screens)`);
}
