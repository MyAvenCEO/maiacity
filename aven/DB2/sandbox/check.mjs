// avenSANDBOX's health check (`bun run up --check`, SANDBOX.md). Runs in the browsers' container and walks through
// avenOS: the vaults each host may act as, what each vault's Control Room and Vault show, and each Peer-Light on its
// own origin with its own OPFS, whose mark survives a reload and differs from every other origin's. The expected
// values are written out by hand from the cast's tree ("Vaults own vaults"), not computed by the code under test.
// Photographs every screen as it goes.
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright';

const expected = {
	// the vaults a host may act as: the box's own view any, a Peer-Light its vault and what it governs, a visitor none
	accounts: {
		localhost: ['alice', 'bob', 'aven'],
		'alice.localhost': ['alice', 'aven'],
		'bob.localhost': ['bob'],
		'os.localhost': [],
	},
	// the peers each vault's Control Room shows: those it governs, nothing else
	sees: { alice: ['aven-peer', 'alice-peer', 'alice-peer-light'], bob: ['bob-peer-light'], aven: ['aven-peer'] },
	// each vault's tree in the Vault app, depth first
	tree: {
		alice: ['alice', 'aven', 'aven-peer', 'alice-peer', 'alice-peer-light'],
		bob: ['bob', 'bob-peer-light'],
		aven: ['aven', 'aven-peer'],
	},
	// the vault each Peer-Light serves
	serves: { 'alice-peer-light': "Alice's vault", 'bob-peer-light': "Bob's vault" },
};

const out = process.argv[2] ?? 'runs/latest';
mkdirSync(out, { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 960 } });
const problems = [];
const differ = (what, got, want) => {
	if (JSON.stringify(got) !== JSON.stringify(want)) problems.push(`${what}: ${JSON.stringify(got)}, not ${JSON.stringify(want)}`);
};
const ids = (selector, name) => page.locator(selector).evaluateAll((els, name) => els.map((el) => el.dataset[name]), name);
const started = Date.now();

// The dashboard on every host, and the vaults its switcher offers
const accounts = {};
for (const host of Object.keys(expected.accounts)) {
	await page.goto(`http://${host}:5173/`);
	await page.getByText('Control Room').first().waitFor({ timeout: 20_000 });
	accounts[host] = await ids('[data-account]', 'account');
	differ(`${host} may act as`, accounts[host], expected.accounts[host]);
	await page.screenshot({ path: `${out}/dashboard-${host.split('.')[0]}.png` });
}
await page.goto('http://localhost:5173/#/alice');
await page.getByTestId('account').click();
await page.locator('#accounts').waitFor();
await page.screenshot({ path: `${out}/switcher.png` });
await page.keyboard.press('Escape');

// Each vault's Vault and Control Room; a Peer-Light's frame reports the vault it serves and its OPFS mark
async function controlRoom(vault, shot) {
	await page.goto(`http://localhost:5173/#/${vault}/control-room`);
	await page.locator(`[data-view="control-room"][data-account="${vault}"]`).waitFor({ timeout: 20_000 });
	const peers = await ids('[data-peer]', 'peer');
	const lights = {};
	for (const id of peers) {
		const frame = page.locator(`[data-peer="${id}"] iframe`);
		if (!(await frame.count())) continue;
		const mark = frame.contentFrame().getByTestId('mark');
		await mark.filter({ hasText: /mark [0-9a-f]{8}/ }).waitFor({ timeout: 20_000 });
		lights[id] = {
			mark: (await mark.textContent()).match(/mark ([0-9a-f]{8})/)[1],
			serves: (await frame.contentFrame().getByTestId('serves').textContent()).trim(),
		};
	}
	if (shot) await page.screenshot({ path: `${out}/control-room-${vault}.png`, fullPage: true });
	return { peers, lights };
}

const views = {};
for (const vault of Object.keys(expected.sees)) {
	views[vault] = await controlRoom(vault, true);
	differ(`${vault}'s Control Room`, views[vault].peers, expected.sees[vault]);
	await page.goto(`http://localhost:5173/#/${vault}/vault`);
	await page.locator(`[data-view="vault"][data-account="${vault}"]`).waitFor();
	differ(`${vault}'s Vault`, await ids('[data-vault]', 'vault'), expected.tree[vault]);
	if (vault === 'alice') await page.screenshot({ path: `${out}/vault-alice.png`, fullPage: true });
}

const lights = Object.assign({}, ...Object.values(views).map((view) => view.lights));
differ('Peer-Lights framed', Object.keys(lights).sort(), Object.keys(expected.serves).sort());
for (const [id, light] of Object.entries(lights)) differ(`${id} serves`, light.serves, expected.serves[id]);
for (const vault of ['alice', 'bob']) {
	const again = await controlRoom(vault, false);
	for (const [id, light] of Object.entries(again.lights))
		if (light.mark !== lights[id].mark) problems.push(`${id}'s OPFS mark changed on reload`);
}
const marks = Object.values(lights).map((light) => light.mark);
if (new Set(marks).size !== marks.length) problems.push('two Peer-Lights share one OPFS mark');
await browser.close();

const report = { ok: problems.length === 0, problems, accounts, views, ms: Date.now() - started };
writeFileSync(`${out}/check.json`, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
process.exit(report.ok ? 0 : 1);
