/*
 * avenDB's native device in the Mac app, end to end, without a Mac: the app's avenDB page in a headless Chrome, as the
 * app's web view shows it, its calls to the app answered here as the app answers them (vault/app/src/avendb.rs): each
 * `avendb` call goes to the native device (avendb-device), which this runs as the app does, and each sign-in sheet it
 * asks for is answered by a passkey of maia.city's, sealed as the sheet's page seals it (avendb-browser's
 * `sealCeremony`, from the page's own module), against an avenDB server on this machine. Signing in before they have an
 * account, as on a server that started fresh, the page names the button that sets one up; the person founds their vault
 * from the "Mac" in two sheets, the page's own sheet showing every step of it done, with its seconds; the page shows
 * the device native, on its own UDP sockets; reloaded, it opens with no sheet, as the device runs on; the app quits
 * and starts again, and the device opens from its folder in one sheet; it is renamed. A drive plugged into the "Mac",
 * a folder in the volumes' folder the device looks at as macOS mounts them in /Volumes, becomes a device of their vault
 * in one sheet, a full copy, its store in .avendb beside the person's own files; unplugged, it shows when it last
 * checked what it holds; plugged in again, it is hosted again with no sheet; and it is removed as a lost phone is. A note of theirs is titled, written, proposed on, accepted, undone and restored, deleted and brought back, with no sheet. Their
 * Library takes a picture, an SVG, a PDF and a song, each sealed by the device a megabyte at a time; the pictures show,
 * the song plays streamed through the page's service worker, in ranges, and the PDF is deleted and brought back. Their
 * vault founds avenALICE, avenBOB, avenCHARLY and Maia City COOP, named by hand, in one sheet, and the person acts as
 * each as its owner, with no switch: in avenALICE's vault the page acts as her, and she writes a note and three todos,
 * one tagged “work”, adds a fourth from her studio’s query console and queries those she has left there, and shares
 * the note alone with avenBOB, and every todo tagged “work”, a rule, and one she tags “work” later; she gives
 * avenCHARLY a Suggester cap on a plan of hers, whose ops let him only suggest changes; her Sync page shows her cells,
 * avenCEO's server relaying their ciphertext; making the coop an Owner of her whole vault takes one sheet, revoking
 * avenBOB's caps none; and the Public group lets everyone read her todos tagged “work”. What a cap's holder sees takes
 * a person who owns it and not her, as the person owns every vault here. Forgotten, the device's
 * store is put aside in its folder, and the person signs in again through the server in one sheet, every vault and her
 * note coming back. Last, the store becomes an earlier avenDB's: the device puts it aside, and the page says it holds
 * no vault and forgets it. Each step is screenshot.
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
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
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
// where the "Mac" mounts its volumes, as macOS does in /Volumes, and where a drive goes while it is unplugged
const volumes = mkdtempSync(join(tmpdir(), 'avendb-volumes-'));
const unplugged = mkdtempSync(join(tmpdir(), 'avendb-unplugged-'));

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
		this.child = spawn(binary, ['--dir', folder, '--volumes', volumes], { stdio: ['pipe', 'pipe', 'inherit'] });
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
/** the sheet that shows a start's steps closed, as it does by itself a little after one that went through */
const settled = () => page.waitForSelector('.signing', { hidden: true, timeout: 15000 }).then(() => true, () => false);
/** the device opened, and the sheet of its start closed */
const opened = () => page.waitForSelector('.shell', { timeout: 180000 }).then(settled, () => false);
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
/** The studio's tables, by their names (each its schema's, or its type's), each with its count of rows. */
const tablesShown = () =>
	page.$$eval('.main .tables button.t[data-table]', (els) =>
		Object.fromEntries(els.map((e) => [e.querySelector('.mono')?.textContent ?? '', Number(e.querySelector('small')?.textContent ?? 0)]))
	);
/** The table editor's rows, each as its columns name its cells. */
const gridRows = () =>
	page.$$eval('.main .grid tr.rec', (rows) =>
		rows.map((r) =>
			Object.fromEntries([...r.querySelectorAll('td[data-col]')].map((c) => [c.getAttribute('data-col'), c.textContent?.replace(/\s+/g, ' ').trim()]))
		)
	);
/** Pick the table named `name` of the table editor. */
async function pickTable(name) {
	const picked = await page.$$eval(
		'.main .tables button.t[data-table]',
		(els, n) => {
			const b = /** @type {HTMLElement | undefined} */ (els.find((e) => e.querySelector('.mono')?.textContent === n));
			b?.click();
			return !!b;
		},
		name
	);
	if (!picked) check(`there is a ${name} table`, false);
	await sleep(250);
}
/** The todo titled `title`'s row in the todos list: its words. */
const todoRow = (title) =>
	page.evaluate((title) => {
		const li = [...document.querySelectorAll('.main .todos li')].find((l) => l.querySelector('.title')?.textContent === title);
		return li?.textContent?.replace(/\s+/g, ' ').trim() ?? null;
	}, title);

/** A one-page PDF with nothing on it. */
const PDF = `%PDF-1.4
1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj
2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj
3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 100]>>endobj
trailer<</Root 1 0 R>>
%%EOF
`;

/** A WAV of a quiet tone `seconds` long, mono, 16-bit at `rate` Hz. @param {number} seconds @param {number} rate */
function wav(seconds, rate) {
	const n = seconds * rate;
	const b = Buffer.alloc(44 + 2 * n);
	b.write('RIFF', 0);
	b.writeUInt32LE(36 + 2 * n, 4);
	b.write('WAVEfmt ', 8);
	b.writeUInt32LE(16, 16);
	b.writeUInt16LE(1, 20);
	b.writeUInt16LE(1, 22);
	b.writeUInt32LE(rate, 24);
	b.writeUInt32LE(2 * rate, 28);
	b.writeUInt16LE(2, 32);
	b.writeUInt16LE(16, 34);
	b.write('data', 36);
	b.writeUInt32LE(2 * n, 40);
	for (let i = 0; i < n; i++) b.writeInt16LE(Math.round(3000 * Math.sin((2 * Math.PI * 440 * i) / rate)), 44 + 2 * i);
	return b;
}

const NOTE = 'Hello from Alice';
const BODY = 'Only Bob may read this.';
const TODO = 'Plant the north beds';
const WORK = 'Fix the greenhouse door';
const LATER = 'Order seeds';
const PLAN = 'Spring plan';
const SOW = 'Sow beans.';

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
	check('after one sheet: unlock', app.sheets().join(',') === 'unlock');
	await shot('1b-no-account');

	await click('Use my maiaCITY passkey');
	// the page's own sheet shows every step of the start as the device takes it, each with its seconds
	const allDone = () => text('.signing header').then((t) => t.includes('All done'));
	check('the sheet says it is all done', await until(allDone, 180000), await text('.signing header'));
	const took = await page.$$eval('.signing .steps li', (els) =>
		els.map((e) => {
			const [state, title, time] = [e.classList[0], e.querySelector('b'), e.querySelector('.time')];
			return `${state} ${title?.textContent} ${time?.textContent?.trim()}`;
		})
	);
	check(
		'it shows the eight steps of the start, each done with its seconds, the claim among them',
		took.length === 8 && took.every((s) => /^done .+ \d+\.\d s$/.test(s)) && took.some((s) => s.includes('claim')),
		took.join(' | ')
	);
	await shot('2a-sheet');
	check('the vault is founded natively', await opened(), await problem());
	check('in two sheets: unlock, found', app.sheets().join(',') === 'unlock,found');
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

	// a drive plugged into the Mac: one sheet makes it a device of the vault, a full copy, hosted while it is plugged in
	app.sheets();
	const photo = join(volumes, 'Photo drive');
	const away = join(unplugged, 'Photo drive');
	mkdirSync(photo);
	writeFileSync(join(photo, 'holiday.txt'), 'the person’s own');
	/** The card headed `title`: its words, and the names in its list. @param {string} title */
	const card = (title) =>
		page.evaluate((title) => {
			const card = [...document.querySelectorAll('.main article.card')].find((c) => c.querySelector('h3')?.textContent?.trim() === title);
			const names = [...(card?.querySelectorAll('.list li') ?? [])].map((li) => li.querySelector('b')?.textContent?.trim() ?? '');
			const chips = [...(card?.querySelectorAll('.list li .chip') ?? [])].map((c) => c.textContent?.trim() ?? '');
			return { text: card?.textContent?.replace(/\s+/g, ' ').trim() ?? '', names, chips };
		}, title);
	const drivesCard = async () => (await card('Drives')).text;
	const deviceList = async () => (await card('Devices')).names;
	/** Click the button `t` in the Drives card. @param {string} t */
	const clickDrives = async (t) => {
		const ok = await page.evaluate((t) => {
			const card = [...document.querySelectorAll('.main article.card')].find((c) => c.querySelector('h3')?.textContent?.trim() === 'Drives');
			const button = [...(card?.querySelectorAll('li button') ?? [])].find((b) => b.textContent?.trim() === t);
			if (button instanceof HTMLElement) button.click();
			return !!button;
		}, t);
		if (!ok) check(`there is a “${t}” to click in Drives`, false);
		await sleep(250);
	};
	check('the drive plugged in shows, to use for avenDB', await until(async () => (await drivesCard()).includes('Photo drive') && (await drivesCard()).includes('Use for avenDB'), 30000), await drivesCard());
	await clickDrives('Use for avenDB');
	check('a device of the vault, by its name', await until(async () => (await deviceList()).includes('Photo drive'), 60000), (await deviceList()).join(', '));
	check('in one sheet: drive', app.sheets().join(',') === 'drive');
	const deviceChips = async () => (await card('Devices')).chips;
	check('shown as a drive among its devices', await until(async () => (await deviceChips()).includes('Drive'), 15000), (await deviceChips()).join(', '));
	// what the drive keeps, as its row in the Drives card shows it
	const driveCopy = () =>
		page.evaluate(() => {
			const card = [...document.querySelectorAll('.main article.card')].find((c) => c.querySelector('h3')?.textContent?.trim() === 'Drives');
			const row = [...(card?.querySelectorAll('.list li') ?? [])].find((li) => li.querySelector('b')?.textContent?.trim() === 'Photo drive');
			return row?.querySelector('button[aria-pressed="true"]')?.textContent?.trim() ?? '';
		});
	check('plugged in, a full copy', await until(async () => (await drivesCard()).includes('Plugged in') && (await driveCopy()) === 'Full copy', 30000), `${await drivesCard()} | ${await driveCopy()}`);
	const onDrive = existsSync(join(photo, '.avendb')) ? readdirSync(join(photo, '.avendb')) : [];
	check('its store on the drive, the person’s own file as it was', onDrive.length > 0 && readFileSync(join(photo, 'holiday.txt'), 'utf8') === 'the person’s own', onDrive.join(', '));
	await shot('4b-drive');
	renameSync(photo, away);
	const checked = async () => /Unplugged checked (just now|\d+ min ago)/.test(await drivesCard());
	check('unplugged, it shows when it last checked what it holds', await until(checked, 60000), await drivesCard());
	await shot('4c-drive-unplugged');
	renameSync(away, photo);
	check('plugged in again, it is hosted again', await until(async () => (await drivesCard()).includes('Plugged in'), 30000), await drivesCard());
	check('with no sheet', app.sheets().length === 0);
	page.once('dialog', (d) => d.accept());
	await clickDrives('Remove');
	check('removed as a lost phone is, a device no more', await until(async () => !(await deviceList()).includes('Photo drive'), 60000), (await deviceList()).join(', '));
	check('in one sheet: approve', app.sheets().join(',') === 'approve');
	check('the drive shows taken out of the vault', await until(async () => (await drivesCard()).includes('Taken out of your vault'), 30000), await drivesCard());
	await shot('4d-drive-removed');
	renameSync(photo, away);

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
	// deleted: gone from the notes, listed apart under Deleted, and brought back from its page, with no sheet
	const hash = () => page.evaluate(() => location.hash);
	await click('Delete', '.doc .top button');
	check('deleted: back at the notes', await until(async () => (await hash()) === '#notes', 30000), await hash());
	check('and gone from them', await until(async () => !(await note('Plan')), 30000));
	await click('Deleted 1', '.main .filter button');
	check('listed under Deleted', await until(async () => !!(await note('Plan')), 5000));
	await shot('5-deleted');
	await page.click('.main .note');
	check('its page says it is deleted', await waitText('This note is deleted', 30000, '.doc .gone'));
	await click('Bring it back', '.doc .gone button');
	check('brought back', await until(async () => !(await page.$('.doc .gone')), 30000));
	await back();
	check('among the notes again', await until(async () => !!(await note('Plan')), 30000));
	check('none of it asked for a sheet', app.sheets().length === 0);

	// their Library: a picture, an SVG, a PDF and a song, picked, each sealed by the device a megabyte at a time; the
	// song streams through the service worker, in ranges the device reads; the PDF is deleted and brought back
	const media = mkdtempSync(join(tmpdir(), 'avendb-media-'));
	const [svg, pdf, song] = ['Logo.svg', 'Plan.pdf', 'Birdsong.wav'].map((f) => join(media, f));
	writeFileSync(svg, '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><circle cx="5" cy="5" r="4" fill="#2f6d62"/></svg>');
	writeFileSync(pdf, PDF);
	writeFileSync(song, wav(48, 16000));
	await goTo('Library');
	check('the Library offers to add files', await waitText('Add files', 30000, '.main'));
	const picker = await page.$('.main .library input[type=file]');
	await /** @type {any} */ (picker)?.uploadFile(resolve('static/the-os.png'), svg, pdf, song);
	const tiles = () => shown('.main .library .tile .info b');
	check('four files in the Library', await until(async () => (await tiles()).length === 4, 120000), (await tiles()).join(', '));
	const kinds = (await shown('.main .filter button')).join(' | ');
	check('by kind: an image, an SVG, a PDF and audio', ['Images 1', 'SVGs 1', 'PDFs 1', 'Audio 1'].every((k) => kinds.includes(k)), kinds);
	check('the pictures previewed', await until(async () => (await page.$$('.main .library .thumb img')).length === 2, 30000));
	check('adding them took no sheet', app.sheets().length === 0);
	await shot('5b-library');
	await click('Birdsong.wav', '.main .library .tile');
	const played = () =>
		page.evaluate(() => {
			const a = document.querySelector('.viewer audio');
			return a instanceof HTMLAudioElement ? { src: a.getAttribute('src'), duration: a.duration } : null;
		});
	const streamed = async () => (await played())?.src?.includes('/app/avendb/file/');
	check('the song streams through the service worker', await until(streamed, 20000), JSON.stringify(await played()));
	const long = async () => Math.round((await played())?.duration ?? 0) === 48;
	check('its 48 seconds read from ranges of it', await until(long, 30000), JSON.stringify(await played()));
	await shot('5c-song');
	await click('Back', '.viewer header button');
	await click('Plan.pdf', '.main .library .tile');
	check('the PDF opens whole', await until(async () => !!(await page.$('.viewer iframe')), 30000), await text('.viewer'));
	await click('Delete', '.viewer header button');
	check('deleted: gone from the Library', await until(async () => !(await tiles()).includes('Plan.pdf'), 30000), (await tiles()).join(', '));
	await click('Deleted 1', '.main .filter button');
	await click('Plan.pdf', '.main .library .tile');
	await click('Bring back', '.viewer header button');
	await click('Back', '.viewer header button');
	check('brought back', await until(async () => (await tiles()).includes('Plan.pdf'), 30000), (await tiles()).join(', '));
	check('none of it asked for a sheet', app.sheets().length === 0);
	check('and no error', !(await problem()), await problem());
	rmSync(media, { recursive: true, force: true });

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
	await look('avenALICE');
	const owner = await text('.main-head p');
	check('in her vault the page acts as her, Samuel her owner', owner.includes('Samuel') && owner.includes('its owner'), owner);
	check('with no switch to flip', !(await page.$('.switcher')));
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
		return t['Markdown document'] === 1 && t.Todo === 3;
	};
	check('her table editor: her note and her three todos', await until(mine, 20000), JSON.stringify(await tablesShown()));

	// her studio's query console: any op as JSON, a change and a query, through the device's one call, `run`
	await goTo('Query');
	await click('Add a todo', '.main .examples button');
	await click('Run', '.main .editor button');
	const added = async () => /"entry": "[0-9a-f]{64}"/.test(await text('.main .json'));
	check('a todo added from the console, as she acts', await until(added, 30000), await text('.main'));
	await click('Todos left', '.main .examples button');
	await click('Run', '.main .editor button');
	const left = async () => (await shown('.main .grid tbody tr')).length === 4;
	check('her todos left, by a query: four rows', await until(left, 30000), await text('.main'));
	const picked = await text('.main .picked');
	check('picked by its labels before any entry opened, as a cap picks', picked.includes('Picked by its labels') && picked.includes('todos'), picked);
	await shot('8c-alice-query');

	// a Suggester cap, whose ops let avenCHARLY only suggest changes to a plan of hers
	await look('avenALICE', 'Notes');
	await click('Blank note', '.main .start button');
	check('her plan opens', await until(async () => !!(await page.$('.doc .paper textarea')), 30000));
	await retitle(PLAN);
	const planned = until(async () => (await edits())[0]?.what === `Renamed it “${PLAN}”`, 30000);
	check('titled', await planned, JSON.stringify((await edits())[0]));
	check('written', await saveText(SOW), await docText());
	await click('Share', '.doc .top button');
	await choose('.doc .sharebar select[aria-label="Share with"]', 'avenCHARLY');
	await click('Suggester', '.doc .sharebar button.group');
	const chips = await text('.doc .sharebar .ops');
	const suggests = ['start proposals', 'change anything on a proposal'].every((op) => chips.includes(op));
	check('its ops as chips: he may suggest changes', suggests, chips);
	check('and add nothing', !chips.includes('add new'), chips);
	await click('Share it', '.doc .sharebar button');
	const writes = until(async () => (await holders()).includes('avenCHARLY writes it'));
	check('avenCHARLY writes it', await writes, (await holders()).join(', '));
	await back();
	await goTo('Access');
	const group = async () => (await shown('.main .group')).find((g) => g?.includes('avenCHARLY')) ?? '';
	const suggester = async () => {
		const g = await group();
		return g.startsWith('Suggester') && g.includes('start proposals');
	};
	check('her Access shows his cap by its group and ops', await suggester(), await group());
	await shot('10-suggester');

	// who receives her cells: this Mac opens them, avenCEO's server only relays their ciphertext
	await look('avenALICE', 'Sync');
	const sync = await text('.main');
	const shares = sync.includes('Its own entries') && sync.includes('Shared: avenBOB, Viewer');
	check('her cells: her own, and those her caps share', shares, sync.slice(0, 400));
	check('this Mac opens them', sync.includes('Samuel’s test Mac') && sync.includes('opens it'), sync.slice(0, 400));
	check('avenCEO’s server relays their ciphertext only', /avenCEO's server.*relays its ciphertext only/.test(sync), sync.slice(0, 600));
	await shot('11-sync');

	// the coop owns her whole vault too, which the passkey approves in a sheet; revoking avenBOB's caps needs none
	await look('avenALICE', 'Access');
	app.sheets();
	await choose('.main select[aria-label="What"]', 'the whole vault');
	await choose('.main select[aria-label="Share with"]', 'Maia City COOP');
	await click('Owner', '.main .share button.group');
	await click('Share', '.main .card button.primary');
	const owns = async () => {
		const groups = await shown('.main .group');
		return groups.some((g) => g?.startsWith('Owner') && g.includes('Maia City COOP on the whole vault'));
	};
	check('the coop owns her whole vault', await until(owns, 60000), await problem());
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

	// everyone reads her todos tagged “work”: the Public group, which only reads
	await look('avenALICE', 'Access');
	await choose('.main select[aria-label="What"]', 'every');
	await choose('.main select[aria-label="Type"]', 'todo');
	await type('.main input[aria-label="Tagged"]', 'work');
	await choose('.main select[aria-label="Share with"]', 'avenCHARLY');
	await click('A group of its own', '.main .share button.group');
	await type('.main .share input[aria-label="Its name"]', 'Tick work');
	await choose('.main .share select[aria-label="An op to add"]', 'set one field to some values');
	await choose('.main .share select[aria-label="Which field"]', 'status');
	await page.evaluate(() => {
		const picks = [...document.querySelectorAll('.main .share .pick input')];
		/** @type {HTMLElement | undefined} */ (picks.find((i) => i.getAttribute('value') === 'done'))?.click();
	});
	await click('Add', '.main .share button');
	const own = await text('.main .share .ops');
	check('a group of its own, built op by op', own.includes('set its status to “done”'), own);
	const json = await text('.main .share .as-json pre');
	check('and the cap as JSON', json.includes('"name": "Tick work"') && json.includes('"to":["done"]'), json);
	await shot('12e-own-group');
	await choose('.main select[aria-label="Share with"]', 'Everyone');
	const only = await shown('.main .share button.group');
	check('to everyone, the Public group alone', only.join(',') === 'Public', only.join(','));
	await click('Share', '.main .card button.primary');
	const everyone = async () => {
		const groups = await shown('.main .group');
		return groups.some((g) => g?.startsWith('Public') && g.includes('Everyone on todos tagged “work”'));
	};
	const publicly = await until(everyone, 30000);
	check('everyone reads her todos tagged “work”', publicly, (await shown('.main .group')).join(' | '));
	check('with no sheet', app.sheets().length === 0);
	await shot('12d-public');
	await look('Samuel', 'Owners & devices');

	// forgotten here, its store is put aside; the passkey alone gets the vault back through the server
	page.once('dialog', (d) => d.accept());
	await click('Forget my account on this Mac');
	check('forgotten, it offers to sign in', await waitText('Sign in with my passkey'));
	const aside = existsSync(join(folder, 'aside')) ? readdirSync(join(folder, 'aside')) : [];
	check('its store put aside, not deleted', aside.some((a) => a.endsWith('-forgotten')) && !existsSync(join(folder, 'meta.json')), aside.join(', '));
	await click('Sign in with my passkey', '.account button');
	check('signed in again, through the server', await opened(), await problem());
	check('in one sheet: unlock', app.sheets().join(',') === 'unlock');
	check('every vault came back', await until(() => hasAll(SIX), 120000), (await bar()).join(', '));
	await look('avenALICE', 'Notes');
	check('her note came back', await until(async () => (await note(NOTE))?.words === BODY, 60000), JSON.stringify(await note(NOTE)));
	check('no error after signing in', !(await problem()), await problem());
	await shot('13-signed-in');

	// an earlier avenDB's store, as when avenDB started fresh: the app starts again, the device puts the store aside,
	// and the page says what it kept holds no vault, puts it aside too and offers to sign in again (the only Forget
	// button is in Owners & devices)
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
	check('put aside, it offers to sign in again', await waitText('Sign in with my passkey'));
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
