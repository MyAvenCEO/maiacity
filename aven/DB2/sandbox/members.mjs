// The members' network, checked at the Peer level (MILESTONE2.md, "How it is checked": steps 1–3, 5 and 6), in the
// browsers' container: avenOS at http://localhost:5174 in front of compose's `prod`, an Aven Peer in production's
// configuration, with Chromium's virtual authenticator. Each browser profile's Peer-Light is driven through its worker,
// as the page drives it: statements made with what the Peer-Light computes, asked of its worker as the page asks (os/web/id.svelte.js), and signed by the profile's passkey. What
// the peers did is read from their own timeline lines. avenOS's Invite, Join and Chat screens are thread B's, and add
// their own steps.
//
//   node sandbox/members.mjs members <run>     on an empty store: the admin claims and invites twice, withdraws the
//                                              second; a member joins with the first (1); the link used again and the
//                                              withdrawn one are refused, at the relay (2); a stranger without an
//                                              invite is kept out by the relay (3); the admin and the member chat, the
//                                              Aven Peer says who joined, and a message signed by a key that is no
//                                              member's is dropped by every peer (5)
//                                              (5); the member signs in with the same passkey on a second browser
//                                              profile and is a second device of their vault, which catches up on the
//                                              chat and shows their own lines as theirs; an assertion replayed for
//                                              another browser and a passkey that owns no vault are refused; the
//                                              second browser signs out and in again (7, Aven.ID.SignIn)
//   node sandbox/members.mjs restarted <run>   after the Aven Peer restarted: the same member, let in again, and the
//                                              chat kept: the Aven Peer's store holds every line (6; store/README.md)
//
// `bun run up --check` runs the phases, restarts the Aven Peer between them, and checks its hook from a stranger Peer
// dialling it directly (3). What the door admits and what a join may do is the model's (`Aven.ID.Invite`, its traces
// replayed by aven-id's and the Peer's tests); here only the box's mechanics are new.
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright';
import { lines } from './records.mjs';

const [phase, run = 'runs/latest'] = process.argv.slice(2);
const origin = 'http://localhost:5174';
const profiles = {
	admin: '/tmp/avensandbox-members-admin',
	member: '/tmp/avensandbox-members-member',
	stranger: '/tmp/avensandbox-members-stranger',
	again: '/tmp/avensandbox-members-again',
};
const state = `${run}/members.json`;
mkdirSync(run, { recursive: true });

const problems = [];
const started = Date.now();
const report = existsSync(state) ? JSON.parse(readFileSync(state, 'utf8')) : {};
const wait = (ms) => new Promise((done) => setTimeout(done, ms));

// the first line since `since` that `match` takes, waited for
async function line(match, since, timeout = 20_000) {
	const deadline = Date.now() + timeout;
	while (Date.now() < deadline) {
		const found = lines().find((l) => l.t >= since && match(l));
		if (found) return found;
		await wait(200);
	}
	return null;
}
const prod = (event) => (l) => l.peer === 'prod-peer' && l.event === event;

async function open(name) {
	const context = await chromium.launchPersistentContext(profiles[name], { viewport: { width: 1100, height: 800 } });
	const page = context.pages()[0] ?? (await context.newPage());
	const cdp = await context.newCDPSession(page);
	await cdp.send('WebAuthn.enable');
	const { authenticatorId } = await cdp.send('WebAuthn.addVirtualAuthenticator', {
		options: { protocol: 'ctap2', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true },
	});
	const b = { context, page, cdp, authenticatorId };
	b.key = await attach(page);
	return b;
}

// The page's Peer-Light, through its worker as the page reaches it, and what a page needs to make statements; again
// after every load
async function attach(page) {
	await page.goto(`${origin}/`);
	await page.locator('main[data-view]').first().waitFor({ timeout: 30_000 });
	return page.evaluate(async () => {
		// the page's Peer-Light, reached as the page reaches it: over its BroadcastChannel, from a tab of its own
		const { port } = (await import('/peer/open.js')).openWorker('network');
		const heard = [];
		// what a statement needs computed, asked of the Peer-Light and answered to this port alone
		const waiting = new Map();
		let asked = 0;
		port.onmessage = ({ data }) => {
			const line = JSON.parse(data);
			if (line.event !== 'answer') return heard.push(line);
			const { resolve, reject } = waiting.get(line.id) ?? {};
			waiting.delete(line.id);
			if (line.error === undefined) resolve?.(line.value);
			else reject?.(new Error(line.error));
		};
		port.start();
		const id = new Proxy(
			{},
			{
				get: (_, fn) =>
					(...args) =>
						new Promise((resolve, reject) => {
							waiting.set(++asked, { resolve, reject });
							port.postMessage({ ask: { id: asked, fn, args } });
						}),
			},
		);
		const hex = (buffer) => [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, '0')).join('');
		const unbase64url = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
		const assertion = async (text, credential) => {
			const allowCredentials = credential ? [{ type: 'public-key', id: credential }] : [];
			const got = await navigator.credentials.get({
				publicKey: { challenge: unbase64url(await id.challenge(text)), rpId: 'localhost', userVerification: 'required', allowCredentials },
			});
			const r = got.response;
			return { clientData: new TextDecoder().decode(r.clientDataJSON), authData: hex(r.authenticatorData), signature: hex(r.signature) };
		};
		const send = (frame, statement) => port.postMessage({ send: JSON.stringify({ frame, statement: JSON.stringify(statement) }) });
		for (let i = 0; i < 300 && !heard.some((l) => l.event === 'started'); i++) await new Promise((done) => setTimeout(done, 50));
		const me = heard.find((l) => l.event === 'started');
		window.peer = { port, heard, id, hex, assertion, send, key: me?.key };
		return me?.key;
	});
}

// The admin invites: a one-time key made here, its secret for the link, the invite signed by the admin's passkey
const invite = (b, passkey) =>
	b.page.evaluate(async (passkey) => {
		const { id, hex, assertion, send } = window.peer;
		const secret = hex(crypto.getRandomValues(new Uint8Array(32)));
		const key = await id.oneTimePublic(secret);
		send('invite', { network: 'aven', invite: key, passkey, assertion: await assertion(await id.inviteText('aven', key)) });
		return { secret, key };
	}, passkey);

const withdraw = (b, passkey, key) =>
	b.page.evaluate(
		async ({ passkey, key }) => {
			const { id, assertion, send } = window.peer;
			send('withdraw', { network: 'aven', invite: key, passkey, assertion: await assertion(await id.withdrawText('aven', key)) });
		},
		{ passkey, key },
	);

// A browser joins with a link's secret: a new passkey, the join signed by the one-time key and by it
const join = (b, secret, name) =>
	b.page.evaluate(async ({ secret, name }) => {
		const { id, hex, assertion, send, key: device } = window.peer;
		const created = await navigator.credentials.create({
			publicKey: {
				rp: { id: 'localhost', name: 'Aven' },
				user: { id: crypto.getRandomValues(new Uint8Array(16)), name: 'member', displayName: 'A member' },
				challenge: crypto.getRandomValues(new Uint8Array(32)),
				pubKeyCredParams: [{ type: 'public-key', alg: -7 }],
				authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
				attestation: 'none',
			},
		});
		const spki = hex(created.response.getPublicKey());
		const key = await id.oneTimePublic(secret);
		const [person, passkey, deviceId] = await Promise.all([id.personId(spki), id.passkeyId(spki), id.deviceId(device)]);
		const s = { network: 'aven', invite: key, person, name, passkey: { id: passkey, spki }, device: { id: deviceId, key: device } };
		const text = await id.joinText('aven', key, s.person, name, s.passkey.id, spki, s.device.id, device);
		s.signature = await id.signJoin(secret, text);
		s.assertion = await assertion(text, created.rawId);
		send('join', s);
		return s.person;
	}, { secret, name });

const say = (b, text) => b.page.evaluate((text) => window.peer.port.postMessage({ say: text }), text);

// A message signed by a key that is no member's, sent through a member's Peer-Light as it is: every peer must drop it
const forge = (b, text) =>
	b.page.evaluate(async (text) => {
		const { hex, port } = window.peer;
		const pair = await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']);
		const from = hex(await crypto.subtle.exportKey('raw', pair.publicKey));
		const at = Date.now();
		const body = `avenDB chat 1\nnetwork aven\nfrom ${from}\nat ${at}\nkind say\n${text}`;
		const sig = hex(await crypto.subtle.sign('Ed25519', pair.privateKey, new TextEncoder().encode(body)));
		port.postMessage({ post: JSON.stringify({ network: 'aven', from, at, kind: 'say', text, sig }) });
		return from;
	}, text);

const view = (b, want, timeout = 30_000) =>
	b.page
		.locator(want === 'dashboard' ? '[data-view="dashboard"]' : `[data-view="${want}"]`)
		.first()
		.waitFor({ timeout })
		.then(() => true)
		.catch(() => false);

const device = (key) => `device-${key.slice(0, 16)}`;

// A browser's passkeys: what its authenticator holds, put in place of what it held, as a synced passkey would be
const passkeysOf = async (b) => (await b.cdp.send('WebAuthn.getCredentials', { authenticatorId: b.authenticatorId })).credentials;
async function holding(b, credentials) {
	await b.cdp.send('WebAuthn.clearCredentials', { authenticatorId: b.authenticatorId });
	for (const credential of credentials) await b.cdp.send('WebAuthn.addCredential', { authenticatorId: b.authenticatorId, credential });
}

// A refusal shown on the page, and the Aven Peer added no device since `at`
async function refusedSignIn(b, what, at) {
	const shown = (await b.page.getByTestId('refused').textContent({ timeout: 15_000 }).catch(() => null))?.trim();
	if (!shown) problems.push(`${what}: no refusal shown`);
	if (await line((l) => prod('signed-in')(l), at, 2_000)) problems.push(`${what} was taken`);
	return shown;
}

// The model's trace for the member's sign-in (invites.json, "the box's check"), its tree after a step with the box's
// ids and public halves put in, as sandbox/claim.mjs holds the admin's: Ada claims, Bea joins on device 4 and signs in
// on device 5
const model = JSON.parse(readFileSync(new URL('../id/spec/vectors/invites.json', import.meta.url), 'utf8'));
const trace = model.find((v) => v.name.startsWith("the box's check"));
function sameTree(what, json, step, ids) {
	const real = JSON.parse(json ?? '{"keys":{},"vaults":{}}');
	const got = {
		keys: Object.entries(real.keys),
		vaults: Object.entries(real.vaults).map(([id, v]) => ({ id, name: v.name, kind: v.kind, owners: v.owners })),
	};
	const id = (x) => ids[x] ?? x;
	const owner = (o) => o.replace(/^(key|vault):(.*)$/, (_, kind, x) => `${kind}:${id(x)}`);
	const { keys, vaults } = trace.expected[step].tree;
	const want = {
		keys: keys.map(([k, public_]) => [id(k), ids[k] ? real.keys[ids[k]] : public_]),
		vaults: vaults.map((v) => ({ id: id(v.id), name: v.name, kind: v.kind, owners: v.owners.map(owner) })),
	};
	if (JSON.stringify(got) !== JSON.stringify(want)) problems.push(`${what}, the tree is ${JSON.stringify(got)}, not the model's ${JSON.stringify(want)}`);
}

if (phase === 'members') {
	for (const dir of Object.values(profiles)) rmSync(dir, { recursive: true, force: true });
	const since = Date.now();

	// 1. the admin claims and invites; a second browser joins with the link and is a member
	const admin = await open('admin');
	await admin.page.getByTestId('name').fill('Ada');
	await admin.page.getByTestId('claim').click();
	if (!(await view(admin, 'dashboard'))) problems.push('the admin did not claim');
	const claimed = await line((l) => prod('network')(l) && l.claimed, since);
	const passkey = Object.keys(JSON.parse(claimed?.tree ?? '{"keys":{}}').keys).find((k) => k.startsWith('passkey-'));
	const timed = Date.now();
	const first = await invite(admin, passkey);
	const second = await invite(admin, passkey);
	const invited = await line((l) => prod('network')(l) && l.invites?.length === 2, timed);
	report.inviteMs = invited ? invited.t - timed : null;
	if (!invited) problems.push('the admin\'s two invites were not taken');
	await withdraw(admin, passkey, second.key);
	if (!(await line((l) => prod('withdrawn')(l), timed))) problems.push('the withdrawal was not taken');

	const member = await open('member');
	if (!(await view(member, 'invite-only'))) problems.push('a browser without a passkey of the network sees no "invite only"');
	const keptOut = await line((l) => prod('kept-out')(l) && l.key === member.key && l.by === 'relay', since, 10_000);
	if (!keptOut) problems.push("before it joined, the relay didn't keep the member's browser out");
	const joinedAt = Date.now();
	report.person = await join(member, first.secret, 'Bea');
	const joined = await line((l) => prod('joined')(l) && l.person === report.person, joinedAt);
	if (!joined) problems.push('the join was not taken');
	if (!(await view(member, 'dashboard'))) problems.push('the member\'s browser opened no dashboard');
	report.joinMs = Date.now() - joinedAt;
	const network = await line((l) => prod('network')(l) && l.members?.length === 1, joinedAt);
	report.memberIds = network?.members;
	if (JSON.stringify(network?.members) !== JSON.stringify([report.person])) problems.push(`the members are ${JSON.stringify(network?.members)}`);
	const states = Object.fromEntries((network?.invites ?? []).map((i) => [i.key, i.state]));
	if (states[first.key] !== 'used' || states[second.key] !== 'withdrawn') problems.push(`the invites are ${JSON.stringify(states)}`);
	// the member's own Peer-Light checked the statements itself and knows the same members
	const told = await line((l) => l.peer === device(member.key) && l.event === 'network' && l.members?.includes(report.person), joinedAt);
	if (!told) problems.push("the member's Peer-Light doesn't know itself a member");
	await member.page.screenshot({ path: `${run}/members-joined.png` });

	// 2. the link used again, and the withdrawn one, are refused: the relay keeps the browser out
	const stranger = await open('stranger');
	for (const [what, link] of [['the link used again', first], ['a withdrawn link', second]]) {
		const at = Date.now();
		await join(stranger, link.secret, 'Eve');
		const refused = await stranger.page.getByTestId('refused').textContent({ timeout: 15_000 }).catch(() => null);
		if (!refused) problems.push(`${what}: no refusal shown`);
		if (await line((l) => prod('joined')(l), at, 3_000)) problems.push(`${what} was taken`);
		await attach(stranger.page);
	}
	// 3. a browser without an invite is kept out by the relay
	if (!(await line((l) => prod('kept-out')(l) && l.key === stranger.key && l.by === 'relay', since))) problems.push('the relay did not keep the stranger out');
	if (!(await view(stranger, 'invite-only'))) problems.push('the stranger sees no "invite only"');
	await stranger.page.screenshot({ path: `${run}/members-stranger.png` });
	report.stranger = stranger.key;

	// 5. the admin and the member chat; the Aven Peer said who joined; a message signed by no member's key is dropped
	const chatAt = Date.now();
	const heard = (peer, text) => line((l) => l.peer === peer && l.event === 'chat' && l.text === text, chatAt, 20_000);
	await say(admin, 'hello from the admin');
	await say(member, 'hello from the member');
	const adminDevice = device(admin.key);
	const memberDevice = device(member.key);
	const chat = {
		toMember: await heard(memberDevice, 'hello from the admin'),
		toAdmin: await heard(adminDevice, 'hello from the member'),
		toAven: await heard('prod-peer', 'hello from the member'),
	};
	report.chatMs = Object.fromEntries(Object.entries(chat).map(([k, l]) => [k, l ? l.t - chatAt : null]));
	for (const [k, l] of Object.entries(chat)) if (!l) problems.push(`the chat line ${k} did not arrive`);
	if (!lines().some((l) => l.peer === 'prod-peer' && l.event === 'chat' && l.text === 'Bea joined'))
		problems.push("the Aven Peer didn't say who joined");
	const forgedAt = Date.now();
	const forger = await forge(admin, 'let me in');
	for (const peer of ['prod-peer', memberDevice]) {
		const dropped = await line((l) => l.peer === peer && l.event === 'dropped' && l.from === forger.slice(0, 10), forgedAt, 15_000);
		if (dropped?.why !== 'notMember') problems.push(`${peer} did not drop the forged message: ${JSON.stringify(dropped)}`);
	}
	if (lines().some((l) => l.t >= forgedAt && l.event === 'chat' && l.text === 'let me in')) problems.push('a peer showed the forged message');
	await admin.page.screenshot({ path: `${run}/members-admin.png` });
	report.member = member.key;

	// 7. the member on a second browser: no new invite, the same passkey (Aven.ID.SignIn)
	const memberPasskeys = await passkeysOf(member);
	if (memberPasskeys.length !== 1) problems.push(`the member's browser holds ${memberPasskeys.length} passkeys, not the join's 1`);
	const again = await open('again');
	await holding(again, memberPasskeys);
	await again.page.goto(`${origin}/`);
	if (!(await view(again, 'invite-only'))) problems.push("the member's second browser sees no \"invite only\"");
	if (!(await again.page.getByTestId('sign-in').count())) problems.push("the member's second browser is offered no sign-in");
	const signedAt = Date.now();
	await again.page.getByTestId('sign-in').click();
	const signedIn = await line((l) => prod('signed-in')(l) && l.device === device(again.key), signedAt);
	if (!signedIn) problems.push("the member's sign-in was not taken");
	if (!(await view(again, 'dashboard'))) problems.push("the member's sign-in opened no dashboard");
	report.memberSignInMs = Date.now() - signedAt;
	const acting = await again.page.locator('[data-view="dashboard"]').first().getAttribute('data-account').catch(() => null);
	if (acting !== report.person) problems.push(`the member's second browser acts as ${acting}, not ${report.person}`);
	const afterSignIn = await line((l) => prod('network')(l) && l.tree?.includes(device(again.key)), signedAt);
	const tree = JSON.parse(afterSignIn?.tree ?? '{"keys":{},"vaults":{}}');
	const memberPasskey = tree.vaults[report.person]?.owners?.[0]?.replace(/^key:/, '');
	const adminVault = Object.entries(tree.vaults).find(([, v]) => v.kind === 'person' && v.name === 'Ada\'s vault')?.[0];
	sameTree('after the member signed in', afterSignIn?.tree, 3, {
		'person-a': adminVault, 'passkey-a': passkey, 'device-1': adminDevice,
		'person-b': report.person, 'passkey-b': memberPasskey, 'device-4': memberDevice, 'device-5': device(again.key),
	});
	// the chat's history by catch-up, the member's own line shown as theirs though another browser said it
	await again.page.goto(`${origin}/#/${report.person}/chat`);
	const bubble = (text) => again.page.getByTestId('lines').locator('li[data-from]', { hasText: text }).first();
	for (const text of ['hello from the admin', 'hello from the member'])
		if (!(await bubble(text).waitFor({ timeout: 20_000 }).then(() => true, () => false))) problems.push(`the member's second browser did not catch up on "${text}"`);
	const mine = async (text) => (await bubble(text).getAttribute('class').catch(() => '')).split(/\s+/).includes('mine');
	if (!(await mine('hello from the member'))) problems.push("the member's own line from their first browser isn't shown as theirs");
	if (await mine('hello from the admin')) problems.push("the admin's line is shown as the member's");
	await again.page.screenshot({ path: `${run}/members-signed-in-again.png` });

	// an assertion replayed for another browser fails its challenge; a passkey that owns no vault is told to ask for an
	// invite. The stranger's browser, with the member's passkey for the first, then a passkey of its own
	await holding(stranger, memberPasskeys);
	await attach(stranger.page);
	const replayAt = Date.now();
	await stranger.page.evaluate(async (other) => {
		const { id, assertion, send, key } = window.peer;
		const otherId = await id.deviceId(other);
		// the member's passkey signed a sign-in for another browser; this one sends it as its own
		const a = await assertion(await id.signInText('aven', otherId, other));
		send('sign_in', { network: 'aven', device: { id: await id.deviceId(key), key }, assertion: a });
	}, member.key);
	report.replayed = await refusedSignIn(stranger, 'a sign-in replayed for another browser', replayAt);
	await holding(stranger, []);
	await attach(stranger.page);
	await stranger.page.evaluate(() =>
		navigator.credentials.create({
			publicKey: {
				rp: { id: 'localhost', name: 'Aven' },
				user: { id: crypto.getRandomValues(new Uint8Array(16)), name: 'eve', displayName: 'Eve' },
				challenge: crypto.getRandomValues(new Uint8Array(32)),
				pubKeyCredParams: [{ type: 'public-key', alg: -7 }],
				authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
				attestation: 'none',
			},
		}),
	);
	await view(stranger, 'invite-only');
	const strangerAt = Date.now();
	await stranger.page.getByTestId('sign-in').click();
	report.strangerSignIn = await refusedSignIn(stranger, "a passkey that owns no vault", strangerAt);
	const plain = "This passkey isn't a member of Maia City. Ask the admin for an invite.";
	if (report.strangerSignIn !== plain) problems.push(`a passkey that owns no vault is told "${report.strangerSignIn}", not "${plain}"`);
	await stranger.page.screenshot({ path: `${run}/members-stranger-sign-in.png` });

	// the second browser signs out: its key is gone, it offers the sign-in again, and the passkey makes it a device again
	await again.page.getByTestId('account').click();
	await again.page.getByTestId('sign-out').click();
	await again.page.waitForURL(`${origin}/`, { timeout: 20_000 }).catch(() => {});
	const out = await attach(again.page);
	if (!(await view(again, 'invite-only'))) problems.push('a signed-out browser is still a device');
	if (!out || out === again.key) problems.push('signing out kept the browser\'s device key');
	const backAt = Date.now();
	await again.page.getByTestId('sign-in').click();
	if (!(await view(again, 'dashboard'))) problems.push('after signing out, the sign-in opened no dashboard');
	const back = await line((l) => prod('network')(l) && l.tree?.includes(device(out ?? '')), backAt);
	const backName = JSON.parse(back?.tree ?? '{"vaults":{}}').vaults[device(out ?? '')]?.name;
	if (backName !== "Bea's browser 3") problems.push(`after signing out and in, the browser is "${backName}", not "Bea's browser 3"`);
	again.key = out;
	report.again = out;
	for (const b of [admin, member, stranger, again]) await b.context.close();
}

if (phase === 'restarted') {
	// 6. a restart keeps the members and the chat: the Aven Peer loads every chain from its store
	const since = report.restartedAt ?? 0;
	const network = await line((l) => prod('network')(l) && l.claimed, since);
	if (JSON.stringify(network?.members) !== JSON.stringify(report.memberIds)) problems.push(`after a restart the members are ${JSON.stringify(network?.members)}`);
	const opened = Date.now();
	const member = await open('member');
	if (!(await view(member, 'dashboard'))) problems.push("after a restart the member's browser is no member");
	const memberDevice = device(member.key);
	if (!(await line((l) => l.peer === memberDevice && l.event === 'status' && l.phase === 'live', opened))) problems.push("after a restart the member's browser isn't live");
	await wait(1000);
	for (const text of ['hello from the admin', 'hello from the member'])
		if (!lines().some((l) => l.t >= since && l.peer === 'prod-peer' && l.event === 'chat' && l.text === text)) problems.push(`after a restart the Aven Peer lost "${text}"`);
	const at = Date.now();
	await say(member, 'hello again');
	if (!(await line((l) => l.peer === 'prod-peer' && l.event === 'chat' && l.text === 'hello again', at))) problems.push("after a restart the member's line did not arrive");
	await member.page.screenshot({ path: `${run}/members-restarted.png` });
	await member.context.close();
	// the member's second browser, a device of their vault since its sign-in, is one still
	const again = await open('again');
	if (again.key !== report.again) problems.push("after a restart the member's second browser has another key");
	if (!(await view(again, 'dashboard'))) problems.push("after a restart the member's second browser is no device");
	await again.context.close();
}

report[phase] = { ok: problems.length === 0, problems, ms: Date.now() - started };
writeFileSync(state, `${JSON.stringify(report, null, 2)}\n`);
for (const problem of problems) console.log(`avenSANDBOX: members: ${problem}`);
console.log(`avenSANDBOX: members, ${phase}: ${problems.length ? 'FAILED' : 'ok'} (${((Date.now() - started) / 1000).toFixed(1)} s)`);
process.exit(problems.length ? 1 : 0);
