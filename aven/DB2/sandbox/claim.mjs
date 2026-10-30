// The admin's passkey, checked (PRODUCTION.md, "How it is checked"), in the browsers' container: avenOS at
// http://localhost:5174 in front of compose's `prod`, an Aven Peer in production's configuration, and Chromium's
// virtual authenticator over CDP, a passkey on one browser profile copied to another as a synced passkey would be.
// `bun run up --check` runs it in three phases around what only the host can do, restarting and wiping that peer:
//
//   node sandbox/claim.mjs claim <run>      on an empty store: the first signup claims the network and opens the
//                                           dashboard, the admin's vault owned by the passkey and the guardian; a
//                                           second signup with another passkey refused; a sign-in from a second
//                                           profile with the same passkey, which becomes a second device
//   node sandbox/claim.mjs restarted <run>  after the Aven Peer restarted: both browsers on the same tree
//   node sandbox/claim.mjs wiped <run>      after its store was wiped: the network unclaimed again
//
// What a claim and a sign-in may do is the model's (`Aven.ID.Claim`, its traces replayed by aven-id's and the Peer's
// tests); here only the box's mechanics are new: real passkeys, a real store, the page. The tree the Aven Peer keeps
// is read from its `network` lines; the box's MaiaCityGuardian from its configuration.
import { createHash, createPrivateKey, createPublicKey } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright';
import { lines } from './records.mjs';

const [phase, run = 'runs/latest'] = process.argv.slice(2);
const origin = 'http://localhost:5174';
const guardian = process.env.AVENSANDBOX_GUARDIAN;
const profiles = { first: '/tmp/avensandbox-claim-first', second: '/tmp/avensandbox-claim-second' };
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

async function open(name) {
	const context = await chromium.launchPersistentContext(profiles[name], { viewport: { width: 1100, height: 800 } });
	const page = context.pages()[0] ?? (await context.newPage());
	const cdp = await context.newCDPSession(page);
	await cdp.send('WebAuthn.enable');
	const { authenticatorId } = await cdp.send('WebAuthn.addVirtualAuthenticator', {
		options: { protocol: 'ctap2', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true },
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

const signUp = (page) => page.getByTestId('claim').click();

// a refusal shown, and the network's tree unchanged since `before`
async function refused(page, what, before) {
	const shown = await page.getByTestId('refused').textContent({ timeout: 15_000 }).catch(() => null);
	if (!shown) problems.push(`${what}: no refusal shown`);
	await wait(300);
	const after = network();
	if (JSON.stringify(after?.tree) !== JSON.stringify(before?.tree)) problems.push(`${what} changed the tree`);
	return shown?.trim();
}

const devices = (line) => (line?.tree ? Object.values(JSON.parse(line.tree).vaults).filter((v) => v.kind === 'device').length : 0);

if (phase === 'claim') {
	for (const dir of Object.values(profiles)) rmSync(dir, { recursive: true, force: true });
	const since = Date.now();
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
	await second.page.goto(`${origin}/`);
	await view(second.page, 'invite-only');
	const signedAt = Date.now();
	await second.page.getByTestId('sign-in').click();
	if (!(await view(second.page, 'dashboard'))) problems.push('the sign-in did not open the dashboard');
	report.signInMs = Date.now() - signedAt;
	const signedIn = await second.page.locator('[data-view="dashboard"]').first().getAttribute('data-account').catch(() => null);
	if (signedIn !== report.admin) problems.push(`the second browser acts as ${signedIn}, not ${report.admin}`);
	await wait(300);
	report.tree = network(since)?.tree;
	if (devices(network()) !== 3) problems.push(`after the sign-in the tree has ${devices(network())} devices, not 3`);
	await second.page.screenshot({ path: `${run}/claim-signed-in.png` });
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
