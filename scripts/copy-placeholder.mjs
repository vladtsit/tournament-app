#!/usr/bin/env node
// Post-build: copy scripts/placeholder.html → app/dist/index.html so the
// SWA root serves a placeholder while the SPA lives under /tournamentes/.
import { copyFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..');
const src = resolve(repoRoot, 'scripts/placeholder.html');
const dest = resolve(repoRoot, 'app/dist/index.html');

await mkdir(dirname(dest), { recursive: true });
await copyFile(src, dest);
console.log(`✓ placeholder → ${dest}`);
