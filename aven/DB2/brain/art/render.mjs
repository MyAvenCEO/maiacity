// Renders the objects (objects.mjs, the slides'; tiles.mjs, the dashboard's) to transparent PNGs, each named by the
// BLAKE3 hash of its bytes, as the network names its files: `bun brain/art/render.mjs` (needs Playwright's Chromium).
// Writes art/img/<hash>.png and art/images.json, the name of each object and its hash. A slide places one as
// `<img src="/files/<hash>">`, a tile by its name.
import { mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { blake3 } from '@noble/hashes/blake3.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import { objects } from './objects.mjs';
import { tiles } from './tiles.mjs';

const { chromium } = createRequire(import.meta.url)('playwright');
const dir = new URL('img/', import.meta.url);
mkdirSync(dir, { recursive: true });
// AVEN_CHROMIUM names a Chromium when Playwright's own is not installed
const browser = await chromium.launch(process.env.AVEN_CHROMIUM ? { executablePath: process.env.AVEN_CHROMIUM } : {});
const page = await browser.newPage({ viewport: { width: 220, height: 220 }, deviceScaleFactor: 2 });
const images = {};
for (const [name, draw] of Object.entries({ ...objects, ...tiles })) {
	await page.setContent(`<!doctype html><style>html,body{margin:0;background:transparent}svg{display:block}</style>${draw()}`);
	const png = await page.screenshot({ omitBackground: true, clip: { x: 0, y: 0, width: 220, height: 220 } });
	const hash = bytesToHex(blake3(png));
	writeFileSync(new URL(`${hash}.png`, dir), png);
	images[name] = hash;
}
await browser.close();
// an image no object names any more goes
for (const file of readdirSync(dir)) if (!Object.values(images).includes(file.replace(/\.png$/, ''))) rmSync(new URL(file, dir));
writeFileSync(new URL('images.json', import.meta.url), `${JSON.stringify(images, null, '\t')}\n`);
console.log(`${Object.keys(images).length} objects drawn`);
