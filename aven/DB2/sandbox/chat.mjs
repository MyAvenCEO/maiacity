// Invites, joins and the chat, checked (MILESTONE2.md, "How it is checked", steps 1, 2 and 4) on production's stand-in
// at http://localhost:5174, in the browsers' container, with Chromium's virtual authenticator as claim.mjs uses it. On
// an empty store: the admin signs up and makes an invite (its link and QR code); a second profile opens the link,
// joins with a name and a passkey, and lands on its dashboard; the link used again by a third profile is refused, and
// so is an invite the admin withdrew; then the admin and the member chat both ways, the Aven Peer's join line arrives,
// and a reload empties the room. Every screen is photographed into the run's folder. Nothing here writes what a peer
// should answer: a line must arrive as it was written, and a refusal must be shown and change nothing.
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright';

const run = process.argv[2] ?? 'runs/latest';
const origin = 'http://localhost:5174';
const dirs = { admin: '/tmp/avensandbox-chat-admin', member: '/tmp/avensandbox-chat-member', stranger: '/tmp/avensandbox-chat-stranger' };
mkdirSync(run, { recursive: true });

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
const name = admin.page.getByTestId('signup-name');
if (await name.count()) await name.fill('Alice');
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
if (!/\/#\/join\/[A-Za-z0-9_-]+\.[0-9a-f]{64}$/.test(link ?? '')) problems.push(`the invite's link is ${link}`);
if (!(await admin.page.getByTestId('invite-qr').locator('svg').count())) problems.push('the invite shows no QR code');
if (!(await seen(admin.page.locator('[data-testid="open-invites"] li')))) problems.push('the new invite is not among the open ones');
await shot(admin.page, 'invite-made');

// a second profile opens the link, joins with a name and a passkey, and lands on its dashboard
const member = await open('member', link.slice(link.indexOf('#')));
if (!(await seen(member.page.locator('[data-view="join"]')))) problems.push("the invite's link shows no join screen");
await shot(member.page, 'join');
await member.page.getByTestId('join-name').fill('Bob');
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
	await stranger.page.getByTestId('join-name').fill('Mallory');
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
const joinLine = admin.page.getByTestId('joined-line');
if (!(await seen(joinLine))) problems.push("the Aven Peer's join line did not arrive");
else if (!(await joinLine.first().textContent()).includes('Bob')) problems.push(`the join line names no Bob: ${await joinLine.first().textContent()}`);
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
report.lines = await lines(admin.page).allTextContents();
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

report.ok = problems.length === 0;
report.problems = problems;
report.ms = Date.now() - started;
writeFileSync(`${run}/chat.json`, `${JSON.stringify(report, null, 2)}\n`);
for (const problem of problems) console.log(`avenSANDBOX: chat: ${problem}`);
console.log(`avenSANDBOX: chat: ${problems.length ? 'FAILED' : 'ok'} (${(report.ms / 1000).toFixed(1)} s)`);
process.exit(problems.length ? 1 : 0);
