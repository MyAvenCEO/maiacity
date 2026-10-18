/*
 * The Proposals app's walk through (/app/aips/, AIPs on today's MIPs): a headless Chrome against the dev server, every
 * /api/ request answered here (a founder who sits at MaiaCity V1's seat A; two V1 MIPs). It checks the stages, the game
 * filter, a V1 detail with its signatures, a new V1 proposal from a COOP's "Propose a payout" link, and that the game
 * shows no proposal on its own screen. avenDB's public feed is answered too: the Maia City COOP vault shares Sandbox 5
 * and MaiaCity V1 with everyone (A2), so the dashboard's Game Worlds show Sandbox 5 without Draft.
 * Each step is screenshot, wide and on a phone.
 *
 *   BASE=http://localhost:5173 node scripts/aips-walk.mjs [--out dir]
 */
import { existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import puppeteer from 'puppeteer-core';
import { act, newGame } from '../game/maiacity-v1/engine.js';

const arg = (name, fallback) => {
	const at = process.argv.indexOf(name);
	return at > 0 ? process.argv[at + 1] : fallback;
};
const out = resolve(arg('--out', 'build/aips-walk'));
mkdirSync(out, { recursive: true });
const base = process.env.BASE ?? 'http://localhost:5173';
const chrome = process.env.CHROME ?? ['/opt/pw-browsers/chromium', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].find((p) => existsSync(p));
const origin = new URL(base).origin;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const checks = [];
const check = (what, ok, found = '') => {
	checks.push({ what, ok: !!ok });
	console.log(`${ok ? '✓' : '✕'} ${what}${ok || !found ? '' : ` (found: ${found})`}`);
};

// the API, as this walk answers it
const now = Date.now();
let game = newGame(now - 3600e3);
game.players.A.founder = 'samuel';
game.players.A.name = 'Samuel';
game.players.B.founder = 'lena';
game.players.B.name = 'Lena';
game.coops.maia.treasury.MAIA = 50; // so a payout from it can be proposed
game = act(game, 'A', { type: 'propose', mip: { title: 'Cheaper tent rent', description: 'The tent costs too much in the first months.', settings: { tentRent: 40 }, coops: {}, payouts: [] } }, now - 1800e3);
game = act(game, 'B', { type: 'propose', mip: { title: 'A faster calendar', description: '', settings: { hoursPerMonth: 12 }, coops: {}, payouts: [] } }, now - 1200e3);
game = act(game, 'A', { type: 'reject', number: 2 }, now - 600e3);
const founder = { id: 'samuel', number: 1, name: 'Samuel', since: '2026-01-01', role: 'admin', caps: ['economy:admin', 'media:admin'] };
const answers = {
	'/api/me': founder,
	'/api/maiacity-v1': { game, me: 'samuel', admin: true, now }
};
let moves = [];
let signedOut = false;
// avenDB's public feed: the game entries everyone may read, those the Maia City COOP vault published
const gameRow = (id) => ({ entry: id, vault: 'c'.repeat(64), name: 'Maia City', seed: 'Maia City', type: 'game', tags: ['game', `game:${id}`] });
const feed = { entries: [gameRow('sandbox-5'), gameRow('maiacity-v1')] };

const browser = await puppeteer.launch({ executablePath: chrome, headless: true, args: ['--no-sandbox'] });
const page = await browser.newPage();
// the app's way in ($lib/app/entry.js) lets this tab on without avenDB, whose own page it walks; the vault founded
// there is named as the person signed up
await page.evaluateOnNewDocument(() => {
	sessionStorage.setItem('avendb:later', '1');
	sessionStorage.setItem('maia:signup', 'Samuel');
});
const wide = { width: 1300, height: 1000 };
const phone = { width: 390, height: 844 };
await page.setViewport(wide);
page.on('pageerror', (e) => check(`no error on the page: ${e.message}`, false));
// the game's first-run story told already, so its tools show
await page.evaluateOnNewDocument((key) => localStorage.setItem(key, JSON.stringify({ off: true })), `v1-story-${game.started}-A`);
const cdp = await page.createCDPSession();
await cdp.send('Fetch.enable', { patterns: [{ urlPattern: '*/api/*' }, { urlPattern: 'https://avendb.maia.city/feed/entries*' }] });
cdp.on('Fetch.requestPaused', (r) => {
	const url = new URL(r.request.url);
	const headers = { 'access-control-allow-origin': origin, 'access-control-allow-credentials': 'true', 'access-control-allow-headers': 'content-type', 'access-control-allow-methods': 'GET, POST, OPTIONS', 'content-type': 'application/json' };
	let body = url.hostname === 'avendb.maia.city' ? feed : (answers[url.pathname] ?? {});
	let status = 200;
	// signed out: the API knows nobody
	if (signedOut && url.pathname.startsWith('/api/')) (body = { error: 'Please sign in.' }), (status = 401);
	if (url.hostname === 'avendb.maia.city') headers['access-control-allow-origin'] = '*';
	if (url.pathname === '/api/maiacity-v1/move' && r.request.method === 'POST') {
		const { seat, action } = JSON.parse(r.request.postData ?? '{}');
		moves.push(action);
		try {
			game = act(game, seat, action, Date.now());
			answers['/api/maiacity-v1'] = { game, me: 'samuel', admin: true, now: Date.now() };
			body = answers['/api/maiacity-v1'];
		} catch (e) {
			body = { error: e.message };
		}
	}
	cdp.send('Fetch.fulfillRequest', { requestId: r.requestId, responseCode: r.request.method === 'OPTIONS' ? 204 : status, responseHeaders: Object.entries(headers).map(([name, value]) => ({ name, value })), body: Buffer.from(JSON.stringify(body)).toString('base64') });
});

const text = () => page.evaluate(() => document.querySelector('main')?.textContent?.replace(/\s+/g, ' ').trim() ?? '');
async function until(holds, ms = 30000) {
	const end = Date.now() + ms;
	while (Date.now() < end) {
		if (await holds()) return true;
		await sleep(200);
	}
	return false;
}
async function click(t, selector = 'button, a') {
	const ok = await page.evaluate((t, selector) => {
		const words = (e) => e.textContent?.replace(/\s+/g, ' ').trim() ?? '';
		const all = [...document.querySelectorAll(selector)];
		const el = all.find((e) => words(e) === t) ?? all.find((e) => words(e).startsWith(t));
		el?.click();
		return !!el;
	}, t, selector);
	if (!ok) check(`found "${t}" to click`, false);
	await sleep(400);
}
async function shot(name) {
	await page.screenshot({ path: `${out}/${name}-wide.png`, fullPage: true });
	await page.setViewport(phone);
	await sleep(300);
	await page.screenshot({ path: `${out}/${name}-phone.png`, fullPage: true });
	await page.setViewport(wide);
	await sleep(300);
}

await page.goto(`${base}/app/aips/`, { waitUntil: 'networkidle2' });
check('the app opens on the proposed ones of every game', await until(async () => (await text()).includes('Cheaper tent rent')), (await text()).slice(0, 300));
check('a proposed one shows its signatures so far', (await text()).includes('1 of 2 signatures'));
await shot('1-proposed');
await click('Archive');
await until(async () => (await text()).includes('A faster calendar'), 5000);
const archive = await text();
check('the archive holds the rejected', archive.includes('A faster calendar') && archive.includes('rejected'), archive.slice(380, 900));
await click('Ideas');
check('ideas are empty and say why', (await text()).includes('No ideas yet'));
await click('Proposed');
await click('MaiaCity V1');
check('the game filter keeps only that game', (await text()).includes('Cheaper tent rent'));
await click('Cheaper tent rent');
const v1 = await text();
check('a V1 detail: text, changes, who signed', v1.includes('The tent costs too much') && v1.includes('Tent price') && v1.includes('✓ Samuel') && v1.includes('○ Lena'), v1.slice(380, 1100));
check('the proposer sees Withdraw, not Sign', v1.includes('Withdraw') && !v1.includes('Sign as'));
await shot('2-v1-detail');

// MaiaCity V1's own screen: no proposal on it, only the way to the app
await page.goto(`${base}/app/maiacity-v1/`, { waitUntil: 'domcontentloaded' });
await until(async () => page.evaluate(() => [...document.querySelectorAll('a')].some((a) => a.getAttribute('href')?.includes('/app/aips/'))), 30000);
const v1page = await page.evaluate(() => [...document.querySelectorAll('a')].map((a) => a.getAttribute('href')).filter((h) => h?.includes('/app/aips/')));
check('the V1 game links to the Proposals app', v1page.length > 0, JSON.stringify(v1page));
check('the V1 game shows no proposal of its own', !(await page.evaluate(() => document.body.textContent)).includes('Propose and sign as'));

// a payout proposed from a COOP lands in the app on a new proposal, filled in
await page.goto(`${base}/app/aips/?game=maiacity-v1&new=1&from=coop%3Amaia&to=player%3AA&token=MAIA&amount=1`, { waitUntil: 'networkidle2' });
check('a new V1 proposal opens filled in', await until(async () => (await text()).includes('Propose and sign as Samuel')));
await shot('3-v1-new');
await page.evaluate(() => {
	const t = document.querySelector('.draft input');
	t.value = 'Pay the first player';
	t.dispatchEvent(new Event('input', { bubbles: true }));
});
await click('Propose and sign as Samuel');
check('proposing sends one propose move with the payout', await until(async () => moves.some((m) => m.type === 'propose' && m.mip?.payouts?.length === 1)), JSON.stringify(moves));
check('the new one is listed under Proposed', await until(async () => (await text()).includes('Pay the first player')));

await page.goto(`${base}/app/`, { waitUntil: 'domcontentloaded' });
check('the dashboard has the Proposals app next to Ledger and Coops', await until(async () => (await page.evaluate(() => [...document.querySelectorAll('a')].some((a) => a.getAttribute('href')?.endsWith('/app/aips/')))) ));
await shot('4-dashboard');

// the Game Worlds on the dashboard: published by the Maia City COOP vault's Public share, as its feed lists them
const rowOf = (label) => page.evaluate((label) => [...document.querySelectorAll('.games .game')].find((g) => g.querySelector('.label b')?.textContent?.trim() === label)?.textContent?.replace(/\s+/g, ' ').trim() ?? '', label);
check('a published sandbox shows no Draft', await until(async () => { const r = await rowOf('Sandbox 5'); return r && !r.includes('Draft'); }), await rowOf('Sandbox 5'));
check('one the vault does not publish still shows Draft', (await rowOf('Sandbox 6')).includes('Draft'), await rowOf('Sandbox 6'));
await page.goto(`${base}/app/games/`, { waitUntil: 'domcontentloaded' });
check('the old Sandboxes list moves on to the dashboard', await until(async () => new URL(page.url()).pathname.replace(/\/$/, '').endsWith('/app')), page.url());
await shot('5-sandboxes');

// signed out: the Proposals app opens, read only
signedOut = true;
await page.goto(`${base}/app/aips/?stage=proposed`, { waitUntil: 'domcontentloaded' });
check('signed out, the Proposals app opens', await until(async () => (await text()).includes('Aven Improvement Proposals')), await text());
await shot('6-signed-out');

await browser.close();
const failed = checks.filter((c) => !c.ok);
console.log(`\n${checks.length - failed.length}/${checks.length} checks passed; screenshots in ${out}`);
process.exit(failed.length ? 1 : 0);
