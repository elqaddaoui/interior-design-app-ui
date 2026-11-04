/**
 * The prompt is a list of BLOCKS. Every block has default wording (below), can be switched off, moved, or re-worded by the admin
 * (Admin > Prompt cards). The defaults are exactly the sentences the app always sent, so an untouched configuration produces a
 * byte-identical prompt (covered by scripts/check-prompt-rules-server.js).
 *
 * A block text may contain {placeholders}; they are replaced with the real values of the generation (see PLACEHOLDERS).
 */
const DEFAULT_ORDER = ['task', 'structure', 'brief', 'mode', 'composition', 'intent', 'style', 'reference', 'styleImage', 'roomImage', 'palette', 'quality', 'rules', 'finalCheck'];

const STRUCTURE = 'STRUCTURE (never change): keep exactly the same camera position, angle, lens, framing and perspective, the same layout and architecture - wall positions, ceiling height, floor area, windows, doors, openings, stairs, beams and built-in fixtures - and the same proportions. Do not add, remove, move or resize any structural element or window. Keep the direction and brightness of the natural light.';
const COMPOSITION = 'COMPOSITION: wide-angle eye-level architectural photograph with straight vertical lines, a coherent space with believable proportions, furniture at real-world scale placed logically (nothing floating, nothing blocking doors or windows), natural light.';
const QUALITY = 'QUALITY: high-end interior photography, realistic materials with accurate textures, soft natural lighting with consistent shadows and reflections, sharp detail, balanced exposure. No text, no watermark, no people, no distortion, no extra windows or doors, no cartoon or illustration look.';

/** id -> { variants: { key: default text } }. The variant is chosen by the situation (photo or text, restyle or renovation, ...). */
const BLOCKS = {
  task: { variants: {
    photo: 'Redesign the {group} of the provided photo (a {room}) into a photorealistic, professionally photographed result.',
    text: 'Create a photorealistic {group} design photograph of a {room}.',
  } },
  structure: { variants: { default: STRUCTURE } },
  brief: { variants: {
    photo: 'CLIENT BRIEF (the client\'s own request: apply every detail of it, it only yields to the STRUCTURE rules): {brief}.',
    text: 'DESCRIPTION FROM THE CLIENT (this is the main brief: follow every detail of it): {brief}.',
  } },
  mode: { variants: {
    restyle: 'MODE restyle: keep the existing furniture where it is, with the same placement, size and shape. Change only its finishes, upholstery, materials, colours, textiles and the decor, so it looks like the same room, restyled.',
    renovation: 'MODE renovation: you may replace the furniture, flooring, wall finishes, lighting and decor with a new layout. Place every piece at believable real-world scale, grounded on the floor, with realistic clearances, never blocking doors, windows or circulation, and in logical positions for a {room} (e.g. sofa facing the focal wall, bed against the solid wall).',
  } },
  composition: { variants: { default: COMPOSITION } },
  // The default of `intent` is automatic: the task sentence that matches the kind of tool (see INTENTS in prompt.js). An empty default = automatic.
  intent: { variants: { default: '' } },
  style: { variants: { default: 'STYLE: {styleNotes}.' } },
  reference: { variants: { default: 'The {nth} image is a STYLE REFERENCE ONLY: borrow its materials, colour mood, textures and decor language. Do not copy its room, layout or architecture.' } },
  styleImage: { variants: {
    image: 'The {nth} image shows the STYLE the client chose: borrow its materials, colour mood, textures and decor language. Do not copy its room, layout or architecture; the first image remains the room to redesign.',
    both: 'The {nth} image shows the "{style}" style the client chose: borrow its materials, colour mood, textures and decor language. Do not copy its room, layout or architecture; the first image remains the room to redesign.',
  } },
  roomImage: { variants: {
    image: 'The {nth} image shows the TYPE OF ROOM the client chose: use it only as a hint of the room\'s function and typical furniture. Do not copy its layout or architecture; the first image remains the room to redesign.',
    both: 'The {nth} image shows an example of the chosen room type ("{room}"): use it only as a hint of the room\'s function and typical furniture. Do not copy its layout or architecture; the first image remains the room to redesign.',
  } },
  palette: { variants: {
    colors: 'COLOUR PALETTE{paletteLabel} (apply with exact fidelity, do not shift the hues): {colors}. Use these exact hex colours on the surfaces they belong to; neutral materials (wood, metal, glass, plants) may stay natural. Do not introduce other strong colours.',
    surprise: 'COLOUR PALETTE: choose a harmonious, tasteful palette of 3 to 4 colours that suits the style.',
  } },
  quality: { variants: { default: QUALITY } },
  // The wording around the admin's rules. The rules themselves are written in the Rules tab; if {rules} is missing here they are appended.
  rules: { variants: { default: 'DESIGN RULES (mandatory, follow every rule):\n{rules}' } },
  finalCheck: { variants: { default: 'FINAL CHECK: the picture must show {mustList}.' } },
};

/** What a {placeholder} means (shown to the admin next to the text fields). */
const PLACEHOLDERS = ['room', 'group', 'style', 'styleNotes', 'mode', 'tool', 'brief', 'briefOriginal', 'briefEnglish', 'colors', 'colorsHex', 'palette', 'paletteLabel', 'nth', 'rules', 'mustList'];

const IMAGE_ROLES = ['inspiration', 'style', 'room'];

module.exports = { DEFAULT_ORDER, BLOCKS, PLACEHOLDERS, IMAGE_ROLES };
