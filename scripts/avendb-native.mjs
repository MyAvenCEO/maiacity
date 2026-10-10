/*
 * avenDB's native device in the Mac app, end to end, without a Mac: the app's avenDB page in a headless Chrome, as the
 * app's web view shows it, its calls to the app answered here as the app answers them (vault/app/src/avendb.rs): each
 * `avendb` call goes to the native device (avendb-device), which this runs as the app does, and each sign-in sheet it
 * asks for is answered by a passkey of maia.city's, sealed as the sheet's page seals it (avendb-browser's
 * `sealCeremony`, from the page's own module), against an avenDB server on this machine. Signing in before they have an
 * account, as on a server that started fresh, the page names the button that sets one up; the person founds their vault
 * from the "Mac" in three sheets; the page shows the device native, on its own UDP sockets; reloaded, it opens with no
 * sheet, as the device runs on; the app quits and starts again, and the device opens from its folder in one sheet; it
 * is renamed. A note of theirs is titled, written, proposed on, accepted, undone and restored with no sheet. Their
 * vault founds avenALICE, avenBOB, avenCHARLY and Maia City COOP, named by hand, in one sheet, and the person acts as
 * each in turn: avenALICE writes a note and three todos, one tagged “work”, and shares the note alone with avenBOB, and
 * every todo tagged “work”, a rule: he reads the note and that todo, and one she tags “work” later, and finds her other
 * todo sealed in her studio, while avenCHARLY sees nothing of hers; her Sync page shows her cells, avenCEO's server
 * relaying their ciphertext; making the coop an owner of her whole vault takes one sheet, revoking avenBOB's caps none.
 * Forgotten, the device's store is put aside in its folder, and the person signs in again through the server in four
 * sheets, every vault and her note coming back. Last, the store becomes an earlier avenDB's: the device puts it aside,
 * and the page says it holds no vault and forgets it. Each step is screenshot.
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
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
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
const SIX = ['Samuel', 'avenCEO', 'avenALICE', 'avenBOB', 'avenCHARLY', 'Maia City COOP'];
const hasAll = async (/** @type {string[]} */ names) => {
	const now = await bar();
	return names.every((n) => now.includes(n));
};
/** Look at vault `name`'s page `tab`. */
async function look(name, tab = 'Notes') {
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
/** Go to page `label` of the vault looked at. */
const goTo = (label) => click(label, '.aside .tabs-list .item');
/** The note titled `title`, as the notes list shows it: its words, and who holds a role on it. */
const note = (title) =>
	page.evaluate((title) => {
		const el = [...document.querySelectorAll('.main .note')].find((n) => n.querySelector('.info b')?.textContent === title);
		if (!el) return null;
		const chips = [...el.querySelectorAll('.who .chip')].map((c) => c.textContent?.replace(/\s+/g, ' ').trim());
		return { words: el.querySelector('.thumb .page span')?.textContent ?? '', chips };
	}, title);
/** Open the note titled `title` from the notes list, on the whole screen. */
async function openNote(title) {
	await page.evaluate((title) => {
		const el = [...document.querySelectorAll('.main .note')].find((n) => n.querySelector('.info b')?.textContent === title);
		if (el instanceof HTMLElement) el.click();
	}, title);
	return until(async () => !!(await page.$('.shell.reading .doc .paper')), 10000);
}
/** Back from a note to the notes. */
async function back() {
	await page.click('.doc .top .back');
	return until(async () => !!(await page.$('.shell .main')), 10000);
}
/** The note's text on the line it shows: its editor's, or its words. */
const docText = () =>
	page.evaluate(() => {
		const paper = document.querySelector('.doc .paper');
		const field = paper?.querySelector('textarea');
		return field ? field.value : (paper?.querySelector('.text')?.textContent ?? null);
	});
/** The note's history on the line shown, newest first: what each edit did, and the words it put in. */
const edits = () =>
	page.$$eval('.doc .history li', (lis) =>
		lis.map((li) => ({
			what: li.querySelector('.what b')?.textContent?.trim() ?? '',
			ins: [...li.querySelectorAll('.diff ins')].map((e) => e.textContent)
		}))
	);
/** The line the note shows: Main, or a proposal's name. */
const onLine = () => text('.doc .versions .line.on b');
/** Set the note's text, and save it on the line it shows. @param {string} t */
async function saveText(t) {
	await page.$eval(
		'.doc .paper textarea',
		(e, t) => {
			/** @type {HTMLTextAreaElement} */ (e).value = t;
			e.dispatchEvent(new Event('input', { bubbles: true }));
		},
		t
	);
	await click('Save on', '.doc .top button');
	return until(async () => (await docText()) === t && !(await page.$('.doc .top .unsaved')), 30000);
}
/** Title the note `t` on the line it shows, as a docs app does: typed over, then Enter. @param {string} t */
async function retitle(t) {
	await type('.doc .top input.title', t);
	await page.keyboard.press('Enter');
	await sleep(250);
}
/** Pick the edit of the history whose words are `what` (and that put in `ins`, if given), then click `label` on it. */
async function onEdit(what, label = '', ins = null) {
	const ok = await page.evaluate(
		(what, ins) => {
			const li = [...document.querySelectorAll('.doc .history li')].find(
				(l) =>
					l.querySelector('.what b')?.textContent?.trim() === what &&
					(ins === null || [...l.querySelectorAll('.diff ins')].map((e) => e.textContent).join('|') === ins)
			);
			const button = li?.querySelector('button.what');
			if (button instanceof HTMLElement) button.click();
			return !!button;
		},
		what,
		ins
	);
	if (!ok) check(`the history has “${what}”`, false);
	await sleep(250);
	if (label) await click(label, '.doc .history li.on .actions button');
}
/** The studio's tables, each with its count of rows. */
const tablesShown = () =>
	page.$$eval('.main .tables button.t[data-table]', (els) =>
		Object.fromEntries(els.map((e) => [e.getAttribute('data-table'), Number(e.querySelector('small')?.textContent ?? 0)]))
	);
/** The table editor's rows, each as its columns name its cells. */
const gridRows = () =>
	page.$$eval('.main .grid tr.rec', (rows) =>
		rows.map((r) =>
			Object.fromEntries([...r.querySelectorAll('td[data-col]')].map((c) => [c.getAttribute('data-col'), c.textContent?.replace(/\s+/g, ' ').trim()]))
		)
	);
/** Pick the table `id` of the table editor. */
async function pickTable(id) {
	await page.click(`.main .tables button.t[data-table="${id}"]`).catch(() => check(`there is a ${id} table`, false));
	await sleep(250);
}
/** The todo titled `title`'s row in the todos list: its words. */
const todoRow = (title) =>
	page.evaluate((title) => {
		const li = [...document.querySelectorAll('.main .todos li')].find((l) => l.querySelector('.title')?.textContent === title);
		return li?.textContent?.replace(/\s+/g, ' ').trim() ?? null;
	}, title);

const NOTE = 'Hello from Alice';
const BODY = 'Only Bob may read this.';
const TODO = 'Plant the north beds';
const WORK = 'Fix the greenhouse door';
const LATER = 'Order seeds';

try {
	await page.goto(at, { waitUntil: 'domcontentloaded' });
	check('it opens on the account, offering the maiaCITY passkey', await waitText('Use my maiaCITY passkey'));
	check('with no passkey made in the app', !(await text()).includes('Make a new passkey'));
	check('this Mac, by name', (await shown('.account .card h3')).includes('This Mac'), (await shown('.account .card h3')).join(', '));
	const name = await page.$eval('.account .name input', (e) => /** @type {HTMLInputElement} */ (e).value);
	check('named as the app', name === 'maiaCITY Studio on Mac', name);
	await shot('1-new');

	// signing in with no account yet, as on a fresh server: the page names the button that sets one up
	await click('Sign in with my passkey', '.account button');
	const setUpFirst = () => problem().then((p) => p.includes('“Use my maiaCITY passkey”'));
	const named = await until(setUpFirst, 120000);
	check('signing in with no account names the button that sets one up', named, await problem());
	check('after three sheets: unlock, pass, hello', app.sheets().join(',') === 'unlock,pass,hello');
	await shot('1b-no-account');

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

	// a note as a docs app keeps one: titled, written, proposed on, accepted, undone and restored, with no sheet
	app.sheets();
	await goTo('Notes');
	await click('Blank note', '.main .start button');
	const addressed = await until(async () => /^#notes\/[0-9a-f]{64}$/.test(await page.evaluate(() => location.hash)), 30000);
	check('a blank note opens at an address of its own', addressed, await page.evaluate(() => location.hash));
	check('a page to write on', await until(async () => !!(await page.$('.shell.reading .doc .paper textarea')), 10000));
	await retitle('Plan');
	const titled = await until(async () => (await edits())[0]?.what === 'Renamed it “Plan”', 30000);
	check('titled “Plan”, an edit of its own', titled, JSON.stringify((await edits())[0]));
	check('written, and saved on main', await saveText('Plant beans.'), await docText());
	check('and saved again', await saveText('Plant beans and peas.'), await docText());
	await click('New proposal', '.doc .versions button');
	await type('#proposal-name', 'draft');
	await click('Propose', '.doc .versions .naming button');
	check('a proposal, draft, picked', await until(async () => (await onLine()) === 'draft'), await onLine());
	check('saved on the proposal', await saveText('Plant beans, peas and corn.'), await docText());
	await click('Accept into main', '.doc .banner button');
	const merged = until(async () => (await onLine()) === 'Main' && (await docText()) === 'Plant beans, peas and corn.');
	check('accepted: main reads the proposal', await merged, await docText());
	await onEdit('Edited on “draft”', 'Undo');
	check('the proposal’s edit undone on main', await until(async () => (await docText()) === 'Plant beans and peas.'), await docText());
	await onEdit('Edited', '', 'Plant beans.');
	await until(async () => (await text('.doc .paper.old .text')) === 'Plant beans.', 5000);
	await click('Restore this version', '.doc .banner.old button');
	check('the first version restored on main', await until(async () => (await docText()) === 'Plant beans.'), await docText());
	check('none of it asked for a sheet', app.sheets().length === 0);
	check('and no error', !(await problem()), await problem());
	await shot('5-note');
	await back();

	// four vaults Samuel's vault owns, named by hand, in one sheet
	await page.click('.bar .add');
	await page.waitForSelector('.dialog');
	for (const [i, n] of SIX.slice(2).entries()) {
		if (i) await click('Add another', '.dialog button');
		await type(`.dialog input[aria-label="Vault ${i + 1}'s name"]`, n);
	}
	await choose(`.dialog select[aria-label="Vault 4's kind"]`, 'Coop');
	await click('Create 4 vaults', '.dialog button');
	check('six vaults in the bar', await until(() => hasAll(SIX), 120000), (await bar()).join(', '));
	check('in one sheet', app.sheets().join(',') === 'approve');
	check('the dialog closed, no error', !(await page.$('.dialog')) && !(await problem()), await problem());
	await shot('6-six-vaults');

	// avenALICE writes a note and todos, and shares the note alone with avenBOB, and every todo tagged “work”
	check('acting as avenALICE', await actAs('avenALICE'), await text('.switcher .pill b'));
	await look('avenALICE');
	await click('Blank note', '.main .start button');
	check('her note opens', await until(async () => !!(await page.$('.doc .paper textarea')), 30000));
	await retitle(NOTE);
	check('titled', await until(async () => (await edits())[0]?.what === `Renamed it “${NOTE}”`, 30000), JSON.stringify((await edits())[0]));
	check('written', await saveText(BODY), await docText());
	await click('Share', '.doc .top button');
	await choose('.doc .sharebar select[aria-label="Share with"]', 'avenBOB');
	const least = await text('.doc .sharebar');
	check('sharing starts at the least: this note alone, to read', least.includes(`Only “${NOTE}”`) && least.includes('reads it'), least);
	await click('Share it', '.doc .sharebar button');
	const holders = () => page.$$eval('.doc .people .person', (els) => els.map((e) => e.getAttribute('title')));
	check('avenBOB reads it', await until(async () => (await holders()).includes('avenBOB reads it')), (await holders()).join(', '));
	await shot('7-alice-note');
	await back();
	check('her note, with avenBOB among its readers', (await note(NOTE))?.chips.includes('avenBOB reads'), JSON.stringify(await note(NOTE)));
	await goTo('Todos');
	await type('.main .todos li.add input[aria-label="A new todo"]', TODO);
	await click('Add the todo', '.main .todos li.add button');
	check('her todo', await waitText(TODO, 30000, '.main .todos'));
	await click('Open', '.main .todos .tick');
	check('marked doing', await waitText('Doing', 30000, '.main .todos'));
	await type('.main .todos li.add input[aria-label="A new todo"]', WORK);
	await type('.main .todos li.add input[aria-label="The new todo’s tags"]', 'work');
	await click('Add the todo', '.main .todos li.add button');
	check('a todo tagged “work”', await until(async () => (await todoRow(WORK))?.includes('#work'), 30000), await todoRow(WORK));
	await type('.main .todos li.add input[aria-label="A new todo"]', LATER);
	await type('.main .todos li.add input[aria-label="The new todo’s tags"]', '');
	await click('Add the todo', '.main .todos li.add button');
	check('and one more, untagged', await until(async () => !!(await todoRow(LATER)), 30000), await text('.main .todos'));
	check('three todos, none done', (await text('.main .todos-of .head')).includes('3 of 3 todos left'), await text('.main .todos-of .head'));
	await goTo('Access');
	await choose('.main select[aria-label="What"]', 'every');
	await choose('.main select[aria-label="Type"]', 'todo');
	await type('.main input[aria-label="Tagged"]', 'work');
	await choose('.main select[aria-label="Share with"]', 'avenBOB');
	const preview = await text('.main .share .preview');
	check('the rule in words, and what it reaches now', preview.includes('todos tagged “work”') && preview.includes(`“${WORK}”`), preview);
	await click('Share', '.main .card button.primary');
	const ruled = async () => (await shown('.main .grants li')).some((l) => l?.includes('avenBOB') && l.includes('todos tagged “work”'));
	check('avenBOB reads her todos tagged “work”: a cap on a rule', await until(ruled), (await shown('.main .grants li')).join(' | '));
	check('sharing took no sheet', app.sheets().length === 0);
	await shot('8-alice-access');
	await goTo('Todos');
	await page.evaluate((later) => {
		const li = [...document.querySelectorAll('.main .todos li')].find((l) => l.querySelector('.title')?.textContent === later);
		/** @type {HTMLElement | null | undefined} */ (li?.querySelector('.tags .more'))?.click();
	}, LATER);
	await sleep(200);
	await type('.main .todos .tags input', 'work');
	await click('Tag', '.main .todos .tags button');
	check('her later todo tagged “work” too', await until(async () => (await todoRow(LATER))?.includes('#work'), 30000), await todoRow(LATER));
	await shot('8b-alice-todos');
	await goTo('Cells');
	const cells = () => page.$$eval('.main .grid tr.rec', (rows) => rows.length);
	check('her cells: her own, and the one avenBOB’s caps share', await until(async () => (await cells()) >= 2, 10000), `${await cells()}`);
	await goTo('Table editor');
	const mine = async () => {
		const t = await tablesShown();
		return t.notes === 1 && t.todos === 3;
	};
	check('her table editor: her note and her three todos', await until(mine, 20000), JSON.stringify(await tablesShown()));

	// avenBOB reads her note and her todos tagged “work”, and nothing else of hers
	check('acting as avenBOB', await actAs('avenBOB'));
	await look('avenALICE');
	check('he reads her note', await until(async () => (await note(NOTE))?.words === BODY, 30000), JSON.stringify(await note(NOTE)));
	check('he starts no note there', !(await page.$('.main .start')));
	await goTo('Todos');
	const both = async () => (await text('.main')).includes(WORK) && (await text('.main')).includes(LATER);
	check('he reads her todos tagged “work”, the one tagged later too', await until(both, 60000), await text('.main'));
	check('her other todo stays hidden', !(await text('.main')).includes(TODO));
	check('he adds no todo there', !(await page.$('.main .todos li.add')));
	await shot('9-bob');
	await goTo('Notes');
	await openNote(NOTE);
	check('he opens it', await until(async () => (await docText()) === BODY, 10000), await docText());
	const readOnly = !(await page.$('.doc .paper textarea')) && !(await page.$('.doc .top .share'));
	check('and may not edit it', readOnly && (await text('.doc .top .mode')).includes('only reads it'), await text('.doc .top .mode'));
	await back();
	await goTo('Table editor');
	const hers = async () => {
		const t = await tablesShown();
		return t.notes === 1 && t.todos === 2 && t.sealed >= 1;
	};
	check('in her table editor, her note and two todos open for him, the rest sealed', await until(hers, 20000), JSON.stringify(await tablesShown()));
	await shot('9b-bob-database');

	// avenCHARLY: nothing of hers
	check('acting as avenCHARLY', await actAs('avenCHARLY'));
	await look('avenALICE', 'Notes');
	const none = /avenCHARLY can't see the \d+ entries in avenALICE/.test(await text('.main'));
	check('he sees none of her entries', !(await note(NOTE)) && none, (await text('.main')).slice(0, 300));
	await shot('10-charly');
	await click('Act as avenALICE', '.main .empty button');
	check('from there, one click acts as her', await until(async () => (await text('.switcher .pill b')) === 'avenALICE', 5000));

	// who receives her cells: this Mac opens them, avenCEO's server only relays their ciphertext
	await look('avenALICE', 'Sync');
	const sync = await text('.main');
	check('her cells: her own, and those her caps share', sync.includes('Its own entries') && sync.includes('Shared: avenBOB reads'), sync.slice(0, 400));
	check('this Mac opens them', sync.includes('Samuel’s test Mac') && sync.includes('opens it'), sync.slice(0, 400));
	check('avenCEO’s server relays their ciphertext only', /avenCEO's server.*relays its ciphertext only/.test(sync), sync.slice(0, 600));
	await shot('11-sync');

	// the coop owns her whole vault too, which the passkey approves in a sheet; revoking avenBOB's caps needs none
	await look('avenALICE', 'Access');
	app.sheets();
	await choose('.main select[aria-label="What"]', 'the whole vault');
	await choose('.main select[aria-label="Share with"]', 'Maia City COOP');
	await choose('.main select[aria-label="Role"]', 'to own (your passkey approves)');
	await click('Share', '.main .card button.primary');
	check('the coop owns her whole vault', await until(async () => /Maia City COOP owns the whole vault/.test(await text('.main')), 60000), await problem());
	check('in one sheet', app.sheets().join(',') === 'approve');
	const revoke = () =>
		page.evaluate(() => {
			const li = [...document.querySelectorAll('.main .grants li')].find((l) => l.textContent?.includes('avenBOB'));
			const button = li?.querySelector('button');
			button?.click();
			return !!button;
		});
	check('she may revoke avenBOB’s read of her note', await revoke());
	await until(async () => (await shown('.main .grants li')).filter((l) => l?.includes('avenBOB')).length < 2);
	check('and his read of her todos tagged “work”', await revoke());
	const gone = await until(async () => !(await shown('.main .grants li')).some((l) => l?.includes('avenBOB')));
	check('revoked', gone, (await shown('.main .grants li')).join(' | '));
	check('with no sheet', app.sheets().length === 0);
	await shot('12-access');

	// the same page in a narrow window: her todos and Access fit it, nothing wider than the screen
	await page.setViewport({ width: 390, height: 844 });
	const fits = () => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);
	await look('avenALICE', 'Todos');
	check('her todos, tags and all, fit a phone’s width', await fits());
	await shot('12b-phone-todos');
	await look('avenALICE', 'Access');
	check('and her Access', await fits());
	await shot('12c-phone-access');
	await page.setViewport({ width: 1300, height: 1000 });
	await actAs('avenBOB');
	await look('avenALICE');
	check('avenBOB no longer reads her note', await until(async () => !(await note(NOTE)), 30000));
	await goTo('Todos');
	check('nor her todos', !(await text('.main')).includes(WORK), await text('.main'));
	await actAs('Samuel');
	await look('Samuel', 'Owners & devices');

	// forgotten here, its store is put aside; the passkey alone gets the vault back through the server
	page.once('dialog', (d) => d.accept());
	await click('Forget my account on this Mac');
	check('forgotten, it offers to sign in', await waitText('Sign in with my passkey'));
	const aside = existsSync(join(folder, 'aside')) ? readdirSync(join(folder, 'aside')) : [];
	check('its store put aside, not deleted', aside.some((a) => a.endsWith('-forgotten')) && !existsSync(join(folder, 'meta.json')), aside.join(', '));
	await click('Sign in with my passkey', '.account button');
	check('signed in again, through the server', await opened(), await problem());
	check('in four sheets: unlock, pass, hello, join', app.sheets().join(',') === 'unlock,pass,hello,join');
	check('every vault came back', await until(() => hasAll(SIX), 120000), (await bar()).join(', '));
	await actAs('avenALICE');
	await look('avenALICE', 'Notes');
	check('her note came back', await until(async () => (await note(NOTE))?.words === BODY, 60000), JSON.stringify(await note(NOTE)));
	check('no error after signing in', !(await problem()), await problem());
	await shot('13-signed-in');

	// an earlier avenDB's store, as when avenDB started fresh: the app starts again, the device puts the store aside,
	// and the page says what it kept holds no vault, and offers to forget it here
	await app.quit();
	const ops = join(folder, 'store', 'ops');
	const earlier = readFileSync(ops);
	earlier[4] = (earlier[4] + 1) & 0xff;
	writeFileSync(ops, earlier);
	app = new App();
	await page.reload({ waitUntil: 'domcontentloaded' });
	check('an earlier store: it asks to unlock', await waitText('Your account is on this Mac'));
	await click('Unlock');
	check('it says what this Mac kept holds no vault', await waitText('kept holds no vault of yours'), await problem());
	const put = existsSync(join(folder, 'store', 'aside')) ? readdirSync(join(folder, 'store', 'aside')) : [];
	check('the earlier store put aside, not deleted', put.length === 1, put.join(', '));
	page.once('dialog', (d) => d.accept());
	await click('Forget it here', '.account button');
	check('forgotten, it offers to sign in again', await waitText('Sign in with my passkey'));
	await shot('14-earlier-store');
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
