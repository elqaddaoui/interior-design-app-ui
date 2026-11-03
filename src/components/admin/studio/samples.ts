/**
 * Two generated sample scenes for the Animation Studio stage (inline SVG data URIs: no asset resolver, identical on web and native).
 * Strong, different colours and a fine grid make every edge, zoom and wobble of a transition easy to judge.
 */
const scene = (sky1: string, sky2: string, hill1: string, hill2: string, sun: string, label: string) => `data:image/svg+xml;utf8,${encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="440" viewBox="0 0 800 440"><defs>`
  + `<linearGradient id="s" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${sky1}"/><stop offset="1" stop-color="${sky2}"/></linearGradient>`
  + `<pattern id="p" width="40" height="40" patternUnits="userSpaceOnUse"><path d="M40 0H0V40" fill="none" stroke="#fff" stroke-opacity=".22"/></pattern></defs>`
  + `<rect width="800" height="440" fill="url(#s)"/><circle cx="600" cy="130" r="58" fill="${sun}" opacity=".95"/>`
  + `<path d="M0 330 L170 190 L320 300 L470 160 L640 310 L800 220 L800 440 L0 440Z" fill="${hill1}"/>`
  + `<path d="M0 390 Q200 300 400 370 T800 340 L800 440 L0 440Z" fill="${hill2}"/>`
  + `<rect width="800" height="440" fill="url(#p)"/>`
  + `<text x="40" y="84" font-family="Arial, sans-serif" font-size="60" font-weight="800" fill="#fff" fill-opacity=".9">${label}</text></svg>`)}`;

export const SAMPLE_A = scene('#fb7185', '#fde68a', '#7f1d1d', '#450a0a', '#fff7d6', 'A');
export const SAMPLE_B = scene('#0ea5e9', '#a7f3d0', '#0f3d5e', '#052e3b', '#ffffff', 'B');
export const SAMPLES: [string, string] = [SAMPLE_A, SAMPLE_B];
