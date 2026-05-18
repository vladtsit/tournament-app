#!/usr/bin/env node
// Post-build: copy scripts/placeholder.html → app/dist/index.html so the
// SWA root serves a placeholder while the SPA lives under /tournamentes/.
// Also copies staticwebapp.config.json into app/dist so SWA picks it up.
import { copyFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..');

const placeholderSrc = resolve(repoRoot, 'scripts/placeholder.html');
const placeholderDest = resolve(repoRoot, 'app/dist/index.html');

const swaConfigSrc = resolve(repoRoot, 'staticwebapp.config.json');
const swaConfigDest = resolve(repoRoot, 'app/dist/staticwebapp.config.json');

await mkdir(dirname(placeholderDest), { recursive: true });
await copyFile(placeholderSrc, placeholderDest);
console.log(`✓ placeholder → ${placeholderDest}`);

await copyFile(swaConfigSrc, swaConfigDest);
console.log(`✓ staticwebapp.config.json → ${swaConfigDest}`);
