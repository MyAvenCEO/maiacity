/*
 * The Proposals app's walk through (/app/aips/, AIPs on today's MIPs): a headless Chrome against the dev server, every
 * /api/ request answered here (a founder who plays Sandbox 7 as its admin and sits at MaiaCity V1's seat A; two Sandbox
 * 7 MIPs and two V1 MIPs). It checks the stages, the game filter, a Sandbox 7 detail, a V1 detail with its signatures,
 * a new V1 proposal from a COOP's "Propose a payout" link, and that neither game shows a proposal on its own screen.
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
const founder = { id: 'samuel', number: 1, name: 'Samuel', since: '2026-01-01', role: 'admin', caps: ['economy:play', 'economy:admin', 'media:admin'] };
const card = { id: 'policy', kind: 'policy', name: 'Policy', values: { mint: 24 }, code: '' };
const mips = [
	{ number: 41, title: 'World 36', description: 'Slower steps.', action: 'world', config: 'base', status: 'accepted', cards: [], remove: [], base: {}, world: { name: 'World 36', diff: ['Step a day: 0.2 → 0.15'], after: 'w35', after_name: 'World 35' }, result: { world: 'w36', name: 'World 36' }, author: 'samuel', author_name: 'Samuel', via: 'mcp', created: new Date(now - 86400e3).toISOString(), decided: new Date(now - 80000e3).toISOString(), prs: [{ number: 494, title: 'buffer price' }] },
	{ number: 42, title: 'World 37', description: 'Keep World 36 and try a lower mint.', action: 'world', config: 'base', status: 'open', cards: [{ ...card, values: { mint: 20 } }], remove: [], base: { policy: card }, world: { name: 'World 37', diff: ['Mint: 24 → 20 HEARTS'], after: 'w36', after_name: 'World 36' }, author: 'agent', author_name: 'avenMaia', via: 'mcp', created: new Date(now - 3600e3).toISOString(), prs: [] }
];
const answers = {
	'/api/me': founder,
	'/api/economy/mips': { mips },
	'/api/economy/configs': { configs: [{ id: 'base', name: 'Base valley', description: 'The defaults', version: 3, cards: [card] }] },
	'/api/economy/runs': { runs: [] },
	'/api/maiacity-v1': { game, me: 'samuel', admin: true, now }
};
let moves = [];

const browser = await puppeteer.launch({ executablePath: chrome, headless: true, args: ['--no-sandbox'] });
const page = await browser.newPage();
const wide = { width: 1300, height: 1000 };
const phone = { width: 390, height: 844 };
await page.setViewport(wide);
page.on('pageerror', (e) => check(`no error on the page: ${e.message}`, false));
// the game's first-run story told already, so its tools show
await page.evaluateOnNewDocument((key) => localStorage.setItem(key, JSON.stringify({ off: true })), `v1-story-${game.started}-A`);
const cdp = await page.createCDPSession();
// and Sandbox 7's GPU machine in Samuel's tailnet, which unlocks the sandbox: it serves d1 and Qwen
await cdp.send('Fetch.enable', { patterns: [{ urlPattern: '*/api/*' }, { urlPattern: 'http://100.96.61.57*' }] });
cdp.on('Fetch.requestPaused', (r) => {
	const url = new URL(r.request.url);
	const headers = { 'access-control-allow-origin': origin, 'access-control-allow-credentials': 'true', 'access-control-allow-headers': 'content-type', 'access-control-allow-methods': 'GET, POST, OPTIONS', 'content-type': 'application/json' };
	let body = url.hostname === '100.96.61.57' ? { data: [{ id: 'd1' }, { id: 'qwen' }] } : (answers[url.pathname] ?? {});
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
	cdp.send('Fetch.fulfillRequest', { requestId: r.requestId, responseCode: r.request.method === 'OPTIONS' ? 204 : 200, responseHeaders: Object.entries(headers).map(([name, value]) => ({ name, value })), body: Buffer.from(JSON.stringify(body)).toString('base64') });
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
check('the app opens on the proposed ones of every game', await until(async () => (await text()).includes('World 37') && (await text()).includes('Cheaper tent rent')), (await text()).slice(0, 300));
check('a proposed one shows its signatures so far', (await text()).includes('1 of 2 signatures') && (await text()).includes('0 of 1 signatures'));
await shot('1-proposed');
await click('Archive');
await until(async () => (await text()).includes('World 36'), 5000);
const archive = await text();
check('the archive holds the applied and the rejected', archive.includes('World 36') && archive.includes('A faster calendar') && archive.includes('applied') && archive.includes('rejected'), archive.slice(380, 900));
await click('Ideas');
check('ideas are empty and say why', (await text()).includes('No ideas yet'));
await click('Proposed');
await click('Sandbox 7');
check('the game filter keeps only that game', !(await text()).includes('Cheaper tent rent') && (await text()).includes('World 37'));
await click('World 37');
const s7 = await text();
check('a Sandbox 7 detail: text, changes, cards, Accept for the admin', s7.includes('Keep World 36 and try a lower mint') && s7.includes('Mint: 24 → 20 HEARTS') && s7.includes('Accept') && s7.includes('MIP-42'), s7.slice(0, 500));
check('the address names the open one', page.url().includes('aip=s7-42') && page.url().includes('game=sandbox-8'));
await shot('2-sandbox7-detail');
await click('MaiaCity V1');
await click('Cheaper tent rent');
const v1 = await text();
check('a V1 detail: text, changes, who signed', v1.includes('The tent costs too much') && v1.includes('Tent price') && v1.includes('✓ Samuel') && v1.includes('○ Lena'), v1.slice(380, 1100));
check('the proposer sees Withdraw, not Sign', v1.includes('Withdraw') && !v1.includes('Sign as'));
await shot('3-v1-detail');

// MaiaCity V1's own screen: no proposal on it, only the way to the app
await page.goto(`${base}/app/maiacity-v1/`, { waitUntil: 'domcontentloaded' });
await until(async () => page.evaluate(() => [...document.querySelectorAll('a')].some((a) => a.getAttribute('href')?.includes('/app/aips/'))), 30000);
const v1page = await page.evaluate(() => [...document.querySelectorAll('a')].map((a) => a.getAttribute('href')).filter((h) => h?.includes('/app/aips/')));
check('the V1 game links to the Proposals app', v1page.length > 0, JSON.stringify(v1page));
check('the V1 game shows no proposal of its own', !(await page.evaluate(() => document.body.textContent)).includes('Propose and sign as'));

// a payout proposed from a COOP lands in the app on a new proposal, filled in
await page.goto(`${base}/app/aips/?game=maiacity-v1&new=1&from=coop%3Amaia&to=player%3AA&token=MAIA&amount=1`, { waitUntil: 'networkidle2' });
check('a new V1 proposal opens filled in', await until(async () => (await text()).includes('Propose and sign as Samuel')));
await shot('4-v1-new');
await page.evaluate(() => {
	const t = document.querySelector('.draft input');
	t.value = 'Pay the first player';
	t.dispatchEvent(new Event('input', { bubbles: true }));
});
await click('Propose and sign as Samuel');
check('proposing sends one propose move with the payout', await until(async () => moves.some((m) => m.type === 'propose' && m.mip?.payouts?.length === 1)), JSON.stringify(moves));
check('the new one is listed under Proposed', await until(async () => (await text()).includes('Pay the first player')));

// Sandbox 7's own screen: no Proposals page, a link with how many wait
await page.goto(`${base}/app/games/sandbox-8/`, { waitUntil: 'domcontentloaded' });
check('Sandbox 7 links to the Proposals app with the count', await until(async () => (await page.evaluate(() => document.querySelector('a.open-mips')?.textContent ?? '')).includes('1 waiting')));
await shot('5-sandbox7-home');

await page.goto(`${base}/app/`, { waitUntil: 'domcontentloaded' });
check('the dashboard has the Proposals app next to Ledger and Coops', await until(async () => (await page.evaluate(() => [...document.querySelectorAll('a')].some((a) => a.getAttribute('href')?.endsWith('/app/aips/')))) ));
await shot('6-dashboard');

await browser.close();
const failed = checks.filter((c) => !c.ok);
console.log(`\n${checks.length - failed.length}/${checks.length} checks passed; screenshots in ${out}`);
process.exit(failed.length ? 1 : 0);
