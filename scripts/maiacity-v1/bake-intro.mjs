// Bake MaiaCity V1's intro times: open each seat's film page (/games/maiacity-v1/?film&area=A|B), let the world time
// every step of the intro afresh (&remeasure), and write what it measured to src/lib/maiacity-v1/intro/<seat>.json:
// each step's segments, where its shots cut, when its lines are told, its hours. The film page and the game
// (./intro.js `reelFor`) read them; a step whose words or moment changed since is
// timed again by the page itself until this is run again.
//
//   VITE_RECIPE_FEED=dev npx vite dev --port 5197      (in another shell)
//   bun scripts/maiacity-v1/bake-intro.mjs [--base http://localhost:5197] [A] [B]
//
// The browser: $CHROME, else Playwright's Chromium (/opt/pw-browsers/chromium), drawing with SwiftShader.
import puppeteer from 'puppeteer-core';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

const args = process.argv.slice(2);
const at = args.indexOf('--base');
const base = at >= 0 ? args[at + 1] : 'http://localhost:5197';
const seats = args.filter((a, i) => (a === 'A' || a === 'B') && args[i - 1] !== '--base');
const OUT = join(import.meta.dir, '../../src/lib/maiacity-v1/intro');

const browser = await puppeteer.launch({
	executablePath: process.env.CHROME ?? '/opt/pw-browsers/chromium',
	headless: true,
	protocolTimeout: 0,
	args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--window-size=640,360', '--no-sandbox']
});
try {
	for (const seat of seats.length ? seats : ['A', 'B']) {
		const page = await browser.newPage();
		await page.setViewport({ width: 640, height: 360 });
		page.on('console', (m) => m.type() === 'error' && console.error(`[${seat}] ${m.text()}`));
		const t0 = Date.now();
		await page.goto(`${base}/games/maiacity-v1/?film&area=${seat}&remeasure`, { waitUntil: 'domcontentloaded' });
		await page.waitForFunction(() => !!window.__world?.intro, { timeout: 0, polling: 500 });
		const schedule = await page.evaluate(() => window.__world.intro.schedule());
		writeFileSync(join(OUT, `${seat}.json`), `${JSON.stringify(schedule, null, '\t')}\n`);
		console.log(`${seat}: ${schedule.steps.length} steps, ${schedule.seconds.toFixed(1)} s, ${schedule.steps.reduce((a, s) => a + s.shots.length, 0)} shots (${((Date.now() - t0) / 1000).toFixed(0)} s to time)`);
		await page.close();
	}
} finally {
	await browser.close();
}
