// avenSANDBOX's health check (`bun run up --check`, SANDBOX.md). Runs in the browsers' container and walks through
// avenOS: the vaults each host may act as, what each vault's Control Room and Vault show, and each Peer-Light on its
// own origin with its own OPFS, whose mark survives a reload and differs from every other origin's. Whom each host may
// act as, what each Control Room and Vault shows, whom each vault acts through and whom each Peer-Light serves come
// from Lean (id/spec/vectors/avenos.json, README rule 10), not from the code under test, and so do the names they are
// shown by: every vault has one in the model (Maia City, the admin coop, among them).
// Photographs every screen as it goes. First it waits until all four peers are live: Alice Peer direct to the Aven
// Peer over UDP, both Peer-Lights through the relay, each showing "4 peers"; it writes the run's timeline beside the
// screenshots. Each peer keeps a record through its store (its first start), in the backend it is configured with;
// every view that shows one must show the peer's newest. The check runs in a Chromium profile kept in a volume, so a
// Peer-Light's OPFS outlives it, as Alice Peer's folder and the Aven Peer's bucket do.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright';
import { lines as allLines, profile, records, stores } from './records.mjs';

// What avenOS shows on the cast, as the model says (`Aven.ID.OS`), and the names the page shows vaults by
const read = (path) => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'));
const avenos = read('../id/spec/vectors/avenos.json');
const shown = (key) => avenos.filter((v) => key in v.input);
const names = shown('names')[0].expected;
const vaultPath = ({ vault, target }) => (target ? `${vault}/${target}` : vault);

const expected = {
	// the people a host may act as: the box's own view anyone, a Peer-Light the person it serves, a visitor no one.
	// No person switches into Aven: it acts only through its own device, the Aven Peer
	accounts: Object.fromEntries(shown('accounts').map((v) => [v.input.accounts, v.expected])),
	// the peers each person's Control Room shows: those their vault governs, nothing else
	sees: Object.fromEntries(shown('sees').map((v) => [v.input.sees, v.expected])),
	// the Vault app's tree at #/<person>/vault/<vault>, depth first: a vault one governs opens, any other doesn't
	tree: Object.fromEntries(shown('vault').map((v) => [vaultPath(v.input), v.expected.tree])),
	// the devices the vault shown acts through, by name: Aven only through the Aven Peer
	actsThrough: Object.fromEntries(shown('vault').map((v) => [vaultPath(v.input), v.expected.actsThrough.map((id) => names[id]).join(', ')])),
	// the vault each Peer-Light serves, by name
	serves: Object.fromEntries(shown('serves').map((v) => [v.input.serves, names[v.expected]])),
	// presence, as the Aven Peer counts it: all four peers, each once
	present: ['alice-peer', 'alice-peer-light', 'aven-peer', 'bob-peer-light'],
	// each Peer-Light's own status line
	light: 'live · 4 peers',
	// how Alice Peer reaches the Aven Peer, and how each Peer-Light does
	paths: { 'alice-peer': 'direct', 'alice-peer-light': 'relay', 'bob-peer-light': 'relay' },
	// each pane's status line in the Control Room
	panes: {
		'aven-peer': 'live · 4 connected',
		'alice-peer': 'live · direct to Aven Peer',
		'alice-peer-light': 'live · 4 peers',
		'bob-peer-light': 'live · 4 peers',
	},
};

const out = process.argv[2] ?? 'runs/latest';
mkdirSync(out, { recursive: true });
// one context, as one browser: each Peer-Light origin runs one shared worker, whatever its tabs and frames
const context = await chromium.launchPersistentContext(profile, { viewport: { width: 1280, height: 960 } });
const page = await context.newPage();
const problems = [];
const differ = (what, got, want) => {
	if (JSON.stringify(got) !== JSON.stringify(want)) problems.push(`${what}: ${JSON.stringify(got)}, not ${JSON.stringify(want)}`);
};
const ids = (selector, name) => page.locator(selector).evaluateAll((els, name) => els.map((el) => el.dataset[name]), name);
const started = Date.now();

// The peers: both Peer-Lights in tabs of their own, kept open through the whole check, and the Peers' own lines
function newest() {
	const status = {};
	const paths = {};
	const lines = allLines();
	for (const line of lines) {
		if (line.event === 'status') status[line.peer] = line;
		if (line.event === 'joined' && line.peer === 'aven-peer') paths[line.from] = line.path;
	}
	return { status, paths, lines };
}
const tabs = {};
for (const id of Object.keys(expected.serves)) {
	tabs[id] = await context.newPage();
	await tabs[id].goto(`http://${id.replace('-peer-light', '')}.localhost:5173/`);
}
const peers = { ok: false };
const deadline = Date.now() + 60_000;
while (Date.now() < deadline) {
	const { status, paths } = newest();
	peers.lights = {};
	for (const [id, tab] of Object.entries(tabs))
		peers.lights[id] = (await tab.getByTestId('status').textContent().catch(() => '')).trim();
	peers.present = status['aven-peer']?.present ?? [];
	peers.alice = status['alice-peer'] && { phase: status['alice-peer'].phase, path: status['alice-peer'].path };
	peers.paths = Object.fromEntries(Object.keys(expected.paths).map((id) => [id, paths[id]]));
	if (
		Object.values(peers.lights).every((line) => line === expected.light) &&
		JSON.stringify(peers.present) === JSON.stringify(expected.present) &&
		peers.alice?.phase === 'live' &&
		peers.alice?.path === 'direct' &&
		JSON.stringify(peers.paths) === JSON.stringify(expected.paths)
	) {
		peers.ok = true;
		break;
	}
	await new Promise((done) => setTimeout(done, 250));
}
peers.ms = Date.now() - started;
if (!peers.ok) problems.push(`the four peers aren't all live after 60 s: ${JSON.stringify(peers)}`);
for (const [id, tab] of Object.entries(tabs)) await tab.screenshot({ path: `${out}/peer-light-${id.split('-')[0]}.png` });

// The dashboard on every host, and the vaults its switcher offers
const accounts = {};
for (const host of Object.keys(expected.accounts)) {
	await page.goto(`http://${host}:5173/`);
	await page.getByText('Control Room').first().waitFor({ timeout: 20_000 });
	accounts[host] = await ids('#accounts [data-account]', 'account');
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
	for (const id of peers)
		await page
			.locator(`[data-peer="${id}"] [data-testid="peer-status"]`)
			.filter({ hasText: expected.panes[id] })
			.waitFor({ timeout: 10_000 })
			.catch(async () => {
				const got = await page.locator(`[data-peer="${id}"] [data-testid="peer-status"]`).textContent();
				problems.push(`${vault}'s Control Room shows ${id} as "${got.trim()}", not "${expected.panes[id]}"`);
			});
	if (!(await page.getByTestId('timeline').locator('[data-event]').count())) problems.push(`${vault}'s Control Room has no timeline`);
	// each pane's record, as the time it names
	const shownRecords = {};
	for (const id of peers) {
		const shown = page.locator(`[data-peer="${id}"] [data-testid="record"][data-first]`);
		await shown.waitFor({ timeout: 10_000 }).catch(() => {});
		shownRecords[id] = Number(await shown.getAttribute('data-first', { timeout: 1_000 }).catch(() => null));
	}
	const lights = {};
	for (const id of peers) {
		const frame = page.locator(`[data-peer="${id}"] iframe`);
		if (!(await frame.count())) continue;
		const mark = frame.contentFrame().getByTestId('mark');
		await mark.filter({ hasText: /mark [0-9a-f]{8}/ }).waitFor({ timeout: 20_000 });
		const record = frame.contentFrame().locator('[data-testid="record"][data-first]');
		await record.waitFor({ timeout: 20_000 }).catch(() => {});
		lights[id] = {
			mark: (await mark.textContent()).match(/mark ([0-9a-f]{8})/)[1],
			serves: (await frame.contentFrame().getByTestId('serves').textContent()).trim(),
			record: Number(await record.getAttribute('data-first', { timeout: 1_000 }).catch(() => null)),
		};
	}
	if (shot) await page.screenshot({ path: `${out}/control-room-${vault}.png`, fullPage: true });
	return { peers, lights, records: shownRecords };
}

const views = {};
for (const vault of Object.keys(expected.sees)) {
	views[vault] = await controlRoom(vault, true);
	differ(`${vault}'s Control Room`, views[vault].peers, expected.sees[vault]);
}
for (const [path, tree] of Object.entries(expected.tree)) {
	const [vault, target] = path.split('/');
	await page.goto(`http://localhost:5173/#/${vault}/vault${target ? `/${target}` : ''}`);
	await page.locator(`[data-view="vault"][data-account="${vault}"][data-shown="${tree[0]}"]`).waitFor();
	differ(`${path}'s Vault`, await ids('[data-vault]', 'vault'), tree);
	// each vault by the model's name
	const shownNames = await page.locator('[data-vault] > a strong').allTextContents();
	differ(`${path}'s Vault names`, shownNames.map((n) => n.trim()), tree.map((id) => names[id]));
	if (expected.actsThrough[path])
		differ(`${path} acts through`, (await page.getByTestId('acts-through').textContent()).trim(), expected.actsThrough[path]);
	if (vault === 'alice') await page.screenshot({ path: `${out}/vault-${path.replace('/', '-')}.png`, fullPage: true });
}
// An address naming Aven as the one acting lands on the box's first person's dashboard
await page.goto('http://localhost:5173/#/aven/control-room');
await page
	.locator('[data-view="dashboard"][data-account="alice"]')
	.waitFor({ timeout: 5_000 })
	.catch(() => problems.push('#/aven/control-room opened something as Aven'));

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
await context.close();

// Each peer's record: kept in the backend it is configured with, and shown as it is in every view
const kept = records();
for (const [id, store] of Object.entries(stores))
	if (kept[id]?.store !== store) problems.push(`${id} keeps its record in ${kept[id]?.store ?? 'nothing'}, not ${store}`);
for (const [vault, view] of Object.entries(views))
	for (const [id, first] of Object.entries(view.records))
		if (first !== kept[id]?.first) problems.push(`${vault}'s Control Room shows ${id}'s record as ${first}, not ${kept[id]?.first}`);
for (const [id, light] of Object.entries(lights))
	if (light.record !== kept[id]?.first) problems.push(`${id}'s dashboard shows its record as ${light.record}, not ${kept[id]?.first}`);

// the run's timeline: every peer's lines since the Aven Peer last started, in one file
const { lines } = newest();
const since = lines.findLast((line) => line.peer === 'aven-peer' && line.event === 'started')?.t ?? 0;
writeFileSync(`${out}/timeline.jsonl`, lines.filter((line) => line.t >= since).map((line) => `${JSON.stringify(line)}\n`).join(''));

const report = { ok: problems.length === 0, problems, peers, records: kept, accounts, views, ms: Date.now() - started };
writeFileSync(`${out}/check.json`, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
process.exit(report.ok ? 0 : 1);
