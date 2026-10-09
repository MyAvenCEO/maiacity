/*
 * The avenDB tile's smoke test: opens /app/avendb/ in a headless Chrome as an admin (the API's /api/me is answered
 * here), waits for the world to be made in the page's workers, then walks every screen as its people would. Samuel's
 * Mac reads Welcome, edits it and branches it, and shows who may do what; a locked Mac is refused with the rule's
 * reason; a stranger sees only the public Charter; Bob's Mac finds the door todo shared with it; Samuel's passkey signs a
 * backup passkey in; the Lab shows every device, Bob's Mac with Samuel's edit synced at once, and plays a scenario; This
 * browser loads its own device. Each screen is screenshot.
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
await page.setViewport({ width: 1440, height: 1000 });
page.on('pageerror', (e) => check(`no error on the page: ${e.message}`, false));
// /api/me answers as an admin. Only that request is held: Puppeteer's own interception holds every request, and the
// workers' module and WebAssembly fetches never come back from it.
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
/** Click the first `selector` whose words include `t`. */
async function click(t, selector = 'button') {
	const ok = await page.evaluate(
		(t, selector) => {
			const el = [...document.querySelectorAll(selector)].find((e) => e.textContent?.replace(/\s+/g, ' ').includes(t));
			if (el instanceof HTMLElement) el.click();
			return !!el;
		},
		t,
		selector
	);
	if (!ok) check(`there is a “${t}” to click`, false);
	await sleep(250);
	return ok;
}
async function shot(name) {
	await sleep(400);
	await page.screenshot({ path: `${out}/${name}.png` });
}
/** Type into the first `selector` whose value includes `had` (or the first one at all), replacing it. */
async function type(selector, value, had = '') {
	const handles = await page.$$(selector);
	for (const h of handles) {
		const v = await h.evaluate((e) => /** @type {HTMLInputElement} */ (e).value);
		if (v.includes(had)) {
			await h.click({ clickCount: 3 });
			await h.evaluate((e) => (/** @type {HTMLInputElement} */ (e).value = ''));
			await h.type(value);
			return true;
		}
	}
	check(`there is a ${selector} to type in`, false);
	return false;
}

try {
	const t = Date.now();
	await page.goto(`${base}/app/avendb/`, { waitUntil: 'domcontentloaded' });
	await shot('0-making');
	const made = await page.waitForSelector('.rail .device', { timeout: 180000 }).then(() => true, () => false);
	check(`the world is made in the page (${((Date.now() - t) / 1000).toFixed(1)} s)`, made);
	if (!made) throw new Error('no world');
	const devices = await page.$$eval('.rail .device span', (s) => s.map((x) => x.textContent));
	check('every device is listed', ["Samuel's Mac", "Samuel's iPhone", "Bob's Mac", "Carol's Mac", 'a stranger'].every((d) => devices.includes(d)), devices.join(', '));

	// Samuel's Mac: the spaces, and Welcome in the Handbook
	check('Spaces lists the Handbook, the Notes and the Todos', (await waitText('Handbook')) && (await waitText("Samuel's Notes")) && (await waitText("Samuel's Todos")));
	await shot('1-spaces');
	await click('Welcome', '.space li button');
	check('Welcome reads on Samuel’s Mac', await waitText('the greenhouse opens at eight'));
	await shot('2-read');
	await click('Edit');
	await type('.editor textarea', 'Welcome to Maia Coop: the greenhouse opens at seven.', 'opens at eight');
	await click('Save');
	check('the edit is saved, encrypted, as Samuel’s Mac', (await waitText("Done on Samuel's Mac")) && (await waitText('opens at seven')));
	check('and synced at once to the devices online', await waitText('Synced at once'));
	await click('JSON', '.tabs button');
	check('JSON shows the raw value and the schemas', await waitText('Written under'));
	await shot('3-json');
	await click('History', '.tabs button');
	check('History lists the edit', await waitText('Revert the latest commit'));
	await shot('4-history');
	await click('Branches', '.tabs button');
	await type('input[placeholder="The branch\'s name"]', 'spring plan');
	await click('Start it');
	check('a branch starts and opens', await waitText('On the branch spring plan'));
	await click('Branches', '.tabs button');
	await shot('5-branches');
	await click('Access', '.tabs button');
	check('Access says who may do what and why', (await waitText('Who may do what')) && (await waitText('founded the space')));
	await shot('6-access');

	// a locked Mac is refused with the rule's reason
	await click('Lab', '.rail .screen');
	await waitText("Every device's copy of");
	await page.evaluate(() => {
		const col = [...document.querySelectorAll('.column')].find((c) => c.querySelector('header b')?.textContent === "Samuel's Mac");
		const lock = [...(col?.querySelectorAll('button') ?? [])].find((b) => b.textContent === 'Lock');
		if (lock instanceof HTMLElement) lock.click();
	});
	await sleep(500);
	await click('Spaces', '.rail .screen');
	await type('input[placeholder="A new entry\'s title"]', 'Written while locked');
	await click('Write', '.space footer button');
	check('a locked device is refused, with the reason', await waitText('Refused on Samuel\'s Mac: The device is locked'));
	await shot('7-refused');
	await click('Lab', '.rail .screen');
	await waitText("Every device's copy of");
	await page.evaluate(() => {
		const col = [...document.querySelectorAll('.column')].find((c) => c.querySelector('header b')?.textContent === "Samuel's Mac");
		const unlock = [...(col?.querySelectorAll('button') ?? [])].find((b) => b.textContent === 'Unlock');
		if (unlock instanceof HTMLElement) unlock.click();
	});
	await sleep(500);

	// a stranger: only what is public
	await click('a stranger', '.rail .device');
	await click('Spaces', '.rail .screen');
	check('a stranger sees the public Charter', await waitText('Charter'));
	check('and nothing of Samuel’s Notes', !(await text()).includes("Samuel's Notes"));
	await shot('8-stranger');

	// Bob's Mac: the door todo, shared with it
	await click("Bob's Mac", '.rail .device');
	await click('Todos', '.rail .screen');
	check('Bob’s Mac finds the door todo shared with it', (await waitText('Shared with me')) && (await waitText('Fix the greenhouse door')));
	await shot('9-todos');

	// Samuel's Mac: the vaults, and a backup passkey signed in with the passkey
	await click("Samuel's Mac", '.rail .device');
	await click('Vaults', '.rail .screen');
	check('Vaults shows the people and the coop', (await waitText('Maia Coop')) && (await waitText('Samuel')));
	await shot('10-vaults');
	await click('Add a backup passkey');
	check('the change waits for the passkey to sign', await waitText('yet to sign'));
	await shot('11-approve');
	await click('Sign with this passkey');
	await click('Send', '.sheet button');
	check('the backup passkey joins Samuel’s vault', await waitText("Samuel's backup passkey"));

	await click('Schemas', '.rail .screen');
	check('Schemas shows the lane and its lenses', (await waitText('Versions in the lane')) && (await waitText('Markdown document, v1 to v2')));
	await shot('12-schemas');

	await click('Lab', '.rail .screen');
	check('the Lab shows every device', await waitText("Every device's copy of"));
	// nobody synced by hand: Samuel's edit reached Bob's Mac the moment it was saved
	const bobs = await page.waitForFunction(() => {
		const col = [...document.querySelectorAll('.column')].find((c) => c.querySelector('header b')?.textContent === "Bob's Mac");
		return col?.textContent?.includes('opens at seven');
	}, { timeout: 30000 }).then(() => true, () => false);
	check('Bob’s Mac has Samuel’s edit, synced at once', bobs);
	await shot('13-lab');
	await page.evaluate(() => {
		const first = document.querySelector('.scenarios > li .btn');
		if (first instanceof HTMLElement) first.click();
	});
	check('the first scenario plays green', await waitText('Run again', 120000));
	const green = await page.$eval('.scenarios > li', (li) => li.classList.contains('ok'));
	check('every check of it green', green);
	await shot('14-scenario');

	// This browser: its own device, apart from the Lab, which links to a person's devices or founds their vault
	await click('This browser', '.rail .screen');
	check('This browser offers to link it or to make a passkey', (await waitText('Link through your other device', 60000)) && (await waitText('Make my passkey')));
	check('its device loads', !(await text()).includes("can't be a device"), (await text()).match(/can't be a device[^.]*/)?.[0]);
	await shot('15-browser');
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
