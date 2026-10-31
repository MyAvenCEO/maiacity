// The admin's passkey, checked (PRODUCTION.md, "How it is checked"), in the browsers' container: avenOS at
// http://localhost:5174 in front of compose's `prod`, an Aven Peer in production's configuration, and Chromium's
// virtual authenticator over CDP, a passkey on one browser profile copied to another as a synced passkey would be.
// `bun run up --check` runs it in three phases around what only the host can do, restarting and wiping that peer:
//
//   node sandbox/claim.mjs claim <run>      on an empty store: a passkey without PRF refused, the network left
//                                           unclaimed; then the first signup, a name then a passkey, claims the
//                                           network and opens the dashboard, the admin's vault owned by the passkey
//                                           and the guardian, owning Maia City, which owns Aven; a
//                                           second signup with another passkey refused; a sign-in from a second
//                                           profile with the same passkey, which becomes a second device; that
//                                           browser's local data then made an older avenOS's, which it resets, and
//                                           a sign-in with the passkey makes it a device again. With PRF, the claim
//                                           opens the vault's keys, and the second browser's one sign-in tap opens
//                                           them
//   node sandbox/claim.mjs restarted <run>  after the Aven Peer restarted: both browsers on the same tree
//   node sandbox/claim.mjs wiped <run>      after its store was wiped: the network unclaimed again
//
// What a claim and a sign-in may do is the model's (`Aven.ID.Claim`, its traces replayed by aven-id's and the Peer's
// tests); here only the box's mechanics are new: real passkeys, a real store, the page. The tree the Aven Peer keeps
// is read from its `network` lines, and held whole, names included, to the model's trace written for this check
// (claims.json, "the box's check"): only the ids and public halves of real passkeys and browsers are put in for the
// model's; the box's MaiaCityGuardian and the Aven Peer's key are the model's own.
import { createHash, createPrivateKey, createPublicKey } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright';
import { lines } from './records.mjs';
import { ownerKeys, withPrf } from './prf.mjs';

const [phase, run = 'runs/latest'] = process.argv.slice(2);
const origin = 'http://localhost:5174';
const guardian = process.env.AVENSANDBOX_GUARDIAN;
const profiles = { first: '/tmp/avensandbox-claim-first', second: '/tmp/avensandbox-claim-second', noPrf: '/tmp/avensandbox-claim-no-prf' };
const state = `${run}/claim.json`;
mkdirSync(run, { recursive: true });

const problems = [];
const started = Date.now();
const report = existsSync(state) ? JSON.parse(readFileSync(state, 'utf8')) : {};
const wait = (ms) => new Promise((done) => setTimeout(done, ms));

// the Aven Peer's newest word on its network, since a moment
function network(since = 0) {
	return lines().findLast((line) => line.peer === 'prod-peer' && line.event === 'network' && line.t >= since);
}

async function open(name, { prf = true } = {}) {
	const context = await chromium.launchPersistentContext(profiles[name], { viewport: { width: 1100, height: 800 } });
	const page = context.pages()[0] ?? (await context.newPage());
	const cdp = await context.newCDPSession(page);
	await cdp.send('WebAuthn.enable');
	const { authenticatorId } = await cdp.send('WebAuthn.addVirtualAuthenticator', {
		options: { protocol: 'ctap2', transport: 'internal', hasResidentKey: true, hasUserVerification: true, hasPrf: prf, isUserVerified: true, automaticPresenceSimulation: true },
	});
	await page.goto(`${origin}/`);
	return { context, page, cdp, authenticatorId };
}

// the view a page shows once the Aven Peer has spoken: claim, invite-only, or the dashboard of the vault it acts as
async function view(page, want, timeout = 30_000) {
	const selector = want === 'dashboard' ? '[data-view="dashboard"]' : `[data-view="${want}"]`;
	return page
		.locator(selector)
		.waitFor({ timeout })
		.then(() => true)
		.catch(() => false);
}

// a signup: the name, then the passkey
async function signUp(page) {
	await page.getByTestId('name').fill(givenName);
	await page.getByTestId('claim').click();
}

// a refusal shown, and the network's tree unchanged since `before`
async function refused(page, what, before) {
	const shown = await page.getByTestId('refused').textContent({ timeout: 15_000 }).catch(() => null);
	if (!shown) problems.push(`${what}: no refusal shown`);
	await wait(300);
	const after = network();
	if (JSON.stringify(after?.tree) !== JSON.stringify(before?.tree)) problems.push(`${what} changed the tree`);
	return shown?.trim();
}

// The model's trace for this check, the name the signup gives, and its tree after a step with the real passkey's and
// browsers' ids put in: `ids` maps the model's ids to the box's, whose public halves come from the box's tree
const model = JSON.parse(readFileSync(new URL('../id/spec/vectors/claims.json', import.meta.url), 'utf8'));
const trace = model.find((v) => v.name.startsWith("the box's check"));
const givenName = trace.input.ops[0].claim.name;
function expectedTree(step, ids, real) {
	const id = (x) => ids[x] ?? x;
	const owner = (o) => o.replace(/^(key|vault):(.*)$/, (_, kind, x) => `${kind}:${id(x)}`);
	const { keys, vaults } = trace.expected[step].tree;
	return {
		keys: keys.map(([k, public_]) => [id(k), ids[k] ? real.keys[ids[k]] : public_]),
		vaults: vaults.map((v) => ({ id: id(v.id), name: v.name, kind: v.kind, owners: v.owners.map(owner) })),
	};
}
// the Aven Peer's tree, a cast's JSON, in the model's form
function asModel(json) {
	const tree = JSON.parse(json);
	return {
		keys: Object.entries(tree.keys),
		vaults: Object.entries(tree.vaults).map(([id, v]) => ({ id, name: v.name, kind: v.kind, owners: v.owners })),
	};
}
function sameTree(what, line, step, ids) {
	const got = line?.tree ? asModel(line.tree) : null;
	const want = got && expectedTree(step, ids, JSON.parse(line.tree));
	if (JSON.stringify(got) !== JSON.stringify(want))
		problems.push(`${what}, the tree is ${JSON.stringify(got)}, not the model's ${JSON.stringify(want)}`);
}
// what the Aven Peer said it did: the device a claim or sign-in added
const said = (event, since) => lines().findLast((line) => line.peer === 'prod-peer' && line.event === event && line.t >= since);

const devices = (line) => (line?.tree ? Object.values(JSON.parse(line.tree).vaults).filter((v) => v.kind === 'device').length : 0);

if (phase === 'claim') {
	for (const dir of Object.values(profiles)) rmSync(dir, { recursive: true, force: true });
	const since = Date.now();
	// a passkey without PRF never makes a vault (Samuel, 31 Oct 2026): its signup is refused with a plain word, before
	// anything is sent or kept, and the network stays unclaimed
	const noPrf = await open('noPrf', { prf: false });
	if (await view(noPrf.page, 'claim')) {
		await signUp(noPrf.page);
		const word = await noPrf.page.getByTestId('refused').textContent({ timeout: 15_000 }).catch(() => '');
		if (!word.includes('passkey provider')) problems.push(`a passkey without PRF was not refused plainly: "${word}"`);
		await noPrf.page.screenshot({ path: `${run}/claim-no-prf.png` });
		await wait(1000);
		if (said('claimed', since)) problems.push('a passkey without PRF claimed the network');
		const kept = await noPrf.page.evaluate(async () => (await import('/id.svelte.js')).ownerKeys()).catch((e) => `unread: ${e}`);
		if (kept !== null) problems.push(`a passkey without PRF left owner keys in the Peer-Light's store: ${kept}`);
	} else problems.push('an unclaimed network shows the no-PRF browser no claim screen');
	await noPrf.context.close();
	const first = await open('first');
	if (!(await view(first.page, 'claim'))) problems.push('an unclaimed network shows no claim screen');
	await first.page.screenshot({ path: `${run}/claim-unclaimed.png` });

	// the first signup claims: the dashboard, as the admin's vault
	await signUp(first.page);
	const claimedAt = Date.now();
	if (!(await view(first.page, 'dashboard'))) problems.push('the claim did not open the dashboard');
	report.claimMs = Date.now() - claimedAt;
	report.admin = await first.page.locator('[data-view="dashboard"]').first().getAttribute('data-account').catch(() => null);
	if (!report.admin?.startsWith('person-')) problems.push(`the dashboard acts as ${report.admin}, not the admin's vault`);
	await first.page.screenshot({ path: `${run}/claim-dashboard.png` });
	// the claim's own assertion asked the passkey's PRF: its vault's keys are open on this browser, so no "open your
	// vault" is offered, and the Peer-Light keeps the owner and seal keys' public halves (id/caps, "Passkeys and the PRF step")
	if (await first.page.getByTestId('open-vault').count()) problems.push('after the claim the vault was not opened by the passkey\'s PRF');
	report.ownerKeys = await ownerKeys(first.page);
	if (!report.ownerKeys?.owner || !report.ownerKeys?.seal) problems.push('the claiming browser keeps no owner and seal public halves');
	const claimed = network(since);
	if (!claimed?.claimed || devices(claimed) !== 2) problems.push(`after the claim the tree has ${devices(claimed)} devices, not 2`);
	// the admin's vault is owned by its passkey and by MaiaCityGuardian, the box's test one
	const tree = claimed?.tree ? JSON.parse(claimed.tree) : { keys: {}, vaults: {} };
	report.owners = tree.vaults[report.admin]?.owners;
	const passkeyOwner = report.owners?.[0]?.replace(/^key:/, '');
	if (report.owners?.length !== 2 || !passkeyOwner?.startsWith('passkey-') || !tree.keys[passkeyOwner]?.startsWith('es256:'))
		problems.push(`the admin's vault is owned by ${JSON.stringify(report.owners)}, not its passkey and the guardian`);
	if (report.owners?.[1] !== 'key:maia-city-guardian' || tree.keys['maia-city-guardian'] !== guardian)
		problems.push(`the admin's vault's second owner is ${report.owners?.[1]}, not the box's MaiaCityGuardian`);
	// the whole tree: the admin's vault named after them, Maia City, Aven, the Aven Peer and this browser
	const ids = { 'person-a': report.admin, 'passkey-a': passkeyOwner, 'device-1': said('claimed', since)?.device };
	sameTree('after the claim', claimed, 0, ids);
	report.names = Object.fromEntries(Object.entries(tree.vaults).map(([id, v]) => [id, v.name]));
	// the dashboard shows the admin's vault by its name
	const shownName = (await first.page.locator('[data-view="dashboard"] h1').first().textContent().catch(() => '')).trim();
	if (shownName !== `${givenName}'s vault`) problems.push(`the dashboard shows "${shownName}", not "${givenName}'s vault"`);

	// the second browser: invite only, and no signup offered, so no passkey made; a deliberate second signup at #/claim,
	// with another passkey, refused by the Aven Peer
	const second = await open('second');
	if (!(await view(second.page, 'invite-only'))) problems.push('a claimed network shows another browser no "invite only"');
	report.inviteOnly = (await second.page.getByTestId('invite-only').textContent().catch(() => '')).trim();
	if (await second.page.getByTestId('claim').count()) problems.push('a claimed network offers another browser a signup');
	if (report.inviteOnly !== 'avenOS · invite only, coming soon') problems.push(`another browser sees "${report.inviteOnly}"`);
	await second.page.screenshot({ path: `${run}/claim-invite-only.png` });
	await second.page.goto(`${origin}/#/claim`);
	await view(second.page, 'claim');
	await signUp(second.page);
	report.secondSignup = await refused(second.page, 'a second signup with another passkey', claimed);
	// the refused signup's passkey stays: the Aven Peer's word never deletes one
	const strays = (await second.cdp.send('WebAuthn.getCredentials', { authenticatorId: second.authenticatorId })).credentials;
	if (strays.length !== 1) problems.push(`the refused signup left ${strays.length} passkeys, not its 1`);
	await second.page.screenshot({ path: `${run}/claim-refused.png` });

	// the same passkey on the second profile, as a synced one: it signs in and becomes a second device
	const { credentials } = await first.cdp.send('WebAuthn.getCredentials', { authenticatorId: first.authenticatorId });
	// the first signup made one passkey and nothing deleted it
	if (credentials.length !== 1) problems.push(`the first browser holds ${credentials.length} passkeys, not 1`);
	// the claim's passkey is the one the tree names: `passkey-` and the start of its public key's SHA-256 (aven-id's
	// passkey_id)
	const named = (credential) => {
		const key = createPrivateKey({ key: Buffer.from(credential.privateKey, 'base64'), format: 'der', type: 'pkcs8' });
		const spki = createPublicKey(key).export({ format: 'der', type: 'spki' });
		return `passkey-${createHash('sha256').update(spki).digest('hex').slice(0, 16)}`;
	};
	const passkey = credentials.find((credential) => Object.keys(JSON.parse(claimed.tree).keys).includes(named(credential)));
	if (!passkey) problems.push("the first browser holds no passkey the tree names");
	// the refused signup made a passkey on the second profile: a person's other browser holds only their own
	await second.cdp.send('WebAuthn.clearCredentials', { authenticatorId: second.authenticatorId });
	await second.cdp.send('WebAuthn.addCredential', { authenticatorId: second.authenticatorId, credential: passkey });
	// Chromium's copy carries no PRF secret, as a synced passkey's would: the box stands in for its PRF (prf.mjs)
	await withPrf(second.context);
	await second.page.goto(`${origin}/`);
	await view(second.page, 'invite-only');
	const signedAt = Date.now();
	await second.page.getByTestId('sign-in').click();
	if (!(await view(second.page, 'dashboard'))) problems.push('the sign-in did not open the dashboard');
	report.signInMs = Date.now() - signedAt;
	const signedIn = await second.page.locator('[data-view="dashboard"]').first().getAttribute('data-account').catch(() => null);
	if (signedIn !== report.admin) problems.push(`the second browser acts as ${signedIn}, not ${report.admin}`);
	// a new browser opens its vault with the passkey alone, in its one sign-in tap, which asked the PRF too (A43). That
	// the same passkey derives the same keys on two browsers is the engines step's (its PRF stand-in on both)
	if (await second.page.getByTestId('open-vault').count()) problems.push("the sign-in's one tap did not open the vault's keys");
	if (!(await ownerKeys(second.page))?.owner) problems.push('the signed-in browser keeps no owner public half');
	await second.page.screenshot({ path: `${run}/claim-opened.png` });
	await wait(300);
	report.tree = network(since)?.tree;
	if (devices(network()) !== 3) problems.push(`after the sign-in the tree has ${devices(network())} devices, not 3`);
	sameTree('after the sign-in', network(since), 2, { ...ids, 'device-2': said('signed-in', since)?.device });
	// the admin's own vault is governed by its owner keys, the passkey and MaiaCityGuardian, as many as the tree has
	// (a bug of 30 Oct 2026 said "its owner key alone"); Aven opens as an agent's vault
	const text = async (testid) => (await second.page.getByTestId(testid).first().textContent().catch(() => '')).trim();
	await second.page.goto(`${origin}/#/${report.admin}/vault`);
	await second.page.locator(`[data-view="vault"][data-shown="${report.admin}"]`).waitFor({ timeout: 10_000 }).catch(() => {});
	const keys = (report.owners ?? []).filter((o) => o.startsWith('key:')).length;
	const governed = await text('governed-by');
	if (governed !== `its ${keys} owner keys: nothing is above it`) problems.push(`the admin's vault is governed by "${governed}"`);
	await second.page.goto(`${origin}/#/${report.admin}/vault/aven`);
	await second.page.locator('[data-view="vault"][data-shown="aven"]').waitFor({ timeout: 10_000 }).catch(() => {});
	const kind = await text('kind');
	if (kind !== 'agent vault') problems.push(`Aven shows as "${kind}", not an agent vault`);
	// Maia City in the admin's Vault, where it opens as a vault the admin governs; the switcher never offers it
	await second.page.goto(`${origin}/#/${report.admin}/vault/maia-city`);
	const opened = second.page.locator('[data-view="vault"][data-shown="maia-city"]');
	if (!(await opened.waitFor({ timeout: 10_000 }).then(() => true, () => false))) problems.push("Maia City doesn't open in the admin's Vault");
	await second.page.screenshot({ path: `${run}/claim-vault-maia-city.png`, fullPage: true });
	await second.page.getByTestId('account').click();
	const offered = await second.page.locator('#accounts [data-account]').evaluateAll((els) => els.map((el) => el.dataset.account));
	if (JSON.stringify(offered) !== JSON.stringify([report.admin])) problems.push(`the switcher offers ${JSON.stringify(offered)}, not the admin alone`);
	await second.page.screenshot({ path: `${run}/claim-signed-in.png` });

	// A browser whose local data an older avenOS left (store/README.md, the opfs driver's `meta/version`): the
	// Peer-Light clears its origin and starts fresh, a new device that says so, and the passkey makes it one again.
	// Away from avenOS its worker ends; an older marker is put in its store, and avenOS opened again.
	const deviceBefore = said('signed-in', since)?.device;
	await second.page.goto(`${origin}/peer-light/aven_peer_light.js`);
	for (let i = 0; i < 20; i++) {
		const planted = await second.page
			.evaluate(async () => {
				const root = await navigator.storage.getDirectory();
				const store = await root.getDirectoryHandle('store', { create: true });
				const meta = await store.getDirectoryHandle('meta', { create: true });
				const file = await meta.getFileHandle('version', { create: true });
				const writable = await file.createWritable();
				await writable.write('avenDB store 0\n');
				await writable.close();
				return true;
			})
			.catch(() => false);
		if (planted) break;
		await wait(250);
	}
	const resetAt = Date.now();
	await second.page.goto(`${origin}/`);
	if (!(await view(second.page, 'invite-only'))) problems.push('a browser with an older store is still a device');
	report.reset = (await second.page.getByTestId('reset').textContent({ timeout: 10_000 }).catch(() => '')).trim();
	const sentence = "This browser's local data was from an older avenOS and was reset. Sign in with your passkey.";
	if (report.reset !== sentence) problems.push(`a reset browser says "${report.reset}", not "${sentence}"`);
	const resetLine = lines().find((l) => l.event === 'reset' && l.t >= resetAt);
	if (!resetLine) problems.push('the Peer-Light wrote no reset line');
	await second.page.screenshot({ path: `${run}/claim-reset.png` });
	await second.page.getByTestId('sign-in').click();
	if (!(await view(second.page, 'dashboard'))) problems.push('after a reset, the sign-in did not open the dashboard');
	const again = await second.page.locator('[data-view="dashboard"]').first().getAttribute('data-account').catch(() => null);
	if (again !== report.admin) problems.push(`after a reset the browser acts as ${again}, not ${report.admin}`);
	await wait(300);
	const deviceAfter = said('signed-in', resetAt)?.device;
	if (!deviceAfter || deviceAfter === deviceBefore) problems.push(`after a reset the sign-in added ${deviceAfter}, not a new device`);
	if (devices(network()) !== 4) problems.push(`after the reset's sign-in the tree has ${devices(network())} devices, not 4`);
	report.tree = network(since)?.tree;
	await second.page.screenshot({ path: `${run}/claim-reset-signed-in.png` });
	for (const b of [first, second]) await b.context.close();
}

if (phase === 'restarted') {
	let line = network();
	for (let i = 0; i < 60 && !(line?.t > (report.checkedAt ?? 0)); i++) {
		await wait(250);
		line = network();
	}
	if (JSON.stringify(line?.tree) !== JSON.stringify(report.tree)) problems.push('after a restart the Aven Peer has another tree');
	for (const name of ['first', 'second']) {
		const b = await open(name);
		if (!(await view(b.page, 'dashboard'))) problems.push(`after a restart the ${name} browser is no device`);
		await b.page.screenshot({ path: `${run}/claim-restarted-${name}.png` });
		await b.context.close();
	}
}

if (phase === 'wiped') {
	let line = network();
	for (let i = 0; i < 60 && !(line?.t > (report.checkedAt ?? 0) && !line.claimed); i++) {
		await wait(250);
		line = network();
	}
	if (line?.claimed !== false) problems.push('after a wipe the network is still claimed');
	const b = await open('first');
	if (!(await view(b.page, 'claim'))) problems.push('after a wipe the first browser sees no claim screen');
	await b.page.screenshot({ path: `${run}/claim-wiped.png` });
	await b.context.close();
}

report[phase] = { ok: problems.length === 0, problems, ms: Date.now() - started };
report.checkedAt = Date.now();
writeFileSync(state, `${JSON.stringify(report, null, 2)}\n`);
for (const problem of problems) console.log(`avenSANDBOX: claim: ${problem}`);
console.log(`avenSANDBOX: claim, ${phase}: ${problems.length ? 'FAILED' : 'ok'} (${((Date.now() - started) / 1000).toFixed(1)} s)`);
process.exit(problems.length ? 1 : 0);
