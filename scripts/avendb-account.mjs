/*
 * The avenDB account's walk through, end to end: /app/avendb/ in a headless Chrome whose virtual authenticator holds a
 * passkey with PRF, against an avenDB server on this machine. The person signed up to maiaCITY with that passkey; the
 * account founds their vault with it in three ceremonies, claims the server, names this browser on its card, renames
 * it, and opens again after a reload in one ceremony; forgotten here, it comes back through the server for the passkey
 * alone, in four ceremonies. The Lab stays unmade until it is opened. Each step is screenshot.
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
await page.setViewport({ width: 1300, height: 1000 });
page.on('pageerror', (e) => check(`no error on the page: ${e.message}`, false));
const cdp = await page.createCDPSession();
await cdp.send('WebAuthn.enable', { enableUI: false });
const options = { protocol: 'ctap2', ctap2Version: 'ctap2_1', transport: 'internal', hasResidentKey: true };
const verified = { hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true, hasPrf: true };
const { authenticatorId } = await cdp.send('WebAuthn.addVirtualAuthenticator', { options: { ...options, ...verified } });
// /api/me answers as Samuel, a founder. Only that request is held (see avendb-smoke.mjs).
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

/** the account's text, as written (not as styled) */
const text = () => page.evaluate(() => document.querySelector('.account')?.textContent ?? '');
async function waitText(t, ms = 60000) {
	const until = Date.now() + ms;
	while (Date.now() < until) {
		if ((await text()).includes(t)) return true;
		await sleep(200);
	}
	return false;
}
/** Click the first `selector` whose words include `t`. */
async function click(t, selector = '.account button') {
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
const shot = async (name) => {
	await sleep(400);
	await page.screenshot({ path: `${out}/${name}.png` });
};
const shown = (selector) => page.$$eval(selector, (els) => els.map((e) => e.textContent?.replace(/\s+/g, ' ').trim()));
const problem = () => page.evaluate(() => document.querySelector('.account .error')?.textContent ?? '');
const ceremonies = async () => (await cdp.send('WebAuthn.getCredentials', { authenticatorId })).credentials[0]?.signCount ?? 0;

try {
	await page.goto(`${base}/app/avendb/?${new URLSearchParams({ relay, server })}`, { waitUntil: 'domcontentloaded' });
	check('it opens on the account, offering the maiaCITY passkey', await waitText('Use my maiaCITY passkey'));
	check('named after the person', (await shown('.account .lead h1'))[0] === 'Samuel', (await shown('.account .lead h1'))[0]);
	check('the Lab is not made until it is opened', !(await page.$('.rail .device')));
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
	const open = await waitText('Link another device', 180000);
	check(`the vault is founded, in ${((Date.now() - t) / 1000).toFixed(1)} s`, open, await problem());
	check('in three ceremonies', (await ceremonies()) - before === 3, `${(await ceremonies()) - before}`);
	check('no error', !(await problem()), await problem());
	check('it owns avenCEO', await waitText('Owns avenCEO', 30000));
	const devices = async () => shown('.account .devices li b');
	const named = async (n) => {
		for (let i = 0; i < 300 && !(await devices()).includes(n); i++) await sleep(200);
		return (await devices()).includes(n);
	};
	check('its devices: this browser, by its name', await named(name), (await devices()).join(', '));
	check('alone so far, so it says to link a second', await waitText('Only this browser so far'));
	await shot('2-account');

	await click('Rename');
	const input = await page.$('.account .devices li input');
	await input?.evaluate((e) => (/** @type {HTMLInputElement} */ (e).value = ''));
	await input?.type('Samuel’s test browser');
	await click('Save', '.account .devices button');
	check('a new name, on its card', await named('Samuel’s test browser'), (await devices()).join(', '));
	await shot('3-renamed');

	await click('Open the Lab', '.rail button');
	const made = await page.waitForSelector('.rail .device', { timeout: 240000 }).then(() => true, () => false);
	check('the Lab opens apart, with Alice and no Samuel', made && !(await shown('.rail .device span')).some((d) => d?.includes('Samuel')));
	await click('Your account', '.rail button');
	check('back on the account, still open', await waitText('Link another device', 5000));

	// the store kept it: after a reload it unlocks with one ceremony, under its new name
	await page.reload({ waitUntil: 'domcontentloaded' });
	check('after a reload, it asks to unlock', await waitText('Unlock your account'));
	const unlocking = await ceremonies();
	await click('Unlock');
	check('it opens again', await waitText('Link another device', 120000), await problem());
	check('in one ceremony', (await ceremonies()) - unlocking === 1, `${(await ceremonies()) - unlocking}`);
	check('still named', await named('Samuel’s test browser'), (await devices()).join(', '));
	check('and no error', !(await problem()), await problem());
	await shot('4-again');

	// forgotten here, the account comes back for the passkey alone: the server hands this browser the vault's log
	page.once('dialog', (d) => d.accept());
	await click('Forget my account on this browser');
	check('forgotten, it offers to sign in', await waitText('Sign in with my passkey'));
	const signing = await ceremonies();
	await click('Sign in with my passkey');
	check('signed in again, through the server', await waitText('Link another device', 180000), await problem());
	check('in four ceremonies', (await ceremonies()) - signing === 4, `${(await ceremonies()) - signing}`);
	check('the same account: it owns avenCEO', await waitText('Owns avenCEO', 30000));
	const both = async () => (await named(name)) && (await devices()).includes('Samuel’s test browser');
	check('its devices: the one forgotten, and this browser again', await both(), (await devices()).join(', '));
	check('no error after signing in', !(await problem()), await problem());
	await shot('5-signed-in');
} catch (e) {
	check(`the walk through finishes: ${e instanceof Error ? e.message : e}`, false);
} finally {
	await browser.close();
}

const failed = checks.filter((c) => !c.ok);
console.log(`\n${checks.length - failed.length} of ${checks.length} checks green; screenshots in ${out}`);
process.exit(failed.length ? 1 : 0);

function sleep(ms) {
	return new Promise((r) => setTimeout(r, ms));
}
