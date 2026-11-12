/**
 * Writes server/theme-presets.json: the colours of the 20 store theme presets, so the console can draw a theme preview without importing
 * app code (`npm run gen:themes`). scripts/check-themes.ts fails when the file is out of date.
 */
import { PRESETS } from '../src/theme/presets';

declare const require: (id: string) => any;
declare const __dirname: string;
const { writeFileSync } = require('node:fs');
const { join } = require('node:path');

const out = Object.fromEntries(PRESETS.map(p => [p.id, { ...p.tokens }]));
writeFileSync(join(__dirname, '..', 'server', 'theme-presets.json'), `${JSON.stringify(out, null, 1)}\n`);
console.log('theme presets written:', PRESETS.length);
