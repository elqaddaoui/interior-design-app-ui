#!/usr/bin/env node
/**
 * server/notice-texts.json = the sentences of the console notifications in fr / ar / dar, taken from src/superadmin/texts.ts.
 * The server writes the text of a Web Push notification (the phone shows it while the console is closed), so it needs the same
 * translations as the console. Run after editing one of these texts:  node scripts/sync-notice-texts.js   (--check only compares).
 */
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');

const KEYS = [
  'Neon database storage', 'Neon compute hours', 'Neon network transfer', 'R2 file storage', 'R2 write operations (Class A)', 'R2 read operations (Class B)',
  'The limit is reached. Back up all your data now.', 'Very close to the limit. Back up all your data now.', 'Time to back up your data.', 'Getting close to the limit. Plan a backup soon.',
  'At the current pace it runs out around {date} (in about {days} days).', 'Only {left} of transfer is left and a full backup needs about {need}. Back up now.',
  '{name} at {pct} %', '{name} at {pct} % (reminder)', '{name} cannot be read', 'The monitor could not read this service for more than 12 hours. Check the key or token in the server settings.',
  'Automatic backup made', 'Saved to {where}. Nothing else to do: you can restore it from Backup & restore.', 'your backup vault', 'Google Drive', 'Dropbox',
  'Automatic backup failed', '{why} It is tried again later. If this keeps happening, open Backup & restore and make a backup by hand.',
  'Burst of API calls', 'Daily API cap reached', 'Usage spike', 'Many failing API calls', 'Repeated attempts while AI is switched off', 'API warning',
  '{value} % of calls failed (alert level {limit} %)', '{value} calls in about {min} min (alert level {limit})', 'Its API was paused automatically. Resume it from the warning.',
  'Notifications are working', 'This is a test. Warnings about your free limits, backups and API use appear here and in your browser.',
];

function build() {
  const source = fs.readFileSync(path.join(root, 'src/superadmin/texts.ts'), 'utf8');
  const body = source.slice(source.indexOf('= {') + 2, source.lastIndexOf('};') + 1);
  const TEXTS = JSON.parse(body.replace(/^\s*("(?:[^"\\]|\\.)*"):\s*\[/gm, '$1: [').replace(/,(\s*})\s*$/, '$1'));
  const out = {};
  for (const key of KEYS) {
    if (!TEXTS[key]) throw new Error(`texts.ts has no row for: ${key}`);
    out[key] = TEXTS[key];
  }
  return `${JSON.stringify(out, null, 1)}\n`;
}
module.exports = { build, KEYS };
if (require.main === module) {
  const file = path.join(root, 'server/notice-texts.json');
  const next = build();
  if (process.argv.includes('--check')) { if (fs.readFileSync(file, 'utf8') !== next) { console.error('server/notice-texts.json is out of date: run node scripts/sync-notice-texts.js'); process.exit(1); } } else { fs.writeFileSync(file, next); console.log('server/notice-texts.json written'); }
}
