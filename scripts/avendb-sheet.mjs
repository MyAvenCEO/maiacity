/*
 * The Mac app's passkey sign-in sheet, end to end in a headless Chrome: /app/avendb/ as maiaCITY Studio runs it, the
 * app's Tauri bridge (`__TAURI_INTERNALS__`) played by this test, against an avenDB server on this machine. The app's
 * web view may not use maia.city's passkeys, so every ceremony runs in its sign-in sheet: maia.city's sheet page
 * (/app/avendb/sheet/, here the dev server's) in a frame over the app, as the app's `passkey_sheet` command shows it in
 * macOS's sign-in sheet (vault/app/src/passkey.rs); the frame's way back to `city.maia.studio://` is caught and handed
 * to the app's page, as the sheet hands it to the app. The person founds their vault in three sheets, creates a vault
 * in one, and opens the account again after a reload in one; what each sheet sends back is sealed to the app's page,
 * so no PRF output crosses open. Each step is screenshot.
 *
 * Run as scripts/avendb-account.mjs is, against a fresh server (its header has the recipe):
 *
 *   BASE=http://localhost:5173 RELAY=http://localhost:3360 SERVER=AVENDB1… node scripts/avendb-sheet.mjs [--out dir]
 */
import { existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import puppeteer from 'puppeteer-core';

const arg = (name, fallback) => {
	const at = process.argv.indexOf(name);
	return at > 0 ? process.argv[at + 1] : fallback;
};
const out = resolve(arg('--out', 'build/avendb-sheet'));
mkdirSync(out, { recursive: true });
const { BASE: base, RELAY: relay, SERVER: server } = process.env;
if (!base || !relay || !server) throw new Error('BASE, RELAY and SERVER: the dev server, the test server’s relay and offer');
const chrome =
	process.env.CHROME ??
	['/opt/pw-browsers/chromium', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].find((p) => existsSync(p));
if (!chrome) throw new Error('No Chrome found: set CHROME to one.');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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

// The app's bridge, in the app's page alone: its API calls answer as Samuel, a founder, and `passkey_sheet` shows the
// sheet's page in a frame over the app. In the sheet's frame: the PRF outputs its ceremony brings are noted (to look for
// them in what it sends back), it can be made to wait a moment (for a screenshot), and its way back to the app's scheme
// is caught and handed to the app's page.
await page.evaluateOnNewDocument(() => {
	if (window === window.top) {
		const founder = { id: 'account', number: 1, name: 'Samuel', since: '2026-01-01', role: 'founder', caps: ['media:admin'] };
		/** @param {string} url */
		const sheet = (url) =>
			new Promise((resolve, reject) => {
				if (!url.startsWith('https://maia.city/app/avendb/sheet/')) return reject('the sheet shows maia.city’s page alone');
				const w = /** @type {any} */ (window);
				w.__sheets = [...(w.__sheets ?? []), url];
				const frame = document.createElement('iframe');
				frame.className = 'sign-in-sheet';
				frame.setAttribute(
					'style',
					'position:fixed;inset:8% 22%;width:56%;height:70%;z-index:1000;border:0;border-radius:14px;box-shadow:0 20px 60px rgb(0 0 0 / .35)'
				);
				w.__sheetBack = (/** @type {string} */ back) => {
					w.__backs = [...(w.__backs ?? []), back];
					frame.remove();
					resolve(back);
				};
				frame.src = url.replace('https://maia.city', location.origin);
				document.body.append(frame);
			});
		/** @type {any} */ (window).__TAURI_INTERNALS__ = {
			invoke: async (/** @type {string} */ cmd, /** @type {any} */ args) => {
				if (cmd === 'api') return args.path === '/api/me' ? { status: 200, body: founder } : { status: 404, body: { error: 'not here' } };
				if (cmd === 'passkey_sheet') return sheet(args.url);
				// the vault's open questions (AskModal): none
				if (cmd === 'asks_open') return [];
				return null;
			},
			transformCallback: (/** @type {Function} */ callback) => {
				const id = Math.floor(Math.random() * 2 ** 32);
				/** @type {any} */ (window)[`_${id}`] = callback;
				return id;
			},
			unregisterCallback: (/** @type {number} */ id) => delete (/** @type {any} */ (window)[`_${id}`]),
			convertFileSrc: (/** @type {string} */ path) => path
		};
		/** @type {any} */ (window).__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener() {} };
		return;
	}
	const top = /** @type {any} */ (window.top);
	const get = navigator.credentials.get.bind(navigator.credentials);
	navigator.credentials.get = async (o) => {
		await new Promise((r) => setTimeout(r, top.__sheetPause ?? 0));
		const credential = /** @type {any} */ (await get(o));
		const prf = credential?.getClientExtensionResults().prf?.results ?? {};
		for (const x of [prf.first, prf.second].filter(Boolean)) top.__prfs = [...(top.__prfs ?? []), Array.from(new Uint8Array(x))];
		return credential;
	};
	/** @type {any} */ (window).navigation?.addEventListener('navigate', (/** @type {any} */ e) => {
		if (!e.destination.url.startsWith('city.maia.studio:')) return;
		e.preventDefault();
		top.__sheetBack(e.destination.url);
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
const shot = async (name) => {
	await sleep(400);
	await page.screenshot({ path: `${out}/${name}.png` });
};
const problem = () => page.evaluate(() => document.querySelector('[role=alert]')?.textContent?.trim() ?? '');
const ceremonies = async () => (await cdp.send('WebAuthn.getCredentials', { authenticatorId })).credentials[0]?.signCount ?? 0;
/** how many sheets the app has shown, and what they sent back */
const sheets = () => page.evaluate(() => /** @type {any} */ (window).__sheets?.length ?? 0);
const bar = () => page.$$eval('.bar .slot[aria-label]:not(.add)', (els) => els.map((e) => e.getAttribute('aria-label')));

/** Whether every answer the sheets sent back is sealed alone: the sealed box, and no PRF output a sheet's ceremony brought. */
async function sealed() {
	const { backs, prfs } = await page.evaluate(() => ({
		backs: /** @type {string[]} */ (/** @type {any} */ (window).__backs ?? []),
		prfs: /** @type {number[][]} */ (/** @type {any} */ (window).__prfs ?? [])
	}));
	const b64 = (/** @type {number[]} */ bytes) => Buffer.from(bytes).toString('base64url');
	return (
		backs.length > 0 &&
		prfs.length >= backs.length &&
		backs.every((back) => {
			const answer = new URLSearchParams(back.split('#')[1] ?? '');
			const box = Buffer.from(answer.get('sealed') ?? '', 'base64url');
			const open = prfs.some((p) => box.includes(Buffer.from(p)) || back.includes(b64(p)));
			return back.startsWith('city.maia.studio://avendb#') && [...answer.keys()].join() === 'sealed' && box.length > 1120 && !open;
		})
	);
}

try {
	await page.goto(`${base}/app/avendb/?${new URLSearchParams({ relay, server })}`, { waitUntil: 'domcontentloaded' });
	check('the app opens on the account', await waitText('Use my maiaCITY passkey'));
	check('named after the person, through the app’s API', (await text('.account .lead h1')) === 'Samuel', await text('.account .lead h1'));
	const name = await page.$eval('.account .name input', (e) => /** @type {HTMLInputElement} */ (e).value);
	check('it names itself the app', name === 'maiaCITY Studio on Mac', name);
	await shot('1-app');

	// maiaCITY's passkey, made before at maia.city (here: localhost), with PRF
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

	// founding: the unlock, the pass, the vault and this device, each in a sheet
	const before = await ceremonies();
	await page.evaluate(() => (/** @type {any} */ (window).__sheetPause = 1500));
	await click('Use my maiaCITY passkey');
	check('the sign-in sheet shows over the app', await until(() => page.$('iframe.sign-in-sheet').then(Boolean), 15000));
	check('saying the sheet asks', await waitText('a sign-in sheet asks for your passkey three times', 5000), await text('.account [role=status]'));
	await sleep(500);
	await shot('2-sheet');
	await page.evaluate(() => (/** @type {any} */ (window).__sheetPause = 0));
	const t = Date.now();
	const open = await page.waitForSelector('.shell', { timeout: 180000 }).then(() => true, () => false);
	check(`the vault is founded through the sheets, in ${((Date.now() - t) / 1000).toFixed(1)} s`, open, await problem());
	check('in three sheets', (await sheets()) === 3, `${await sheets()}`);
	check('and three ceremonies', (await ceremonies()) - before === 3, `${(await ceremonies()) - before}`);
	check('each answer sealed: no PRF output crosses open', await sealed());
	check('its vault and avenCEO named, in the bar', await until(async () => (await bar()).join() === 'Samuel,avenCEO'), (await bar()).join(', '));
	check('no error', !(await problem()), await problem());
	await shot('3-founded');

	// a new vault: one ceremony, in one sheet
	const [creating, shown] = [await ceremonies(), await sheets()];
	await page.click('.bar .add');
	await page.waitForSelector('.dialog');
	const field = await page.$('.dialog input');
	await field?.type('avenALICE');
	await click('Create 1 vault', '.dialog button');
	check('a new vault, in the bar', await until(async () => (await bar()).includes('avenALICE'), 120000), (await bar()).join(', '));
	check('in one sheet and one ceremony', (await sheets()) - shown === 1 && (await ceremonies()) - creating === 1);
	check('sealed too', await sealed());
	await shot('4-new-vault');

	// opened again after a reload: the unlock, in one sheet
	await page.reload({ waitUntil: 'domcontentloaded' });
	check('after a reload, it asks to unlock', await waitText('Unlock your account'));
	const unlocking = await ceremonies();
	await click('Unlock', '.account button');
	check('it opens again', await page.waitForSelector('.shell', { timeout: 120000 }).then(() => true, () => false), await problem());
	check('in one sheet and one ceremony', (await sheets()) === 1 && (await ceremonies()) - unlocking === 1, `${await sheets()}`);
	check('every vault there', await until(async () => (await bar()).includes('avenALICE')), (await bar()).join(', '));
	check('sealed too ', await sealed());
	await shot('5-unlocked');

	// the sheet's page opened by itself: nothing to confirm
	await page.goto(`${base}/app/avendb/sheet/`, { waitUntil: 'domcontentloaded' });
	check('the sheet’s page alone asks nothing', await waitText('Nothing to confirm here', 15000, 'main.sheet'));
	await shot('6-sheet-alone');
} catch (e) {
	check(`the walk through finishes: ${e instanceof Error ? e.message : e}`, false);
	await page.screenshot({ path: `${out}/failed.png` }).catch(() => {});
} finally {
	await browser.close();
}

const failed = checks.filter((c) => !c.ok);
console.log(`\n${checks.length - failed.length} of ${checks.length} checks green; screenshots in ${out}`);
process.exit(failed.length ? 1 : 0);
