#!/usr/bin/env node
/** Copies src/lib/reservedSlugs.js RESERVED into public/push-sw.js (the worker cannot require() it). Run after editing the list. */
const fs = require('node:fs');
const path = require('node:path');
const { RESERVED } = require('../src/lib/reservedSlugs');
const file = path.join(__dirname, '..', 'public', 'push-sw.js');
const code = fs.readFileSync(file, 'utf8');
const next = code.replace(/const RESERVED = \[.*?\];/s, `const RESERVED = ${JSON.stringify([...RESERVED])};`);
fs.writeFileSync(file, next);
console.log(next === code ? 'push-sw.js already up to date' : 'push-sw.js updated');
