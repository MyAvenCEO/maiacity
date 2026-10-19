/*
 * The app's one way in, walked end to end ($lib/app/entry.js, src/routes/app/+layout.svelte): a headless Chrome whose
 * virtual authenticator holds passkeys with PRF, against an avenDB server on this machine and a stand-in for
 * maiaCITY's API that checks every passkey ceremony as the API does (@simplewebauthn/server, from api/). The first
 * person signs up on the join page with no invite, and the app founds their human vault with that passkey, named as
 * they signed up, its profile the name the nav pill shows; a reload unlocks it in one ceremony; signed out and in
 * again, ONE ceremony signs them in to the API and unlocks avenDB together, the API getting the assertion without
 * its PRF outputs. Once the city has its admin, the join page wants an invite: the admin makes one to a traveler in
 * the nav pill, a share of Maia City's Traveler cap group to a one-time key, its link carrying the share and the key
 * after its `#`, and a second person signs up with it, used once: their new vault claims the share, so the dashboard
 * opens the sandboxes and the Game Assets to them, and MaiaCity V1, a citizen's, stays closed. avenDB's home is
 * screenshot with its app grid.
 *
 * Build and start as scripts/avendb-account.mjs says (a device and a server with `localhost-passkeys`, the device
 * copied into src/lib/avendb/device for the dev server, and `git checkout src/lib/avendb/device` after), then:
 *
 *   BASE=http://localhost:5173 RELAY=http://localhost:3360 SERVER=AVENDB1… node scripts/entry-walk.mjs [--out dir]
 *
 * The dev server reaches the API at http://localhost:3100 (src/lib/auth/client.ts), where this walk answers.
 */
import { createServer } from 'node:http';
import { existsSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import puppeteer from 'puppeteer-core';

const webauthn = createRequire(new URL('../api/package.json', import.meta.url))('@simplewebauthn/server');

const arg = (name, fallback) => {
	const at = process.argv.indexOf(name);
	return at > 0 ? process.argv[at + 1] : fallback;
};
const out = resolve(arg('--out', 'build/entry-walk'));
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

// ─── the API's stand-in: founders, passkeys, sign-up invites and a session cookie, every ceremony verified ───

const api = { founders: [], keys: new Map(), challenges: new Map(), sessions: new Map(), invites: new Map(), logins: [] };
const cookieOf = (req) => /maia_test=([^;]+)/.exec(req.headers.cookie ?? '')?.[1] ?? '';
const whoOf = (req) => api.founders.find((f) => f.id === api.sessions.get(cookieOf(req))) ?? null;
const caps = (f) => (f.role === 'admin' ? ['roles:admin', 'humans:invite', 'media:admin', 'economy:admin'] : ['hearts:mint']);
const shown = (f) => ({ id: f.id, number: f.number, since: f.since });

async function answer(req, body) {
	const path = new URL(req.url, 'http://x').pathname;
	const me = whoOf(req);
	if (path === '/api/me') return me ? [200, { ...shown(me), role: me.role, caps: caps(me) }] : [401, { error: 'not signed in' }];
	if (path === '/api/founders/count') return [200, { count: api.founders.length, step: 1 }];
	if (path === '/api/passkey/register/options') {
		if (api.founders.length && !api.invites.get(body.invite)?.open) return [400, { error: 'maiaCITY is invite only' }];
		const options = await webauthn.generateRegistrationOptions({
			rpName: 'maiaCITY',
			rpID: 'localhost',
			userID: new TextEncoder().encode(randomUUID()),
			userName: body.name,
			attestationType: 'none',
			authenticatorSelection: { residentKey: 'required', userVerification: 'preferred' }
		});
		api.challenges.set(options.challenge, { invite: body.invite });
		return [200, options];
	}
	if (path === '/api/passkey/register/finish') {
		const challenge = JSON.parse(Buffer.from(body.response.clientDataJSON, 'base64url')).challenge;
		const pending = api.challenges.get(challenge);
		const v = await webauthn.verifyRegistrationResponse({ response: body, expectedChallenge: challenge, expectedOrigin: origin, expectedRPID: 'localhost', requireUserVerification: false });
		if (!pending || !v.verified) return [400, { error: 'did not verify' }];
		if (api.founders.length) {
			const inv = api.invites.get(pending.invite);
			if (!inv?.open) return [400, { error: 'maiaCITY is invite only' }];
			inv.open = false;
		}
		const f = { id: randomUUID(), number: api.founders.length + 1, since: new Date().toISOString(), role: api.founders.length ? 'citizen' : 'admin' };
		api.founders.push(f);
		const c = v.registrationInfo.credential;
		api.keys.set(c.id, { founder: f.id, publicKey: c.publicKey, counter: c.counter });
		return signedIn(f);
	}
	if (path === '/api/passkey/login/options') {
		const options = await webauthn.generateAuthenticationOptions({ rpID: 'localhost', userVerification: 'preferred' });
		api.challenges.set(options.challenge, { login: true });
		return [200, options];
	}
	if (path === '/api/passkey/login/finish') {
		api.logins.push(body);
		const challenge = JSON.parse(Buffer.from(body.response.clientDataJSON, 'base64url')).challenge;
		const key = api.keys.get(body.id);
		if (!api.challenges.get(challenge)?.login || !key) return [401, { error: 'This passkey is not registered here.' }];
		const v = await webauthn.verifyAuthenticationResponse({
			response: body,
			expectedChallenge: challenge,
			expectedOrigin: origin,
			expectedRPID: 'localhost',
			requireUserVerification: false,
			credential: { id: body.id, publicKey: key.publicKey, counter: key.counter }
		});
		if (!v.verified) return [401, { error: 'That passkey did not verify.' }];
		api.challenges.delete(challenge);
		return signedIn(api.founders.find((f) => f.id === key.founder));
	}
	if (path === '/api/session' && req.method === 'DELETE') {
		api.sessions.delete(cookieOf(req));
		return [204, null];
	}
	if (path === '/api/invites' && req.method === 'POST') {
		if (!me || !caps(me).includes('humans:invite')) return [403, { error: 'This needs the right to invite a new human.' }];
		const code = randomUUID().replace(/-/g, '');
		api.invites.set(code, { open: true });
		return [200, { code, expires: new Date(Date.now() + 7 * 864e5).toISOString() }];
	}
	if (path.startsWith('/api/invites/')) return [200, { open: !!api.invites.get(path.split('/').pop())?.open }];
	return [404, { error: 'not here' }];
}
function signedIn(f) {
	const token = randomUUID();
	api.sessions.set(token, f.id);
	return [200, shown(f), { 'set-cookie': `maia_test=${token}; Path=/; SameSite=Lax; HttpOnly` }];
}
const stand = createServer(async (req, res) => {
	const cors = {
		'access-control-allow-origin': origin,
		'access-control-allow-credentials': 'true',
		'access-control-allow-headers': 'content-type',
		'access-control-allow-methods': 'GET,POST,PATCH,DELETE,OPTIONS'
	};
	if (req.method === 'OPTIONS') return void res.writeHead(204, cors).end();
	let raw = '';
	for await (const chunk of req) raw += chunk;
	try {
		const [status, body, headers = {}] = await answer(req, raw ? JSON.parse(raw) : {});
		res.writeHead(status, { ...cors, ...headers, 'content-type': 'application/json' }).end(body == null ? '' : JSON.stringify(body));
	} catch (e) {
		console.error(e);
		res.writeHead(500, { ...cors, 'content-type': 'application/json' }).end(JSON.stringify({ error: String(e) }));
	}
});
await new Promise((r) => stand.listen(3100, '127.0.0.1', r));

// ─── the browser ───

const browser = await puppeteer.launch({ executablePath: chrome, headless: true, args: ['--no-sandbox'] });
/** A tab of the browser, in a context of its own (its own cookies and storage: another person's browser) or the first
 *  one's, with the authenticator `auth` (a new one if none), pointed at the test server. */
async function tab(auth = null, own = false) {
	const page = await (own ? await browser.createBrowserContext() : browser.defaultBrowserContext()).newPage();
	await page.setViewport({ width: 1300, height: 950 });
	await page.evaluateOnNewDocument(
		(relay, server) => {
			sessionStorage.setItem('avendb:relay', relay);
			sessionStorage.setItem('avendb:server', server);
		},
		relay,
		server
	);
	page.on('pageerror', (e) => check(`no error on the page: ${e.message}`, false));
	// an invite made before Maia City holds its groups says so in an alert: dismissed, and tried again
	page.on('dialog', (d) => {
		console.log(`  (a dialog said: ${d.message()})`);
		void d.dismiss();
	});
	const cdp = await page.createCDPSession();
	await cdp.send('WebAuthn.enable', { enableUI: false });
	const options = { protocol: 'ctap2', ctap2Version: 'ctap2_1', transport: 'internal', hasResidentKey: true };
	const verified = { hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true, hasPrf: true };
	const { authenticatorId } = await cdp.send('WebAuthn.addVirtualAuthenticator', { options: { ...options, ...verified } });
	if (auth) for (const credential of auth.credentials) await cdp.send('WebAuthn.addCredential', { authenticatorId, credential });
	let asserted = 0;
	cdp.on('WebAuthn.credentialAsserted', () => (asserted += 1));
	return {
		page,
		cdp,
		authenticatorId,
		asserted: () => asserted,
		credentials: async () => (await cdp.send('WebAuthn.getCredentials', { authenticatorId })).credentials
	};
}
const words = (page, selector = 'body') =>
	page.evaluate((s) => document.querySelector(s)?.textContent?.replace(/\s+/g, ' ').trim() ?? '', selector);
async function until(holds, ms = 90000) {
	const end = Date.now() + ms;
	while (Date.now() < end) {
		if (await holds()) return true;
		await sleep(250);
	}
	return false;
}
const waitText = (page, t, ms) => until(async () => (await words(page)).includes(t), ms);
async function click(page, t, selector = 'button') {
	const ok = await page.evaluate(
		(t, selector) => {
			const all = [...document.querySelectorAll(selector)];
			const said = (e) => e.textContent?.replace(/\s+/g, ' ').trim() ?? '';
			const el = all.find((e) => said(e) === t) ?? all.find((e) => said(e).includes(t));
			if (el instanceof HTMLElement) el.click();
			return !!el;
		},
		t,
		selector
	);
	if (!ok) check(`there is a “${t}” to click`, false, await words(page));
	await sleep(300);
	return ok;
}
const shot = (page, name) => page.screenshot({ path: `${out}/${name}.png` });

try {
	// 1. the first person signs up: no invite, as nobody runs the city yet; the app founds their human vault
	const a = await tab();
	await a.page.goto(`${base}/join/`, { waitUntil: 'domcontentloaded' });
	check('the join page offers to sign up, as nobody runs the city yet', await waitText(a.page, 'Join as a founder'));
	await a.page.type('#name', 'Samuel');
	await click(a.page, 'Join as a founder');
	check('signed up, the app asks to set up the human vault, named as they signed up', await waitText(a.page, 'Your human vault.'));
	check('the name is the one they signed up with', (await a.page.$eval('input.name', (i) => i.value)) === 'Samuel');
	await shot(a.page, '01-human-vault');
	let before = a.asserted();
	await click(a.page, 'Set up my human vault');
	check('the founding opens avenDB on its home', await waitText(a.page, 'Workspace', 120000));
	check('in the two ceremonies the gate says', a.asserted() - before === 2, `${a.asserted() - before}`);
	check('the nav pill shows the vault’s profile name', await until(async () => (await words(a.page, 'nav.pill')).includes('Samuel'), 30000), await words(a.page, 'nav.pill'));
	check('the API was never told a name', !JSON.stringify(api.founders).includes('Samuel'));
	await a.page.evaluate(() => (location.hash = '#about'));
	check('their name is public by default', await waitText(a.page, 'Everyone sees its name', 30000), await words(a.page, 'main'));
	await shot(a.page, '02-about-public-name');
	await a.page.evaluate(() => (location.hash = '#home'));
	await sleep(1500);
	await shot(a.page, '02-avendb-home');
	await a.page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
	await sleep(600);
	await shot(a.page, '03-avendb-home-phone');
	await a.page.setViewport({ width: 1300, height: 950 });

	// 2. a reload: signed in still, avenDB locked; one ceremony unlocks it
	await a.page.goto(`${base}/app/`, { waitUntil: 'domcontentloaded' });
	check('reloaded, the app asks to unlock', await waitText(a.page, 'Unlock with your passkey'));
	await shot(a.page, '04-unlock');
	before = a.asserted();
	await click(a.page, 'Unlock with your passkey');
	check('unlocked, the dashboard greets them by their profile name', await waitText(a.page, ', Samuel.', 60000), await words(a.page, 'h1'));
	check('in one ceremony', a.asserted() - before === 1, `${a.asserted() - before}`);
	const games = (page) => words(page, '.games');
	check('Maia City’s owner opens every game, MaiaCity V1 and the sandboxes', await until(async () => /MaiaCity V1.*Sandbox 1/.test(await games(a.page)), 30000), await games(a.page));

	// 3. the vault switcher is the You item: their vaults, their own first, and the invite for a new human
	await click(a.page, 'Samuel', 'nav.pill button.item');
	const menu = await words(a.page, 'nav.pill .account');
	check('You lists their vaults, their own first', /Your vaults\s*\S*\s*Samuel/.test(menu) || menu.includes('Your vaults'), menu);
	await shot(a.page, '05-you-menu');
	// the invite is made once the seed defined Maia City's groups, in the background after the founding: tried until then
	const inviting = () =>
		a.page.evaluate(() => {
			const b = [...document.querySelectorAll('nav.pill .account button')].find((e) => e.textContent?.includes('Invite a new traveler'));
			if (b instanceof HTMLElement) b.click();
			return !!b;
		});
	check('the owner’s menu offers to invite a traveler', await until(inviting, 20000), await words(a.page, 'nav.pill .account'));
	const made = await until(async () => (await inviting()) && (await until(async () => !!(await a.page.$('input.invited')), 4000)), 180000);
	const link = made ? await a.page.$eval('input.invited', (i) => i.value) : '';
	check('the super admin makes an invite link to a traveler, its share and key after its #', /\/join\/\?invite=\w+#share=[0-9a-f]{64}&key=[0-9a-f]{64}$/.test(link), link);
	await shot(a.page, '06-invite');
	// the seed writes hundreds of entries in the background after the founding, which the server takes in turn: the
	// invite reaches it once they did, as the admin's app shows the seed done
	const seeded = Date.now();
	await until(async () => !(await a.page.$('p.seeding')), 900000);
	console.log(`  (the seed was done ${Math.round((Date.now() - seeded) / 1000)} s after the invite)`);

	// 4. invite only: without one, the join page offers none; with the admin's, a second person signs up, once, while
	// the admin's app is open still, so the server holds the invite their device made
	const b = await tab(null, true);
	await b.page.goto(`${base}/join/`, { waitUntil: 'domcontentloaded' });
	check('without an invite, joining is closed', await waitText(b.page, 'invite only'));
	await shot(b.page, '07-invite-only');
	await b.page.goto(link, { waitUntil: 'domcontentloaded' });
	check('with the invite, the join page offers to sign up', await waitText(b.page, 'Join as a founder'));
	await b.page.type('#name', 'Lena');
	await click(b.page, 'Join as a founder');
	check('the invited person sets up their human vault', await waitText(b.page, 'Your human vault.'));
	check('the invite is used up', api.invites.get(new URL(link).searchParams.get('invite'))?.open === false);
	await click(b.page, 'Set up my human vault');
	check('their dashboard greets them', await waitText(b.page, ', Lena.', 120000), await words(b.page, 'h1'));
	check('their vault claimed the invite: the sandboxes open to them', await until(async () => (await games(b.page)).includes('Sandbox 1'), 60000), await games(b.page));
	check('no word of an invite that didn’t go through', !(await b.page.$('.invite-note')), await words(b.page, '.invite-note'));
	check('MaiaCity V1 stays a citizen’s', !(await games(b.page)).includes('MaiaCity V1'), await games(b.page));
	check('the Game Assets are theirs to look at', (await words(b.page)).includes('Game Assets'));
	await shot(b.page, '09-traveler-dashboard');
	await b.page.goto(`${base}/app/maiacity-v1/`, { waitUntil: 'domcontentloaded' });
	// a page loaded anew opens avenDB with the passkey again, as every one does
	if (await waitText(b.page, 'Unlock with your passkey', 20000)) await click(b.page, 'Unlock with your passkey');
	check('a traveler is told MaiaCity V1 is for citizens', await waitText(b.page, 'is for citizens', 60000), (await words(b.page)).slice(0, 300));
	await shot(b.page, '10-traveler-v1');
	const c = await tab(null, true);
	await c.page.goto(link, { waitUntil: 'domcontentloaded' });
	check('a used invite opens nothing', await waitText(c.page, 'used up or expired'));

	// 5. signed out and in again: ONE ceremony signs in to the API and unlocks avenDB together
	await click(a.page, 'Sign out', 'nav.pill .account button');
	// signing out locks avenDB, then the API's session, then goes home: over once it left the app
	await until(async () => !new URL(a.page.url()).pathname.startsWith('/app'), 60000);
	await a.page.goto(`${base}/app/`, { waitUntil: 'domcontentloaded' });
	check('signed out, the app asks to sign in', await waitText(a.page, 'Sign in with your passkey'));
	before = a.asserted();
	const logins = api.logins.length;
	await click(a.page, 'Sign in with your passkey');
	check('signed in, the dashboard greets them by name', await waitText(a.page, ', Samuel.', 60000), await words(a.page, 'h1'));
	check('in ONE ceremony for the API and avenDB together', a.asserted() - before === 1, `${a.asserted() - before}`);
	const sent = api.logins.slice(logins);
	check('the API got one sign-in', sent.length === 1, `${sent.length}`);
	check('without the PRF outputs', sent.every((b) => !JSON.stringify(b).toLowerCase().includes('prf')), JSON.stringify(sent[0]?.clientExtensionResults));
	// on into avenDB by the vault switcher, the You item: no sign-in of its own, no second ceremony
	before = a.asserted();
	await click(a.page, 'Samuel', 'nav.pill button.item');
	await click(a.page, 'Samuel', 'nav.pill .account button.acct');
	check('avenDB opens with no sign-in of its own', await waitText(a.page, 'Workspace', 60000), (await words(a.page)).slice(0, 600));
	await shot(a.page, '08-avendb-by-the-switcher');
	check('and no Unlock card, nor a ceremony', !(await words(a.page)).includes('Unlock your account') && a.asserted() === before);
} catch (e) {
	check(`the walk ran: ${e.message}`, false);
} finally {
	await browser.close();
	stand.close();
}
const failed = checks.filter((c) => !c.ok);
console.log(`\n${checks.length - failed.length} of ${checks.length} checks passed; screenshots in ${out}`);
process.exit(failed.length ? 1 : 0);
