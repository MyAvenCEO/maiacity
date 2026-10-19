/*
 * Both probes in a real browser (hardening H8, gap G9): every way out of the asset box and of a view, tried from inside
 * each by code made to do harm, in headless Chromium, against the site as it is in this checkout. CI runs it on every
 * pull request and before every deploy (.github/workflows/kernel.yml); a failure stops the deploy.
 *
 * - The box: its lab (/app/assets/box/) runs every check, the box's probe among them (src/lib/assets/box/probe.js, a
 *   recipe that tries every way out, one that crashes its worker and one that never stops, each ended alone). Every
 *   check must pass.
 * - The views: /app/views/probe/ shows views made to do harm in the real view host (src/lib/sandbox/view/probe.js).
 *   Every attempt aims at a canary this script listens on: anything that arrives there got out, whatever the view was
 *   told. While the views run, this script clicks every link and button the hostile view drew and presses Enter in its
 *   field; after, it reads the frame's DOM for anything the engine should have cleaned (a script, a handler, an address
 *   that leads out), and checks the page is where it was and opened no window. Every check must pass.
 *
 * The site is the dev server's, with the repo's own recipes standing in for the Maia City vault's feed
 * (VITE_RECIPE_FEED=dev), so nothing here needs avenDB's server; the app's sign-in is answered here (/api/me).
 *
 *   node scripts/probes.mjs                                            starts its own dev server
 *   BASE=http://localhost:5173 node scripts/probes.mjs                 a running one (VITE_RECIPE_FEED=dev bun run dev)
 *   CHROME=/path/to/chrome node scripts/probes.mjs                     else Playwright's Chromium, or Chrome on a Mac
 *   node scripts/probes.mjs --only view|box
 */
import { spawn } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { createServer } from 'node:http';
import { join } from 'node:path';
import puppeteer from 'puppeteer-core';
import { CLICKS, HTML_TRIES } from '../src/lib/sandbox/view/probe.js';

const only = process.argv.includes('--only') ? process.argv[process.argv.indexOf('--only') + 1] : null;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Playwright's Chromium: where PLAYWRIGHT_BROWSERS_PATH (or its own cache) keeps it */
function playwrightChromium() {
	const roots = [process.env.PLAYWRIGHT_BROWSERS_PATH, '/opt/pw-browsers', join(process.env.HOME ?? '', '.cache/ms-playwright')].filter(Boolean);
	for (const root of roots) {
		if (!existsSync(root)) continue;
		for (const d of readdirSync(root).filter((d) => /^chromium-\d+$/.test(d)).sort((a, b) => Number(b.slice(9)) - Number(a.slice(9)))) {
			const bin = join(root, d, 'chrome-linux/chrome');
			if (existsSync(bin)) return bin;
		}
	}
	return null;
}
const chrome = process.env.CHROME ?? playwrightChromium() ?? ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].find((p) => existsSync(p));
if (!chrome) throw new Error('No Chromium found: install Playwright’s (npx playwright install chromium) or set CHROME.');

const checks = [];
const check = (what, ok, found = '') => {
	checks.push({ what, ok: !!ok, found });
	console.log(`${ok ? '✓' : '✕'} ${what}${found ? ` (${found})` : ''}`);
};

// ---- the canary: every request and every connection that reaches it, by path ----
const hits = [];
let connections = 0;
const canary = createServer((req, res) => {
	// (the browser's own ask for an icon, after the control below opens the canary as a page)
	if (req.url !== '/favicon.ico') hits.push(`${req.method} ${req.url}`);
	res.writeHead(200, { 'content-type': 'text/plain', 'access-control-allow-origin': '*' });
	res.end('the canary heard you');
});
canary.on('connection', () => connections++);
canary.on('upgrade', (req, socket) => {
	hits.push(`UPGRADE ${req.url}`);
	socket.destroy();
});
await new Promise((ok) => canary.listen(0, '127.0.0.1', ok));
const CANARY = `http://127.0.0.1:${canary.address().port}`;

// ---- the site ----
let base = process.env.BASE;
let server = null;
if (!base) {
	const port = 5298;
	base = `http://localhost:${port}`;
	server = spawn('npx', ['vite', 'dev', '--port', String(port), '--strictPort'], { stdio: 'ignore', detached: true, env: { ...process.env, VITE_RECIPE_FEED: 'dev' } });
	for (let i = 0; i < 120 && !(await fetch(base).then((r) => r.ok, () => false)); i++) await sleep(1000);
}
const origin = new URL(base).origin;

const browser = await puppeteer.launch({ executablePath: chrome, headless: true, args: ['--no-sandbox'] });

/** a tab signed in to the app as an admin, with avenDB left for later (as scripts/avendb-smoke.mjs answers it) */
async function signedIn() {
	const page = await browser.newPage();
	await page.setViewport({ width: 1280, height: 1000 });
	await page.evaluateOnNewDocument(() => {
		try {
			sessionStorage.setItem('avendb:later', '1');
		} catch {}
	});
	const cdp = await page.createCDPSession();
	await cdp.send('Fetch.enable', { patterns: [{ urlPattern: '*/api/me' }] });
	cdp.on('Fetch.requestPaused', (r) => {
		const founder = { id: 'probe', number: 1, name: 'Probe', since: '2026-01-01', role: 'founder', caps: [] };
		const headers = { 'access-control-allow-origin': origin, 'access-control-allow-credentials': 'true', 'content-type': 'application/json' };
		cdp.send('Fetch.fulfillRequest', { requestId: r.requestId, responseCode: 200, responseHeaders: Object.entries(headers).map(([name, value]) => ({ name, value })), body: Buffer.from(JSON.stringify(founder)).toString('base64') }).catch(() => {});
	});
	return page;
}

/** the results a lab writes into #results once it is through */
const resultsOf = (page, ms) => page.waitForSelector('#results', { timeout: ms }).then(() => page.$eval('#results', (e) => JSON.parse(e.textContent ?? 'null')));

/**
 * The dev server's stand-in for the recipe feed bundles every recipe the first time it is asked, longer than the box's
 * lab waits for the feed on a busy machine: asked for here (while the views run), and kept.
 */
async function feed() {
	const t = Date.now();
	const fed = await fetch(`${base}/__recipe-feed/code`, { signal: AbortSignal.timeout(300000) }).then((r) => r.ok, () => false);
	console.log(fed ? `the dev server's recipe feed answered in ${((Date.now() - t) / 1000).toFixed(0)} s` : 'no recipe feed of the dev server’s (started without VITE_RECIPE_FEED=dev?)');
}

/**
 * The dev server compiles a page and what it imports the first time it is asked for, and reloads a page whose imports
 * bring a dependency it had not bundled yet: each page is asked for once before its run, so none reloads during one.
 */
async function warm(path) {
	const page = await signedIn();
	// a dependency it bundles only once the page has run reloads the page a little later: asked again until it stays put
	for (let i = 0; i < 4; i++) {
		let reloaded = false;
		const moved = (f) => f === page.mainFrame() && (reloaded = true);
		await page.goto(`${base}${path}`, { waitUntil: 'networkidle2', timeout: 120000 }).catch(() => {});
		page.on('framenavigated', moved);
		await sleep(4000);
		page.off('framenavigated', moved);
		if (!reloaded) break;
	}
	await page.close();
}

/** a frame's element, or null: a frame the page dropped (a reload) answers nothing rather than throwing */
async function find(frame, sel) {
	try {
		return await frame.$(sel);
	} catch {
		return null;
	}
}

async function viewProbe() {
	// the browser reaches the canary: so nothing arriving means nothing got out, not that nothing could (opened as a page
	// of its own, not fetched from one of the site's, which would teach the browser to connect to it from the site)
	const control = await browser.newPage();
	await control.goto(`${CANARY}/control`).catch(() => {});
	await sleep(500);
	await control.close();
	check('the browser reaches the canary', hits.includes('GET /control'), hits.join(', '));
	hits.length = 0;
	connections = 0;

	const page = await signedIn();
	const pages = (await browser.pages()).length;
	let popups = 0;
	browser.on('targetcreated', (t) => t.type() === 'page' && popups++);
	const url = `${base}/app/views/probe/?canary=${encodeURIComponent(`${CANARY}/v`)}`;
	await page.goto(url, { waitUntil: 'domcontentloaded' });

	// the hostile view, once drawn: everything it shows that a person could click, clicked; Enter in its field
	const deadline = Date.now() + 60000;
	let frame = null;
	while (!frame && Date.now() < deadline) {
		for (const f of page.frames()) if (await find(f, '#probe-mark')) frame = f;
		if (!frame) await sleep(200);
	}
	check('the hostile view is drawn in its frame', !!frame);
	const clicked = [];
	for (const sel of frame ? CLICKS : []) {
		const el = await find(frame, sel);
		if (!el) continue;
		await el.click().catch(() => {});
		if (sel === '#probe-text') await page.keyboard.press('Enter');
		clicked.push(sel);
	}
	const results = await resultsOf(page, 90000).catch((e) => (check(`the view probe finishes: ${e.message}`, false), null));
	await sleep(1000);
	if (results) {
		check('the view probe checks everything it tries', results.checks.length >= 10, `${results.checks.length} checks`);
		for (const c of results.checks) check(`views: ${c.name}`, c.ok, c.ok ? '' : c.note);
	}

	// the frame's DOM: only the engine's scripts, no handler, no address that leads out
	const left = frame
		? await frame
				.evaluate(() => {
					const bad = [];
					const out = (v) => !/^\s*(data:|blob:|#|$)/i.test(v);
					for (const el of document.querySelectorAll('*')) {
						if (/^(iframe|frame|object|embed|link|base|form|portal|applet|video|audio|source|track)$/.test(el.localName)) bad.push(`<${el.localName}>`);
						if (el.localName === 'meta' && el.httpEquiv && !/content-security-policy/i.test(el.httpEquiv)) bad.push(`<meta http-equiv=${el.httpEquiv}>`);
						if (el.localName === 'script' && el.src && !el.src.startsWith('blob:')) bad.push(`<script src=${el.src}>`);
						for (const a of el.attributes) {
							if (/^on/i.test(a.name)) bad.push(`${el.localName}[${a.name}]`);
							if (/^(src|href|xlink:href|action|formaction|srcset|data|poster|background|ping|cite)$/i.test(a.name) && el.localName !== 'script' && out(a.value)) bad.push(`${el.localName}[${a.name}=${a.value.slice(0, 60)}]`);
						}
						const css = el.localName === 'style' ? el.textContent : (el.getAttribute('style') ?? '');
						if (/@import|url\(\s*['"]?\s*(?!data:|#)/i.test(css ?? '')) bad.push(`${el.localName} CSS: ${(css ?? '').match(/(@import|url\()[^;]{0,60}/i)?.[0]}`);
					}
					const scripts = document.querySelectorAll('script');
					if (scripts.length > 2) bad.push(`${scripts.length} scripts, not the boot script and the engine`);
					return bad;
				})
				.catch((e) => [`unreadable: ${e.message}`])
		: ['no frame'];
	check('the frame holds nothing the engine should have cleaned', !left.length, left.join(', '));

	// what reached the canary, by what aimed there
	const named = (h) => {
		const path = h.split(' ')[1]?.replace(/^\/v\//, '').replace(/[?#].*$/, '') ?? '';
		return HTML_TRIES[path] ? `${HTML_TRIES[path]} (${h})` : h;
	};
	check(`nothing reached the canary (${clicked.length} clicked, ${Object.keys(HTML_TRIES).length} addresses in its markup, every attempt of its script)`, !hits.length && !connections, hits.length ? hits.map(named).join('; ') : connections ? `${connections} connections with no request` : '');
	check('the page is where it was', page.url() === url, page.url() === url ? '' : page.url());
	const windows = (await browser.pages()).length - pages;
	check('no window opened', !popups && !windows, popups || windows ? `${Math.max(popups, windows)} opened` : '');
	// what each attempt of its script came to, for the log
	if (results) for (const [what, said] of Object.entries(results.said)) if (!what.startsWith('(')) console.log(`    ${what}: ${said}`);
	await page.close();
}

async function boxLab() {
	const page = await signedIn();
	await page.goto(`${base}/app/assets/box/`, { waitUntil: 'domcontentloaded' });
	const shown = await page.waitForSelector('button.chip.run:not([disabled])', { timeout: 120000 }).catch(() => null);
	if (!shown) return check('the box lab opens', false, (await page.evaluate(() => document.body.innerText).catch(() => '')).replace(/\s+/g, ' ').slice(0, 300));
	// a page the dev server reloads (a dependency it found late) loses its run: a failure says so
	let reloads = 0;
	page.on('framenavigated', (f) => f === page.mainFrame() && reloads++);
	await page.click('button.chip.run');
	const r = await resultsOf(page, 300000).catch((e) => (check(`the box lab finishes: ${e.message}${reloads ? ' (the page reloaded)' : ''}`, false), null));
	if (!r) return;
	const probes = Object.entries(r.probes ?? {});
	const open = probes.filter(([, v]) => !String(v).startsWith('blocked'));
	check(`box: every way out refused (${probes.length} tried)`, probes.length > 10 && !open.length, open.map(([k, v]) => `${k}: ${v}`).join('; '));
	for (const [what, said] of probes) console.log(`    ${what}: ${said}`);
	// each ended alone: the same box goes on, the recipe behind it built in its own room, a machine kept running
	for (const [what, got] of [['a recipe that never stops', r.kill], ['a recipe that crashes its worker', r.crash]]) {
		const alone = got?.alone === true && !!got?.stopped;
		check(`box: ${what} is ended alone, and the box goes on`, alone, alone ? `${got.stopped}, after ${got.ms} ms` : JSON.stringify(got));
	}
	const lab = await page.$$eval('ul.checks li', (ls) => ls.map((l) => ({ ok: !l.classList.contains('bad'), text: l.querySelector('b')?.textContent ?? '', note: l.querySelector('small')?.textContent ?? '' })));
	check('box: the lab ran its checks', lab.length >= 10, `${lab.length} checks`);
	for (const c of lab) check(`box: ${c.text.replace(/^[✓✗]\s*/, '')}`, c.ok, c.ok ? '' : c.note);
	await page.close();
}

const t0 = Date.now();
try {
	const fed = only === 'view' ? null : feed();
	const took = (t) => `${((Date.now() - t) / 1000).toFixed(0)} s`;
	if (only !== 'box') {
		const t = Date.now();
		await warm('/app/views/probe/');
		await viewProbe();
		console.log(`the views: ${took(t)}`);
	}
	if (only !== 'view') {
		await fed;
		const t = Date.now();
		await warm('/app/assets/box/');
		await boxLab();
		console.log(`the box: ${took(t)}`);
	}
} catch (e) {
	check(`the probes finish: ${e instanceof Error ? e.message : e}`, false);
} finally {
	await browser.close();
	canary.close();
	if (server?.pid) process.kill(-server.pid);
}

const failed = checks.filter((c) => !c.ok);
console.log(`\n${checks.length - failed.length} of ${checks.length} checks green in ${((Date.now() - t0) / 1000).toFixed(0)} s (${chrome})`);
process.exit(failed.length ? 1 : 0);
