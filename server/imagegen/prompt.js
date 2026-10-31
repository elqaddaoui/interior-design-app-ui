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
const TOOL_INTENT = [
  [/furnish/, 'The room is empty or nearly empty: furnish and decorate it completely, as a real designer would, while leaving the bare room itself unchanged.'],
  [/floor.?plan|plan/, 'The input is a 2D floor plan: turn it into a realistic, furnished interior render that follows the plan\'s walls, openings and room proportions exactly.'],
  [/paint/, 'Change ONLY the wall (and, if asked, ceiling) colours. Furniture, floor, decor and every object stay exactly as they are.'],
  [/garden/, 'This is an outdoor garden / terrace: redesign planting, paving, lighting and outdoor furniture. Keep the house, boundaries, slope and fixed structures as they are.'],
  [/exterior|facade/, 'This is a building exterior: restyle the facade finishes, colours, doors, shutters, lighting and landscaping. Keep the building\'s volume, openings and roof exactly as they are.'],
  [/staging/, 'Virtual home staging for a property listing: neutral, appealing, uncluttered furniture and decor that shows the space at its best.'],
];
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
function colorBlock(colors, surprise) {
  if (colors.length) {
    return [
      `COLOUR PALETTE (apply with exact fidelity, do not shift the hues): ${colors.map((hex, i) => `${hex} (${colorName(hex)}) as ${ROLES[i]}`).join('; ')}.`,
      'Use these exact hex colours on the surfaces they belong to; neutral materials (wood, metal, glass, plants) may stay natural. Do not introduce other strong colours.',
    ].join(' ');
  }
  return surprise ? 'COLOUR PALETTE: choose a harmonious, tasteful palette of 3 to 4 colours that suits the style.' : '';
}

/**
 * input: { photo: boolean, hasReference: boolean, toolId, roomTitle, styleId, styleTitle, mode, colors, surprise, prompt, extraImages }
 * `roomTitle` / `styleTitle` are English labels when known (the seeded ids carry them) or the admin's own title.
 */
function buildPrompt(input) {
  const room = clean(input.roomTitle, 60) || 'room';
  const style = clean(input.styleTitle, 60);
  const styleLine = STYLE_NOTES[input.styleId] || (style ? `${style} style` : '');
  const colors = normalizeColors(input.colors);
  const user = clean(input.prompt, 500);
  const intent = TOOL_INTENT.find(([pattern]) => pattern.test(String(input.toolId || '').toLowerCase()))?.[1];
  const parts = [];
  if (input.photo) {
    parts.push(`Redesign the interior of the provided photo (a ${room}) into a photorealistic, professionally photographed result.`);
    parts.push('STRUCTURE (never change): keep exactly the same camera position, angle, lens, framing and perspective, the same room layout and architecture - wall positions, ceiling height, floor area, windows, doors, openings, stairs, beams and built-in fixtures - and the same proportions. Do not add, remove, move or resize any structural element or window. Keep the direction and brightness of the natural light.');
    if (input.mode === 'renovation') parts.push('MODE renovation: you may replace the furniture, flooring, wall finishes, lighting and decor with a new layout. Place every piece at believable real-world scale, grounded on the floor, with realistic clearances, never blocking doors, windows or circulation, and in logical positions for a ' + room + ' (e.g. sofa facing the focal wall, bed against the solid wall).');
    else parts.push('MODE restyle: keep the existing furniture where it is, with the same placement, size and shape. Change only its finishes, upholstery, materials, colours, textiles and the decor, so it looks like the same room, restyled.');
  } else {
    parts.push(`Create a photorealistic interior design photograph of a ${room}${styleLine ? '' : ''}.`);
    parts.push('COMPOSITION: wide-angle eye-level architectural photograph with straight vertical lines, a coherent room with believable proportions, furniture at real-world scale placed logically (nothing floating, nothing blocking doors or windows), natural light through the windows.');
  }
  if (intent) parts.push(intent);
  if (styleLine) parts.push(`STYLE: ${styleLine}.`);
  if (input.hasReference) parts.push('The second image is a STYLE REFERENCE ONLY: borrow its materials, colour mood, textures and decor language. Do not copy its room, layout or architecture.');
  const palette = colorBlock(colors, input.surprise);
  if (palette) parts.push(palette);
  if (user) parts.push(`ADDITIONAL REQUEST FROM THE CLIENT (follow it whenever it does not break the structure rules): "${user}".`);
  parts.push('QUALITY: high-end interior photography, realistic materials with accurate textures, soft natural lighting with consistent shadows and reflections, sharp detail, balanced exposure. No text, no watermark, no people, no distortion, no extra windows or doors, no cartoon or illustration look.');
  return parts.join('\n\n');
}
const ROOM_EN = {
  rt_living: 'living room', rt_bedroom: 'bedroom', rt_kitchen: 'kitchen', rt_bathroom: 'bathroom', rt_dining: 'dining room', rt_stairs: 'staircase', rt_balcony: 'balcony',
  rt_nursery: 'child\'s bedroom', rt_garage: 'garage', rt_entry: 'entrance hall', rt_laundry: 'laundry room', rt_office: 'office', rt_homeoffice: 'home office', rt_study: 'study',
  rt_house: 'house exterior', rt_villa: 'villa exterior', rt_garden: 'garden', rt_terrace: 'terrace', rt_pool: 'pool area', rt_building: 'apartment building exterior',
};
module.exports = { ROOM_EN, buildPrompt, normalizeColors, colorName, clean, STYLE_NOTES };
