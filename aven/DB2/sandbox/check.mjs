// avenSANDBOX's health check (`bun run up --check`, SANDBOX.md). Runs in the browsers' container: the control room
// shows every Peer-Light's landing page, each on its own origin with the vault the cast gives it and its own OPFS,
// whose mark survives a reload and differs from every other origin's. Writes a screenshot of the control room.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright';

const out = process.argv[2] ?? 'runs/latest';
const cast = JSON.parse(readFileSync('sandbox/cast.json', 'utf8'));
const vaultOf = (id) => Object.values(cast.vaults).find((v) => v.owners.includes(id))?.name ?? 'none';
const lights = Object.entries(cast.peers).filter(([, peer]) => peer.origin);

mkdirSync(out, { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 960 } });
const problems = [];

async function read() {
	await page.goto('http://localhost:5173/');
	const seen = {};
	for (const [id, peer] of lights) {
		const frame = page.frameLocator(`iframe[title="${peer.name}"]`);
		const mark = frame.getByTestId('mark');
		await mark.filter({ hasText: /mark [0-9a-f]{8}/ }).waitFor({ timeout: 20_000 });
		seen[id] = {
			mark: (await mark.textContent()).match(/mark ([0-9a-f]{8})/)[1],
			vault: (await frame.getByTestId('vault').textContent()).trim(),
		};
	}
	return seen;
}

const started = Date.now();
const first = await read();
const second = await read();
await page.screenshot({ path: `${out}/control-room.png`, fullPage: true });
await browser.close();

for (const [id, peer] of lights) {
	if (first[id].vault !== vaultOf(id)) problems.push(`${peer.name} shows ${first[id].vault}, not ${vaultOf(id)}`);
	if (first[id].mark !== second[id].mark) problems.push(`${peer.name}'s OPFS mark changed on reload`);
}
const marks = lights.map(([id]) => first[id].mark);
if (new Set(marks).size !== marks.length) problems.push('two Peer-Lights share one OPFS mark');

const report = { ok: problems.length === 0, problems, peerLights: first, ms: Date.now() - started };
writeFileSync(`${out}/check.json`, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
process.exit(report.ok ? 0 : 1);
