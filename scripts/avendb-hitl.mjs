/*
 * The HITL queue's walk through, end to end, on the Sparks pad: /app/avendb/ in a headless Chrome whose virtual
 * authenticator holds a passkey with PRF, against an avenDB server on this machine, as scripts/avendb-account.mjs
 * runs. The person founds their vault, their aven avenMaia, and gives it a Suggester share on their vault: it may
 * only write on proposals. Acting as the aven through the page's own api (as its agent device would over MCP), it
 * proposes changes to three sparks. Each rises as a card by itself; the person accepts the first (merged into main),
 * declines the second (it stays a proposal, answered), and asks for a revision of the third, whose words the aven sees
 * on its own card; it revises, the card comes back, and the person accepts it. Each vault in the nav pill shows a
 * bubble of how many changes wait for it. Each step is screenshot, wide and on a phone.
 *
 * Build and start as scripts/avendb-account.mjs says (a device and a server with `localhost-passkeys`), then:
 *
 *   BASE=http://localhost:5173 RELAY=http://localhost:3360 SERVER=AVENDB1… node scripts/avendb-hitl.mjs [--out dir]
 */
import { existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import puppeteer from 'puppeteer-core';

const arg = (name, fallback) => {
	const at = process.argv.indexOf(name);
	return at > 0 ? process.argv[at + 1] : fallback;
};
const out = resolve(arg('--out', 'build/avendb-hitl'));
mkdirSync(out, { recursive: true });
const { BASE: base, RELAY: relay, SERVER: server } = process.env;
if (!base || !relay || !server) throw new Error('BASE, RELAY and SERVER: the dev server, the test server’s relay and offer');
const chrome =
	process.env.CHROME ??
	['/opt/pw-browsers/chromium', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].find((p) => existsSync(p));
if (!chrome) throw new Error('No Chrome found: set CHROME to one.');
const origin = new URL(base).origin;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const checks = [];
const check = (what, ok, found = '') => {
	checks.push({ what, ok: !!ok, found });
	console.log(`${ok ? '✓' : '✕'} ${what}${ok || !found ? '' : ` (found: ${found})`}`);
};

const browser = await puppeteer.launch({ executablePath: chrome, headless: true, args: ['--no-sandbox'] });
const page = await browser.newPage();
const wide = { width: 1300, height: 1000 };
// a phone's width: no isMobile, which would load the page again
const phone = { width: 390, height: 844 };
await page.setViewport(wide);
page.on('pageerror', (e) => check(`no error on the page: ${e.message}`, false));
const cdp = await page.createCDPSession();
await cdp.send('WebAuthn.enable', { enableUI: false });
const options = { protocol: 'ctap2', ctap2Version: 'ctap2_1', transport: 'internal', hasResidentKey: true };
const verified = { hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true, hasPrf: true };
await cdp.send('WebAuthn.addVirtualAuthenticator', { options: { ...options, ...verified } });
// /api/me answers as Samuel, a founder: only that request is held (see scripts/avendb-account.mjs)
await cdp.send('Fetch.enable', { patterns: [{ urlPattern: '*/api/me' }] });
cdp.on('Fetch.requestPaused', (r) => {
	const founder = { id: 'account', number: 1, name: 'Samuel', since: '2026-01-01', role: 'founder', caps: ['media:admin'] };
	const headers = { 'access-control-allow-origin': origin, 'access-control-allow-credentials': 'true', 'content-type': 'application/json' };
	cdp.send('Fetch.fulfillRequest', {
		requestId: r.requestId,
		responseCode: 200,
		responseHeaders: Object.entries(headers).map(([name, value]) => ({ name, value })),
		body: Buffer.from(JSON.stringify(founder)).toString('base64')
	});
});

const text = (selector = 'main.avendb') =>
	page.evaluate((s) => document.querySelector(s)?.textContent?.replace(/\s+/g, ' ').trim() ?? '', selector);
async function until(holds, ms = 60000) {
	const end = Date.now() + ms;
	while (Date.now() < end) {
		if (await holds()) return true;
		await sleep(200);
	}
	return false;
}
async function click(t, selector) {
	const ok = await page.evaluate(
		(t, selector) => {
			const all = [...document.querySelectorAll(selector)];
			const words = (e) => e.textContent?.replace(/\s+/g, ' ').trim() ?? '';
			const el = all.find((e) => words(e) === t) ?? all.find((e) => words(e).includes(t));
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
const shot = async (name) => {
	await sleep(500);
	await page.screenshot({ path: `${out}/${name}.png` });
};
const problem = () => page.evaluate(() => document.querySelector('[role=alert]')?.textContent?.trim() ?? '');

/** Op `op` through the page's api, as `what`: what it did, or null. */
const run = (what, op) => page.evaluate((what, op) => /** @type {any} */ (globalThis).avendb.api.run(what, op), what, op);
/** A read through the page's api: the device's answer. */
const ask = (op) => page.evaluate((op) => /** @type {any} */ (globalThis).avendb.api.ask(op), op);
const world = () => page.evaluate(() => /** @type {any} */ (globalThis).avendb.world());
const card = () => text('.stack .card');

const spark = (title, text) => ({
	kind: 'spark',
	title,
	look: 'thought',
	blocks: [
		{ id: 1, type: 'heading', level: 1, text: title },
		{ id: 2, type: 'paragraph', text }
	]
});

/** As aven `aven`, propose on spark `entry` a new title and text, named `name`: the proposal's line. */
async function propose(aven, entry, name, title, words) {
	const note = (await ask({ op: 'note', entry })).ok;
	const main = note.lines.find((l) => l.line === null);
	const made = await run('Proposing', { op: 'propose', as: aven, entry, from: main.heads, name });
	if (!made) return null;
	await rewrite(aven, entry, made.line, title, words);
	return made.line;
}
/** As `aven`, write `title` and `words` on line `line` of spark `entry`. */
async function rewrite(aven, entry, line, title, words) {
	const set = (path, value) => ({ op: 'set', entry, line, path, value });
	const ops = [set(['title'], title), set(['blocks', { id: 1 }, 'text'], title), set(['blocks', { id: 2 }, 'text'], words)];
	return run('Writing on the proposal', { op: 'batch', ops, as: aven });
}
/** The spark `entry`'s title on main, as the world says. */
const titleOf = async (entry) => (await world()).entries.find((e) => e.entry === entry)?.title;
/** Look at vault `name`, from the nav pill's vaults. */
async function lookAt(name) {
	await page.click('nav button.item[title^="avenDB vaults"]').catch(() => check('the nav pill shows the vaults', false));
	await sleep(250);
	await click(name, '.account button.acct');
	return until(async () => (await text('.main-head p, .home-head h1')).includes(name), 8000);
}
/** The bubbles in the nav pill's vaults menu, by vault name. */
async function bubbles() {
	await page.click('nav button.item[title^="avenDB vaults"]').catch(() => {});
	await sleep(250);
	const got = await page.$$eval('.account button.acct', (els) =>
		Object.fromEntries(
			els.map((e) => [e.querySelector('.acct-name')?.childNodes[0]?.textContent?.trim(), e.querySelector('.bubble')?.textContent ?? '0'])
		)
	);
	await page.click('nav button.item[title^="avenDB vaults"]').catch(() => {});
	await sleep(150);
	return got;
}

try {
	await page.goto(`${base}/app/avendb/?${new URLSearchParams({ relay, server })}`, { waitUntil: 'domcontentloaded' });
	check('it opens on the account', await until(async () => (await text()).includes('Use my maiaCITY passkey')));
	await page.evaluate(async () => {
		await navigator.credentials.create({
			publicKey: {
				rp: { id: 'localhost', name: 'maiaCITY' },
				user: { id: crypto.getRandomValues(new Uint8Array(16)), name: 'Samuel', displayName: 'Samuel' },
				challenge: crypto.getRandomValues(new Uint8Array(32)),
				pubKeyCredParams: [{ type: 'public-key', alg: -7 }],
				authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
				extensions: { prf: {} }
			}
		});
	});
	await click('Use my maiaCITY passkey', 'main.avendb button');
	check('the vault is founded', await page.waitForSelector('.shell', { timeout: 180000 }).then(() => true, () => false), await problem());
	await page.waitForSelector('.signing', { hidden: true, timeout: 20000 }).catch(() => {});
	await until(async () => !!(await page.evaluate(() => /** @type {any} */ (globalThis).avendb?.world())), 10000);
	const mine = (await world()).mine;

	// their aven, given a Suggester share on their vault: it writes only on proposals
	await run('Founding the aven', { op: 'found', vaults: [{ kind: 'aven', name: 'avenMaia' }] });
	const aven = await until(async () => (await world()).vaults.some((v) => v.kind === 'aven' && v.name === 'avenMaia'), 30000)
		? (await world()).vaults.find((v) => v.kind === 'aven' && v.name === 'avenMaia').id
		: null;
	check('their aven avenMaia is founded', !!aven, await problem());
	const shared = await run('Sharing with the aven', { op: 'share', over: mine, who: { vault: aven }, level: 'Suggester', what: 'everything', as: mine });
	check('the aven holds a Suggester share on their vault', !!shared, await problem());

	// three sparks on their pad
	const made = [];
	for (const [t, w] of [
		['Seed library', 'Swap seeds in the village hall.'],
		['Night market', 'Stalls under the dome on Fridays.'],
		['Rain barrels', 'One barrel per house.']
	]) {
		const got = await run('Adding a spark', { op: 'create', vault: mine, type: 'spark', tags: [], value: spark(t, w) });
		made.push(got?.entry);
	}
	check('three sparks on the pad', made.every(Boolean), await problem());
	await page.evaluate(() => (location.hash = 'sparks'));
	check('no card while nothing waits', !(await page.$('.stack')));

	// 1. the aven proposes; the card rises by itself; the person accepts it
	const lineA = await propose(aven, made[0], 'sharper title', 'Seed library and tool shed', 'Swap seeds and tools in the village hall, every Sunday.');
	check('the aven may propose with its Suggester share', !!lineA, await problem());
	check('a card rises by itself', await until(async () => (await card()).includes('avenMaia proposes a change'), 30000), await card());
	const c = await card();
	check('it shows the change: the new title and words', c.includes('tool shed') && c.includes('every Sunday'), c);
	check('with the policy: one owner', c.includes('One owner'), c);
	await shot('1-card');
	await page.setViewport(phone);
	await shot('1-card-phone');
	await page.setViewport(wide);
	await click('Accept', '.stack .answers button');
	check('accepted: merged into main', await until(async () => (await titleOf(made[0])) === 'Seed library and tool shed', 30000), await titleOf(made[0]));
	check('and the card is gone', await until(async () => !(await page.$('.stack .card')), 10000));
	const r1 = (await world()).entries.find((e) => e.type === 'review' && e.record?.entry === made[0]);
	check('a review records it, signed by the device: accepted', r1?.record?.verdict === 'accepted', JSON.stringify(r1?.record));

	// 2. declined: it stays a proposal, answered
	const lineB = await propose(aven, made[1], 'every night', 'Night market, every night', 'Stalls under the dome every night.');
	check('a second card rises', await until(async () => (await card()).includes('every night'), 30000), await card());
	await click('Decline', '.stack .answers button');
	check('declined: the card is gone', await until(async () => !(await page.$('.stack .card')), 10000));
	check('main keeps its title', (await titleOf(made[1])) === 'Night market', await titleOf(made[1]));
	const r2 = (await world()).entries.find((e) => e.type === 'review' && e.record?.line === lineB);
	check('a review records it: declined', r2?.record?.verdict === 'declined', JSON.stringify(r2?.record));

	// 3. revise: the words go back to the aven, which revises; the card comes back and is accepted
	const lineC = await propose(aven, made[2], 'bigger', 'Rain barrels', 'Ten barrels per house.');
	check('a third card rises', await until(async () => (await card()).includes('Ten barrels'), 30000), await card());
	await click('Revise', '.stack .answers button');
	await page.type('.stack textarea', 'Ten is too many: make it two, and say where they stand.');
	await shot('3-revise');
	await click('Send', '.stack .answers button');
	check('asked for a revision: the card is gone', await until(async () => !(await page.$('.stack .card')), 10000));
	check('as Samuel, nothing waits', (await bubbles())['Samuel'] === '0', JSON.stringify(await bubbles()));
	await lookAt('avenMaia');
	check('as the aven, the revision asked of it rises', await until(async () => (await card()).includes('asks for a revision'), 15000), await card());
	check('with the words sent', (await card()).includes('make it two'), await card());
	await shot('4-aven');
	await click('Done', '.stack .answers button');
	await rewrite(aven, made[2], lineC, 'Rain barrels', 'Two barrels per house, by the north wall.');
	check('the revised version waits for Samuel: a bubble on his vault', await until(async () => (await bubbles())['Samuel'] === '1', 30000), JSON.stringify(await bubbles()));
	await shot('5-bubble');
	await lookAt('Samuel');
	check('back as Samuel, the revised card rises', await until(async () => (await card()).includes('north wall'), 30000), await card());
	check('it says the earlier version was sent back', (await card()).includes('earlier version: revise'), await card());
	await shot('6-revised');
	await click('Accept', '.stack .answers button');
	const merged = async () => (await ask({ op: 'note', entry: made[2] })).ok?.lines.find((l) => l.line === null)?.text;
	check('accepted: the revision is on main', await until(async () => (await merged())?.includes('north wall'), 30000), await merged());
	check('nothing waits any more', await until(async () => !(await page.$('.stack .card')) && !(await page.$('.waiting')), 10000));
	await shot('7-done');
} catch (e) {
	check(`the walk ran through: ${e.message}`, false);
} finally {
	const failed = checks.filter((c) => !c.ok);
	console.log(`\n${checks.length - failed.length} of ${checks.length} checks passed. Screens in ${out}`);
	await browser.close();
	process.exit(failed.length ? 1 : 0);
}
