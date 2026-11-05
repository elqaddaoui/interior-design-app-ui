/**
 * Interior-design prompt builder. The same text goes to every engine, so switching model never changes the design rules.
 * Priorities, in this order: (1) keep the room's structure and camera, (2) respect the mode (restyle / renovation),
 * (3) exact colours, (4) the chosen style, (5) the person's own words.
 */
const clean = (value, max) => String(value ?? '').replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);

/** Visual vocabulary per style id (the seeded presets). Other (admin-created) styles fall back to their own title. */
const STYLE_NOTES = {
  st_modern: 'modern contemporary: clean lines, low-profile furniture, matte and glossy contrast, hidden storage, sleek lighting',
  st_cozy: 'cozy and warm: soft layered textiles, chunky knits, warm ambient lamps, rounded upholstered furniture, natural wood',
  st_christmas: 'tasteful Christmas decor: a decorated tree, garlands, warm string lights, candles, red and green accents, cozy textiles',
  st_luxury: 'luxury: marble and brass details, velvet and silk upholstery, statement chandelier, symmetry, rich deep materials, designer pieces',
  st_minimal: 'minimalist: very few pieces, uncluttered surfaces, neutral calm palette, natural light, simple geometric shapes',
  st_scandi: 'Scandinavian: light oak, white walls, simple functional furniture, wool and linen, hygge lighting, a few green plants',
  st_farm: 'modern farmhouse: shiplap and beams, reclaimed wood, apron-front details, vintage accents, linen, matte black fixtures',
  st_midcentury: 'mid-century modern: walnut furniture with tapered legs, organic curves, sunburst accents, retro lamps, earthy accent colours',
  st_airbnb: 'bright inviting hospitality styling: durable, photogenic, neutral base with fresh accents, tidy layered bedding, art and plants',
  st_moroccan: 'Moroccan: zellige tiles, carved plaster and arches, brass lanterns, handwoven berber rugs, low majlis seating, cedar and tadelakt textures',
  st_boho: 'bohemian: layered patterned textiles, rattan and macrame, many plants, eclectic art, warm earthy colours, vintage rugs',
  st_industrial: 'industrial loft: exposed brick and concrete, black steel frames, leather and reclaimed wood, Edison bulbs, raw textures',
};
/**
 * What each kind of tool really does. `lockMode` = the tool defines the job itself, so the restyle / renovation switch (which the
 * wizard fills with "restyle" for every tool) must not contradict it. `photo` = the intent only makes sense with a photo.
 * The pattern is tested on the tool id AND its title, so tools the admin creates are recognised too.
 */
const INTENTS = [
  { key: 'furnish', re: /furnish|meubl/, lockMode: true, photo: true, text: 'FURNISH TASK: the room is empty or nearly empty: furnish and decorate it completely, as a real designer would, while leaving the bare room itself (walls, floor, windows, doors, ceiling) unchanged.' },
  { key: 'floorplan', re: /floor.?plan|plan/, lockMode: true, photo: true, text: 'FLOOR PLAN TASK: the input is a 2D floor plan: turn it into a realistic, furnished interior render that follows the plan\'s walls, openings and room proportions exactly.' },
  { key: 'paint', re: /paint|peintur/, lockMode: true, photo: true, text: 'PAINT TASK: change ONLY the wall (and, if asked, ceiling) colours. Furniture, floor, decor and every object stay exactly as they are.' },
  { key: 'garden', re: /garden|jardin/, lockMode: false, photo: true, text: 'GARDEN TASK: this is an outdoor garden / terrace: redesign planting, paving, lighting and outdoor furniture. Keep the house, boundaries, slope and fixed structures as they are.' },
  { key: 'exterior', re: /exterior|facade|fa[c\u00e7]ade|ext[e\u00e9]rieur/, lockMode: false, photo: true, text: 'EXTERIOR TASK: this is a building exterior: restyle the facade finishes, colours, doors, shutters, lighting and landscaping. Keep the building\'s volume, openings and roof exactly as they are.' },
  { key: 'staging', re: /staging/, lockMode: false, photo: true, text: 'STAGING TASK: virtual home staging for a property listing: neutral, appealing, uncluttered furniture and decor that shows the space at its best.' },
];
const intentOf = input => {
  const hay = `${input.toolId || ''} ${input.toolTitle || ''}`.toLowerCase();
  return INTENTS.find(item => item.re.test(hay) && (input.photo || !item.photo)) || null;
};
const NAMES = [
  ['white', '#FFFFFF'], ['off-white', '#F5F0E6'], ['cream', '#F3E9D2'], ['beige', '#D9C8A9'], ['sand', '#C2B280'], ['taupe', '#9A8C7A'], ['light grey', '#C8C8C8'], ['grey', '#808080'], ['charcoal', '#36454F'], ['black', '#111111'],
  ['brown', '#6B4423'], ['walnut brown', '#5B3A29'], ['terracotta', '#C8694A'], ['rust', '#B7410E'], ['orange', '#E8802A'], ['mustard yellow', '#D4A017'], ['yellow', '#F2D31B'], ['olive green', '#7A7A2E'], ['sage green', '#9CAF88'], ['green', '#2E8B57'],
  ['forest green', '#1F4D3A'], ['teal', '#2A8C8C'], ['sky blue', '#87B8DE'], ['blue', '#2F6DB5'], ['navy blue', '#1C2E5A'], ['lavender', '#B8A5D6'], ['purple', '#6B3FA0'], ['blush pink', '#F1C5CF'], ['pink', '#E67FAE'], ['burgundy', '#7A2338'], ['red', '#C62D2D'],
];
const rgb = hex => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
function colorName(hex) {
  const [r, g, b] = rgb(hex);
  let best = NAMES[0][0], bestDistance = Infinity;
  for (const [name, value] of NAMES) { const [r2, g2, b2] = rgb(value); const d = (r - r2) ** 2 + (g - g2) ** 2 + (b - b2) ** 2; if (d < bestDistance) { bestDistance = d; best = name; } }
  return best;
}
/** Only well-formed #RRGGBB values, upper-cased, unique, at most 8. */
function normalizeColors(list) {
  const out = [];
  for (const value of Array.isArray(list) ? list : []) { const hex = typeof value === 'string' && /^#[0-9a-fA-F]{6}$/.test(value.trim()) ? value.trim().toUpperCase() : null; if (hex && !out.includes(hex)) out.push(hex); }
  return out.slice(0, 8);
}
const ROLES = ['dominant colour (walls and the largest surfaces, about 60%)', 'secondary colour (main furniture, rugs and curtains, about 30%)', 'accent colour', 'accent colour', 'accent colour', 'accent colour', 'accent colour', 'accent colour'];
const PAINT_ROLES = ['main wall colour (every wall that is being repainted)', 'second wall colour (feature wall, or the wall beside the first)', 'trim, ceiling or accent colour', 'accent colour', 'accent colour', 'accent colour', 'accent colour', 'accent colour'];
const rolesOf = (colors, intent) => colors.map((hex, i) => ({ hex, name: colorName(hex), role: (intent?.key === 'paint' ? PAINT_ROLES : ROLES)[i] }));
const { BLOCKS, DEFAULT_ORDER, PLACEHOLDERS, IMAGE_ROLES, blockOn } = require('./blocks');
const { resolveRules, defaultRules } = require('./rules');
const NTH = ['first', 'second', 'third', 'fourth', 'fifth', 'sixth'];
let defaultResolved;
const defaults = () => defaultResolved ||= resolveRules(defaultRules(), '');
/** "{name}" -> value. Unknown names are left untouched (the admin preview reports them). */
const fill = (template, ctx) => String(template).replace(/\{([A-Za-z]+)\}/g, (all, key) => (Object.prototype.hasOwnProperty.call(ctx, key) ? String(ctx[key]) : all));
const unknownPlaceholders = template => [...new Set([...String(template).matchAll(/\{([A-Za-z]+)\}/g)].map(m => m[1]).filter(name => !PLACEHOLDERS.includes(name)))];

/**
 * Builds the prompt AND the record of what was applied (shown to the admin on the request, so the admin sees exactly what the model was asked).
 * input: { photo, toolId, toolTitle, roomGroup, roomTitle, styleId, styleTitle, mode, colors, colorSource, paletteName, surprise,
 *          prompt, promptEnglish, imageRoles, hasReference, rules }
 * `roomTitle` / `styleTitle` are English labels when known (the seeded ids carry them) or the admin's own title.
 * `imageRoles` = the extra pictures that REALLY travel with the photo, in order (any of 'inspiration', 'style', 'room'). `hasReference` is the
 * older way to say ['inspiration']. `rules` = the admin's resolved Prompt cards rules (rules.js); without it the defaults apply and the text
 * is exactly the one the app always sent (scripts/fixtures/prompt-defaults.json).
 * Order matters for models that only read the first tokens: task, the client's own words, style and colours first; long rules after.
 * Returns { prompt, applied, blocks } where `blocks` lists every block in prompt order (id, text, custom wording?) for the admin preview.
 */
function buildBrief(input) {
  const R = input.rules || defaults();
  const wanted = Array.isArray(input.imageRoles) ? input.imageRoles : input.hasReference ? ['inspiration'] : [];
  const roles = wanted.filter((role, i) => input.photo && IMAGE_ROLES.includes(role) && wanted.indexOf(role) === i);
  const has = role => roles.includes(role);
  const nthOf = role => NTH[1 + roles.indexOf(role)] || 'next';
  // A picture only replaces the words when it really travels with the photo; otherwise the words stay (text-only fallback).
  const styleMode = has('style') ? R.images.style : 'text';
  const roomMode = has('room') ? R.images.room : 'text';
  const group = input.roomGroup === 'exterior' ? 'exterior' : 'interior';
  const intent = intentOf(input);
  const typed = clean(R.vocab?.rooms?.[input.roomTypeId], 60) || clean(input.roomTitle, 60);
  const noun = (roomMode === 'image' ? '' : typed) || (intent?.key === 'garden' ? 'garden' : group === 'exterior' ? 'building exterior' : 'room');
  const style = clean(input.styleTitle, 60);
  const notes = clean(R.vocab?.styles?.[input.styleId], 400) || STYLE_NOTES[input.styleId] || (style ? `${style} style` : '');
  const styleLine = styleMode === 'image' ? '' : notes;
  const colorRoles = rolesOf(normalizeColors(input.colors), intent);
  const user = clean(input.prompt, 500);
  const english = clean(input.promptEnglish, 700);
  const briefMode = R.output.brief;
  // The client's words as the model should read them: English when it could be translated, with the original wording kept next to it.
  const words = !user ? '' : briefMode === 'original' || !english ? `"${user}"` : briefMode === 'english' ? `"${english}"` : english.toLowerCase() !== user.toLowerCase() ? `"${english}" (the client's original wording: "${user}")` : `"${user}"`;
  const must = [styleLine && `the ${style || 'chosen'} style`, colorRoles.length && `exactly these colours: ${colorRoles.map(r => r.hex).join(', ')}`, user && `the client's request: ${briefMode === 'original' ? user : english || user}`].filter(Boolean);
  const paletteKind = colorRoles.length ? 'colors' : input.surprise ? 'surprise' : '';
  const rulesList = R.rulesText ? R.rulesText.split('\n').map(line => line.trim()).filter(Boolean).map(line => (/^([-*\u2022]|\d+[.)])\s/.test(line) ? line : `- ${line}`)).join('\n') : '';
  const ctx = {
    room: noun, group, style, styleNotes: styleLine || notes, mode: input.mode === 'renovation' ? 'renovation' : 'restyle', tool: clean(input.toolTitle, 120),
    brief: words, briefOriginal: user, briefEnglish: english, colors: colorRoles.map(r => `${r.hex} (${r.name}) as ${r.role}`).join('; '), colorsHex: colorRoles.map(r => r.hex).join(', '),
    palette: clean(input.paletteName, 40), paletteLabel: input.colorSource === 'preset' && input.paletteName ? ` "${clean(input.paletteName, 40)}"` : '', nth: 'second', rules: rulesList, mustList: must.join('; '),
  };
  const made = {}; // block id -> { variant, text, custom }
  /** One block: the situation picks the variant, the admin's switch / wording decides the text. A switched-off block is simply absent. */
  const put = (id, variant, extra = {}, auto = '') => {
    const item = R.blocks.items[id];
    if (!blockOn(id, item, R.images)) return;
    const custom = item?.texts?.[variant] || '';
    let text = fill(custom || auto || BLOCKS[id].variants[variant] || '', { ...ctx, ...extra }).trim();
    // The admin's own wording of the rules block may forget {rules}: the rules are then appended, never lost.
    if (id === 'rules' && custom && !/\{rules\}/.test(custom)) text = `${text}\n${rulesList}`;
    if (text) made[id] = { variant, text, custom: !!custom };
  };
  if (input.photo) {
    put('task', 'photo');
    put('structure', 'default');
    if (user) put('brief', 'photo');
    // A tool that defines the job itself (paint, furnish, floor plan) is not contradicted by the generic restyle / renovation switch.
    if (!intent?.lockMode) put('mode', input.mode === 'renovation' ? 'renovation' : 'restyle');
  } else {
    put('task', 'text');
    if (user) put('brief', 'text');
    put('composition', 'default');
  }
  if (intent || R.blocks.items.intent?.texts?.default) put('intent', 'default', {}, intent?.text || '');
  if (styleLine) put('style', 'default');
  if (has('inspiration')) put('reference', 'default', { nth: nthOf('inspiration') });
  if (has('style')) put('styleImage', styleMode === 'both' ? 'both' : 'image', { nth: nthOf('style') });
  if (has('room')) put('roomImage', roomMode === 'both' ? 'both' : 'image', { nth: nthOf('room') });
  if (paletteKind) put('palette', paletteKind);
  put('quality', 'default');
  if (rulesList) put('rules', 'default');
  if (must.length) put('finalCheck', 'default');
  const order = R.blocks.order.length ? R.blocks.order : DEFAULT_ORDER;
  const list = order.filter(id => made[id]).map(id => ({ id, ...made[id] }));
  return {
    prompt: list.map(block => block.text).join('\n\n'),
    blocks: list,
    applied: {
      task: input.photo ? 'photo' : 'text', intent: intent?.key || null, mode: input.photo && !intent?.lockMode ? (input.mode === 'renovation' ? 'renovation' : 'restyle') : null,
      style: styleLine || styleMode === 'image' ? (style || input.styleId || '') : '', colors: colorRoles, colorSource: colorRoles.length ? (input.colorSource || 'custom') : input.surprise ? 'surprise' : 'none',
      reference: has('inspiration'), brief: user ? { original: user, english: english && english !== user ? english : '' } : null, room: noun,
      images: roles, styleMode, roomMode, rules: !!rulesList, blocksOff: order.filter(id => !blockOn(id, R.blocks.items[id], R.images)),
    },
  };
}
const buildPrompt = input => buildBrief(input).prompt;
const ROOM_EN = {
  rt_living: 'living room', rt_bedroom: 'bedroom', rt_kitchen: 'kitchen', rt_bathroom: 'bathroom', rt_dining: 'dining room', rt_stairs: 'staircase', rt_balcony: 'balcony',
  rt_nursery: 'child\'s bedroom', rt_garage: 'garage', rt_entry: 'entrance hall', rt_laundry: 'laundry room', rt_office: 'office', rt_homeoffice: 'home office', rt_study: 'study',
  rt_house: 'house exterior', rt_villa: 'villa exterior', rt_garden: 'garden', rt_terrace: 'terrace', rt_pool: 'pool area', rt_building: 'apartment building exterior',
};
module.exports = { ROOM_EN, buildPrompt, buildBrief, intentOf, normalizeColors, colorName, clean, STYLE_NOTES, INTENTS, unknownPlaceholders };
