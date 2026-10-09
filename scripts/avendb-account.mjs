/*
 * The avenDB account's walk through, end to end: /app/avendb/ in a headless Chrome whose virtual authenticator holds a
 * passkey with PRF, against an avenDB server on this machine. The person signed up to maiaCITY with that passkey; the
 * account founds their vault with it in three ceremonies, claims the server, and names their vault and avenCEO with
 * none. Their vault then founds avenALICE, avenBOB, avenCHARLY and Maia City COOP in one ceremony, and the person acts
 * as each in turn from the switcher at the foot: avenALICE writes a note and a todo and shares the note with avenBOB,
 * who reads it and nothing else, while avenCHARLY sees nothing of hers; the Sync list shows avenCEO's server relaying
 * her home's ciphertext and opening none of it; making the coop an owner of her home takes one ceremony, revoking
 * avenBOB's read none. The account opens again after a reload in one ceremony; forgotten here, it comes back through
 * the server for the passkey alone, in four ceremonies, with every vault and the note. Each step is screenshot.
 *
 * Passkeys of localhost count only in a device built with avendb's `localhost-passkeys`, never in one that ships, so
 * this runs on a dev server whose src/lib/avendb/device/ holds such a build, and a server built likewise:
 *
 *   cd avendb && cargo build -p avendb-browser --target wasm32-unknown-unknown --release --features localhost-passkeys
 *   wasm-bindgen --target web --no-typescript --out-dir ../src/lib/avendb/device \
 *     target/wasm32-unknown-unknown/release/avendb_browser.wasm          (git checkout src/lib/avendb/device after)
 *   cargo build -p avendb-server --features avendb/localhost-passkeys
 *   AVENDB_DATA=$(mktemp -d) AVENDB_BIND=127.0.0.1:7421 AVENDB_RELAY_BIND=127.0.0.1:3360 \
 *     AVENDB_RELAY_URL=http://localhost:3360 target/debug/avendb-server     (it logs its offer)
 *   BASE=http://localhost:5173 RELAY=http://localhost:3360 SERVER=AVENDB1… node scripts/avendb-account.mjs [--out dir]
 *
 * CHROME=/path/to/chrome, else /opt/pw-browsers/chromium, or Chrome on a Mac.
 */
import { existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import puppeteer from 'puppeteer-core';

const arg = (name, fallback) => {
	const at = process.argv.indexOf(name);
	return at > 0 ? process.argv[at + 1] : fallback;
};
const out = resolve(arg('--out', 'build/avendb-account'));
mkdirSync(out, { recursive: true });
const { BASE: base, RELAY: relay, SERVER: server } = process.env;
if (!base || !relay || !server) throw new Error('BASE, RELAY and SERVER: the dev server, the test server’s relay and offer');
const chrome =
	process.env.CHROME ??
	['/opt/pw-browsers/chromium', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].find((p) => existsSync(p));
if (!chrome) throw new Error('No Chrome found: set CHROME to one.');
const origin = new URL(base).origin;

const checks = [];
const check = (what, ok, found = '') => {
	checks.push({ what, ok: !!ok, found });
	console.log(`${ok ? '✓' : '✕'} ${what}${ok || !found ? '' : ` (found: ${found})`}`);
};

const browser = await puppeteer.launch({ executablePath: chrome, headless: true, args: ['--no-sandbox'] });
const page = await browser.newPage();
const wide = { width: 1300, height: 1000 };
await page.setViewport(wide);
page.on('pageerror', (e) => check(`no error on the page: ${e.message}`, false));
const cdp = await page.createCDPSession();
await cdp.send('WebAuthn.enable', { enableUI: false });
const options = { protocol: 'ctap2', ctap2Version: 'ctap2_1', transport: 'internal', hasResidentKey: true };
const verified = { hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true, hasPrf: true };
const { authenticatorId } = await cdp.send('WebAuthn.addVirtualAuthenticator', { options: { ...options, ...verified } });
// /api/me answers as Samuel, a founder. Only that request is held: Puppeteer's own interception holds every request,
// and the device's module and WebAssembly fetches never come back from it.
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

/** the words of `selector`, as written (not as styled) */
const text = (selector = 'main.avendb') =>
	page.evaluate((s) => document.querySelector(s)?.textContent?.replace(/\s+/g, ' ').trim() ?? '', selector);
/** Whether `holds` comes true within `ms`. @param {() => Promise<unknown>} holds */
async function until(holds, ms = 60000) {
	const end = Date.now() + ms;
	while (Date.now() < end) {
		if (await holds()) return true;
		await sleep(200);
	}
	return false;
}
const waitText = (t, ms = 60000, selector = 'main.avendb') => until(async () => (await text(selector)).includes(t), ms);
/** Click the `selector` whose words are `t`, else the first whose words include it. */
async function click(t, selector = 'main.avendb button') {
	const ok = await page.evaluate(
		(t, selector) => {
			const all = [...document.querySelectorAll(selector)];
			const words = (/** @type {Element} */ e) => e.textContent?.replace(/\s+/g, ' ').trim() ?? '';
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
/** Pick the option worded `label` of the select `selector`. */
async function choose(selector, label) {
	const ok = await page.evaluate(
		(selector, label) => {
			const s = document.querySelector(selector);
			if (!(s instanceof HTMLSelectElement)) return false;
			const o = [...s.options].find((o) => o.textContent?.trim() === label);
			if (!o) return false;
			s.value = o.value;
			s.dispatchEvent(new Event('change', { bubbles: true }));
			return true;
		},
		selector,
		label
	);
	if (!ok) check(`there is a “${label}” to choose`, false);
	await sleep(150);
	return ok;
}
/** Type `t` into the empty field `selector`. */
async function type(selector, t) {
	const field = await page.$(selector);
	if (!field) return check(`there is a ${selector} to type in`, false);
	await field.evaluate((e) => {
		/** @type {HTMLInputElement} */ (e).value = '';
		e.dispatchEvent(new Event('input', { bubbles: true }));
	});
	await field.type(t);
}
const shot = async (name) => {
	await sleep(400);
	await page.screenshot({ path: `${out}/${name}.png` });
};
const shown = (selector) => page.$$eval(selector, (els) => els.map((e) => e.textContent?.replace(/\s+/g, ' ').trim()));
const problem = () => page.evaluate(() => document.querySelector('[role=alert]')?.textContent?.trim() ?? '');
const ceremonies = async () => (await cdp.send('WebAuthn.getCredentials', { authenticatorId })).credentials[0]?.signCount ?? 0;

/** the vaults in the bar, by name, the person's own first */
const bar = () => page.$$eval('.bar .slot[aria-label]:not(.add)', (els) => els.map((e) => e.getAttribute('aria-label')));
const SIX = ['Samuel', 'avenCEO', 'avenALICE', 'avenBOB', 'avenCHARLY', 'Maia City COOP'];
const hasAll = async (names) => {
	const now = await bar();
	return names.every((n) => now.includes(n));
};
/** Look at vault `name`'s list `tab`. */
async function look(name, tab = 'Notes & todos') {
	await page.click(`.bar .slot[aria-label="${name}"]`).catch(() => check(`${name} is in the bar`, false));
	await sleep(150);
	await click(tab, '.aside .tabs-list .item');
	return until(async () => (await text('.aside h1')) === name, 5000);
}
/** Act as vault `name`, from the switcher at the foot. */
async function actAs(name) {
	if (!(await page.$('.switcher .menu'))) await page.click('.switcher .pill');
	const ok = await page.evaluate((name) => {
		const all = [...document.querySelectorAll('.switcher .menu button')];
		const el = all.find((b) => b.querySelector('.who b')?.textContent?.trim() === name);
		if (el instanceof HTMLElement) el.click();
		return !!el;
	}, name);
	if (!ok) check(`the switcher offers to act as ${name}`, false);
	return until(async () => (await text('.switcher .pill b')) === name, 5000);
}
/** The note titled `title`, as `.main` shows it: its words, whether it is editable, and its holders. */
const note = (title) =>
	page.evaluate((title) => {
		const el = [...document.querySelectorAll('.main .note')].find((n) => n.querySelector('b')?.textContent === title);
		if (!el) return null;
		const chips = [...el.querySelectorAll('.who .chip')].map((c) => c.textContent?.replace(/\s+/g, ' ').trim());
		const words = el.querySelector('.text')?.textContent ?? /** @type {HTMLTextAreaElement} */ (el.querySelector('textarea'))?.value;
		return { words, editable: !!el.querySelector('textarea'), chips };
	}, title);

const NOTE = 'Hello from Alice';
const BODY = 'Only Bob may read this.';
const TODO = 'Plant the north beds';

try {
	await page.goto(`${base}/app/avendb/?${new URLSearchParams({ relay, server })}`, { waitUntil: 'domcontentloaded' });
	check('it opens on the account, offering the maiaCITY passkey', await waitText('Use my maiaCITY passkey'));
	check('named after the person', (await shown('.account .lead h1'))[0] === 'Samuel', (await shown('.account .lead h1'))[0]);
	check('no simulated Lab on the page', !(await page.$('.rail')) && !(await text()).includes('Lab'));
	const name = await page.$eval('.account .name input', (e) => /** @type {HTMLInputElement} */ (e).value);
	check('this browser has a name of its own', /on Linux|on Mac|Chrome/.test(name), name);
	await shot('1-new');

	// the passkey of maiaCITY's sign-up: made before, with PRF, for the same relying party
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
	const before = await ceremonies();
	await click('Use my maiaCITY passkey');
	const t = Date.now();
	const open = await page.waitForSelector('.shell', { timeout: 180000 }).then(() => true, () => false);
	check(`the vault is founded, in ${((Date.now() - t) / 1000).toFixed(1)} s`, open, await problem());
	check('in three ceremonies', (await ceremonies()) - before === 3, `${(await ceremonies()) - before}`);
	check('its vault and avenCEO named, in the bar', await until(() => hasAll(['Samuel', 'avenCEO'])), (await bar()).join(', '));
	check('naming them took no ceremony', (await ceremonies()) - before === 3, `${(await ceremonies()) - before}`);
	check('the person’s own vault first', (await bar())[0] === 'Samuel', (await bar()).join(', '));
	check('quantum-proof: post-quantum only', (await text('.aside')).includes('Post-quantum only'));
	check('acting as Samuel', (await text('.switcher .pill b')) === 'Samuel', await text('.switcher .pill b'));
	check('no error', !(await problem()), await problem());
	await shot('2-founded');

	await click('Owners & devices', '.aside .tabs-list .item');
	check('it owns avenCEO', (await text('.main')).includes('It owns') && (await text('.main')).includes('avenCEO'));
	const devices = () => shown('.main .list li b');
	check('its devices: this browser, by its name', await until(async () => (await devices()).includes(name)), (await devices()).join(', '));
	await click('Rename', '.main .list li button');
	await type('.main .list li input', 'Samuel’s test browser');
	await click('Save', '.main .list li button');
	const renamed = await until(async () => (await devices()).includes('Samuel’s test browser'));
	check('a new name, on its card', renamed, (await devices()).join(', '));
	await shot('3-devices');

	// the cast to enact: four vaults Samuel's vault owns, in one ceremony
	const founding = await ceremonies();
	await page.click('.bar .add');
	await page.waitForSelector('.dialog');
	const rows = await page.$$eval('.dialog input', (els) => els.map((e) => /** @type {HTMLInputElement} */ (e).value));
	check('it offers avenALICE, avenBOB, avenCHARLY and Maia City COOP', rows.join() === SIX.slice(2).join(), rows.join(', '));
	await shot('4-new-vaults');
	await click('Create 4 vaults', '.dialog button');
	check('six vaults in the bar', await until(() => hasAll(SIX), 120000), (await bar()).join(', '));
	check('in one ceremony', (await ceremonies()) - founding === 1, `${(await ceremonies()) - founding}`);
	check('the dialog closed, no error', !(await page.$('.dialog')) && !(await problem()), await problem());
	await page.click('.switcher .pill');
	const actors = await shown('.switcher .menu button b');
	check('Samuel may act as any of them', SIX.every((n) => actors.includes(n)), actors.join(', '));
	await shot('5-six-vaults');

	// avenALICE writes a note and a todo in her home, and shares the note with avenBOB
	check('acting as avenALICE', await actAs('avenALICE'), await text('.switcher .pill b'));
	check('looking at her vault', (await text('.aside h1')) === 'avenALICE', await text('.aside h1'));
	check('she owns her home', await waitText('avenALICE owns it', 5000, '.main'));
	await type('.compose input.field', NOTE);
	await type('.compose textarea', BODY);
	await click('Write the note', '.compose button');
	check('her note', await until(async () => (await note(NOTE))?.words === BODY), JSON.stringify(await note(NOTE)));
	await type('.compose .row input', TODO);
	await click('Add the todo', '.compose button');
	check('her todo', await waitText(TODO, 30000, '.main .todos'));
	await click('Open', '.main .todos .tick');
	check('marked doing', await waitText('Doing', 30000, '.main .todos'));
	const sharing = await ceremonies();
	await click('Share', '.main .note .who button');
	await choose('.main .note .share select[aria-label="Share with"]', 'avenBOB');
	await choose('.main .note .share select[aria-label="Role"]', 'reads');
	await click('Share it', '.main .note .share button');
	const shared = await until(async () => (await note(NOTE))?.chips.includes('avenBOB reads'));
	check('shared with avenBOB, who reads it', shared, (await note(NOTE))?.chips.join(', '));
	check('sharing took no ceremony', (await ceremonies()) === sharing, `${(await ceremonies()) - sharing}`);
	await shot('6-alice');

	// avenBOB reads the note, and nothing else of hers
	check('acting as avenBOB', await actAs('avenBOB'));
	await look('avenALICE');
	const bob = await note(NOTE);
	check('he reads her note', bob?.words === BODY, JSON.stringify(bob));
	check('and may not edit it', bob && !bob.editable, JSON.stringify(bob));
	check('her todo stays hidden', !(await text('.main')).includes(TODO));
	check('he writes nothing new there', !(await page.$('.main .compose')));
	await shot('7-bob');

	// avenCHARLY: nothing of hers
	check('acting as avenCHARLY', await actAs('avenCHARLY'));
	await look('avenALICE');
	const none = /avenCHARLY can't see the 2 entries in avenALICE's home/.test(await text('.main'));
	check('he sees none of her 2 entries', !(await note(NOTE)) && none, (await text('.main')).slice(0, 300));
	const dim = await page.$eval('.bar .slot[aria-label="avenALICE"] .mark', (e) => e.classList.contains('dim'));
	check('her mark faded for him', dim);
	await shot('8-charly');
	await click('Act as avenALICE', '.main .empty button');
	check('from there, one click acts as her', await until(async () => (await text('.switcher .pill b')) === 'avenALICE', 5000));

	// who receives her home: this browser opens it, avenCEO's server only relays its ciphertext
	await look('avenALICE', 'Sync');
	const sync = await text('.main');
	check('this browser opens her home', sync.includes('Samuel’s test browser') && sync.includes('opens it'), sync.slice(0, 400));
	check('avenCEO’s server relays its ciphertext only', /avenCEO's server.*relays its ciphertext only/.test(sync), sync.slice(0, 400));
	await shot('9-sync');

	// as avenALICE: the coop owns her home too, which her owner's passkey approves; revoking avenBOB's read needs none
	await look('avenALICE', 'Access');
	const owning = await ceremonies();
	await choose('.main select[aria-label="Share with"]', 'Maia City COOP');
	await choose('.main select[aria-label="Role"]', 'owns (your passkey approves)');
	await click('Share', '.main .card button.primary');
	const coop = await until(async () => /Maia City COOP owns/.test(await text('.main')), 60000);
	check('the coop owns her home', coop, await problem());
	check('in one ceremony', (await ceremonies()) - owning === 1, `${(await ceremonies()) - owning}`);
	const revoking = await ceremonies();
	const revoked = await page.evaluate(() => {
		const li = [...document.querySelectorAll('.main .grants li')].find((l) => l.textContent?.includes('avenBOB'));
		const button = li?.querySelector('button');
		button?.click();
		return !!button;
	});
	check('she may revoke avenBOB’s read', revoked);
	const gone = await until(async () => !(await shown('.main .grants li')).some((l) => l?.includes('avenBOB')));
	check('revoked', gone, (await shown('.main .grants li')).join(' | '));
	check('with no ceremony', (await ceremonies()) === revoking, `${(await ceremonies()) - revoking}`);
	await shot('10-access');
	await actAs('avenBOB');
	await look('avenALICE');
	check('avenBOB no longer reads her note', !(await note(NOTE)));

	// the coop: owned by Samuel, with no devices
	await actAs('Samuel');
	await look('Maia City COOP', 'Owners & devices');
	check('the coop is owned by Samuel', (await text('.aside')).includes('Owned by Samuel'), await text('.aside'));
	check('and has no devices', (await text('.main')).includes('A coop has no devices'));
	await shot('11-coop');

	// a phone: the bar on top, the switcher above the app's own buttons, nothing wider than the screen
	await page.setViewport({ width: 390, height: 844 });
	await look('avenALICE');
	const fits = await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);
	check('on a phone, nothing wider than the screen', fits);
	await shot('12-phone');
	await page.setViewport(wide);

	// the store kept it: after a reload it unlocks with one ceremony, every vault there
	await page.reload({ waitUntil: 'domcontentloaded' });
	check('after a reload, it asks to unlock', await waitText('Unlock your account'));
	const unlocking = await ceremonies();
	await click('Unlock', '.account button');
	check('it opens again', await page.waitForSelector('.shell', { timeout: 120000 }).then(() => true, () => false), await problem());
	check('in one ceremony', (await ceremonies()) - unlocking === 1, `${(await ceremonies()) - unlocking}`);
	check('every vault there', await until(() => hasAll(SIX)), (await bar()).join(', '));
	await actAs('avenALICE');
	check('her note there', await until(async () => (await note(NOTE))?.words === BODY, 30000));
	check('and no error', !(await problem()), await problem());
	await shot('13-again');

	// forgotten here, the account comes back for the passkey alone: the server hands this browser the vault's log
	await actAs('Samuel');
	await look('Samuel', 'Owners & devices');
	page.once('dialog', (d) => d.accept());
	await click('Forget my account on this browser');
	check('forgotten, it offers to sign in', await waitText('Sign in with my passkey'));
	const signing = await ceremonies();
	await click('Sign in with my passkey', '.account button');
	const back = await page.waitForSelector('.shell', { timeout: 180000 }).then(() => true, () => false);
	check('signed in again, through the server', back, await problem());
	check('in four ceremonies', (await ceremonies()) - signing === 4, `${(await ceremonies()) - signing}`);
	check('every vault came back', await until(() => hasAll(SIX), 120000), (await bar()).join(', '));
	await click('Owners & devices', '.aside .tabs-list .item');
	const both = async () => (await devices()).includes(name) && (await devices()).includes('Samuel’s test browser');
	check('its devices: the one forgotten, and this browser again', await until(both), (await devices()).join(', '));
	await actAs('avenALICE');
	check('her note came back', await until(async () => (await note(NOTE))?.words === BODY, 60000), JSON.stringify(await note(NOTE)));
	check('no error after signing in', !(await problem()), await problem());
	await shot('14-signed-in');
} catch (e) {
	check(`the walk through finishes: ${e instanceof Error ? e.message : e}`, false);
	await page.screenshot({ path: `${out}/failed.png` }).catch(() => {});
} finally {
	await browser.close();
}

const failed = checks.filter((c) => !c.ok);
console.log(`\n${checks.length - failed.length} of ${checks.length} checks green; screenshots in ${out}`);
process.exit(failed.length ? 1 : 0);

function sleep(ms) {
	return new Promise((r) => setTimeout(r, ms));
}
