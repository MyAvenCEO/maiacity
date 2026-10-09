/*
 * avenDB's page's smoke test, with no avenDB server: opens /app/avendb/ in a headless Chrome as an admin (the API's
 * /api/me is answered here). It opens on the person's account, named after them, which loads its own device and offers
 * to found their vault with the maiaCITY passkey, to make a new one, or to sign in, with avendb.maia.city filled in as
 * its server; there is no simulated Lab; and on a phone nothing is wider than the screen. Each screen is screenshot.
 * scripts/avendb-account.mjs walks the account itself against a server: founding, the vaults it owns, acting as each.
 *
 *   node scripts/avendb-smoke.mjs [--out dir]                    starts its own dev server
 *   BASE=http://localhost:5173 node scripts/avendb-smoke.mjs     uses a running one
 *   CHROME=/path/to/chrome node scripts/avendb-smoke.mjs         else /opt/pw-browsers/chromium, or Chrome on a Mac
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import puppeteer from 'puppeteer-core';

const arg = (name, fallback) => {
	const at = process.argv.indexOf(name);
	return at > 0 ? process.argv[at + 1] : fallback;
};
const out = resolve(arg('--out', 'build/avendb-smoke'));
mkdirSync(out, { recursive: true });
const chrome =
	process.env.CHROME ??
	['/opt/pw-browsers/chromium', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].find((p) => existsSync(p));
if (!chrome) throw new Error('No Chrome found: set CHROME to one.');

// the dev server: the one given, or one of our own
let base = process.env.BASE;
let server = null;
if (!base) {
	const port = 5297;
	base = `http://localhost:${port}`;
	server = spawn('npx', ['vite', 'dev', '--port', String(port), '--strictPort'], { stdio: 'ignore', detached: true });
	for (let i = 0; i < 60 && !(await fetch(base).then((r) => r.ok, () => false)); i++) await sleep(1000);
}
const origin = new URL(base).origin;

const checks = [];
const check = (what, ok, found = '') => {
	checks.push({ what, ok: !!ok, found });
	console.log(`${ok ? '✓' : '✕'} ${what}${ok || !found ? '' : ` (found: ${found})`}`);
};

const browser = await puppeteer.launch({ executablePath: chrome, headless: true, args: ['--no-sandbox'] });
const page = await browser.newPage();
await page.setViewport({ width: 1300, height: 1000 });
page.on('pageerror', (e) => check(`no error on the page: ${e.message}`, false));
// /api/me answers as an admin. Only that request is held: Puppeteer's own interception holds every request, and the
// device's module and WebAssembly fetches never come back from it.
const cdp = await page.createCDPSession();
await cdp.send('Fetch.enable', { patterns: [{ urlPattern: '*/api/me' }] });
cdp.on('Fetch.requestPaused', (r) => {
	const founder = { id: 'smoke', number: 1, name: 'Samuel', since: '2026-01-01', role: 'founder', caps: ['media:admin'] };
	const headers = { 'access-control-allow-origin': origin, 'access-control-allow-credentials': 'true', 'content-type': 'application/json' };
	cdp.send('Fetch.fulfillRequest', {
		requestId: r.requestId,
		responseCode: 200,
		responseHeaders: Object.entries(headers).map(([name, value]) => ({ name, value })),
		body: Buffer.from(JSON.stringify(founder)).toString('base64')
	});
});

/** the page's text, as written (not as styled) */
const text = () => page.evaluate(() => document.body.textContent ?? '');
async function waitText(t, ms = 30000) {
	const until = Date.now() + ms;
	while (Date.now() < until) {
		if ((await text()).includes(t)) return true;
		await sleep(150);
	}
	return false;
}
async function shot(name) {
	await sleep(400);
	await page.screenshot({ path: `${out}/${name}.png` });
}

try {
	await page.goto(`${base}/app/avendb/`, { waitUntil: 'domcontentloaded' });
	const offers = (await waitText('Use my maiaCITY passkey', 60000)) && (await waitText('Sign in with my passkey'));
	check('it opens on the account, offering to found a vault with the maiaCITY passkey, or to sign in', offers && (await waitText('Make a new passkey')));
	const lead = await page.$eval('.account .lead h1', (e) => e.textContent?.trim()).catch(() => '');
	check('named after the person', lead === 'Samuel', lead);
	check('its device loads', !(await text()).includes("can't be a device"), (await text()).match(/can't be a device[^.]*/)?.[0]);
	const name = await page.$eval('.account .name input', (e) => /** @type {HTMLInputElement} */ (e).value).catch(() => '');
	check('this browser has a name of its own', /on Linux|on Mac|Chrome/.test(name), name);
	const relay = await page
		.$eval('.account input[placeholder^="Its relay"]', (e) => /** @type {HTMLInputElement} */ (e).value)
		.catch(() => '');
	check('avenDB’s server filled in', relay === 'https://avendb.maia.city', relay);
	check('no simulated Lab', !(await page.$('.rail')) && !(await text()).includes('Open the Lab'));
	await shot('1-account');

	await page.setViewport({ width: 390, height: 844 });
	await sleep(300);
	const fits = await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);
	check('on a phone, nothing wider than the screen', fits);
	await shot('2-phone');
} catch (e) {
	check(`the walk through finishes: ${e instanceof Error ? e.message : e}`, false);
} finally {
	await browser.close();
	if (server?.pid) process.kill(-server.pid);
}

const failed = checks.filter((c) => !c.ok);
console.log(`\n${checks.length - failed.length} of ${checks.length} checks green; screenshots in ${out}`);
process.exit(failed.length ? 1 : 0);

function sleep(ms) {
	return new Promise((r) => setTimeout(r, ms));
}
