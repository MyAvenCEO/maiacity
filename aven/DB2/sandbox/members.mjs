// The members' network, checked at the Peer level (MILESTONE2.md, "How it is checked": steps 1–3, 5 and 6), in the
// browsers' container: avenOS at http://localhost:5174 in front of compose's `prod`, an Aven Peer in production's
// configuration, with Chromium's virtual authenticator. Each browser profile's Peer-Light is driven through its worker,
// as the page drives it: statements made with aven-id's wasm (os/web/id.js) and signed by the profile's passkey. What
// the peers did is read from their own timeline lines. avenOS's Invite, Join and Chat screens are thread B's, and add
// their own steps.
//
//   node sandbox/members.mjs members <run>     on an empty store: the admin claims and invites twice, withdraws the
//                                              second; a member joins with the first (1); the link used again and the
//                                              withdrawn one are refused, at the relay (2); a stranger without an
//                                              invite is kept out by the relay (3); the admin and the member chat, the
//                                              Aven Peer says who joined, and a message signed by a key that is no
//                                              member's is dropped by every peer (5)
//   node sandbox/members.mjs restarted <run>   after the Aven Peer restarted: the same member, let in again, and an
//                                              empty chat (6)
//
// `bun run up --check` runs the phases, restarts the Aven Peer between them, and checks its hook from a stranger Peer
// dialling it directly (3). What the door admits and what a join may do is the model's (`Aven.ID.Invite`, its traces
// replayed by aven-id's and the Peer's tests); here only the box's mechanics are new.
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright';
import { lines } from './records.mjs';

const [phase, run = 'runs/latest'] = process.argv.slice(2);
const origin = 'http://localhost:5174';
const profiles = { admin: '/tmp/avensandbox-members-admin', member: '/tmp/avensandbox-members-member', stranger: '/tmp/avensandbox-members-stranger' };
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
	await cdp.send('WebAuthn.addVirtualAuthenticator', {
		options: { protocol: 'ctap2', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true },
	});
	const b = { context, page };
	b.key = await attach(page);
	return b;
}

// The page's Peer-Light, through its worker as the page reaches it, and what a page needs to make statements; again
// after every load
async function attach(page) {
	await page.goto(`${origin}/`);
	await page.locator('main[data-view]').first().waitFor({ timeout: 30_000 });
	return page.evaluate(async () => {
		// the page's own worker, opened as the page opens it: Vite names the worker's URL, and a shared worker is its URL
		// and name
		const { worker } = (await import('/peer/open.js')).openWorker('network');
		const heard = [];
		worker.port.onmessage = ({ data }) => heard.push(JSON.parse(data));
		worker.port.start();
		const id = await import('/id.js');
		const hex = (buffer) => [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, '0')).join('');
		const unbase64url = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
		const assertion = async (text, credential) => {
			const allowCredentials = credential ? [{ type: 'public-key', id: credential }] : [];
			const got = await navigator.credentials.get({
				publicKey: { challenge: unbase64url(id.challenge(text)), rpId: 'localhost', userVerification: 'required', allowCredentials },
			});
			const r = got.response;
			return { clientData: new TextDecoder().decode(r.clientDataJSON), authData: hex(r.authenticatorData), signature: hex(r.signature) };
		};
		const send = (frame, statement) => worker.port.postMessage({ send: JSON.stringify({ frame, statement: JSON.stringify(statement) }) });
		for (let i = 0; i < 300 && !heard.some((l) => l.event === 'started'); i++) await new Promise((done) => setTimeout(done, 50));
		const me = heard.find((l) => l.event === 'started');
		window.peer = { worker, heard, id, hex, assertion, send, key: me?.key };
		return me?.key;
	});
}

// The admin invites: a one-time key made here, its secret for the link, the invite signed by the admin's passkey
const invite = (b, passkey) =>
	b.page.evaluate(async (passkey) => {
		const { id, hex, assertion, send } = window.peer;
		const secret = hex(crypto.getRandomValues(new Uint8Array(32)));
		const key = id.oneTimePublic(secret);
		send('invite', { network: 'aven', invite: key, passkey, assertion: await assertion(id.inviteText('aven', key)) });
		return { secret, key };
	}, passkey);

const withdraw = (b, passkey, key) =>
	b.page.evaluate(
		async ({ passkey, key }) => {
			const { id, assertion, send } = window.peer;
			send('withdraw', { network: 'aven', invite: key, passkey, assertion: await assertion(id.withdrawText('aven', key)) });
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
		const key = id.oneTimePublic(secret);
		const s = { network: 'aven', invite: key, person: id.personId(spki), name, passkey: { id: id.passkeyId(spki), spki }, device: { id: id.deviceId(device), key: device } };
		const text = id.joinText('aven', key, s.person, name, s.passkey.id, spki, s.device.id, device);
		s.signature = id.signJoin(secret, text);
		s.assertion = await assertion(text, created.rawId);
		send('join', s);
		return s.person;
	}, { secret, name });

const say = (b, text) => b.page.evaluate((text) => window.peer.worker.port.postMessage({ say: text }), text);

// A message signed by a key that is no member's, sent through a member's Peer-Light as it is: every peer must drop it
const forge = (b, text) =>
	b.page.evaluate(async (text) => {
		const { hex, worker } = window.peer;
		const pair = await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']);
		const from = hex(await crypto.subtle.exportKey('raw', pair.publicKey));
		const at = Date.now();
		const body = `avenDB chat 1\nnetwork aven\nfrom ${from}\nat ${at}\nkind say\n${text}`;
		const sig = hex(await crypto.subtle.sign('Ed25519', pair.privateKey, new TextEncoder().encode(body)));
		worker.port.postMessage({ post: JSON.stringify({ network: 'aven', from, at, kind: 'say', text, sig }) });
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
	for (const b of [admin, member, stranger]) await b.context.close();
}

if (phase === 'restarted') {
	// 6. a restart keeps the members and empties the chat
	const since = report.restartedAt ?? 0;
	const network = await line((l) => prod('network')(l) && l.claimed, since);
	if (JSON.stringify(network?.members) !== JSON.stringify(report.memberIds)) problems.push(`after a restart the members are ${JSON.stringify(network?.members)}`);
	const opened = Date.now();
	const member = await open('member');
	if (!(await view(member, 'dashboard'))) problems.push("after a restart the member's browser is no member");
	const memberDevice = device(member.key);
	if (!(await line((l) => l.peer === memberDevice && l.event === 'status' && l.phase === 'live', opened))) problems.push("after a restart the member's browser isn't live");
	await wait(1000);
	if (lines().some((l) => l.t >= since && l.event === 'chat' && l.text?.startsWith('hello from'))) problems.push('after a restart the chat still holds the lines before');
	const at = Date.now();
	await say(member, 'hello again');
	if (!(await line((l) => l.peer === 'prod-peer' && l.event === 'chat' && l.text === 'hello again', at))) problems.push("after a restart the member's line did not arrive");
	await member.page.screenshot({ path: `${run}/members-restarted.png` });
	await member.context.close();
}

report[phase] = { ok: problems.length === 0, problems, ms: Date.now() - started };
writeFileSync(state, `${JSON.stringify(report, null, 2)}\n`);
for (const problem of problems) console.log(`avenSANDBOX: members: ${problem}`);
console.log(`avenSANDBOX: members, ${phase}: ${problems.length ? 'FAILED' : 'ok'} (${((Date.now() - started) / 1000).toFixed(1)} s)`);
process.exit(problems.length ? 1 : 0);
