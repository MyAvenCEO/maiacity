/*
 * avenDB's native device in the Mac app, end to end, without a Mac: the app's avenDB page in a headless Chrome, as the
 * app's web view shows it, its calls to the app answered here as the app answers them (vault/app/src/avendb.rs): each
 * `avendb` call goes to the native device (avendb-device), which this runs as the app does, and each sign-in sheet it
 * asks for is answered by a passkey of maia.city's, sealed as the sheet's page seals it (avendb-browser's
 * `sealCeremony`, from the page's own module), against an avenDB server on this machine. The person founds their vault
 * from the "Mac" in three sheets; the page shows the device native, on its own UDP sockets; reloaded, it opens with no
 * sheet, as the device runs on; the app quits and starts again, and the device opens from its folder in one sheet; it
 * is renamed; forgotten, its store is put aside in its folder, and the person signs in again through the server in
 * four sheets. Each step is screenshot.
 *
 *   cd avendb && cargo build -p avendb-server -p avendb-device
 *   AVENDB_DATA=$(mktemp -d) AVENDB_BIND=127.0.0.1:7421 AVENDB_RELAY_BIND=127.0.0.1:3360 \
 *     AVENDB_RELAY_URL=http://localhost:3360 target/debug/avendb-server     (it logs its offer)
 *   BASE=http://localhost:5173 RELAY=http://localhost:3360 SERVER=AVENDB1… node scripts/avendb-native.mjs [--out dir]
 *
 * DEVICE=/path/to/avendb-device, else avendb/target/debug/avendb-device. CHROME=/path/to/chrome, else
 * /opt/pw-browsers/chromium, or Chrome on a Mac.
 */
import { spawn } from 'node:child_process';
import { createHash, createHmac, generateKeyPairSync, randomBytes, sign } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { pathToFileURL } from 'node:url';
import puppeteer from 'puppeteer-core';

const arg = (name, fallback) => {
	const at = process.argv.indexOf(name);
	return at > 0 ? process.argv[at + 1] : fallback;
};
const out = resolve(arg('--out', 'build/avendb-native'));
mkdirSync(out, { recursive: true });
const { BASE: base, RELAY: relay, SERVER: server } = process.env;
if (!base || !relay || !server) throw new Error('BASE, RELAY and SERVER: the dev server, the test server’s relay and offer');
const binary = resolve(process.env.DEVICE ?? 'avendb/target/debug/avendb-device');
if (!existsSync(binary)) throw new Error(`No avendb-device at ${binary}: build it, or set DEVICE`);
const chrome =
	process.env.CHROME ??
	['/opt/pw-browsers/chromium', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].find((p) => existsSync(p));
if (!chrome) throw new Error('No Chrome found: set CHROME to one.');
const origin = new URL(base).origin;
const folder = mkdtempSync(join(tmpdir(), 'avendb-native-'));

const checks = [];
const check = (what, ok, found = '') => {
	checks.push({ what, ok: !!ok, found });
	console.log(`${ok ? '✓' : '✕'} ${what}${ok || !found ? '' : ` (found: ${found})`}`);
};

const b64url = (/** @type {Uint8Array} */ b) => Buffer.from(b).toString('base64url');
const unb64url = (/** @type {string} */ s) => new Uint8Array(Buffer.from(s, 'base64url'));
const sha256 = (/** @type {Uint8Array | string} */ b) => createHash('sha256').update(b).digest();

// the sheet page's seal, from the page's own module
const device = resolve('src/lib/avendb/device');
const avendb = await import(pathToFileURL(join(device, 'avendb_browser.js')).href);
await avendb.default({ module_or_path: readFileSync(join(device, 'avendb_browser_bg.wasm')) });

/** The person's passkey of maia.city, as their platform's authenticator holds it: P-256, user verified, with PRF. */
const passkey = (() => {
	const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
	const [secret, id] = [randomBytes(32), b64url(randomBytes(16))];
	let counter = 0;
	const prf = (/** @type {Uint8Array} */ salt) => new Uint8Array(createHmac('sha256', secret).update(salt).digest());
	return {
		id,
		/** A ceremony over `challenge` on maia.city, as the sheet's page brings it back. */
		ceremony(/** @type {Uint8Array} */ challenge, /** @type {Uint8Array} */ salt, /** @type {Uint8Array=} */ deviceSalt) {
			counter += 1;
			const count = Buffer.alloc(4);
			count.writeUInt32BE(counter);
			const authenticatorData = Buffer.concat([sha256('maia.city'), Buffer.from([0x05]), count]);
			const client = { type: 'webauthn.get', challenge: b64url(challenge), origin: 'https://maia.city', crossOrigin: false };
			const clientDataJSON = Buffer.from(JSON.stringify(client));
			const signature = sign('sha256', Buffer.concat([authenticatorData, sha256(clientDataJSON)]), privateKey);
			return {
				id,
				authenticatorData: new Uint8Array(authenticatorData),
				clientDataJSON: new Uint8Array(clientDataJSON),
				signature: new Uint8Array(signature),
				prf: prf(salt),
				devicePrf: deviceSalt ? prf(deviceSalt) : undefined
			};
		}
	};
})();

/** The app's side of the native device: started on the folder, each call answered, each sheet shown. */
class App {
	constructor() {
		this.child = spawn(binary, ['--dir', folder], { stdio: ['pipe', 'pipe', 'inherit'] });
		/** @type {Map<number, { resolve: (v: any) => void, reject: (e: string) => void }>} */
		this.waiting = new Map();
		this.next = 0;
		/** what each sheet was for, since last asked */
		this.asked = [];
		this.ended = new Promise((r) => this.child.on('exit', r));
		createInterface({ input: this.child.stdout }).on('line', (line) => this.read(JSON.parse(line)));
	}

	/** @param {any} m */
	read(m) {
		if (typeof m.sheet === 'number') return this.sheet(m.sheet, m.url);
		const call = this.waiting.get(m.id);
		this.waiting.delete(m.id);
		if ('ok' in m) call?.resolve(m.ok);
		else call?.reject(m.error);
	}

	/** Sheet `n`, maia.city's sheet page at `url`: the ceremony its fragment asks for, sealed to its key. */
	sheet(/** @type {number} */ n, /** @type {string} */ url) {
		const q = new URLSearchParams(url.split('#')[1] ?? '');
		this.asked.push(q.get('what'));
		const challenge = unb64url(q.get('challenge') ?? '');
		const salt = unb64url(q.get('salt') ?? '');
		const deviceSalt = q.get('device') ? unb64url(q.get('device') ?? '') : undefined;
		const sealed = avendb.sealCeremony(unb64url(q.get('key') ?? ''), challenge, passkey.ceremony(challenge, salt, deviceSalt));
		this.say({ sheet: n, back: `city.maia.studio://avendb#${new URLSearchParams({ sealed: b64url(sealed) })}` });
	}

	say(/** @type {any} */ m) {
		this.child.stdin.write(`${JSON.stringify(m)}\n`);
	}

	/** @param {string} call @param {unknown[]} args */
	call(call, args) {
		const id = ++this.next;
		return new Promise((resolve, reject) => {
			this.waiting.set(id, { resolve, reject });
			this.say({ id, call, args });
		});
	}

	/** The sheets since the last ask. */
	sheets() {
		return this.asked.splice(0);
	}

	/** The app quits: the device's stdin ends, and it closes its store. */
	async quit() {
		this.child.stdin.end();
		await this.ended;
	}
}

let app = new App();

const browser = await puppeteer.launch({ executablePath: chrome, headless: true, args: ['--no-sandbox'] });
const page = await browser.newPage();
await page.setViewport({ width: 1300, height: 1000 });
page.on('pageerror', (e) => check(`no error on the page: ${e.message}`, false));
// the app's web view: its commands answered here, as the app answers them
const founder = { id: 'account', number: 1, name: 'Samuel', since: '2026-01-01', role: 'founder', caps: ['media:admin'] };
await page.exposeFunction('__app', async (/** @type {string} */ cmd, /** @type {any} */ args) => {
	try {
		if (cmd === 'avendb') return { ok: await app.call(args.call, args.args) };
		if (cmd === 'api' && args.path === '/api/me') return { ok: { status: 200, body: founder } };
		if (cmd === 'log_js') return { ok: null };
		if (cmd === 'plugin:event|listen') return { ok: Math.floor(Math.random() * 1e9) };
		if (cmd.startsWith('plugin:event|')) return { ok: null };
		return { error: `no ${cmd} in this test` };
	} catch (e) {
		return { error: String(e) };
	}
});
await page.evaluateOnNewDocument(() => {
	/** @type {any} */ (window).__TAURI_INTERNALS__ = {
		invoke: (/** @type {string} */ cmd, /** @type {any} */ args) =>
			/** @type {any} */ (window).__app(cmd, args ?? {}).then((/** @type {any} */ r) => {
				if ('error' in r) throw r.error;
				return r.ok;
			}),
		transformCallback: () => Math.floor(Math.random() * 1e9),
		unregisterCallback: () => {},
		convertFileSrc: (/** @type {string} */ p) => p
	};
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
/** the vaults in the bar, by name, the person's own first */
const bar = () => page.$$eval('.bar .slot[aria-label]:not(.add)', (els) => els.map((e) => e.getAttribute('aria-label')));
const opened = () => page.waitForSelector('.shell', { timeout: 180000 }).then(() => true, () => false);
const devices = () => shown('.main .list li b');
const at = `${base}/app/avendb/?${new URLSearchParams({ relay, server })}`;

try {
	await page.goto(at, { waitUntil: 'domcontentloaded' });
	check('it opens on the account, offering the maiaCITY passkey', await waitText('Use my maiaCITY passkey'));
	check('with no passkey made in the app', !(await text()).includes('Make a new passkey'));
	check('this Mac, by name', (await shown('.account .card h3')).includes('This Mac'), (await shown('.account .card h3')).join(', '));
	const name = await page.$eval('.account .name input', (e) => /** @type {HTMLInputElement} */ (e).value);
	check('named as the app', name === 'maiaCITY Studio on Mac', name);
	await shot('1-new');

	await click('Use my maiaCITY passkey');
	check('the vault is founded natively', await opened(), await problem());
	check('in three sheets: unlock, pass, found', app.sheets().join(',') === 'unlock,pass,found');
	check('its vault and avenCEO in the bar', await until(async () => (await bar()).includes('avenCEO')), (await bar()).join(', '));
	check('no error', !(await problem()), await problem());
	await shot('2-founded');

	await click('Owners & devices', '.aside .tabs-list .item');
	check('this Mac among its devices', await until(async () => (await devices()).includes(name)), (await devices()).join(', '));
	const native = await text('.main');
	check('shown native, on UDP sockets of its own', native.includes('Native') && /\d+ UDP sockets?/.test(native), native);
	check('the link for the next device is the site’s', (await page.$eval('.main input.code', (e) => /** @type {HTMLInputElement} */ (e).value)).startsWith('https://maia.city/app/avendb/?link='));
	await shot('3-native');

	// the page reloads: the device ran on, and opens with no sheet
	await page.reload({ waitUntil: 'domcontentloaded' });
	check('reloaded, it opens at once', await opened(), await problem());
	check('with no sheet', app.sheets().length === 0);

	// the app quits and starts again: the device opens from its folder, in the unlock alone
	await app.quit();
	check('the folder keeps it', existsSync(join(folder, 'meta.json')) && existsSync(join(folder, 'store')));
	app = new App();
	await page.reload({ waitUntil: 'domcontentloaded' });
	check('the app started again: unlock it on this Mac', await waitText('Your account is on this Mac'));
	await click('Unlock');
	check('it opens from its folder', await opened(), await problem());
	check('in one sheet', app.sheets().join(',') === 'unlock');

	await click('Owners & devices', '.aside .tabs-list .item');
	await until(async () => (await devices()).includes(name));
	await click('Rename', '.main .list li button');
	await type('.main .list li input', 'Samuel’s test Mac');
	await click('Save', '.main .list li button');
	check('renamed, on its card', await until(async () => (await devices()).includes('Samuel’s test Mac')), (await devices()).join(', '));
	await shot('4-again');

	// forgotten here, its store is put aside; the passkey alone gets the vault back through the server
	page.once('dialog', (d) => d.accept());
	await click('Forget my account on this Mac');
	check('forgotten, it offers to sign in', await waitText('Sign in with my passkey'));
	const aside = existsSync(join(folder, 'aside')) ? readdirSync(join(folder, 'aside')) : [];
	check('its store put aside, not deleted', aside.some((a) => a.endsWith('-forgotten')) && !existsSync(join(folder, 'meta.json')), aside.join(', '));
	await click('Sign in with my passkey', '.account button');
	check('signed in again, through the server', await opened(), await problem());
	check('in four sheets: unlock, pass, hello, join', app.sheets().join(',') === 'unlock,pass,hello,join');
	check('its vault came back', await until(async () => (await bar()).includes('avenCEO'), 120000), (await bar()).join(', '));
	check('no error after signing in', !(await problem()), await problem());
	await shot('5-signed-in');
} catch (e) {
	check(`the walk through finishes: ${e instanceof Error ? e.message : e}`, false);
	await page.screenshot({ path: `${out}/failed.png` }).catch(() => {});
} finally {
	await browser.close();
	await app.quit();
}

const failed = checks.filter((c) => !c.ok);
console.log(`\n${checks.length - failed.length} of ${checks.length} checks green; screenshots in ${out}`);
process.exit(failed.length ? 1 : 0);

function sleep(ms) {
	return new Promise((r) => setTimeout(r, ms));
}
