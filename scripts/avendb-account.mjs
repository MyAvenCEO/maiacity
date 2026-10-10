/*
 * The avenDB account's walk through, end to end: /app/avendb/ in a headless Chrome whose virtual authenticator holds a
 * passkey with PRF, against an avenDB server on this machine. The person signed up to maiaCITY with that passkey; the
 * account founds their vault with it in three ceremonies, claims the server, and names their vault and avenCEO with
 * none. A note of theirs opens as a docs app opens a document, at an address of its own: started blank, titled,
 * written, given a proposal, accepted into main, undone, restored, made to match its proposal and made a variant of,
 * with no ceremony; their vault's studio shows its tables, schemas, lenses and every signed edit. Their vault then
 * founds avenALICE, avenBOB, avenCHARLY and Maia City COOP, each named by hand, in one ceremony,
 * and the person acts as each in turn from the switcher at the foot: avenALICE writes a note and two todos, one tagged
 * “work”, and shares the note with avenBOB, and every todo tagged “work”, a rule rather than a list: he reads the note
 * and its history and that todo, and a todo she tags “work” later, and nothing else, and finds her other todo sealed for
 * him in her table editor, while avenCHARLY sees nothing of hers; the Sync list shows her cells, avenCEO's server
 * relaying their ciphertext and opening none of it; making the coop an owner of her whole vault takes one ceremony,
 * revoking avenBOB's read none. The account opens again after a reload in one ceremony; forgotten here,
 * it comes back through the server for the passkey alone, in four ceremonies, with every vault and the note. Each step
 * is screenshot.
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
/** The page's address. */
const hash = () => page.evaluate(() => location.hash);
/** Go to page `label` of the vault looked at. */
const goTo = (label) => click(label, '.aside .tabs-list .item');
/** The note titled `title`, as the notes list shows it: its words, and who holds a role on it. */
const note = (title) =>
	page.evaluate((title) => {
		const el = [...document.querySelectorAll('.main .note')].find((n) => n.querySelector('.info b')?.textContent === title);
		if (!el) return null;
		const chips = [...el.querySelectorAll('.who .chip')].map((c) => c.textContent?.replace(/\s+/g, ' ').trim());
		const variant = el.querySelector('.variant')?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
		return { words: el.querySelector('.thumb .page span')?.textContent ?? '', chips, variant };
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
/** The note's history on the line shown, newest first: what each edit did, and the words it put in and took out. */
const edits = () =>
	page.$$eval('.doc .history li', (lis) =>
		lis.map((li) => ({
			what: li.querySelector('.what b')?.textContent?.trim() ?? '',
			ins: [...li.querySelectorAll('.diff ins')].map((e) => e.textContent),
			del: [...li.querySelectorAll('.diff del')].map((e) => e.textContent)
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
/**
 * Pick the edit of the history whose words are `what` (and that put in `ins`, if given), which shows its version, then
 * click `label` on it, if given.
 */
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

const NOTE = 'Hello from Alice';
const BODY = 'Only Bob may read this.';
const TODO = 'Plant the north beds';
const WORK = 'Fix the greenhouse door';
const LATER = 'Order seeds';

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

	// a note as a docs app keeps one: started blank, titled, written, proposed on, accepted, undone, restored, made to
	// match its proposal and made a variant of, all of it without a ceremony
	const noting = await ceremonies();
	await goTo('Notes');
	check('Notes, at an address of its own', await until(async () => (await hash()) === '#notes', 5000), await hash());
	await click('Blank note', '.main .start button');
	const addressed = await until(async () => /^#notes\/[0-9a-f]{64}$/.test(await hash()), 30000);
	check('a blank note opens at once, at an address of its own', addressed, await hash());
	const paper = await until(async () => !!(await page.$('.shell.reading .doc .paper textarea')), 10000);
	check('on the whole screen, a page to write on', paper);
	await retitle('Plan');
	const titled = await until(async () => (await edits())[0]?.what === 'Renamed it “Plan”', 30000);
	check('titled “Plan”, an edit of its own', titled, JSON.stringify((await edits())[0]));
	check('written, and saved on main', await saveText('Plant beans.'), await docText());
	check('and saved again', await saveText('Plant beans and peas.'), await docText());
	const edit = (await edits())[0];
	check('the edit, word by word', edit?.what === 'Edited' && edit.ins.join('|') === ' and peas' && !edit.del.length, JSON.stringify(edit));
	check('its history, newest first', (await edits()).at(-1)?.what === 'Wrote the note', JSON.stringify(await edits()));
	await click('New proposal', '.doc .versions button');
	await type('#proposal-name', 'draft');
	await click('Propose', '.doc .versions .naming button');
	const lines = () => shown('.doc .versions .line b');
	check('a proposal, draft, picked', await until(async () => (await onLine()) === 'draft'), (await lines()).join());
	const start = (await edits())[0]?.what;
	check('it starts from main', start === 'Proposed “draft” from “main”', start);
	check('saved on the proposal', await saveText('Plant beans, peas and corn.'), await docText());
	const against = await shown('.doc .against .diff ins');
	check('what it changes against main', against.join('|') === ', peas|corn', against.join('|'));
	await shot('3b-proposal');
	await click('Accept into main', '.doc .banner button');
	const merged = until(async () => (await onLine()) === 'Main' && (await docText()) === 'Plant beans, peas and corn.');
	check('accepted: main reads the proposal', await merged, await docText());
	const merge = (await edits())[0];
	check('the merge, and what it brought', merge?.what === 'Accepted “draft” into main' && merge.ins.join('|') === ', peas |corn', JSON.stringify(merge));
	await onEdit('Edited on “draft”', 'Undo');
	check('the proposal’s edit undone on main', await until(async () => (await docText()) === 'Plant beans and peas.'), await docText());
	await onEdit('Edited', '', 'Plant beans.');
	const old = await until(async () => (await text('.doc .paper.old .text')) === 'Plant beans.', 5000);
	check('the first version, read-only', old && (await text('.doc .top .mode')).startsWith('Viewing version'), await text('.doc .top .mode'));
	await shot('3c-version');
	await click('Restore this version', '.doc .banner.old button');
	check('restored on main', await until(async () => (await docText()) === 'Plant beans.'), await docText());
	await click('draft', '.doc .versions .line');
	check('the proposal as it was', await until(async () => (await docText()) === 'Plant beans, peas and corn.', 5000), await docText());
	check('saved on the proposal again', await saveText('Corn first.'), await docText());
	await click('Make main match it', '.doc .banner button');
	const matched = until(async () => (await onLine()) === 'Main' && (await docText()) === 'Corn first.');
	check('main made to match the proposal', await matched, await docText());
	check('as an edit of its own', (await edits())[0]?.what === 'Made “main” match “draft”', (await edits())[0]?.what);
	await shot('3d-history');
	await click('Make a variant', '.doc .variants button');
	check('a variant made', await waitText('Made a variant', 30000, '.doc .variants'), await problem());
	await click('Open it', '.doc .variants .made a');
	const variant = until(async () => (await docText()) === 'Corn first.' && (await edits()).length === 1, 10000);
	check('the variant: the same text, with one edit of its own', await variant, `${await docText()} ${(await edits()).length}`);
	check('it names the note it came from', (await text('.doc .variants')).includes('Variant of “Plan”'), await text('.doc .variants'));
	check('none of it asked the passkey', (await ceremonies()) === noting, `${(await ceremonies()) - noting}`);
	check('and no error', !(await problem()), await problem());
	await shot('3e-variant');
	check('back to the notes', await back());
	const cards = await shown('.main .note .info b');
	check('both notes there, the variant named so', cards.length === 2 && (await text('.main')).includes('Variant of “Plan”'), cards.join(', '));
	await shot('3f-notes');

	// the vault's studio, as this browser holds it: its tables, cells, schemas, lenses and every signed edit
	await goTo('Table editor');
	check('the table editor, at an address of its own', (await hash()) === '#tables', await hash());
	const held = async () => {
		const t = await tablesShown();
		return t.notes === 2 && t.device_cards >= 1 && t.vault_profiles >= 1;
	};
	check('its tables: the two notes, this browser’s card, the vault’s profile', await until(held, 20000), JSON.stringify(await tablesShown()));
	await pickTable('notes');
	const planRow = async () => (await gridRows()).findIndex((r) => r.title === 'Plan' && r.proposals === '1');
	check('the note with its proposal', (await until(async () => (await planRow()) >= 0, 10000)), JSON.stringify(await gridRows()));
	const types = await shown('.main .grid th[data-col] .type');
	check('typed columns, as Postgres names them', types.includes('bytea') && types.includes('text'), types.join(', '));
	await shot('3g-table-grid');
	await page.evaluate((i) => /** @type {HTMLElement} */ (document.querySelectorAll('.main .grid tr.rec')[i])?.click(), await planRow());
	await sleep(250);
	const drawer = await text('.panel');
	check('its row, opened: its proposal and its record', drawer.includes('draft') && drawer.includes('Corn first.'), drawer.slice(0, 300));
	await shot('3g-table-editor');
	await page.keyboard.press('Escape');
	await goTo('Cells');
	check('its cells', await waitText('signed edits held', 10000, '.main'), (await text('.main')).slice(0, 200));
	await goTo('Schemas');
	const schemaNames = await shown('.main .schemas .schema header b');
	check('the schemas the app ships', ['Markdown document, v2', 'Todo, v2'].every((n) => schemaNames.includes(n)), schemaNames.join(', '));
	const fieldNames = await shown('.main .schemas .fields td:first-child code');
	check('field by field', ['blocks', 'tags', 'status', 'due'].every((n) => fieldNames.includes(n)), fieldNames.join(', '));
	await shot('3h-schemas');
	await goTo('Lenses');
	check('and the lens between v1 and v2', (await shown('.main .lenses .lens header b')).includes('Markdown document, v1 to v2'));
	await goTo('History');
	check('every signed edit', await until(async () => (await page.$$('.main .grid tr.rec')).length > 10, 20000));
	const said = await text('.main .grid');
	check('each in words', said.includes('Samuel writes') && said.includes('proposing a change'), said.slice(0, 300));
	check('with its post-quantum signature', said.includes('SLH-DSA'), said.slice(0, 300));
	await shot('3i-history');

	// the cast to enact, named by hand: four vaults Samuel's vault owns, in one ceremony
	const founding = await ceremonies();
	await page.click('.bar .add');
	await page.waitForSelector('.dialog');
	const rows = await page.$$eval('.dialog input', (els) => els.map((e) => /** @type {HTMLInputElement} */ (e).value));
	check('it opens on one empty row, naming no vault itself', rows.length === 1 && !rows[0], rows.join(', '));
	for (const [i, n] of SIX.slice(2).entries()) {
		if (i) await click('Add another', '.dialog button');
		await type(`.dialog input[aria-label="Vault ${i + 1}'s name"]`, n);
	}
	await choose(`.dialog select[aria-label="Vault 4's kind"]`, 'Coop');
	await shot('4-new-vaults');
	await click('Create 4 vaults', '.dialog button');
	check('six vaults in the bar', await until(() => hasAll(SIX), 120000), (await bar()).join(', '));
	check('in one ceremony', (await ceremonies()) - founding === 1, `${(await ceremonies()) - founding}`);
	check('the dialog closed, no error', !(await page.$('.dialog')) && !(await problem()), await problem());
	await page.click('.switcher .pill');
	const actors = await shown('.switcher .menu button b');
	check('Samuel may act as any of them', SIX.every((n) => actors.includes(n)), actors.join(', '));
	await shot('5-six-vaults');

	// avenALICE writes a note and todos in her vault, and shares the note with avenBOB, and her todos tagged “work”
	check('acting as avenALICE', await actAs('avenALICE'), await text('.switcher .pill b'));
	await look('avenALICE');
	check('looking at her vault', (await text('.aside h1')) === 'avenALICE', await text('.aside h1'));
	check('she may start a note in her vault', !!(await page.$('.main .start')));
	await click('Blank note', '.main .start button');
	check('her note opens', await until(async () => !!(await page.$('.doc .paper textarea')), 30000));
	await retitle(NOTE);
	check('titled', await until(async () => (await edits())[0]?.what === `Renamed it “${NOTE}”`, 30000), JSON.stringify((await edits())[0]));
	check('written', await saveText(BODY), await docText());
	const sharing = await ceremonies();
	await click('Share', '.doc .top button');
	await choose('.doc .sharebar select[aria-label="Share with"]', 'avenBOB');
	check('sharing starts at the least: this note alone, to read', (await text('.doc .sharebar')).includes('Only “Hello from Alice”'), await text('.doc .sharebar'));
	await choose('.doc .sharebar select[aria-label="Role"]', 'to read');
	await click('Share it', '.doc .sharebar button');
	const holders = () => page.$$eval('.doc .people .person', (els) => els.map((e) => e.getAttribute('title')));
	const shared = await until(async () => (await holders()).includes('avenBOB reads it'));
	check('shared with avenBOB, who reads it', shared, (await holders()).join(', '));
	check('sharing took no ceremony', (await ceremonies()) === sharing, `${(await ceremonies()) - sharing}`);
	await shot('6-alice-note');
	await back();
	check('her note, in her notes', await until(async () => (await note(NOTE))?.words === BODY), JSON.stringify(await note(NOTE)));
	check('with avenBOB among its readers', (await note(NOTE))?.chips.includes('avenBOB reads'), (await note(NOTE))?.chips.join(', '));
	await goTo('Todos');
	check('Todos, at an address of its own', (await hash()) === '#todos', await hash());
	await type('.main .todos li.add input', TODO);
	await click('Add the todo', '.main .todos li.add button');
	check('her todo', await waitText(TODO, 30000, '.main .todos'));
	await click('Open', '.main .todos .tick');
	check('marked doing', await waitText('Doing', 30000, '.main .todos'));
	await type('.main .todos li.add input[aria-label="A new todo"]', WORK);
	await type('.main .todos li.add input[aria-label="The new todo’s tags"]', 'work');
	await click('Add the todo', '.main .todos li.add button');
	check('a todo tagged “work”', await waitText('#work', 30000, '.main .todos'), await text('.main .todos'));
	await type('.main .todos li.add input[aria-label="A new todo"]', LATER);
	await click('Add the todo', '.main .todos li.add button');
	check('and one more, untagged', await waitText(LATER, 30000, '.main .todos'));
	await goTo('Access');
	await choose('.main select[aria-label="What"]', 'every');
	await choose('.main select[aria-label="Type"]', 'todo');
	await type('.main input[aria-label="Tagged"]', 'work');
	await choose('.main select[aria-label="Share with"]', 'avenBOB');
	const preview = await text('.main .share .preview');
	check('the rule, in words, and what it reaches now', preview.includes('todos tagged “work”') && preview.includes(`“${WORK}”`), preview);
	await click('Share', '.main .card button.primary');
	const rule = await until(async () => (await shown('.main .grants li')).some((l) => l?.includes('avenBOB') && l.includes('todos tagged “work”')));
	check('avenBOB reads her todos tagged “work”: a cap on a rule', rule, (await shown('.main .grants li')).join(' | '));
	await goTo('Todos');
	await page.evaluate((later) => {
		const li = [...document.querySelectorAll('.main .todos li')].find((l) => l.querySelector('.title')?.textContent === later);
		/** @type {HTMLElement | null | undefined} */ (li?.querySelector('.tags .more'))?.click();
	}, LATER);
	await sleep(200);
	await type('.main .todos .tags input', 'work');
	await click('Tag', '.main .todos .tags button');
	check('her later todo tagged “work” too', await until(async () => (await text('.main .todos')).split('#work').length > 2, 30000), await text('.main .todos'));
	await shot('6b-alice-todos');

	// avenBOB reads the note, and nothing else of hers
	check('acting as avenBOB', await actAs('avenBOB'));
	await look('avenALICE');
	const bob = await note(NOTE);
	check('he reads her note', bob?.words === BODY, JSON.stringify(bob));
	check('he starts no note there', !(await page.$('.main .start')));
	await goTo('Todos');
	check('he reads her todos tagged “work”, the one tagged later too', await until(async () => (await text('.main')).includes(WORK) && (await text('.main')).includes(LATER), 60000), await text('.main'));
	check('her other todo stays hidden', !(await text('.main')).includes(TODO));
	check('he adds no todo there', !(await page.$('.main .todos li.add')));
	await shot('7-bob');
	await goTo('Notes');
	await openNote(NOTE);
	check('he opens it', await until(async () => (await docText()) === BODY, 10000), await docText());
	const readOnly = !(await page.$('.doc .paper textarea')) && !(await page.$('.doc .top .share'));
	check('nor propose on it', !(await text('.doc .versions')).includes('New proposal'), await text('.doc .versions'));
	check('and may not edit it', readOnly && (await text('.doc .top .mode')).includes('only reads it'), await text('.doc .top .mode'));
	check('he reads its history', (await edits()).length >= 3, JSON.stringify(await edits()));
	await shot('7b-bob-note');
	await back();
	await goTo('Table editor');
	const hers = async () => {
		const t = await tablesShown();
		return t.notes >= 1 && t.sealed >= 1;
	};
	check('in her table editor, her note opens for him, her todo is sealed', await until(hers, 20000), JSON.stringify(await tablesShown()));
	await pickTable('notes');
	check('her note’s row', await until(async () => (await gridRows()).some((r) => r.title === NOTE), 5000), JSON.stringify(await gridRows()));
	await pickTable('sealed');
	await shot('7c-bob-database');

	// avenCHARLY: nothing of hers
	check('acting as avenCHARLY', await actAs('avenCHARLY'));
	await look('avenALICE', 'Notes');
	const none = /avenCHARLY can't see the \d+ entries in avenALICE/.test(await text('.main'));
	check('he sees none of her entries', !(await note(NOTE)) && none, (await text('.main')).slice(0, 300));
	const dim = await page.$eval('.bar .slot[aria-label="avenALICE"] .mark', (e) => e.classList.contains('dim'));
	check('her mark faded for him', dim);
	await shot('8-charly');
	await click('Act as avenALICE', '.main .empty button');
	check('from there, one click acts as her', await until(async () => (await text('.switcher .pill b')) === 'avenALICE', 5000));

	// who receives her cells: this browser opens them, avenCEO's server only relays their ciphertext
	await look('avenALICE', 'Sync');
	const sync = await text('.main');
	check('her cells: her own, and those her caps share', sync.includes('Its own entries') && sync.includes('Shared: avenBOB reads'), sync.slice(0, 400));
	check('this browser opens them', sync.includes('Samuel’s test browser') && sync.includes('opens it'), sync.slice(0, 400));
	check('avenCEO’s server relays their ciphertext only', /avenCEO's server.*relays its ciphertext only/.test(sync), sync.slice(0, 400));
	await shot('9-sync');

	// as avenALICE: the coop owns her whole vault too, which her owner's passkey approves; revoking avenBOB's read needs
	// none
	await look('avenALICE', 'Access');
	const owning = await ceremonies();
	await choose('.main select[aria-label="What"]', 'the whole vault');
	await choose('.main select[aria-label="Share with"]', 'Maia City COOP');
	await choose('.main select[aria-label="Role"]', 'to own (your passkey approves)');
	await click('Share', '.main .card button.primary');
	const coop = await until(async () => /Maia City COOP owns the whole vault/.test(await text('.main')), 60000);
	check('the coop owns her whole vault', coop, await problem());
	check('in one ceremony', (await ceremonies()) - owning === 1, `${(await ceremonies()) - owning}`);
	const revoking = await ceremonies();
	const revoke = () =>
		page.evaluate(() => {
			const li = [...document.querySelectorAll('.main .grants li')].find((l) => l.textContent?.includes('avenBOB'));
			const button = li?.querySelector('button');
			button?.click();
			return !!button;
		});
	check('she may revoke avenBOB’s read', await revoke());
	await until(async () => (await shown('.main .grants li')).filter((l) => l?.includes('avenBOB')).length < 2);
	check('and his read of her todos tagged “work”', await revoke());
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
	await look('avenALICE', 'Table editor');
	check('as Samuel, her table editor offers to act as her', await waitText('Act as avenALICE', 5000, '.main .db .act'));
	check('nor her table editor, whose grid scrolls on its own', await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
	await shot('12b-phone-database');
	await actAs('avenALICE');
	await look('avenALICE', 'Notes');
	await openNote(NOTE);
	const phoneNote = await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);
	check('a note on a phone: its columns one under another, nothing wider than the screen', phoneNote && (await docText()) === BODY);
	await shot('12c-phone-note');
	await back();
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
	await look('avenALICE', 'Notes');
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
	const signedIn = await page.waitForSelector('.shell', { timeout: 180000 }).then(() => true, () => false);
	check('signed in again, through the server', signedIn, await problem());
	check('in four ceremonies', (await ceremonies()) - signing === 4, `${(await ceremonies()) - signing}`);
	check('every vault came back', await until(() => hasAll(SIX), 120000), (await bar()).join(', '));
	await click('Owners & devices', '.aside .tabs-list .item');
	const both = async () => (await devices()).includes(name) && (await devices()).includes('Samuel’s test browser');
	check('its devices: the one forgotten, and this browser again', await until(both), (await devices()).join(', '));
	await actAs('avenALICE');
	await look('avenALICE', 'Notes');
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
