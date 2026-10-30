// Invites, joins and the chat, checked (MILESTONE2.md, "How it is checked", steps 1, 2 and 4) on production's stand-in
// at http://localhost:5174, in the browsers' container, with Chromium's virtual authenticator as claim.mjs uses it. On
// an empty store: the admin signs up and makes an invite (its link and QR code); a second profile opens the link,
// joins with a name and a passkey, and lands on its dashboard; the link used again by a third profile is refused, and
// so is an invite the admin withdrew; then the admin and the member chat both ways, the Aven Peer's join line arrives,
// and a reload empties the room. In the cast's box, Alice's and Bob's Peer-Lights chat both ways too, and Alice's
// second tab takes over her Peer-Light when the first closes. Every screen is photographed into the run's folder. What
// a line or a refusal should say comes from Lean's chat vectors or from the page that wrote it, never from this file.
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright';

const run = process.argv[2] ?? 'runs/latest';
const origin = 'http://localhost:5174';
const dirs = { admin: '/tmp/avensandbox-chat-admin', member: '/tmp/avensandbox-chat-member', stranger: '/tmp/avensandbox-chat-stranger' };
mkdirSync(run, { recursive: true });

// Lean's chat vectors (README, rule 10): the Aven Peer's join line, and the longest line a member may say
const vectors = JSON.parse(readFileSync('db/spec/vectors/chat.json', 'utf8'));
const vector = (name) => vectors.find((v) => v.name === name);
const joinVector = vector("the Aven Peer's join line");
const joinedText = (name) => joinVector.expected[0].said[0][1].replace(joinVector.input.members.at(-1), name);
const lengths = vector('an empty line, and the longest one and one byte more');
const longest = lengths.input.steps.map((step, i) => [step.message.text, lengths.expected[i].answer]).filter(([, answer]) => answer.ok).at(-1)[0];

const problems = [];
const report = {};
const started = Date.now();
const shot = (page, name) => page.screenshot({ path: `${run}/chat-${name}.png` });
const seen = (locator, timeout = 20_000) =>
	locator
		.first()
		.waitFor({ timeout })
		.then(() => true)
		.catch(() => false);

async function open(name, hash = '') {
	rmSync(dirs[name], { recursive: true, force: true });
	const context = await chromium.launchPersistentContext(dirs[name], { viewport: { width: 1100, height: 800 } });
	const page = context.pages()[0] ?? (await context.newPage());
	const cdp = await context.newCDPSession(page);
	await cdp.send('WebAuthn.enable');
	await cdp.send('WebAuthn.addVirtualAuthenticator', {
		options: { protocol: 'ctap2', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true },
	});
	await page.goto(`${origin}/${hash}`);
	return { context, page };
}

// the address within the page, so the room's lines, which live in its memory, stay
const go = (page, hash) => page.evaluate((h) => (location.hash = h), hash);
const lines = (page) => page.getByTestId('lines').locator('li[data-from]');

// 1. the admin signs up, so claims the network, and makes an invite
const admin = await open('admin');
if (!(await seen(admin.page.locator('[data-view="claim"]')))) problems.push('an empty store shows the admin no signup');
await admin.page.getByTestId('name').fill('Alice');
await admin.page.getByTestId('claim').click();
if (!(await seen(admin.page.locator('[data-view="dashboard"]')))) problems.push('the claim did not open the dashboard');
report.admin = await admin.page.locator('[data-view="dashboard"]').getAttribute('data-account').catch(() => null);
if (!(await seen(admin.page.locator(`a[href="#/${report.admin}/invite"]`)))) problems.push("the admin's dashboard has no Invite");
await shot(admin.page, 'admin-dashboard');

await go(admin.page, `#/${report.admin}/invite`);
const invite = async () => {
	await admin.page.getByTestId('make-invite').click();
	await seen(admin.page.getByTestId('invite-link'));
	return (await admin.page.getByTestId('invite-link').textContent())?.trim();
};
const link = await invite();
if (!/\/#\/join\/[0-9a-f]{64}$/.test(link ?? '')) problems.push(`the invite's link is ${link}`);
if (!(await admin.page.getByTestId('invite-qr').locator('svg').count())) problems.push('the invite shows no QR code');
if (!(await seen(admin.page.locator('[data-testid="open-invites"] li')))) problems.push('the new invite is not among the open ones');
await shot(admin.page, 'invite-made');

// a second profile opens the link, joins with a name and a passkey, and lands on its dashboard
const member = await open('member', link.slice(link.indexOf('#')));
if (!(await seen(member.page.locator('[data-view="join"]')))) problems.push("the invite's link shows no join screen");
await shot(member.page, 'join');
await member.page.getByTestId('name').fill('Bob');
const joinedAt = Date.now();
await member.page.getByTestId('join').click();
if (!(await seen(member.page.locator('[data-view="dashboard"]')))) problems.push('the join did not open the dashboard');
report.joinMs = Date.now() - joinedAt;
report.member = await member.page.locator('[data-view="dashboard"]').getAttribute('data-account').catch(() => null);
if (!report.member || report.member === report.admin) problems.push(`the member acts as ${report.member}`);
if (await member.page.locator(`a[href="#/${report.member}/invite"]`).count()) problems.push("a member's dashboard offers Invite");
await shot(member.page, 'member-dashboard');
if (!(await seen(admin.page.locator('[data-testid="open-count"]', { hasText: /^0$/ })))) problems.push('the used invite is still open');

// 2. the link used again is refused, and so is a withdrawn invite
const stranger = await open('stranger', link.slice(link.indexOf('#')));
const refusedJoin = async (what) => {
	await seen(stranger.page.locator('[data-view="join"]'));
	await stranger.page.getByTestId('name').fill('Mallory');
	await stranger.page.getByTestId('join').click();
	if (!(await seen(stranger.page.getByTestId('refused')))) problems.push(`${what}: no refusal shown`);
	if (await stranger.page.locator('[data-view="dashboard"]').count()) problems.push(`${what} let a stranger in`);
	return (await stranger.page.getByTestId('refused').textContent().catch(() => ''))?.trim();
};
report.usedAgain = await refusedJoin('the link used again');
await shot(stranger.page, 'used-again');
const withdrawn = await invite();
await seen(admin.page.locator('[data-testid="open-count"]', { hasText: /^1$/ }));
await admin.page.getByTestId('withdraw').first().click();
if (!(await seen(admin.page.locator('[data-testid="open-count"]', { hasText: /^0$/ })))) problems.push('the withdrawn invite is still open');
await shot(admin.page, 'withdrawn');
await stranger.page.goto(`${origin}/${withdrawn.slice(withdrawn.indexOf('#'))}`);
await stranger.page.reload();
report.withdrawn = await refusedJoin('a withdrawn invite');
await shot(stranger.page, 'withdrawn-refused');
await stranger.context.close();

// 4. the admin and the member chat both ways, and the Aven Peer's join line arrives
await go(admin.page, `#/${report.admin}/chat`);
await go(member.page, `#/${report.member}/chat`);
const joinLine = admin.page.getByTestId('network-line');
if (!(await seen(joinLine))) problems.push("the Aven Peer's join line did not arrive");
report.joinLine = (await joinLine.first().textContent().catch(() => ''))?.trim();
if (report.joinLine !== joinedText('Bob')) problems.push(`the join line reads "${report.joinLine}", not "${joinedText('Bob')}"`);
if (!(await seen(admin.page.locator(`[data-testid="present"] li[data-vault="${report.member}"]`)))) problems.push('the admin sees no member present');
const sayAndHear = async (from, to, text) => {
	const at = Date.now();
	await from.getByTestId('line').fill(text);
	await from.getByTestId('say').click();
	if (!(await seen(to.getByTestId('lines').locator('li', { hasText: text })))) problems.push(`"${text}" did not arrive`);
	return Date.now() - at;
};
report.adminToMemberMs = await sayAndHear(admin.page, member.page, 'hello from the admin');
report.memberToAdminMs = await sayAndHear(member.page, admin.page, 'hello back from the member');
// the longest line arrives whole, and one byte more arrives nowhere
await sayAndHear(admin.page, member.page, longest);
await admin.page.getByTestId('line').fill(`${longest}b`);
await admin.page.getByTestId('say').click();
await member.page.waitForTimeout(2000);
if (await member.page.getByTestId('lines').locator('li', { hasText: `${longest}b` }).count()) problems.push('a line longer than the longest arrived');
report.lines = (await lines(admin.page).allTextContents()).map((text) => (text.length > 80 ? `${text.slice(0, 40)}… (${text.length})` : text));
await shot(admin.page, 'room-admin');
await shot(member.page, 'room-member');

// a reload empties the room
await admin.page.reload();
await seen(admin.page.locator('[data-view="chat"]'));
await admin.page.waitForTimeout(1000);
report.afterReload = await lines(admin.page).count();
if (report.afterReload) problems.push(`after a reload the room holds ${report.afterReload} lines`);
await shot(admin.page, 'room-reloaded');
for (const b of [admin, member]) await b.context.close();

// in the cast's box, Alice's and Bob's Peer-Lights chat the same way (MILESTONE2.md, "How it is checked")
const cast = await chromium.launch();
const castPage = async (who) => {
	// a context of its own, so a second tab of the same person can open in it (the takeover, below)
	const page = await (await cast.newContext({ viewport: { width: 1100, height: 600 } })).newPage();
	await page.goto(`http://${who}.localhost:5173/#/${who}/chat`);
	await seen(page.locator('[data-view="chat"]'));
	return page;
};
const alice = await castPage('alice');
const bob = await castPage('bob');
await seen(bob.locator('[data-testid="present"] li[data-vault="alice"]'));
report.castAliceToBobMs = await sayAndHear(alice, bob, `alice to bob, ${started}`);
report.castBobToAliceMs = await sayAndHear(bob, alice, `bob to alice, ${started}`);
await shot(bob, 'cast-bob');

// the leader's tab closes (store/README.md, the opfs driver, 3): Alice's first tab holds the Web Lock and runs her
// Peer-Light; a second tab of hers follows it. Closed, the follower takes over within 5 s, and its line still arrives
const follower = await alice.context().newPage();
await follower.goto(`http://alice.localhost:5173/#/alice`);
await seen(follower.locator('[data-testid="status"][data-phase="live"]'));
const closed = Date.now();
await alice.close();
// the Web Lock passes to the follower, which starts the Peer-Light again: starting, connecting, live
const led = await follower
	.waitForFunction(() => globalThis.__avenLeader, null, { timeout: 5_000 })
	.then(() => follower.evaluate(() => globalThis.__avenLeader), () => null);
report.takeoverLockMs = led && led - closed;
const restarted = led && (await follower.waitForFunction(() => document.querySelector('[data-testid="status"]')?.dataset.phase !== 'live', null, { timeout: 2_000 }).then(() => true, () => false));
const live = restarted && (await seen(follower.locator('[data-testid="status"][data-phase="live"]'), 5_000));
report.takeoverMs = Date.now() - closed;
if (!led || !live || report.takeoverMs > 5_000) problems.push(`Alice's second tab didn't take over within 5 s of her first closing (${JSON.stringify({ lock: report.takeoverLockMs, restarted, live, ms: report.takeoverMs })})`);
await follower.evaluate(() => (location.hash = '#/alice/chat'));
await seen(follower.locator('[data-view="chat"]'));
// the new Peer-Light joins the room again before a line reaches anyone: the old one's connection, under the same key,
// lingers at the Aven Peer for about 2 s (measured 2.2 to 2.3 s, 30 Oct 2026), and gossip keeps nothing for a peer not
// in it yet. So Alice says a line each second until Bob hears one, within 10 s. A line said in that gap is lost until
// the city-dome's chains land: they upload a device's own lines the Aven Peer lacks, which covers it
let through = false;
for (let i = 0; i < 10 && !through; i++) {
	const text = `alice after the takeover ${i}, ${started}`;
	await follower.getByTestId('line').fill(text);
	await follower.getByTestId('say').click();
	through = await bob.getByTestId('lines').locator('li', { hasText: text }).waitFor({ timeout: 1_000 }).then(() => true, () => false);
}
report.castAfterTakeoverMs = Date.now() - closed;
if (!through) problems.push(`no line of Alice's second tab reached Bob within 10 s of the takeover`);
await shot(follower, 'cast-takeover');
await cast.close();

report.ok = problems.length === 0;
report.problems = problems;
report.ms = Date.now() - started;
writeFileSync(`${run}/chat.json`, `${JSON.stringify(report, null, 2)}\n`);
for (const problem of problems) console.log(`avenSANDBOX: chat: ${problem}`);
console.log(`avenSANDBOX: chat: ${problems.length ? 'FAILED' : 'ok'} (${(report.ms / 1000).toFixed(1)} s)`);
process.exit(problems.length ? 1 : 0);
